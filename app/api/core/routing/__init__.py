"""Dynamic risk-aware mine routing, explainable risk, and haulage-constrained
production optimisation.

    config      cost weights, hard constraints, vehicle profiles, risk bands
    terrain     the spatial risk surface (deterministic, condition-driven)
    cost        terrain layers -> traversal cost per kilometre
    astar       risk-aware search with an admissible heuristic
    explain     risk decomposition and recommendation narrative
    production  cycle-time model, root-cause attribution, what-if simulation
"""

from .config import (
    VEHICLE_PROFILES,
    CostWeights,
    GridConfig,
    HardConstraints,
    RoutingConfig,
    VehicleProfile,
    get_vehicle,
    load_config,
    risk_band,
)
from .cost import FACTOR_LABELS, FACTORS, CostSurface, build_cost_surface, heatmap_payload
from .astar import NoRouteError, RouteResult, alternative_routes, astar, route_through
from .explain import compare_routes, explain_recommendation, risk_breakdown, route_payload
from .production import (
    HaulageContext,
    ProductionForecast,
    ProductionInputs,
    forecast_production,
    haulage_from_route,
    recommend_actions,
    root_cause_analysis,
    simulate,
)
from .terrain import Conditions, TerrainGrid, get_grid, haversine_km

__all__ = [
    "VEHICLE_PROFILES", "CostWeights", "GridConfig", "HardConstraints", "RoutingConfig",
    "VehicleProfile", "get_vehicle", "load_config", "risk_band",
    "FACTORS", "FACTOR_LABELS", "CostSurface", "build_cost_surface", "heatmap_payload",
    "NoRouteError", "RouteResult", "alternative_routes", "astar", "route_through",
    "compare_routes", "explain_recommendation", "risk_breakdown", "route_payload",
    "HaulageContext", "ProductionForecast", "ProductionInputs", "forecast_production",
    "haulage_from_route", "recommend_actions", "root_cause_analysis", "simulate",
    "Conditions", "TerrainGrid", "get_grid", "haversine_km",
]
