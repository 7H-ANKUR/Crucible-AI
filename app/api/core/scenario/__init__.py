"""Canonical scenario evaluation for Crucible AI.

    types       vocabulary shared by every caller
    catalogue   the single list of interventions and what governs each
    economics   cost rates derived from the mine's own production records
    engine      context assembly, counterfactual evaluation, scenario run
    ranking     objective-driven ordering; nothing is "best" in the abstract
    explain     why this, and why not the alternatives

Routers are adapters over `run_scenario`. Logic does not live in routers.
"""

from .catalogue import CATALOGUE, InterventionSpec, all_specs, spec
from .economics import MineEconomics, mine_economics
from .engine import build_context, evaluate_intervention, run_scenario
from .explain import explain, why_not, why_this
from .ranking import objectives_agree, rank, winners
from .types import (
    Flexibility,
    InterventionOutcome,
    RiskTolerance,
    ScenarioContext,
    ScenarioControls,
    ScenarioObjective,
    ScenarioResult,
)

__all__ = [
    "CATALOGUE", "Flexibility", "InterventionOutcome", "InterventionSpec",
    "MineEconomics", "RiskTolerance", "ScenarioContext", "ScenarioControls",
    "ScenarioObjective", "ScenarioResult", "all_specs", "build_context",
    "evaluate_intervention", "explain", "mine_economics", "objectives_agree",
    "rank", "run_scenario", "spec", "why_not", "why_this", "winners",
]
