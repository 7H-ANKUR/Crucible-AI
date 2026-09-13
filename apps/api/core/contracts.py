"""apps/api/core/contracts.py — Canonical Pydantic schemas and contracts for MINEx API.

Ensures strict typing, immutable defaults via Field(default_factory=list),
unified vibration_rms naming, canonical data_origin enums, and lifecycle state tracking.
"""
from enum import Enum

from pydantic import BaseModel, Field
from typing import Literal


class DataOrigin(str, Enum):
    REAL_PUBLIC = "REAL_PUBLIC"
    REAL_USER_UPLOADED = "REAL_USER_UPLOADED"
    SYNTHETIC = "SYNTHETIC"
    SYSTEM_GENERATED = "SYSTEM_GENERATED"
    DERIVED = "DERIVED"
    MIXED = "MIXED"


class ServingStatus(str, Enum):
    """Reflects whether the model actually serving matches the authoritative champion."""
    SYNCED = "SYNCED"              # serving == authoritative
    SYNC_PENDING = "SYNC_PENDING"  # artifact missing; still serving old model
    SYNC_FAILED = "SYNC_FAILED"    # artifact found but checks failed; still serving old
    UNAVAILABLE = "UNAVAILABLE"    # no model loaded at all


class ModelStatus(str, Enum):
    CHALLENGER = "challenger"
    APPROVED = "approved"
    CHAMPION = "champion"
    RETIRED = "retired"
    REJECTED = "rejected"
    ROLLED_BACK = "rolled_back"
    ARCHIVED = "archived"


class DatasetStatus(str, Enum):
    UPLOADED = "UPLOADED"
    MAPPED = "MAPPED"
    VALIDATED = "VALIDATED"
    APPROVED_FOR_TRAINING = "APPROVED_FOR_TRAINING"
    REJECTED = "REJECTED"


class TrainingStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    ABANDONED = "abandoned"


class EvidenceMode(str, Enum):
    """Whether a scenario intervention estimate is model-backed or heuristic."""
    MODEL_BACKED = "MODEL_BACKED"
    HEURISTIC = "HEURISTIC"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


class DecisionLifecycleState(str, Enum):
    RECOMMENDED = "RECOMMENDED"
    UNDER_REVIEW = "UNDER_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    EXECUTED = "EXECUTED"
    OUTCOME_RECORDED = "OUTCOME_RECORDED"


class ForecastQuantiles(BaseModel):
    p10: float = Field(..., description="P10 production quantile (tonnes)")
    p50: float = Field(..., description="P50 median forecast (tonnes)")
    p90: float = Field(..., description="P90 production quantile (tonnes)")


class ForecastGap(BaseModel):
    tonnes: float = Field(..., description="Difference between planned and P50 (planned - p50)")
    percentage: float = Field(..., description="Gap as percentage of planned production")
    status: str = Field(..., description="'deficit' | 'surplus' | 'on_target'")


class ShortfallRiskInfo(BaseModel):
    probability: float = Field(..., ge=0.0, le=1.0, description="Calibrated ML shortfall probability")
    threshold: float = Field(0.30, description="Operating decision threshold for shortfall alert")
    alert: bool = Field(..., description="True if probability >= threshold")
    confidence_tier: str = Field("MEDIUM", description="'HIGH' | 'MEDIUM' | 'LOW'")
    source: str = Field("classifier", description="Model source: calibrated logistic classifier")


class TopDriver(BaseModel):
    feature: str
    impact: float
    direction: str = "positive"


class ProductionForecastResult(BaseModel):
    model_config = {"protected_namespaces": ()}
    mine_id: str
    as_of: str
    model_version: str
    data_origin: str = "SYNTHETIC"
    freshness: str = "FRESH"
    planned_production_t: float
    forecast: ForecastQuantiles
    gap: ForecastGap
    shortfall: ShortfallRiskInfo
    # Backward compatibility fields
    shortfall_probability: float
    confidence_tier: str
    top_drivers: list[TopDriver] = Field(default_factory=list)
    leakage_status: str = "PASS"


class ShortfallResult(BaseModel):
    model_config = {"protected_namespaces": ()}
    mine_id: str
    shortfall_probability: float
    confidence_tier: str
    threshold_used: float
    alert: bool
    data_origin: str = "SYNTHETIC"
    model_version: str


