"""app/api/core/scenario/types.py — the vocabulary of a scenario.

One set of types, used by every caller. Previously the same concepts existed
three times with subtly different shapes (`scenario_engine.py`, `scenarios.py`,
`optimizer.py`), which is how the platform ended up reporting a production gap
under a field named `shortfall_prob` in one path and not the other.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from ..constraints import ConstraintReport
from ..evidence import EvidenceAssessment
from ..provenance import CalculationMode, Provenance, Scope


class ScenarioObjective(str, Enum):
    """What the manager is trying to achieve.

    Ranking is meaningless without this. An option that recovers the most tonnes
    is not "best" to someone whose constraint is cost, so no result is labelled
    best in the abstract — only best *for* a stated objective.
    """

    MAXIMIZE_PRODUCTION = "MAXIMIZE_PRODUCTION"
    BALANCED = "BALANCED"
    MINIMIZE_COST = "MINIMIZE_COST"
    MINIMIZE_RISK = "MINIMIZE_RISK"


class RiskTolerance(str, Enum):
    CONSERVATIVE = "CONSERVATIVE"
    BALANCED = "BALANCED"
    AGGRESSIVE = "AGGRESSIVE"


class Flexibility(str, Enum):
    """How much room the manager is giving the planner in one dimension."""

    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"

    @property
    def magnitude(self) -> float:
        """Fractional adjustment this level permits."""
        return {"NONE": 0.0, "LOW": 0.05, "MEDIUM": 0.10, "HIGH": 0.15}[self.value]


@dataclass(frozen=True)
class ScenarioControls:
    """Manager-facing inputs.

    Deliberately expressed as operational latitude rather than model parameters.
    A mine manager should not have to know what a feature column is to ask
    "recover production, and you may spend up to 10% more fuel".
    """

    mine_id: str
    objective: ScenarioObjective = ScenarioObjective.BALANCED
    #: Ceiling on additional fuel burn the scenario may trade for production.
    max_additional_fuel_pct: float = 10.0
    fleet_reallocation: Flexibility = Flexibility.MEDIUM
    route_flexibility: Flexibility = Flexibility.MEDIUM
    #: PRESERVE means maintenance is off the table entirely.
    maintenance_flexibility: Flexibility = Flexibility.NONE
    operating_time_flexibility: Flexibility = Flexibility.NONE
    risk_tolerance: RiskTolerance = RiskTolerance.BALANCED
    #: Cap on how many actions a response may contain. More than a handful is
    #: not a plan a shift can execute.
    max_actions: int = 3


@dataclass
class ScenarioContext:
    """Everything the engine needs about the mine's current state.

    Built once per scenario and shared across every candidate, so that all
    options are scored against identical conditions — otherwise a comparison
    between them means nothing.
    """

    mine_id: str
    location: tuple[float, float] | None
    #: Current expected production, tonnes. None when it cannot be established.
    baseline_production_t: float | None
    #: The plan this is measured against, tonnes.
    planned_production_t: float | None
    #: Model-ready feature frame for the latest record; None when unavailable.
    features: Any = None
    #: The serving production model; None when unavailable.
    model: Any = None
    #: Serving metadata from ml_loader.
    model_meta: dict[str, Any] = field(default_factory=dict)
    #: The newest production row, raw.
    latest_row: dict[str, Any] = field(default_factory=dict)
    provenance: Provenance = field(default_factory=Provenance)
    #: True when the baseline itself came from the model rather than a recorded value.
    baseline_model_backed: bool = False

    @property
    def production_gap_t(self) -> float | None:
        """Planned minus expected. Positive means a shortfall.

        Named for what it is. The field this replaces was called
        ``shortfall_prob`` and was consumed as a probability by the UI, which
        rendered a 6.8% production gap as "Shortfall Risk 6.8%".
        """
        if self.baseline_production_t is None or self.planned_production_t is None:
            return None
        return self.planned_production_t - self.baseline_production_t

    @property
    def production_gap_pct(self) -> float | None:
        gap = self.production_gap_t
        if gap is None or not self.planned_production_t:
            return None
        return 100.0 * gap / self.planned_production_t


@dataclass
class InterventionOutcome:
    """One candidate action, fully evaluated."""

    key: str
    title: str
    description: str
    magnitude: float

    #: Expected production change, tonnes. None when it cannot be estimated.
    delta_t: float | None
    calculation_mode: CalculationMode
    #: How the delta was obtained, in one sentence.
    method: str

    constraints: ConstraintReport
    evidence: EvidenceAssessment

    #: Estimated incremental cost, rupees. Always a declared assumption.
    cost_inr: float | None = None
    cost_basis: str = "Not estimated"
    #: Additional fuel burn as a fraction of current consumption.
    fuel_delta_pct: float | None = None
    #: Change in equipment risk exposure: positive means more exposure.
    risk_delta: float = 0.0
    #: Why a manager might not choose this. Populated for every option, including
    #: the recommended one — a recommendation with no stated downside is a sales
    #: pitch, not an analysis.
    tradeoffs: list[str] = field(default_factory=list)
    #: Populated when the action was refused outright.
    rejected_reason: str | None = None

    @property
    def feasible(self) -> bool:
        return self.rejected_reason is None and self.constraints.feasible

    @property
    def available(self) -> bool:
        return self.feasible and self.delta_t is not None

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "title": self.title,
            "description": self.description,
            "magnitude": round(self.magnitude, 4),
            "expected_delta_t": round(self.delta_t, 1) if self.delta_t is not None else None,
            "calculation_mode": self.calculation_mode.value,
            "method": self.method,
            "cost_inr": round(self.cost_inr, 0) if self.cost_inr is not None else None,
            "cost_basis": self.cost_basis,
            "fuel_delta_pct": round(self.fuel_delta_pct, 2) if self.fuel_delta_pct is not None else None,
            "risk_delta": round(self.risk_delta, 3),
            "feasible": self.feasible,
            "rejected_reason": self.rejected_reason,
            "tradeoffs": self.tradeoffs,
            "constraints": self.constraints.as_dict(),
            "evidence": self.evidence.as_dict(),
        }


@dataclass
class ScenarioResult:
    """The answer to one scenario question."""

    scenario_id: str
    mine_id: str
    objective: ScenarioObjective
    created_at: str
    created_by: str
    scope: Scope = Scope.MINE

    baseline_production_t: float | None = None
    planned_production_t: float | None = None
    projected_production_t: float | None = None

    #: Selected actions, in execution order.
    selected: list[InterventionOutcome] = field(default_factory=list)
    #: Every candidate considered, including refused ones, so "why not?" is answerable.
    considered: list[InterventionOutcome] = field(default_factory=list)

    calculation_mode: CalculationMode = CalculationMode.INSUFFICIENT_DATA
    evidence: EvidenceAssessment | None = None
    provenance: Provenance = field(default_factory=Provenance)

    #: Present when nothing could be computed.
    unavailable_reason: str | None = None

    @property
    def net_delta_t(self) -> float | None:
        deltas = [o.delta_t for o in self.selected if o.delta_t is not None]
        return sum(deltas) if deltas else None

    @property
    def net_cost_inr(self) -> float | None:
        costs = [o.cost_inr for o in self.selected if o.cost_inr is not None]
        return sum(costs) if costs else None

    @property
    def production_gap_t(self) -> float | None:
        if self.planned_production_t is None or self.baseline_production_t is None:
            return None
        return self.planned_production_t - self.baseline_production_t

    @property
    def residual_gap_t(self) -> float | None:
        """Shortfall still outstanding after the selected actions."""
        if self.planned_production_t is None or self.projected_production_t is None:
            return None
        return self.planned_production_t - self.projected_production_t


__all__ = [
    "Flexibility",
    "InterventionOutcome",
    "RiskTolerance",
    "ScenarioContext",
    "ScenarioControls",
    "ScenarioObjective",
    "ScenarioResult",
]
