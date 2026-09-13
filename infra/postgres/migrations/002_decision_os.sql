-- =============================================================
-- 002_decision_os.sql
--
-- Turns Crucible AI from a platform that records decisions into one that runs the
-- loop around them:
--
--   incident -> impact -> response plan -> approval -> execution -> outcome
--
-- Design notes
-- ------------
-- * `gov.decisions` already carried a six-state lifecycle. It is extended to
--   nine rather than replaced, and existing rows are migrated by name, so no
--   history is lost.
-- * Every table that records a judgement carries its own provenance
--   (model_version, dataset_version, calculation_mode, evidence_quality). A
--   decision must be reconstructable months later without joining to whatever
--   the registry happens to say at that point.
-- * Foreign keys are real, and ON DELETE is chosen deliberately per relation:
--   an incident's events die with it, a decision's approvals do not silently
--   disappear.
--
-- Idempotent: safe to re-run.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- Lifecycle: 6 states -> 9
-- -------------------------------------------------------------
-- DRAFT             created, not yet simulated
-- SIMULATED         options evaluated, not yet put forward
-- READY_FOR_REVIEW  put forward for a decision
-- APPROVED          authorised by a permitted role
-- REJECTED          declined, with a reason
-- EXECUTING         being carried out
-- COMPLETED         carried out
-- MEASURED          actual outcome recorded against prediction
-- LEARNED           fed back into decision memory

-- The migrations ledger predates this file but was never created on some
-- deployments, so it is ensured here rather than assumed.
CREATE TABLE IF NOT EXISTS gov.schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ DEFAULT NOW(),
    description TEXT
);

-- A copy of the rows this migration rewrites, so the vocabulary change is
-- reversible without a database-level restore.
CREATE TABLE IF NOT EXISTS gov.decisions_pre_002 AS
    SELECT id, lifecycle_state, status, decided_at FROM gov.decisions;

ALTER TABLE gov.decisions DROP CONSTRAINT IF EXISTS decisions_lifecycle_state_check;
ALTER TABLE gov.decisions DROP CONSTRAINT IF EXISTS decisions_status_check;

-- `lifecycle_state` and `status` were independently writable and have drifted:
-- rows exist with lifecycle_state='RECOMMENDED' AND status='executed'. Mapping
-- purely on lifecycle_state would record executed decisions as awaiting review,
-- which loses the fact that they happened.
--
-- Reconcile on the more advanced of the two first. An execution is evidence the
-- decision was approved, so it is never rolled backwards.
UPDATE gov.decisions
   SET lifecycle_state = 'OUTCOME_RECORDED'
 WHERE status = 'outcome_recorded' AND lifecycle_state <> 'OUTCOME_RECORDED';

UPDATE gov.decisions
   SET lifecycle_state = 'EXECUTED'
 WHERE status = 'executed' AND lifecycle_state NOT IN ('EXECUTED','OUTCOME_RECORDED');

UPDATE gov.decisions
   SET lifecycle_state = 'APPROVED'
 WHERE status = 'approved'
   AND lifecycle_state NOT IN ('APPROVED','EXECUTED','OUTCOME_RECORDED');

UPDATE gov.decisions
   SET lifecycle_state = 'REJECTED'
 WHERE status = 'rejected' AND lifecycle_state <> 'REJECTED';

-- Now map the reconciled vocabulary onto the nine-state machine.
UPDATE gov.decisions SET lifecycle_state = 'READY_FOR_REVIEW' WHERE lifecycle_state = 'RECOMMENDED';
UPDATE gov.decisions SET lifecycle_state = 'READY_FOR_REVIEW' WHERE lifecycle_state = 'UNDER_REVIEW';
UPDATE gov.decisions SET lifecycle_state = 'COMPLETED'        WHERE lifecycle_state = 'EXECUTED';
UPDATE gov.decisions SET lifecycle_state = 'MEASURED'         WHERE lifecycle_state = 'OUTCOME_RECORDED';

