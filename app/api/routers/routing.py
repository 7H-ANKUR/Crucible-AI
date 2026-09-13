"""app/api/routers/routing.py — dynamic mine routing and production optimisation.

Mounted at /api/v1/routing.

  POST /optimize            plan a risk-aware route, with alternatives and reasons
  POST /compare-conditions  the same trip under two condition sets (the re-route story)
  GET  /heatmap             a spatial risk layer for the map
  POST /production/forecast haulage-constrained production, root cause, actions
  POST /production/simulate what-if against a baseline
  GET  /config              the live cost weights and vehicle profiles
  GET  /points/{mine_id}    suggested pit / stockpile / dispatch points

Reads require an authenticated user. Nothing here mutates state, so there is no
elevated-role gate — the write-shaped verbs are computations, not commands.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.db import query
from ..core.rbac import require_authenticated
from ..core.routing import (
    Conditions,
    NoRouteError,
    ProductionInputs,
    alternative_routes,
    build_cost_surface,
    explain_recommendation,
    forecast_production,
    get_grid,
    get_vehicle,
    haulage_from_route,
    heatmap_payload,
    load_config,
    recommend_actions,
    root_cause_analysis,
    route_payload,
    route_through,
    simulate,
)

logger = logging.getLogger("crucible.routing")
router = APIRouter(tags=["routing"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class Point(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    label: str | None = None


class OptimizeRequest(BaseModel):
    mine_id: str = "MH-NAGPUR-01"
    start: Point
    destination: Point
    #: Intermediate stops in order, e.g. a stockpile between pit and dispatch.
    waypoints: list[Point] = Field(default_factory=list)
    vehicle_type: str = "haul_truck"
    conditions: dict[str, Any] = Field(default_factory=dict)
    alternatives: int = Field(default=2, ge=0, le=4)


class CompareConditionsRequest(BaseModel):
    mine_id: str = "MH-NAGPUR-01"
    start: Point
    destination: Point
    waypoints: list[Point] = Field(default_factory=list)
    vehicle_type: str = "haul_truck"
    before: dict[str, Any] = Field(default_factory=dict)
    after: dict[str, Any] = Field(default_factory=dict)


class ProductionRequest(BaseModel):
    mine_id: str = "MH-NAGPUR-01"
    inputs: dict[str, Any] = Field(default_factory=dict)
    #: One-way haul time. Supplied by the caller from a route result when the
    #: two are being reasoned about together.
    route_time_min: float | None = None
    route_distance_km: float | None = None
    route_risk_score: float | None = None


class SimulateRequest(ProductionRequest):
    changes: dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mine_location(mine_id: str) -> tuple[float, float]:
    """Mine coordinates, with a Sausar Belt fallback if the row is missing."""
    try:
        rows = query(
            "SELECT latitude, longitude FROM ops.mines WHERE mine_id = %s LIMIT 1",
            (mine_id,),
        )
        if rows and rows[0].get("latitude") is not None:
            return float(rows[0]["latitude"]), float(rows[0]["longitude"])
    except Exception as exc:
        logger.warning("Mine lookup failed for %s: %s", mine_id, exc)

    # The corridor the platform was built for. Better than a 500 on a demo.
    return 21.95, 79.25


def _prepare(mine_id: str, vehicle_type: str, conditions: dict[str, Any]):
    cfg = load_config()
    lat, lon = _mine_location(mine_id)
    grid = get_grid(mine_id, lat, lon, cfg.grid)
    vehicle = get_vehicle(vehicle_type)
    conds = Conditions.from_payload(conditions)
    surface = build_cost_surface(grid, cfg.weights, cfg.constraints, vehicle, conds)
    return cfg, grid, surface, conds, vehicle


def _to_cells(grid, points: list[Point]) -> list[tuple[int, int]]:
    cells: list[tuple[int, int]] = []
    for p in points:
        if not grid.contains(p.lat, p.lon):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Point ({p.lat:.4f}, {p.lon:.4f}) lies outside the {grid.radius_km:.0f} km "
                    f"routing area around {grid.mine_id}. Choose a point closer to the mine or "
                    "increase ROUTE_GRID_RADIUS_KM."
                ),
            )
        cell = grid.to_cell(p.lat, p.lon)
        # Consecutive identical cells make a zero-length leg; drop them.
        if not cells or cells[-1] != cell:
            cells.append(cell)
    return cells


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

@router.post("/optimize", summary="Plan a risk-aware route")
def optimize_route(body: OptimizeRequest, user=Depends(require_authenticated())):
    cfg, grid, surface, conds, vehicle = _prepare(body.mine_id, body.vehicle_type, body.conditions)

    ordered = [body.start, *body.waypoints, body.destination]
    cells = _to_cells(grid, ordered)
    if len(cells) < 2:
        raise HTTPException(
            status_code=422,
            detail="Start and destination resolve to the same grid cell — no route to plan.",
        )

    try:
        primary = route_through(surface, cells, diagonal=cfg.grid.diagonal, label="recommended")
    except NoRouteError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc), "reason": exc.reason})

    alts = alternative_routes(
        surface, cells, primary, diagonal=cfg.grid.diagonal, count=body.alternatives
    )

    # The distance-only route is the baseline the recommendation is argued
    # against: "longer but safer" needs a shortest route to be longer than.
    shortest = None
    try:
        from ..core.routing.config import CostWeights
        from ..core.routing.cost import build_cost_surface as _build

        distance_only = CostWeights(
            alpha_distance=1.0, beta_slope=0.0, gamma_flood=0.0, delta_road=0.0,
            epsilon_mining=0.0, zeta_weather=0.0, eta_traffic=0.0,
        )
        flat_surface = _build(grid, distance_only, cfg.constraints, vehicle, conds)
        shortest_path = route_through(flat_surface, cells, diagonal=cfg.grid.diagonal, label="shortest")
        # Re-measure that geometry on the real cost surface, so its risk is
        # comparable with the recommended route's.
        from ..core.routing.astar import _finalise

        shortest = _finalise(surface, shortest_path.cells, shortest_path.nodes_expanded, "shortest", None)
    except (NoRouteError, Exception) as exc:  # noqa: BLE001 - baseline is optional
        logger.info("Shortest-path baseline unavailable: %s", exc)

    explanation = explain_recommendation(primary, alts, cfg.weights, shortest=shortest)

    return {
        "mine_id": body.mine_id,
        "vehicle_type": vehicle.name,
        "conditions": conds.as_dict(),
        "route": route_payload(primary, surface, cfg.weights),
        "alternative_routes": [route_payload(a, surface, cfg.weights) for a in alts],
        "shortest_route": route_payload(shortest, surface, cfg.weights) if shortest else None,
        "explanation": explanation,
        "waypoints": [p.model_dump() for p in ordered],
        "grid": grid.summary(),
        "weights": cfg.weights.as_dict(),
    }


@router.post("/compare-conditions", summary="Re-route under changed conditions")
def compare_conditions(body: CompareConditionsRequest, user=Depends(require_authenticated())):
    """Plan the same trip twice and report whether the recommendation changes.

    This is the dynamic-routing demonstration: identical endpoints, identical
    weights, only the weather differs — so any change in the recommended route
    is attributable to the conditions and nothing else.
    """
    ordered = [body.start, *body.waypoints, body.destination]
    results: dict[str, Any] = {}

    for phase, payload in (("before", body.before), ("after", body.after)):
        cfg, grid, surface, conds, vehicle = _prepare(body.mine_id, body.vehicle_type, payload)
        cells = _to_cells(grid, ordered)
        if len(cells) < 2:
            raise HTTPException(status_code=422, detail="Start and destination are the same cell.")
        try:
            route = route_through(surface, cells, diagonal=cfg.grid.diagonal, label=phase)
        except NoRouteError as exc:
            raise HTTPException(
                status_code=422,
                detail={"message": f"No route under '{phase}' conditions: {exc}", "reason": exc.reason},
            )
        alts = alternative_routes(surface, cells, route, diagonal=cfg.grid.diagonal, count=2)
        results[phase] = {
            "conditions": conds.as_dict(),
            "route": route_payload(route, surface, cfg.weights),
            "alternative_routes": [route_payload(a, surface, cfg.weights) for a in alts],
            "_raw": route,
        }

    before, after = results["before"], results["after"]
    changed = before["_raw"].cells != after["_raw"].cells

    shared = len(set(before["_raw"].cells) & set(after["_raw"].cells))
    overlap = shared / max(1, len(before["_raw"].cells))

    risk_delta = after["route"]["risk_score"] - before["route"]["risk_score"]
    dist_delta = after["route"]["distance_km"] - before["route"]["distance_km"]

    # The number that actually justifies re-routing: what the ORIGINAL route
    # would score under the new conditions. Without it the comparison can only
    # say the new route is risky, not that the old one became worse — which is
    # the whole claim.
    original_under_new: dict[str, Any] | None = None
    try:
        cfg_a, grid_a, surface_a, _, _ = _prepare(body.mine_id, body.vehicle_type, body.after)
        from ..core.routing.astar import _finalise

        reevaluated = _finalise(
            surface_a, before["_raw"].cells, 0, "original-under-new", None
        )
        original_under_new = route_payload(reevaluated, surface_a, cfg_a.weights)
    except Exception as exc:  # noqa: BLE001 — comparison degrades, endpoint does not
        logger.info("Could not re-evaluate the original route: %s", exc)

    if changed:
        if original_under_new is not None:
            rose_to = original_under_new["risk_score"]
            avoided = rose_to - after["route"]["risk_score"]
            if dist_delta > 0.05:
                trade = f"{dist_delta:.1f} km longer"
            elif dist_delta < -0.05:
                trade = f"{abs(dist_delta):.1f} km shorter"
            else:
                trade = "the same distance"

            narrative = (
                f"Conditions changed the recommendation. The original route would now score "
                f"{rose_to:.0f}/100, up from {before['route']['risk_score']:.0f}. The router "
                f"moved to a different line scoring {after['route']['risk_score']:.0f}/100 — "
                + (
                    f"{trade}, avoiding {avoided:.0f} point{'' if round(avoided) == 1 else 's'} of risk."
                    if avoided >= 1.0
                    else f"{trade}, though the risk gain is marginal."
                )
            )
        else:
            narrative = (
                f"Conditions changed the recommendation: {100 * (1 - overlap):.0f}% of the path "
                f"is different, now scoring {after['route']['risk_score']:.0f}/100 over "
                f"{after['route']['distance_km']:.1f} km."
            )
    else:
        narrative = (
            f"The recommended route is unchanged. Its risk moved from "
            f"{before['route']['risk_score']:.0f} to {after['route']['risk_score']:.0f}/100, "
            "but no alternative scores better under the new conditions."
        )

    for phase in ("before", "after"):
        results[phase].pop("_raw", None)

    return {
        "mine_id": body.mine_id,
        "vehicle_type": body.vehicle_type,
        "before": results["before"],
        "after": results["after"],
        "original_route_under_new_conditions": original_under_new,
        "route_changed": changed,
        "path_overlap_pct": round(100.0 * overlap, 1),
        "risk_delta": round(risk_delta, 1),
        "distance_delta_km": round(dist_delta, 3),
        "narrative": narrative,
    }


@router.get("/heatmap", summary="Spatial risk layer")
def heatmap(
    mine_id: str = Query("MH-NAGPUR-01"),
    layer: str = Query("overall", pattern="^(overall|slope|flood|road|mining|weather|traffic)$"),
    vehicle_type: str = Query("haul_truck"),
    rainfall: float = Query(0.0, ge=0, le=500),
    road_condition: float = Query(0.7, ge=0, le=1),
    traffic_level: float = Query(0.3, ge=0, le=1),
    resolution: int = Query(48, ge=8, le=96),
    user=Depends(require_authenticated()),
):
    _, _, surface, conds, _ = _prepare(
        mine_id,
        vehicle_type,
        {"rainfall": rainfall, "road_condition": road_condition, "traffic_level": traffic_level},
    )
    try:
        payload = heatmap_payload(surface, layer=layer, max_cells=resolution)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    payload["conditions"] = conds.as_dict()
    payload["mine_id"] = mine_id
    return payload


@lru_cache(maxsize=8)
def _compute_points(mine_id: str) -> dict[str, Any]:
    """Pit, stockpile and dispatch points for a mine.

    The dispatch point is *searched for* rather than placed at a fixed offset:
    it is chosen as the reachable destination whose route diverges most between
    dry and wet conditions. An arbitrary offset frequently lands somewhere the
    shortest line stays optimal in the rain, which makes a working router look
    like it is ignoring the weather.

    Cached because the search costs a few seconds and depends only on the mine.
    """
    import numpy as np

    cfg, grid, surface, _, vehicle = _prepare(mine_id, "haul_truck", {})
    n = grid.n

    def nearest_open(row: int, col: int) -> tuple[int, int]:
        if not surface.blocked[row, col]:
            return row, col
        for radius in range(1, n // 2):
            r0, r1 = max(0, row - radius), min(n, row + radius + 1)
            c0, c1 = max(0, col - radius), min(n, col + radius + 1)
            open_cells = np.argwhere(~surface.blocked[r0:r1, c0:c1])
            if open_cells.size:
                dr, dc = open_cells[0]
                return r0 + int(dr), c0 + int(dc)
        return row, col

    pit = nearest_open(n // 2, n // 2)

    wet_surface = build_cost_surface(
        grid, cfg.weights, cfg.constraints, vehicle,
        Conditions.from_payload({"rainfall": 150, "road_condition": 0.3, "traffic_level": 0.6}),
    )

    best: tuple[float, tuple[int, int]] | None = None
    # Coarse sweep: this runs two A* searches per candidate, so the step is set
    # to keep first-call latency inside a browser timeout. The result is cached.
    step = max(6, n // 8)
    for gr in range(step, n - step, step):
        for gc in range(step, n - step, step):
            if surface.blocked[gr, gc] or wet_surface.blocked[gr, gc]:
                continue
            try:
                dry_route = route_through(surface, [pit, (gr, gc)], diagonal=cfg.grid.diagonal)
                wet_route = route_through(wet_surface, [pit, (gr, gc)], diagonal=cfg.grid.diagonal)
            except NoRouteError:
                continue
            if dry_route.distance_km < 2.0:
                continue  # too short to be an interesting haul
            divergence = 1.0 - len(set(dry_route.cells) & set(wet_route.cells)) / len(dry_route.cells)
            if best is None or divergence > best[0]:
                best = (divergence, (gr, gc))

    dispatch = best[1] if best else nearest_open(int(n * 0.74), int(n * 0.26))

    # Stockpile sits between pit and dispatch, offset to one side so the
    # three-leg route is a real detour rather than a point on a straight line.
    mid_r = (pit[0] + dispatch[0]) // 2
    mid_c = (pit[1] + dispatch[1]) // 2
    offset = max(3, n // 10)
    stockpile = nearest_open(
        max(0, min(n - 1, mid_r - offset)),
        max(0, min(n - 1, mid_c + offset)),
    )

    out: dict[str, Any] = {}
    for name, (r, c) in (("extraction", pit), ("stockpile", stockpile), ("dispatch", dispatch)):
        lat, lon = grid.cell_center(r, c)
        out[name] = {
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "label": name,
            "risk": round(float(surface.risk_0_100[r, c]), 1),
        }

    return {
        "mine_id": mine_id,
        "points": out,
        "bounds": grid.summary()["bounds"],
        "reroute_divergence_pct": round(100.0 * best[0], 1) if best else None,
    }


@router.get("/points/{mine_id}", summary="Suggested routing points")
def suggested_points(mine_id: str, user=Depends(require_authenticated())):
    return _compute_points(mine_id)


# ---------------------------------------------------------------------------
# Production
# ---------------------------------------------------------------------------

def _haulage(body: ProductionRequest):
    """Haulage context from a supplied route, or a site-typical default."""
    from ..core.routing import risk_band

    one_way = body.route_time_min if body.route_time_min is not None else 14.0
    distance = body.route_distance_km if body.route_distance_km is not None else 5.0
    risk = body.route_risk_score if body.route_risk_score is not None else 22.0
    ctx = haulage_from_route(one_way, distance, risk)
    band, _ = risk_band(risk)
    return ctx, band


@router.post("/production/forecast", summary="Haulage-constrained production forecast")
def production_forecast(body: ProductionRequest, user=Depends(require_authenticated())):
    inputs = ProductionInputs.from_payload(body.inputs)
    haulage, band = _haulage(body)

    forecast = forecast_production(inputs, haulage)
    causes = root_cause_analysis(inputs, haulage, forecast)
    actions = recommend_actions(inputs, haulage, forecast, causes, band)

    return {
        "mine_id": body.mine_id,
        "inputs": inputs.as_dict(),
        "haulage": {
            "round_trip_minutes": round(haulage.round_trip_minutes, 2),
            "distance_km": haulage.distance_km,
            "risk_score": haulage.risk_score,
            "risk_band": band,
            "risk_delay_minutes": round(haulage.risk_delay_minutes, 2),
        },
        "forecast": forecast.as_dict(),
        "root_cause": causes,
        "recommended_actions": actions,
        "data_origin": "SYNTHETIC",
    }


@router.post("/production/simulate", summary="What-if simulation")
def production_simulate(body: SimulateRequest, user=Depends(require_authenticated())):
    inputs = ProductionInputs.from_payload(body.inputs)
    haulage, band = _haulage(body)
    result = simulate(inputs, haulage, body.changes)
    result["mine_id"] = body.mine_id
    result["haulage_risk_band"] = band
    return result


@router.get("/config", summary="Live routing configuration")
def routing_config(user=Depends(require_authenticated())):
    """The weights, constraints and vehicle profiles currently in force."""
    return load_config().describe()
