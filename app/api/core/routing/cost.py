"""app/api/core/routing/cost.py — the traversal cost surface.

Turns the terrain layers into the per-cell risk factors the search consumes,
and combines them into a single cost per kilometre.

Risk is expressed per kilometre, not per cell. An edge between two cells costs
``(alpha + sum(weight_i * factor_i)) * edge_length_km``, so halving the grid
spacing does not double the accumulated risk of the same physical route. That
normalisation is what makes the grid resolution a rendering choice rather than a
parameter that silently changes every answer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from .config import CostWeights, HardConstraints, VehicleProfile
from .terrain import Conditions, TerrainGrid

#: Order is fixed: it defines the factor vector layout used everywhere
#: downstream, including the explanation breakdown and the heatmap layers.
FACTORS: tuple[str, ...] = ("slope", "flood", "road", "mining", "weather", "traffic")

FACTOR_LABELS: dict[str, str] = {
    "slope": "Terrain slope",
    "flood": "Flood / standing water",
    "road": "Road condition",
    "mining": "Active mining zones",
    "weather": "Weather",
    "traffic": "Vehicle traffic",
}


@dataclass
class CostSurface:
    """Per-cell risk factors and the resulting traversal cost per kilometre."""

    grid: TerrainGrid
    weights: CostWeights
    vehicle: VehicleProfile
    conditions: Conditions

    factors: dict[str, np.ndarray]
    blocked: np.ndarray
    cost_per_km: np.ndarray
    risk_0_100: np.ndarray

    # -- per-cell queries --------------------------------------------------

    def factor_vector(self, row: int, col: int) -> dict[str, float]:
        return {name: float(self.factors[name][row, col]) for name in FACTORS}

    def dominant_factor(self, row: int, col: int) -> str:
        """Which factor contributes most to this cell's cost.

        Weighted, not raw: a high raw value on a lightly-weighted factor is not
        what is actually driving the cost.
        """
        weights = self.weights.risk_weights
        return max(FACTORS, key=lambda f: weights[f] * float(self.factors[f][row, col]))

    def speed_kmh(self, row: int, col: int) -> float:
        """Achievable speed in a cell, for travel-time estimation.

        Modelled as multiplicative degradations because they compound: a wet,
        steep, congested road is worse than any single term suggests.
        """
        v = self.vehicle
        slope = float(self.factors["slope"][row, col])
        road = float(self.factors["road"][row, col])
        traffic = float(self.factors["traffic"][row, col])
        flood = float(self.factors["flood"][row, col])
        weather = float(self.factors["weather"][row, col])

        speed = v.base_speed_kmh
        speed *= 1.0 - 0.55 * slope
        speed *= 1.0 - 0.45 * road
        speed *= 1.0 - 0.50 * traffic
        speed *= 1.0 - 0.40 * flood
        speed *= 1.0 - 0.25 * weather
        # Never zero: a blocked cell is excluded by the mask, not by an
        # infinite traversal time, and a divide-by-zero here would be a crash
        # rather than a routing decision.
        return max(3.0, speed)

    @property
    def min_cost_per_km(self) -> float:
        """Cheapest traversable kilometre anywhere on the grid.

        This is the admissible heuristic's scaling constant: no route can beat
        it, so straight-line distance times this value never overestimates.
        """
        traversable = self.cost_per_km[~self.blocked]
        if traversable.size == 0:
            return float(self.weights.alpha_distance)
        return float(max(self.weights.alpha_distance, traversable.min()))


def build_cost_surface(
    grid: TerrainGrid,
    weights: CostWeights,
    constraints: HardConstraints,
    vehicle: VehicleProfile,
    conditions: Conditions,
) -> CostSurface:
    """Compute every factor layer and the combined cost surface."""
    n = grid.n

    slope = grid.slope_risk() * vehicle.slope_sensitivity
    flood = grid.flood_risk(conditions) * vehicle.flood_sensitivity
    road = grid.road_risk(conditions) * vehicle.road_sensitivity
    mining = grid.mining_risk(conditions)
    traffic = grid.traffic(conditions)

    # Weather is reported for the site as a whole, but its effect is not
    # uniform: exposure rises with elevation and on poor surfaces.
    exposure = 0.5 + 0.5 * _unit(grid.elevation_m)
    weather = np.clip(conditions.weather_severity * exposure * (1.0 + 0.3 * road), 0.0, 1.0)

    factors: dict[str, np.ndarray] = {
        "slope": np.clip(slope, 0.0, 1.0),
        "flood": np.clip(flood, 0.0, 1.0),
        "road": np.clip(road, 0.0, 1.0),
        "mining": np.clip(mining, 0.0, 1.0),
        "weather": np.clip(weather, 0.0, 1.0),
        "traffic": np.clip(traffic, 0.0, 1.0),
    }

    w = weights.risk_weights
    risk_weighted = np.zeros((n, n), dtype=np.float64)
    for name in FACTORS:
        risk_weighted += w[name] * factors[name]

    cost_per_km = weights.alpha_distance + risk_weighted

    # Risk on 0..100, normalised by the maximum the weighting can produce, so
    # the score means the same thing regardless of how the weights are tuned.
    risk_0_100 = np.clip(100.0 * risk_weighted / max(1e-9, weights.max_risk_weight_sum), 0.0, 100.0)

    blocked = grid.blocked_mask(conditions, constraints, vehicle)

    return CostSurface(
        grid=grid,
        weights=weights,
        vehicle=vehicle,
        conditions=conditions,
        factors=factors,
        blocked=blocked,
        cost_per_km=cost_per_km,
        risk_0_100=risk_0_100,
    )


def _unit(a: np.ndarray) -> np.ndarray:
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


def heatmap_payload(
    surface: CostSurface,
    layer: str = "overall",
    max_cells: int = 64,
) -> dict[str, Any]:
    """Serialise a risk layer for the map.

    Downsampled by block-mean when the grid is finer than ``max_cells``: a
    128x128 grid is 16k cells, which is more JSON than a browser should parse to
    draw a heatmap whose features are far coarser than its resolution.
    """
    from .config import risk_band

    if layer == "overall":
        field = surface.risk_0_100
    elif layer in surface.factors:
        field = surface.factors[layer] * 100.0
    else:
        raise ValueError(f"Unknown heatmap layer '{layer}'")

    grid = surface.grid
    n = grid.n
    step = max(1, n // max_cells)

    if step > 1:
        trimmed = (n // step) * step
        field = field[:trimmed, :trimmed].reshape(trimmed // step, step, trimmed // step, step).mean(axis=(1, 3))
        blocked = surface.blocked[:trimmed, :trimmed].reshape(trimmed // step, step, trimmed // step, step).any(axis=(1, 3))
    else:
        blocked = surface.blocked

    rows, cols = field.shape
    cells = []
    for r in range(rows):
        for c in range(cols):
            score = float(field[r, c])
            label, tone = risk_band(score)
            src_r, src_c = min(n - 1, r * step + step // 2), min(n - 1, c * step + step // 2)
            lat, lon = grid.cell_center(src_r, src_c)
            cells.append(
                {
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "risk": round(score, 1),
                    "band": label,
                    "tone": tone,
                    "dominant": surface.dominant_factor(src_r, src_c) if layer == "overall" else layer,
                    "blocked": bool(blocked[r, c]),
                }
            )

    return {
        "layer": layer,
        "label": "Overall risk" if layer == "overall" else FACTOR_LABELS.get(layer, layer),
        "rows": rows,
        "cols": cols,
        "bounds": {
            "lat_min": grid.lat_min, "lat_max": grid.lat_max,
            "lon_min": grid.lon_min, "lon_max": grid.lon_max,
        },
        "cell_size_km": round(grid.cell_size_km * step, 4),
        "cells": cells,
        "data_origin": "SYNTHETIC",
    }