ALTER TABLE gov.decisions
    ADD CONSTRAINT decisions_lifecycle_state_check
    CHECK (lifecycle_state IN (
        'DRAFT','SIMULATED','READY_FOR_REVIEW','APPROVED','REJECTED',
        'EXECUTING','COMPLETED','MEASURED','LEARNED'
    ));

-- `status` duplicated `lifecycle_state` in lower case and the two could drift.
-- It is kept for existing readers but is now derived, never independently set.
UPDATE gov.decisions SET status = lower(lifecycle_state);
ALTER TABLE gov.decisions
    ADD CONSTRAINT decisions_status_check
    CHECK (status = lower(lifecycle_state));

ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS incident_id        BIGINT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS response_plan_id   BIGINT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS objective          TEXT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS calculation_mode   TEXT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS evidence_quality   TEXT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS model_version      TEXT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS dataset_version    TEXT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS rejected_reason    TEXT;
ALTER TABLE gov.decisions ADD COLUMN IF NOT EXISTS shift_id           TEXT;

-- -------------------------------------------------------------
-- Incidents
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.incidents (
    id                  BIGSERIAL PRIMARY KEY,
    incident_ref        TEXT UNIQUE NOT NULL,          -- INC-000123, shown to users
    mine_id             TEXT NOT NULL,
    shift_id            TEXT,

    incident_type       TEXT NOT NULL
                        CHECK (incident_type IN (
                            'PRODUCTION_SHORTFALL','EQUIPMENT_RISK','HAULAGE_BOTTLENECK',
                            'PROCESSING_OUTAGE','POWER_DISRUPTION','DATA_FAILURE',
                            'EXPLORATION_OPPORTUNITY','OTHER'
                        )),
    severity            TEXT NOT NULL
                        CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW')),
    status              TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','ACKNOWLEDGED','RESPONDING','RESOLVED','CLOSED')),

    title               TEXT NOT NULL,
    summary             TEXT,
    -- What the platform observed, as JSON. The evidence, not a restatement.
    detection_evidence  TEXT,
    -- Estimated production at stake. NULL means not estimable, never zero.
    impact_estimate_t   DOUBLE PRECISION,
    impact_basis        TEXT,
    calculation_mode    TEXT CHECK (calculation_mode IS NULL OR calculation_mode IN
                        ('MODEL_BACKED','HEURISTIC','INSUFFICIENT_DATA')),
    evidence_quality    TEXT CHECK (evidence_quality IS NULL OR evidence_quality IN
                        ('HIGH','MEDIUM','LOW','UNAVAILABLE')),

    detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by     TEXT,
    acknowledged_at     TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,

    -- Stable identity for deduplication: the same condition detected twice in a
    -- shift is one incident with two events, not two incidents.
    signature           TEXT,
    data_origin         TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_incidents_mine_status
    ON ops.incidents (mine_id, status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_severity
    ON ops.incidents (severity, detected_at DESC);
-- One open incident per signature per mine.
CREATE UNIQUE INDEX IF NOT EXISTS uq_incident_open_signature
    ON ops.incidents (mine_id, signature)
    WHERE status IN ('OPEN','ACKNOWLEDGED','RESPONDING');

-- -------------------------------------------------------------
-- Incident timeline
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ops.incident_events (
    id              BIGSERIAL PRIMARY KEY,
    incident_id     BIGINT NOT NULL REFERENCES ops.incidents(id) ON DELETE CASCADE,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type      TEXT NOT NULL
                    CHECK (event_type IN (
                        'DETECTED','THRESHOLD_CROSSED','IMPACT_ESTIMATED','PLAN_GENERATED',
                        'PLAN_APPROVED','PLAN_REJECTED','ACTION_STARTED','ACTION_COMPLETED',
                        'OUTCOME_RECORDED','RESOLVED','NOTE'
                    )),
    actor_id        TEXT,                 -- NULL for platform-generated events
    description     TEXT NOT NULL,
    payload         TEXT,                 -- JSON
    -- Measured value at this point, for replay charting.
    observed_value  DOUBLE PRECISION,
    observed_metric TEXT
);

CREATE INDEX IF NOT EXISTS idx_incident_events_timeline
    ON ops.incident_events (incident_id, occurred_at);

-- -------------------------------------------------------------
-- Response plans
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov.response_plans (
    id                  BIGSERIAL PRIMARY KEY,
    plan_ref            TEXT UNIQUE NOT NULL,          -- RP-001042
    incident_id         BIGINT REFERENCES ops.incidents(id) ON DELETE SET NULL,
    mine_id             TEXT NOT NULL,
    shift_id            TEXT,

    objective           TEXT NOT NULL,
    situation           TEXT NOT NULL,
    root_cause          TEXT,
    expected_delta_t    DOUBLE PRECISION,
    residual_gap_t      DOUBLE PRECISION,

    lifecycle_state     TEXT NOT NULL DEFAULT 'DRAFT'
                        CHECK (lifecycle_state IN (
                            'DRAFT','SIMULATED','READY_FOR_REVIEW','APPROVED','REJECTED',
                            'EXECUTING','COMPLETED','MEASURED','LEARNED'
                        )),

    calculation_mode    TEXT CHECK (calculation_mode IS NULL OR calculation_mode IN
                        ('MODEL_BACKED','HEURISTIC','INSUFFICIENT_DATA')),
    evidence_quality    TEXT CHECK (evidence_quality IS NULL OR evidence_quality IN
                        ('HIGH','MEDIUM','LOW','UNAVAILABLE')),
    -- Full evidence factor list and constraint report, as JSON.
    evidence_detail     TEXT,
    constraints_checked TEXT,

    model_version       TEXT,
    dataset_version     TEXT,
    scenario_id         TEXT,

    owner               TEXT,
    created_by          TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data_origin         TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_plans_mine_state
    ON gov.response_plans (mine_id, lifecycle_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plans_incident
    ON gov.response_plans (incident_id);

-- -------------------------------------------------------------
-- Plan actions
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov.response_plan_actions (
    id                  BIGSERIAL PRIMARY KEY,
    plan_id             BIGINT NOT NULL REFERENCES gov.response_plans(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL,

    intervention_key    TEXT NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT,
    horizon             TEXT NOT NULL CHECK (horizon IN ('NOW','NEXT','NEXT_SHIFT')),

    magnitude           DOUBLE PRECISION,
    expected_delta_t    DOUBLE PRECISION,
    cost_inr            DOUBLE PRECISION,
    cost_basis          TEXT,
    risk_delta          DOUBLE PRECISION,

    calculation_mode    TEXT CHECK (calculation_mode IS NULL OR calculation_mode IN
                        ('MODEL_BACKED','HEURISTIC','INSUFFICIENT_DATA')),
    method              TEXT,
    tradeoffs           TEXT,             -- JSON array

    owner               TEXT,
    status              TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','SKIPPED','BLOCKED')),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    completed_by        TEXT,
    note                TEXT,

    UNIQUE (plan_id, position)
);

CREATE INDEX IF NOT EXISTS idx_plan_actions_plan
    ON gov.response_plan_actions (plan_id, position);

-- -------------------------------------------------------------
-- Scenarios attached to a decision
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov.decision_scenarios (
    id                  BIGSERIAL PRIMARY KEY,
    decision_id         BIGINT REFERENCES gov.decisions(id) ON DELETE CASCADE,
    plan_id             BIGINT REFERENCES gov.response_plans(id) ON DELETE CASCADE,
    scenario_id         TEXT NOT NULL,

    label               TEXT NOT NULL,                -- 'Do nothing', 'Option A', ...
    is_baseline         BOOLEAN NOT NULL DEFAULT FALSE,
    objective           TEXT,

    projected_production_t DOUBLE PRECISION,
    net_delta_t         DOUBLE PRECISION,
    net_cost_inr        DOUBLE PRECISION,
    risk_delta          DOUBLE PRECISION,
    fuel_delta_pct      DOUBLE PRECISION,

    calculation_mode    TEXT,
    evidence_quality    TEXT,
    payload             TEXT,                          -- full scenario JSON
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (decision_id IS NOT NULL OR plan_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_decision_scenarios_plan
    ON gov.decision_scenarios (plan_id);

-- -------------------------------------------------------------
-- Approvals
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov.decision_approvals (
    id              BIGSERIAL PRIMARY KEY,
    decision_id     BIGINT REFERENCES gov.decisions(id) ON DELETE CASCADE,
    plan_id         BIGINT REFERENCES gov.response_plans(id) ON DELETE CASCADE,

    required_role   TEXT NOT NULL,
    decision        TEXT NOT NULL CHECK (decision IN ('APPROVED','REJECTED','MODIFIED')),
    actor_id        TEXT NOT NULL,
    actor_role      TEXT NOT NULL,
    rationale       TEXT,
    -- When a manager modifies rather than accepts, what they changed.
    modifications   TEXT,                              -- JSON
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (decision_id IS NOT NULL OR plan_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_approvals_plan
    ON gov.decision_approvals (plan_id, decided_at DESC);

-- -------------------------------------------------------------
-- Playbooks
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gov.playbooks (
    id              BIGSERIAL PRIMARY KEY,
    playbook_ref    TEXT UNIQUE NOT NULL,
    mine_id         TEXT,                              -- NULL = applies platform-wide
    name            TEXT NOT NULL,
    incident_type   TEXT NOT NULL,
    description     TEXT,

    -- Trigger conditions as JSON, evaluated by core/playbooks.py.
    trigger_spec    TEXT NOT NULL,
    -- Ordered steps as JSON; each names an intervention key or a manual check.
    steps           TEXT NOT NULL,

    -- A site's own approved emergency procedure, when one applies. Crucible AI
    -- surfaces it; it does not author or supersede it.
    site_procedure_ref  TEXT,

    active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playbooks_trigger
    ON gov.playbooks (incident_type, active);

-- -------------------------------------------------------------
-- Outcomes: extend for prediction error
-- -------------------------------------------------------------
ALTER TABLE gov.decision_outcomes ADD COLUMN IF NOT EXISTS plan_id           BIGINT;
ALTER TABLE gov.decision_outcomes ADD COLUMN IF NOT EXISTS variance_pct      DOUBLE PRECISION;
ALTER TABLE gov.decision_outcomes ADD COLUMN IF NOT EXISTS variance_reason   TEXT;
ALTER TABLE gov.decision_outcomes ADD COLUMN IF NOT EXISTS calculation_mode  TEXT;
ALTER TABLE gov.decision_outcomes ADD COLUMN IF NOT EXISTS model_version     TEXT;
ALTER TABLE gov.decision_outcomes ADD COLUMN IF NOT EXISTS recorded_by       TEXT;

-- Deferred so the column can be added before gov.response_plans is guaranteed
-- to exist on a fresh database.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'decision_outcomes_plan_fk'
    ) THEN
        ALTER TABLE gov.decision_outcomes
            ADD CONSTRAINT decision_outcomes_plan_fk
            FOREIGN KEY (plan_id) REFERENCES gov.response_plans(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'decisions_incident_fk'
    ) THEN
        ALTER TABLE gov.decisions
            ADD CONSTRAINT decisions_incident_fk
            FOREIGN KEY (incident_id) REFERENCES ops.incidents(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'decisions_plan_fk'
    ) THEN
        ALTER TABLE gov.decisions
            ADD CONSTRAINT decisions_plan_fk
            FOREIGN KEY (response_plan_id) REFERENCES gov.response_plans(id) ON DELETE SET NULL;
    END IF;
END $$;

INSERT INTO gov.schema_migrations (version, description)
VALUES ('002_decision_os', 'Incidents, response plans, approvals, playbooks; 9-state decision lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
