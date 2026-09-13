"""app/api/core/routing/terrain.py — the spatial risk surface the router searches.

Builds a grid of cells around a mine, each carrying the physical attributes the
cost function consumes: elevation, slope, road quality, flood exposure,
landslide susceptibility, mining activity, traffic and access restrictions.

Two properties matter more than realism here:

**Determinism.** The same mine and the same conditions must produce the same
grid on every call. A route that changes between two identical requests is
not a recommendation, it is noise — and the "recompute after rainfall" story
only means anything if the *only* thing that changed was the rainfall.

**Physical coherence.** Slope is computed from the elevation field rather than
sampled independently, flood risk accumulates in low-lying cells rather than
being sprinkled at random, and roads follow low-gradient lines. Independently
random layers produce a map that falls apart under any scrutiny — cliffs that
flood, roads that climb walls.

Terrain is synthetic and labelled as such, consistent with the platform's
synthetic data policy. `load_overrides()` is where surveyed data replaces it.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import numpy as np

from .config import GridConfig

EARTH_RADIUS_KM = 6371.0088


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


# ---------------------------------------------------------------------------
# Deterministic value noise
# ---------------------------------------------------------------------------

def _seed_for(mine_id: str, layer: str) -> int:
    digest = hashlib.sha256(f"{mine_id}:{layer}".encode()).digest()
    return int.from_bytes(digest[:4], "big")


def _smooth_noise(n: int, seed: int, octaves: int = 4, base_lattice: int = 2) -> np.ndarray:
    """Fractal value noise on an n x n grid, normalised to 0..1.

    Layered coarse-to-fine so the result has both broad landforms and local
    texture, the way real terrain does. Bilinear upsampling of a small lattice
    is enough here and avoids a gradient-noise implementation nobody needs to
    read.

    ``base_lattice`` sets the coarsest octave. Raising it produces a layer that
    is fine-grained at full amplitude, which is how local relief is generated:
    stacking more octaves onto a coarse base cannot do it, because each octave
    carries half the amplitude of the one before and the fine detail arrives too
    faint to create a real gradient.
    """
    rng = np.random.default_rng(seed)
    field = np.zeros((n, n), dtype=np.float64)
    amplitude = 1.0
    total = 0.0

    for octave in range(octaves):
        lattice = max(2, base_lattice * (2 ** octave) + 1)
        coarse = rng.random((lattice, lattice))

        # Bilinear upsample the lattice to the full grid.
        ys = np.linspace(0, lattice - 1, n)
        xs = np.linspace(0, lattice - 1, n)
        y0 = np.clip(np.floor(ys).astype(int), 0, lattice - 2)
        x0 = np.clip(np.floor(xs).astype(int), 0, lattice - 2)
        ty = (ys - y0)[:, None]
        tx = (xs - x0)[None, :]

        c00 = coarse[np.ix_(y0, x0)]
        c01 = coarse[np.ix_(y0, x0 + 1)]
        c10 = coarse[np.ix_(y0 + 1, x0)]
        c11 = coarse[np.ix_(y0 + 1, x0 + 1)]

        # Smoothstep easing removes the visible lattice grid that raw bilinear
        # interpolation leaves behind.
        ey = ty * ty * (3 - 2 * ty)
        ex = tx * tx * (3 - 2 * tx)

        top = c00 * (1 - ex) + c01 * ex
        bottom = c10 * (1 - ex) + c11 * ex
        field += amplitude * (top * (1 - ey) + bottom * ey)

        total += amplitude
        amplitude *= 0.5

    field /= total
    lo, hi = float(field.min()), float(field.max())
    return (field - lo) / (hi - lo) if hi > lo else np.zeros_like(field)


def _normalise(a: np.ndarray) -> np.ndarray:
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


# ---------------------------------------------------------------------------
# Conditions
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Conditions:
    """Live operating conditions. These drive dynamic re-routing.

    All are 0..1 except rainfall_mm, which is a physical quantity so an operator
    can type in what the gauge actually read.
    """

    rainfall_mm: float = 0.0
    road_condition: float = 0.7      # 1.0 = newly graded, 0.0 = impassable
    traffic_level: float = 0.3       # 1.0 = gridlocked
    visibility: float = 0.9          # 1.0 = clear
    wind_speed_kmh: float = 8.0
    active_blasting: bool = False

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> "Conditions":
        p = payload or {}

        def num(key: str, default: float, lo: float, hi: float) -> float:
            try:
                return max(lo, min(hi, float(p.get(key, default))))
            except (TypeError, ValueError):
                return default

        return cls(
            rainfall_mm=num("rainfall", 0.0, 0.0, 500.0) if "rainfall" in p
            else num("rainfall_mm", 0.0, 0.0, 500.0),
            road_condition=num("road_condition", 0.7, 0.0, 1.0),
            traffic_level=num("traffic_level", 0.3, 0.0, 1.0),
            visibility=num("visibility", 0.9, 0.0, 1.0),
            wind_speed_kmh=num("wind_speed_kmh", 8.0, 0.0, 200.0),
            active_blasting=bool(p.get("active_blasting", False)),
        )

    @property
    def rainfall_factor(self) -> float:
        """Rainfall as a 0..1 saturation factor.

        Saturating rather than linear: the step from 0 to 40 mm changes haulage
        conditions far more than the step from 160 to 200 mm, by which point
        everything that can flood already has.
        """
        return float(1.0 - math.exp(-self.rainfall_mm / 45.0))

    @property
    def weather_severity(self) -> float:
        """Composite weather hazard, 0..1."""
        wind = min(1.0, self.wind_speed_kmh / 80.0)
        return float(min(1.0, 0.55 * self.rainfall_factor + 0.25 * (1.0 - self.visibility) + 0.20 * wind))

    def as_dict(self) -> dict[str, Any]:
        return {
            "rainfall_mm": self.rainfall_mm,
            "road_condition": self.road_condition,
            "traffic_level": self.traffic_level,
            "visibility": self.visibility,
            "wind_speed_kmh": self.wind_speed_kmh,
            "active_blasting": self.active_blasting,
            "derived": {
                "rainfall_factor": round(self.rainfall_factor, 4),
                "weather_severity": round(self.weather_severity, 4),
            },
        }


# ---------------------------------------------------------------------------
# The grid
# ---------------------------------------------------------------------------

@dataclass
class TerrainGrid:
    """An n x n sampling of the terrain around a mine.

    Layers are 0..1 except `elevation_m` (metres) and `slope_deg` (degrees).
    """

    mine_id: str
    lat: float
    lon: float
    n: int
    radius_km: float

    lat_min: float
    lat_max: float
    lon_min: float
    lon_max: float

    elevation_m: np.ndarray
    slope_deg: np.ndarray
    road_quality: np.ndarray       # 1.0 = sealed haul road
    flood_base: np.ndarray         # susceptibility before rainfall is applied
    landslide: np.ndarray
    mining_activity: np.ndarray
    traffic_base: np.ndarray
    restricted: np.ndarray         # boolean mask
    excavation: np.ndarray         # boolean mask — active faces

    # -- coordinate mapping ------------------------------------------------

    def cell_center(self, row: int, col: int) -> tuple[float, float]:
        lat = self.lat_max - (row + 0.5) * (self.lat_max - self.lat_min) / self.n
        lon = self.lon_min + (col + 0.5) * (self.lon_max - self.lon_min) / self.n
        return lat, lon

    def to_cell(self, lat: float, lon: float) -> tuple[int, int]:
        """Nearest cell, clamped to the grid."""
        row = int((self.lat_max - lat) / (self.lat_max - self.lat_min) * self.n)
        col = int((lon - self.lon_min) / (self.lon_max - self.lon_min) * self.n)
        return max(0, min(self.n - 1, row)), max(0, min(self.n - 1, col))

    def contains(self, lat: float, lon: float) -> bool:
        return self.lat_min <= lat <= self.lat_max and self.lon_min <= lon <= self.lon_max

    @property
    def cell_size_km(self) -> float:
        return (2 * self.radius_km) / self.n

    # -- dynamic layers ----------------------------------------------------

    def flood_risk(self, conditions: Conditions) -> np.ndarray:
        """Flood exposure under the current rainfall.

        Susceptibility is a property of the ground; standing water is what
        rainfall does to it. Keeping them separate is what lets the same grid
        answer both "where is it usually wet" and "where is it wet today".
        """
        return np.clip(self.flood_base * (0.18 + 0.92 * conditions.rainfall_factor), 0.0, 1.0)

    def traffic(self, conditions: Conditions) -> np.ndarray:
        """Traffic density scaled by the reported fleet load."""
        return np.clip(self.traffic_base * (0.35 + 1.15 * conditions.traffic_level), 0.0, 1.0)

    def road_risk(self, conditions: Conditions) -> np.ndarray:
        """Road hazard: poor surface, made worse by wet weather.

        Wet degradation is proportional to how bad the surface already is —
        rain turns a poor haul road to slurry and barely touches a sealed one.
        """
        base = 1.0 - self.road_quality
        reported = 1.0 - conditions.road_condition
        combined = 0.6 * base + 0.4 * reported
        return np.clip(combined * (1.0 + 0.55 * conditions.rainfall_factor * combined), 0.0, 1.0)

    def slope_risk(self) -> np.ndarray:
        """Gradient hazard, normalised against a 20 degree ceiling."""
        return np.clip(self.slope_deg / 20.0, 0.0, 1.0)

    def mining_risk(self, conditions: Conditions) -> np.ndarray:
        activity = self.mining_activity.copy()
        if conditions.active_blasting:
            # Blasting widens the hazard footprint well beyond the face itself.
            activity = np.clip(activity * 1.6, 0.0, 1.0)
        return activity

    def blocked_mask(self, conditions: Conditions, constraints, vehicle) -> np.ndarray:
        """Cells the route may not enter, for any cost."""
        blocked = np.zeros((self.n, self.n), dtype=bool)

        if constraints.block_restricted_zones:
            blocked |= self.restricted.astype(bool)
        if constraints.block_active_excavation:
            blocked |= self.excavation.astype(bool)

        blocked |= self.flood_risk(conditions) >= constraints.flood_block_threshold

        # The vehicle's own grade limit applies when it is stricter than the
        # site-wide rule: a loaded haul truck is stopped by grades a light
        # vehicle takes without trouble.
        grade_limit = min(constraints.slope_block_degrees, vehicle.max_grade_degrees)
        blocked |= self.slope_deg > grade_limit

        return blocked

    def summary(self) -> dict[str, Any]:
        return {
            "mine_id": self.mine_id,
            "center": {"lat": self.lat, "lon": self.lon},
            "bounds": {
                "lat_min": self.lat_min, "lat_max": self.lat_max,
                "lon_min": self.lon_min, "lon_max": self.lon_max,
            },
            "cells": self.n,
            "radius_km": self.radius_km,
            "cell_size_km": round(self.cell_size_km, 4),
            "elevation_m": {
                "min": round(float(self.elevation_m.min()), 1),
                "max": round(float(self.elevation_m.max()), 1),
            },
            "slope_deg": {
                "mean": round(float(self.slope_deg.mean()), 2),
                "max": round(float(self.slope_deg.max()), 2),
            },
            "data_origin": "SYNTHETIC",
        }


# ---------------------------------------------------------------------------
# Construction
# ---------------------------------------------------------------------------

def _build_grid(mine_id: str, lat: float, lon: float, n: int, radius_km: float) -> TerrainGrid:
    # Degrees per km differ by axis; longitude compresses with latitude.
    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * max(0.2, math.cos(math.radians(lat))))

    lat_min, lat_max = lat - dlat, lat + dlat
    lon_min, lon_max = lon - dlon, lon + dlon

    # --- elevation --------------------------------------------------------
    base = _smooth_noise(n, _seed_for(mine_id, "elevation"), octaves=5)
    ridge = _smooth_noise(n, _seed_for(mine_id, "ridge"), octaves=3)

    # A mine sits in a worked depression. Subtracting a radial bowl centred on
    # the pit gives the elevation field a reason to look the way it does, and
    # makes downhill-to-the-pit routes emerge naturally.
    yy, xx = np.mgrid[0:n, 0:n]
    cy = cx = (n - 1) / 2.0
    radial = np.sqrt(((yy - cy) / cy) ** 2 + ((xx - cx) / cx) ** 2)
    bowl = np.clip(1.0 - radial, 0.0, 1.0) ** 2

    # Local relief: gullies, spoil heaps, bench faces. Generated at a fine
    # lattice so it produces gradients a truck would actually notice — broad
    # landforms alone give a near-flat surface where slope never matters.
    relief = _smooth_noise(n, _seed_for(mine_id, "relief"), octaves=3, base_lattice=14)
    benches = _smooth_noise(n, _seed_for(mine_id, "benches"), octaves=2, base_lattice=26)

    elevation = (
        320.0
        + 180.0 * base
        + 90.0 * ridge
        - 130.0 * bowl
        + 78.0 * relief
        + 46.0 * benches
    )

    # Pit walls. An open pit is cut in benches: flat working levels separated by
    # faces far too steep to drive. Quantising the pit depression into steps
    # reproduces that, and it is what makes the grade constraint meaningful —
    # without it nothing on the grid is steep enough to block a haul truck, and
    # the vehicle grade limits would be decorative.
    bench_height = 12.0
    pit_zone = bowl > 0.18
    stepped = np.round(elevation / bench_height) * bench_height
    elevation = np.where(pit_zone, stepped, elevation)

    # A ramp gives the pit a way in. Real pits have one; a pit whose every wall
    # is a bench face is unroutable, which would be a modelling artefact rather
    # than a finding.
    angle = np.arctan2(yy - cy, xx - cx)
    ramp = np.abs(((angle + np.pi) % (2 * np.pi)) - np.pi * 0.75) < 0.30
    elevation = np.where(pit_zone & ramp, 320.0 + 180.0 * base + 90.0 * ridge - 130.0 * bowl, elevation)

    # --- slope, derived from elevation -----------------------------------
    cell_km = (2 * radius_km) / n
    gy, gx = np.gradient(elevation, cell_km * 1000.0)  # metres per metre
    slope_deg = np.degrees(np.arctan(np.sqrt(gy ** 2 + gx ** 2)))

    # --- flood susceptibility --------------------------------------------
    # Low ground collects water; steep ground sheds it. Both terms are needed:
    # elevation alone would flood a high plateau's relative lows.
    depth_below = _normalise(-elevation)
    shedding = np.clip(slope_deg / 12.0, 0.0, 1.0)
    wetness = _smooth_noise(n, _seed_for(mine_id, "flood"), octaves=3)
    flood_base = np.clip(0.62 * depth_below * (1.0 - 0.75 * shedding) + 0.38 * wetness * (1.0 - shedding), 0.0, 1.0)

    # --- landslide susceptibility ----------------------------------------
    # Steep *and* loose. Steep bedrock is stable; loose flat ground does not slide.
    looseness = _smooth_noise(n, _seed_for(mine_id, "regolith"), octaves=3)
    landslide = np.clip((slope_deg / 25.0) ** 1.5 * (0.45 + 0.55 * looseness), 0.0, 1.0)

    # --- road network -----------------------------------------------------
    # Roads follow low gradients and radiate from the pit, because that is how
    # haul roads are actually cut.
    road_noise = _smooth_noise(n, _seed_for(mine_id, "roads"), octaves=4)
    grade_favourability = 1.0 - np.clip(slope_deg / 15.0, 0.0, 1.0)
    corridor = np.clip(1.0 - np.abs(radial - 0.45) * 2.2, 0.0, 1.0)
    road_quality = np.clip(
        0.20 + 0.45 * grade_favourability + 0.25 * corridor + 0.25 * road_noise - 0.20 * flood_base,
        0.03, 1.0,
    )

    # --- mining activity --------------------------------------------------
    activity = np.clip(bowl ** 0.7 * (0.55 + 0.45 * _smooth_noise(n, _seed_for(mine_id, "activity"), octaves=2)), 0.0, 1.0)

    # --- traffic ----------------------------------------------------------
    # Traffic concentrates on good roads near the pit — empty tracks are empty.
    traffic_base = np.clip(0.65 * road_quality * (0.35 + 0.65 * bowl) + 0.2 * _smooth_noise(n, _seed_for(mine_id, "traffic"), octaves=2), 0.0, 1.0)

    # --- hard zones -------------------------------------------------------
    # Active faces are discrete working areas, not the whole pit. The centre is
    # deliberately excluded: that is the ROM pad where trucks load, so blocking
    # it would make the extraction point itself unroutable.
    face_noise = _smooth_noise(n, _seed_for(mine_id, "faces"), octaves=3, base_lattice=6)
    excavation = (activity > 0.70) & (face_noise > 0.70) & (radial > 0.14)

    restricted_noise = _smooth_noise(n, _seed_for(mine_id, "restricted"), octaves=2)
    # Magazine/tailings exclusions: compact, off to one side, away from the pit.
    restricted = (restricted_noise > 0.88) & (radial > 0.35)

    return TerrainGrid(
        mine_id=mine_id,
        lat=lat, lon=lon, n=n, radius_km=radius_km,
        lat_min=lat_min, lat_max=lat_max, lon_min=lon_min, lon_max=lon_max,
        elevation_m=elevation,
        slope_deg=slope_deg,
        road_quality=road_quality,
        flood_base=flood_base,
        landslide=landslide,
        mining_activity=activity,
        traffic_base=traffic_base,
        restricted=restricted,
        excavation=excavation,
    )


@lru_cache(maxsize=16)
def _cached_grid(mine_id: str, lat: float, lon: float, n: int, radius_km: float) -> TerrainGrid:
    return _build_grid(mine_id, lat, lon, n, radius_km)


def get_grid(
    mine_id: str,
    lat: float,
    lon: float,
    config: GridConfig | None = None,
) -> TerrainGrid:
    """Terrain grid for a mine. Cached — construction is the expensive part, and
    the result is a pure function of its arguments."""
    cfg = config or GridConfig()
    return _cached_grid(mine_id, round(lat, 5), round(lon, 5), cfg.cells, cfg.radius_km)


def clear_grid_cache() -> None:
    _cached_grid.cache_clear()
