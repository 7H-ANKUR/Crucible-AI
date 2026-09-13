"""app/api/core/routing/astar.py — risk-aware A* over the cost surface.

Standard A* with two properties worth stating explicitly, because both are easy
to get subtly wrong and neither fails loudly:

**The heuristic is admissible.** ``h = straight_line_km * min_cost_per_km``,
where ``min_cost_per_km`` is the cheapest traversable kilometre anywhere on the
grid. No real path can beat that rate over that distance, so ``h`` never
overestimates and A* still returns the optimal path. A heuristic tuned for speed
by scaling it up would return paths that merely look plausible — which on a
safety-routing tool is worse than being slow.

**Hard constraints are enforced by exclusion, not by cost.** Blocked cells are
never expanded. Giving them a very large finite cost would let the search route
through an active blast zone whenever the alternative was long enough.
"""

from __future__ import annotations

import heapq
import math
from dataclasses import dataclass, field
from typing import Any, Iterator

import numpy as np

from .cost import FACTORS, CostSurface
from .terrain import haversine_km

# (dy, dx, length multiplier). Diagonals cost sqrt(2) cell-widths.
_NEIGHBOURS_8: tuple[tuple[int, int, float], ...] = (
    (-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
    (-1, -1, math.sqrt(2)), (-1, 1, math.sqrt(2)),
    (1, -1, math.sqrt(2)), (1, 1, math.sqrt(2)),
)
_NEIGHBOURS_4: tuple[tuple[int, int, float], ...] = _NEIGHBOURS_8[:4]


class NoRouteError(RuntimeError):
    """No traversable path exists under the current constraints."""

    def __init__(self, message: str, reason: str = "unreachable"):
        super().__init__(message)
        self.reason = reason


@dataclass
class RouteResult:
    """One computed route."""

    cells: list[tuple[int, int]]
    coordinates: list[tuple[float, float]]     # (lat, lon)
    distance_km: float
    travel_time_min: float
    total_cost: float
    #: Distance-weighted mean of each risk factor along the route, 0..1.
    factor_means: dict[str, float]
    risk_score: float                          # 0..100
    nodes_expanded: int
    blocked_encountered: bool = False
    label: str = "primary"
    penalty_applied: float = 0.0

    @property
    def safety_score(self) -> float:
        return round(100.0 - self.risk_score, 1)

    def geojson(self) -> dict[str, Any]:
        return {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                # GeoJSON is [lon, lat] — the opposite of every other ordering
                # in this codebase, which is a reliable source of silent bugs.
                "coordinates": [[lon, lat] for lat, lon in self.coordinates],
            },
            "properties": {
                "label": self.label,
                "distance_km": round(self.distance_km, 3),
                "travel_time_min": round(self.travel_time_min, 1),
                "risk_score": round(self.risk_score, 1),
                "safety_score": self.safety_score,
            },
        }


