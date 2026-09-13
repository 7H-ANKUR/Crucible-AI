"""app/api/core/routing/config.py — routing cost model configuration.

Every weight, threshold and vehicle profile the router uses lives here so the
cost function can be retuned without touching the search. Values are overridable
from the environment, which is how a site tunes the model to its own conditions
without a redeploy.

The cost of traversing an edge is

    cost = alpha*distance_km
         + beta*slope + gamma*flood + delta*road
         + epsilon*mining + zeta*weather + eta*traffic

where each risk term is a 0..1 factor multiplied by the edge length, so risk is
accumulated per kilometre travelled rather than per cell visited. Without that
normalisation a fine grid would penalise risk more than a coarse one for the
same physical route.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from typing import Any


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class CostWeights:
    """Relative importance of each term, in cost-units per kilometre.

    ``alpha`` is the pure distance term and anchors the scale: with alpha=1.0 a
    weight of 2.5 means "a fully hazardous kilometre costs the same as 3.5 km of
    safe road", which is the number to argue about when tuning.
    """

    alpha_distance: float = field(default_factory=lambda: _env_float("ROUTE_W_DISTANCE", 1.0))
    beta_slope: float = field(default_factory=lambda: _env_float("ROUTE_W_SLOPE", 2.2))
    gamma_flood: float = field(default_factory=lambda: _env_float("ROUTE_W_FLOOD", 3.0))
    delta_road: float = field(default_factory=lambda: _env_float("ROUTE_W_ROAD", 2.5))
    epsilon_mining: float = field(default_factory=lambda: _env_float("ROUTE_W_MINING", 2.0))
    zeta_weather: float = field(default_factory=lambda: _env_float("ROUTE_W_WEATHER", 1.5))
    eta_traffic: float = field(default_factory=lambda: _env_float("ROUTE_W_TRAFFIC", 1.2))

    def as_dict(self) -> dict[str, float]:
        return asdict(self)

    @property
    def risk_weights(self) -> dict[str, float]:
        """Only the risk terms, keyed by the factor names used in explanations."""
        return {
            "slope": self.beta_slope,
            "flood": self.gamma_flood,
            "road": self.delta_road,
            "mining": self.epsilon_mining,
            "weather": self.zeta_weather,
            "traffic": self.eta_traffic,
        }

    @property
    def max_risk_weight_sum(self) -> float:
        return sum(self.risk_weights.values())


@dataclass(frozen=True)
class HardConstraints:
    """Conditions that make a cell impassable rather than merely expensive.

    These are not high costs. A haul truck does not "prefer not to" enter an
    active blast zone — it must not, and the search must never return a path
    through one however much cheaper it looks.
    """

    block_restricted_zones: bool = True
    block_active_excavation: bool = True
    #: Flood depth factor at or above which a cell is impassable.
    flood_block_threshold: float = field(
        default_factory=lambda: _env_float("ROUTE_FLOOD_BLOCK", 0.85)
    )
    #: Slope (degrees) above which a loaded haul truck cannot climb safely.
    slope_block_degrees: float = field(
        default_factory=lambda: _env_float("ROUTE_SLOPE_BLOCK_DEG", 18.0)
    )


@dataclass(frozen=True)
class VehicleProfile:
    """How a vehicle class experiences the terrain.

    A haul truck is slower, more slope-sensitive and more flood-vulnerable than
    a light utility vehicle, so the same grid produces different routes for
    different vehicles — which is the point of modelling the vehicle at all.
    """

    name: str
    base_speed_kmh: float
    #: Multiplies the slope term. >1 means this vehicle suffers more on grades.
    slope_sensitivity: float
    flood_sensitivity: float
    road_sensitivity: float
    #: Maximum safe gradient in degrees; overrides the global constraint if lower.
    max_grade_degrees: float
    payload_tonnes: float


VEHICLE_PROFILES: dict[str, VehicleProfile] = {
    "haul_truck": VehicleProfile(
        name="haul_truck",
        base_speed_kmh=28.0,
        slope_sensitivity=1.45,
        flood_sensitivity=1.30,
        road_sensitivity=1.25,
        max_grade_degrees=12.0,
        payload_tonnes=55.0,
    ),
    "articulated_dumper": VehicleProfile(
        name="articulated_dumper",
        base_speed_kmh=32.0,
        slope_sensitivity=1.15,
        flood_sensitivity=0.95,
        road_sensitivity=0.90,
        max_grade_degrees=16.0,
        payload_tonnes=32.0,
    ),
    "water_tanker": VehicleProfile(
        name="water_tanker",
        base_speed_kmh=35.0,
        slope_sensitivity=1.25,
        flood_sensitivity=1.10,
        road_sensitivity=1.10,
        max_grade_degrees=14.0,
        payload_tonnes=18.0,
    ),
    "light_vehicle": VehicleProfile(
        name="light_vehicle",
        base_speed_kmh=48.0,
        slope_sensitivity=0.80,
        flood_sensitivity=1.45,  # low clearance — standing water stops it sooner
        road_sensitivity=1.35,
        max_grade_degrees=20.0,
        payload_tonnes=0.5,
    ),
}

DEFAULT_VEHICLE = "haul_truck"


def get_vehicle(name: str | None) -> VehicleProfile:
    return VEHICLE_PROFILES.get((name or DEFAULT_VEHICLE).lower(), VEHICLE_PROFILES[DEFAULT_VEHICLE])


# ---------------------------------------------------------------------------
# Risk banding
# ---------------------------------------------------------------------------

#: (inclusive lower bound, label, UI colour token). Banding is on 0..100.
RISK_BANDS: list[tuple[int, str, str]] = [
    (0, "Safe", "ok"),
    (21, "Low Risk", "ok2"),
    (41, "Moderate", "warn"),
    (61, "High Risk", "danger"),
    (81, "Critical", "critical"),
]


def risk_band(score: float) -> tuple[str, str]:
    """Map a 0..100 risk score to (label, colour token)."""
    label, colour = RISK_BANDS[0][1], RISK_BANDS[0][2]
    for lower, name, tone in RISK_BANDS:
        if score >= lower:
            label, colour = name, tone
    return label, colour


@dataclass(frozen=True)
class GridConfig:
    """Spatial resolution of the routing graph.

    Resolution is a real trade-off: a finer grid follows terrain more faithfully
    but squares the search space. 64x64 over an 8 km box gives ~125 m cells,
    which is about the turning envelope of a loaded haul truck.
    """

    cells: int = field(default_factory=lambda: _env_int("ROUTE_GRID_CELLS", 64))
    radius_km: float = field(default_factory=lambda: _env_float("ROUTE_GRID_RADIUS_KM", 8.0))
    #: Allow diagonal movement. 8-connected paths look far more natural than
    #: 4-connected ones, which produce visible staircase artefacts on a map.
    diagonal: bool = True

    def __post_init__(self) -> None:
        if not 8 <= self.cells <= 256:
            object.__setattr__(self, "cells", 64)
        if not 0.5 <= self.radius_km <= 60.0:
            object.__setattr__(self, "radius_km", 8.0)


@dataclass(frozen=True)
class RoutingConfig:
    weights: CostWeights = field(default_factory=CostWeights)
    constraints: HardConstraints = field(default_factory=HardConstraints)
    grid: GridConfig = field(default_factory=GridConfig)

    def describe(self) -> dict[str, Any]:
        """Configuration as returned by the API, so the UI can show the tuning."""
        return {
            "weights": self.weights.as_dict(),
            "constraints": asdict(self.constraints),
            "grid": {
                "cells": self.grid.cells,
                "radius_km": self.grid.radius_km,
                "diagonal": self.grid.diagonal,
            },
            "risk_bands": [
                {"from": lo, "label": name, "tone": tone} for lo, name, tone in RISK_BANDS
            ],
            "vehicles": {
                k: asdict(v) for k, v in VEHICLE_PROFILES.items()
            },
        }


def load_config() -> RoutingConfig:
    """Build the configuration from the current environment."""
    return RoutingConfig()