class EquipmentRiskResult(BaseModel):
    machine_id: str
    equipment_type: str
    failure_risk_prob: float
    risk_level: str
    operating_hours: float
    temperature_c: float | None = None
    vibration_rms: float | None = Field(None, description="Vibration root mean square (unified)")
    vibration_mms: float | None = Field(None, description="Legacy alias for vibration_rms")
    last_service_date: str | None = None
    data_origin: str = "SYNTHETIC"


class ScenarioObjective(str, Enum):
    MAXIMIZE_PRODUCTION = "MAXIMIZE_PRODUCTION"
    BALANCED = "BALANCED"
    MINIMIZE_COST = "MINIMIZE_COST"
    MINIMIZE_RISK = "MINIMIZE_RISK"


class ScenarioControls(BaseModel):
    mine_id: str
    objective: ScenarioObjective = ScenarioObjective.BALANCED
    max_additional_fuel_pct: float = Field(default=14.0, ge=0.0, le=30.0)
    fleet_reallocation: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    maintenance_flexibility: Literal["PRESERVE", "LIMITED", "HIGH"] = "LIMITED"
    route_flexibility: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    operating_time_mode: Literal["CURRENT", "EXTENDED_AVAILABILITY", "MAX_AVAILABLE"] = "CURRENT"
    risk_tolerance: Literal["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] = "BALANCED"


class ScenarioInterventionModel(BaseModel):
    type: str
    intervention: str
    detail: str
    description: str
    magnitude: float | None = None
    expected_delta_t: float
    feasibility: float
    risk_reduction: float
    cost_inr: float
    urgency: str
    model_backed: bool
    calculation_mode: Literal["MODEL_BACKED", "HEURISTIC", "INSUFFICIENT_DATA"]
    production_delta_source: str
    cost_source: str
    reason: str
    constraints_checked: list[str]
    assumption_tag: str


class ScenarioResponse(BaseModel):
    scenario_id: str
    mine_id: str
    created_at: str
    created_by: str
    status: str
    model_version: str
    serving_model_version: str
    authoritative_model_version: str
    serving_status: str
    dataset_version: str
    calculation_mode: str
    data_quality: dict[str, str]
    baseline: dict[str, float]
    scenario: dict[str, float]
    actions_applied: list[ScenarioInterventionModel]
    interventions: list[ScenarioInterventionModel]
    confidence_tier: str
    model_confidence: float
    data_origin: str
    disclaimer: str


class AlertItem(BaseModel):
    id: int
    alert_type: str
    severity: str
    mine_id: str | None = None
    entity_id: str | None = None
    message: str
    created_at: str
    acknowledged: bool = False
    data_origin: str = "SYNTHETIC"


class DatasetVersion(BaseModel):
    id: int
    dataset_name: str
    domain: str
    version_tag: str
    status: str
    row_count: int
    quality_score: float | None = None
    created_at: str
    approved_by: str | None = None
    drive_file_id: str | None = None
    checksum_sha256: str | None = None
    data_origin: str = "REAL_USER_UPLOADED"


class TrainingRun(BaseModel):
    id: int
    run_tag: str
    status: str
    domain: str
    dataset_version_id: int | None = None
    triggered_by: str
    triggered_at: str
    completed_at: str | None = None
    error_message: str | None = None
    data_origin: str = "SYNTHETIC"


class ModelRegistryEntry(BaseModel):
    id: int
    task: str
    model: str
    version: str
    status: str  # champion | approved | challenger | retired | rejected | rolled_back
    metric_roc_auc: float | None = None
    metric_pr_auc: float | None = None
    metric_mae: float | None = None
    metric_r2: float | None = None
    metric_lift: float | None = None
    split_type: str = "temporal"
    data_origin: str = "SYNTHETIC"
    leakage_status: str = "PASS"
    approved_by: str | None = None
    approved_at: str | None = None
    promoted_at: str | None = None
    artifact_drive_file_id: str | None = None
    artifact_sha256: str | None = None
    smoke_test_status: str | None = None


class Decision(BaseModel):
    id: int | None = None
    problem: str
    prediction_id: int | None = None
    recommendation: str
    decided_by: str
    decided_at: str | None = None
    status: str = "pending"
    lifecycle_state: str = "RECOMMENDED"
    reviewed_by: str | None = None
    reviewed_at: str | None = None
    executed_by: str | None = None
    executed_at: str | None = None
    data_origin: str = "SYNTHETIC"


class DecisionOutcome(BaseModel):
    id: int | None = None
    decision_id: int
    predicted_value: float
    actual_value: float
    delta: float
    effectiveness: float
    metric_type: str | None = None
    metric_details: str | None = None
    recorded_at: str | None = None
    data_origin: str = "SYNTHETIC"