def _reconstruct(came_from: dict[int, int], current: int, n: int) -> list[tuple[int, int]]:
    path = [current]
    while current in came_from:
        current = came_from[current]
        path.append(current)
    path.reverse()
    return [(idx // n, idx % n) for idx in path]


def _neighbours(cfg_diagonal: bool) -> tuple[tuple[int, int, float], ...]:
    return _NEIGHBOURS_8 if cfg_diagonal else _NEIGHBOURS_4


def astar(
    surface: CostSurface,
    start: tuple[int, int],
    goal: tuple[int, int],
    *,
    diagonal: bool = True,
    penalty: np.ndarray | None = None,
    label: str = "primary",
) -> RouteResult:
    """Cheapest risk-weighted path from ``start`` to ``goal``.

    ``penalty`` adds per-cell cost without marking cells blocked. It is how
    alternative routes are generated: penalise the corridor the primary route
    used and search again, yielding a genuinely different path rather than one
    shifted by a cell.
    """
    grid = surface.grid
    n = grid.n
    cost_per_km = surface.cost_per_km
    blocked = surface.blocked
    cell_km = grid.cell_size_km

    if blocked[start]:
        raise NoRouteError(
            "The start point is inside a blocked zone (restricted, active excavation, "
            "flooded, or too steep for this vehicle).",
            reason="start_blocked",
        )
    if blocked[goal]:
        raise NoRouteError(
            "The destination is inside a blocked zone (restricted, active excavation, "
            "flooded, or too steep for this vehicle).",
            reason="goal_blocked",
        )

    goal_lat, goal_lon = grid.cell_center(*goal)
    rate = surface.min_cost_per_km  # admissible scaling constant

    def h(row: int, col: int) -> float:
        lat, lon = grid.cell_center(row, col)
        return haversine_km(lat, lon, goal_lat, goal_lon) * rate

    start_idx = start[0] * n + start[1]
    goal_idx = goal[0] * n + goal[1]

    g_score = np.full(n * n, np.inf, dtype=np.float64)
    g_score[start_idx] = 0.0

    came_from: dict[int, int] = {}
    closed = np.zeros(n * n, dtype=bool)

    open_heap: list[tuple[float, int]] = [(h(*start), start_idx)]
    neighbours = _neighbours(diagonal)
    expanded = 0

    while open_heap:
        _, current = heapq.heappop(open_heap)
        if closed[current]:
            continue
        closed[current] = True
        expanded += 1

        if current == goal_idx:
            cells = _reconstruct(came_from, current, n)
            return _finalise(surface, cells, expanded, label, penalty)

        cr, cc = current // n, current % n
        current_cost = cost_per_km[cr, cc]

        for dy, dx, mult in neighbours:
            nr, nc = cr + dy, cc + dx
            if not (0 <= nr < n and 0 <= nc < n):
                continue
            if blocked[nr, nc] or closed[nr * n + nc]:
                continue

            edge_km = cell_km * mult
            # Trapezoidal: charge the average of the two cells' rates over the
            # edge. Charging only the destination makes the cost depend on
            # traversal direction, which it physically should not.
            rate_edge = 0.5 * (current_cost + cost_per_km[nr, nc])
            step = rate_edge * edge_km
            if penalty is not None:
                step += float(penalty[nr, nc]) * edge_km

            neighbour = nr * n + nc
            tentative = g_score[current] + step
            if tentative < g_score[neighbour]:
                g_score[neighbour] = tentative
                came_from[neighbour] = current
                heapq.heappush(open_heap, (tentative + h(nr, nc), neighbour))

    raise NoRouteError(
        "No traversable route exists between these points under the current "
        "conditions. Blocked zones may completely separate them.",
        reason="unreachable",
    )


def _finalise(
    surface: CostSurface,
    cells: list[tuple[int, int]],
    expanded: int,
    label: str,
    penalty: np.ndarray | None,
) -> RouteResult:
    """Measure a path: true distance, time, and distance-weighted risk."""
    grid = surface.grid
    coords = [grid.cell_center(r, c) for r, c in cells]

    total_km = 0.0
    total_min = 0.0
    total_cost = 0.0
    penalty_total = 0.0
    weighted: dict[str, float] = {f: 0.0 for f in FACTORS}

    for i in range(1, len(cells)):
        (lat0, lon0), (lat1, lon1) = coords[i - 1], coords[i]
        seg_km = haversine_km(lat0, lon0, lat1, lon1)
        total_km += seg_km

        pr, pc = cells[i - 1]
        r, c = cells[i]

        # Weight each factor by segment length so a long straight run counts
        # for more than a short jink, as it should.
        for fname in FACTORS:
            avg = 0.5 * (float(surface.factors[fname][pr, pc]) + float(surface.factors[fname][r, c]))
            weighted[fname] += avg * seg_km

        speed = 0.5 * (surface.speed_kmh(pr, pc) + surface.speed_kmh(r, c))
        total_min += (seg_km / speed) * 60.0

        rate = 0.5 * (float(surface.cost_per_km[pr, pc]) + float(surface.cost_per_km[r, c]))
        total_cost += rate * seg_km
        if penalty is not None:
            penalty_total += float(penalty[r, c]) * seg_km

    if total_km <= 0:
        # Start and goal in the same cell: a valid answer, not an error.
        factor_means = {f: float(surface.factors[f][cells[0]]) for f in FACTORS}
    else:
        factor_means = {f: weighted[f] / total_km for f in FACTORS}

    w = surface.weights.risk_weights
    risk = sum(w[f] * factor_means[f] for f in FACTORS)
    risk_score = min(100.0, 100.0 * risk / max(1e-9, surface.weights.max_risk_weight_sum))

    return RouteResult(
        cells=cells,
        coordinates=coords,
        distance_km=total_km,
        travel_time_min=total_min,
        total_cost=total_cost,
        factor_means=factor_means,
        risk_score=risk_score,
        nodes_expanded=expanded,
        label=label,
        penalty_applied=penalty_total,
    )


def route_through(
    surface: CostSurface,
    points: list[tuple[int, int]],
    *,
    diagonal: bool = True,
    penalty: np.ndarray | None = None,
    label: str = "primary",
) -> RouteResult:
    """Route through an ordered sequence of points (pit -> stockpile -> dispatch).

    Each leg is solved independently and the results concatenated. This is
    correct because the waypoint order is given, not chosen — the caller is
    stating where the load must stop, not asking for a tour to be optimised.
    """
    if len(points) < 2:
        raise ValueError("At least a start and a destination are required")

    legs = [
        astar(surface, points[i], points[i + 1], diagonal=diagonal, penalty=penalty, label=label)
        for i in range(len(points) - 1)
    ]

    merged_cells: list[tuple[int, int]] = []
    for i, leg in enumerate(legs):
        # Drop the duplicated junction cell where one leg ends and the next begins.
        merged_cells.extend(leg.cells if i == 0 else leg.cells[1:])

    return _finalise(surface, merged_cells, sum(l.nodes_expanded for l in legs), label, penalty)


def alternative_routes(
    surface: CostSurface,
    points: list[tuple[int, int]],
    primary: RouteResult,
    *,
    diagonal: bool = True,
    count: int = 2,
    corridor_cells: int = 2,
    penalty_strength: float = 1.6,
) -> list[RouteResult]:
    """Generate genuinely distinct alternatives to ``primary``.

    Penalises a corridor around each route found so far and re-searches. The
    penalty is additive cost, never a block, so an alternative may still reuse
    part of the corridor where there is honestly no other way through — which
    is the correct outcome, and different from pretending one exists.
    """
    grid = surface.grid
    n = grid.n
    results: list[RouteResult] = []
    penalty = np.zeros((n, n), dtype=np.float64)

    scale = penalty_strength * max(1.0, float(surface.cost_per_km.mean()))

    def add_corridor(route: RouteResult) -> None:
        for r, c in route.cells:
            r0, r1 = max(0, r - corridor_cells), min(n, r + corridor_cells + 1)
            c0, c1 = max(0, c - corridor_cells), min(n, c + corridor_cells + 1)
            penalty[r0:r1, c0:c1] += scale

    add_corridor(primary)

    for i in range(count):
        try:
            alt = route_through(
                surface, points, diagonal=diagonal, penalty=penalty, label=f"alternative-{i + 1}"
            )
        except NoRouteError:
            break

        # Reject near-duplicates: an "alternative" sharing almost every cell
        # with one already found tells the operator nothing.
        if _overlap(alt, primary) > 0.85 or any(_overlap(alt, r) > 0.85 for r in results):
            add_corridor(alt)
            continue

        results.append(alt)
        add_corridor(alt)

    return results


def _overlap(a: RouteResult, b: RouteResult) -> float:
    """Fraction of ``a``'s cells that also appear in ``b``."""
    if not a.cells:
        return 0.0
    shared = len(set(a.cells) & set(b.cells))
    return shared / len(a.cells)
