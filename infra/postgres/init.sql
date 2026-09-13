-- =============================================================
-- MINEx / MANGANESIS — Aiven PostgreSQL Schema
-- SIH26009 | Authoritative Enterprise Schema
-- Safe to run multiple times (all statements are idempotent)
-- =============================================================

-- Schemas
CREATE SCHEMA IF NOT EXISTS geo;
CREATE SCHEMA IF NOT EXISTS ml;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS gov;
CREATE SCHEMA IF NOT EXISTS hub;

-- =============================================================
-- Migration version tracking
-- =============================================================
CREATE TABLE IF NOT EXISTS gov.schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ DEFAULT NOW(),
    description TEXT
);

-- =============================================================
-- GEO: Prospectivity grid
-- =============================================================
CREATE TABLE IF NOT EXISTS geo.prospectivity_grid (
    grid_id          TEXT PRIMARY KEY,
    latitude         DOUBLE PRECISION NOT NULL CHECK (latitude  BETWEEN 6.0 AND 37.5),
    longitude        DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN 68.0 AND 98.0),
    belt             TEXT,
    prospectivity_label  INTEGER,
    ndvi             DOUBLE PRECISION,
    ndmi             DOUBLE PRECISION,
    ndwi             DOUBLE PRECISION,
    elevation_m      DOUBLE PRECISION,
    slope_deg        DOUBLE PRECISION,
    mn_geochemistry  DOUBLE PRECISION,
    lithology_code   TEXT,
    data_origin      TEXT DEFAULT 'SYNTHETIC',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prosp_label_geochem
    ON geo.prospectivity_grid (prospectivity_label, mn_geochemistry DESC NULLS LAST);

-- =============================================================
-- ML: Predictions ledger
-- =============================================================
CREATE TABLE IF NOT EXISTS ml.predictions (
    id               BIGSERIAL PRIMARY KEY,
    task             TEXT NOT NULL,  -- prospectivity | production_forecast | shortfall | equipment_failure
    entity_id        TEXT NOT NULL,  -- mine_id / machine_id / grid_id
    mine_id          TEXT,
    model_version    TEXT NOT NULL DEFAULT 'v1.0',  -- ACTUAL serving version used for inference
    dataset_version  TEXT,
    predicted_at     TIMESTAMPTZ DEFAULT NOW(),
    prediction_value DOUBLE PRECISION,
    probability      DOUBLE PRECISION CHECK (probability IS NULL OR (probability >= 0 AND probability <= 1)),
    confidence_tier  TEXT,           -- HIGH | MEDIUM | LOW
    p10              DOUBLE PRECISION CHECK (p10 IS NULL OR p10 >= 0),
    p50              DOUBLE PRECISION CHECK (p50 IS NULL OR p50 >= 0),
    p90              DOUBLE PRECISION CHECK (p90 IS NULL OR p90 >= 0),
    prediction_status TEXT DEFAULT 'OK',  -- OK | INSUFFICIENT_DATA | HEURISTIC | SYNC_FAILED
    top_driver_1     TEXT,
    top_driver_2     TEXT,
    top_driver_3     TEXT,
    shap_json        TEXT,           -- JSON string of top SHAP values
    data_origin      TEXT DEFAULT 'SYNTHETIC',
    leakage_status   TEXT DEFAULT 'PASS'
);

CREATE INDEX IF NOT EXISTS idx_predictions_task_entity
    ON ml.predictions (task, entity_id, predicted_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_mine_task
    ON ml.predictions (mine_id, task, predicted_at DESC);

-- =============================================================
-- OPS: Equipment telemetry
-- =============================================================
CREATE TABLE IF NOT EXISTS ops.equipment_telemetry (
    id                      BIGSERIAL PRIMARY KEY,
    -- Canonical operational timestamp (TIMESTAMPTZ). 'timestamp' TEXT kept for
    -- backward compat with legacy seed data only; use 'datetime' for all new writes.
    timestamp               TEXT,
    datetime                TIMESTAMPTZ,
    machine_id              TEXT NOT NULL,
    mine_id                 TEXT NOT NULL,
    equipment_type          TEXT,
    machine_age_years       DOUBLE PRECISION CHECK (machine_age_years IS NULL OR machine_age_years >= 0),
    shift_number            DOUBLE PRECISION,
    vibration_rms           DOUBLE PRECISION CHECK (vibration_rms IS NULL OR vibration_rms >= 0),
    engine_temperature_c    DOUBLE PRECISION,
    hydraulic_pressure_bar  DOUBLE PRECISION CHECK (hydraulic_pressure_bar IS NULL OR hydraulic_pressure_bar >= 0),
    fuel_consumption_lph    DOUBLE PRECISION CHECK (fuel_consumption_lph IS NULL OR fuel_consumption_lph >= 0),
    payload_tons            DOUBLE PRECISION CHECK (payload_tons IS NULL OR payload_tons >= 0),
    operating_hours         DOUBLE PRECISION CHECK (operating_hours IS NULL OR operating_hours >= 0),
    idle_hours              DOUBLE PRECISION CHECK (idle_hours IS NULL OR idle_hours >= 0),
    load_cycle_count        DOUBLE PRECISION CHECK (load_cycle_count IS NULL OR load_cycle_count >= 0),
    speed_kmh               DOUBLE PRECISION CHECK (speed_kmh IS NULL OR speed_kmh >= 0),
    odometer_km             DOUBLE PRECISION CHECK (odometer_km IS NULL OR odometer_km >= 0),
    coolant_temperature_c   DOUBLE PRECISION,
    oil_pressure_bar        DOUBLE PRECISION CHECK (oil_pressure_bar IS NULL OR oil_pressure_bar >= 0),
    battery_voltage_v       DOUBLE PRECISION CHECK (battery_voltage_v IS NULL OR battery_voltage_v >= 0),
    ambient_temperature_c   DOUBLE PRECISION,
    humidity_pct            DOUBLE PRECISION CHECK (humidity_pct IS NULL OR (humidity_pct >= 0 AND humidity_pct <= 100)),
    altitude_m              DOUBLE PRECISION,
    maintenance_overdue_days DOUBLE PRECISION CHECK (maintenance_overdue_days IS NULL OR maintenance_overdue_days >= 0),
    maintenance_days_since  DOUBLE PRECISION CHECK (maintenance_days_since IS NULL OR maintenance_days_since >= 0),
    failure_count_7d        INTEGER CHECK (failure_count_7d IS NULL OR failure_count_7d >= 0),
    failure_count_30d       INTEGER CHECK (failure_count_30d IS NULL OR failure_count_30d >= 0),
    failure_count_90d       INTEGER CHECK (failure_count_90d IS NULL OR failure_count_90d >= 0),
    downtime_hours_7d       DOUBLE PRECISION CHECK (downtime_hours_7d IS NULL OR downtime_hours_7d >= 0),
    downtime_hours_past_24h DOUBLE PRECISION CHECK (downtime_hours_past_24h IS NULL OR downtime_hours_past_24h >= 0),
    total_operating_hours   DOUBLE PRECISION CHECK (total_operating_hours IS NULL OR total_operating_hours >= 0),
    utilization_pct         DOUBLE PRECISION CHECK (utilization_pct IS NULL OR (utilization_pct >= 0 AND utilization_pct <= 100)),
    ground_condition_score  DOUBLE PRECISION,
    operator_experience_years DOUBLE PRECISION CHECK (operator_experience_years IS NULL OR operator_experience_years >= 0),
    production_tons         DOUBLE PRECISION CHECK (production_tons IS NULL OR production_tons >= 0),
    failure_next_24h        INTEGER CHECK (failure_next_24h IS NULL OR (failure_next_24h >= 0 AND failure_next_24h <= 1)),
    data_origin             TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_equip_machine_dt
    ON ops.equipment_telemetry (machine_id, datetime DESC);

CREATE INDEX IF NOT EXISTS idx_equip_mine_machine_dt
    ON ops.equipment_telemetry (mine_id, machine_id, datetime DESC);

-- =============================================================
-- OPS: Production data
-- =============================================================
CREATE TABLE IF NOT EXISTS ops.production_records (
    id                   BIGSERIAL PRIMARY KEY,
    date                 DATE NOT NULL,
    mine_id              TEXT NOT NULL,
    zone_id              TEXT,
    shift                TEXT,
    planned_production_t DOUBLE PRECISION CHECK (planned_production_t IS NULL OR planned_production_t >= 0),
    actual_production_t  DOUBLE PRECISION CHECK (actual_production_t IS NULL OR actual_production_t >= 0),
    shortfall_flag       INTEGER CHECK (shortfall_flag IS NULL OR shortfall_flag IN (0, 1)),
    ore_grade_mn_pct     DOUBLE PRECISION CHECK (ore_grade_mn_pct IS NULL OR (ore_grade_mn_pct >= 0 AND ore_grade_mn_pct <= 100)),
    working_hours        DOUBLE PRECISION CHECK (working_hours IS NULL OR (working_hours >= 0 AND working_hours <= 24)),
    data_origin          TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_prod_mine_date
    ON ops.production_records (mine_id, date DESC);

-- Idempotent business-key unique (mine+date+shift for production ingestion)
CREATE UNIQUE INDEX IF NOT EXISTS uix_prod_mine_date_shift
    ON ops.production_records (mine_id, date, shift)
    WHERE shift IS NOT NULL;

-- =============================================================
-- OPS: Mines master
-- =============================================================
CREATE TABLE IF NOT EXISTS ops.mines (
    mine_id      TEXT PRIMARY KEY,
    mine_name    TEXT,
    state        TEXT,
    district     TEXT,
    latitude     DOUBLE PRECISION CHECK (latitude  BETWEEN 6.0 AND 37.5),
    longitude    DOUBLE PRECISION CHECK (longitude BETWEEN 68.0 AND 98.0),
    active       BOOLEAN DEFAULT TRUE,
    data_origin  TEXT DEFAULT 'SYNTHETIC'
);

-- =============================================================
-- HUB: Data Hub & Canonical Storage
-- =============================================================
CREATE TABLE IF NOT EXISTS hub.canonical_schemas (
    id          SERIAL PRIMARY KEY,
    domain      TEXT UNIQUE NOT NULL, -- 'production', 'equipment', 'exploration', 'maintenance'
    version     TEXT NOT NULL,
    schema_json TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub.datasets (
    id          BIGSERIAL PRIMARY KEY,
    domain      TEXT NOT NULL,
    name        TEXT NOT NULL,
    description TEXT,
    created_by  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hub.dataset_versions (
    id                         BIGSERIAL PRIMARY KEY,
    dataset_id                 BIGINT REFERENCES hub.datasets(id) ON DELETE CASCADE,
    version_tag                TEXT NOT NULL,
    file_path                  TEXT NOT NULL,
    status                     TEXT DEFAULT 'UPLOADED'
                               CHECK (status IN ('UPLOADED','MAPPED','VALIDATED','APPROVED_FOR_TRAINING','REJECTED')),
    row_count                  INTEGER CHECK (row_count IS NULL OR row_count >= 0),
    uploaded_by                TEXT NOT NULL,
    drive_file_id              TEXT,
    drive_folder_id            TEXT,
    checksum_sha256            TEXT,
    file_size_bytes            BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
    content_type               TEXT,
    original_filename          TEXT,
    canonical_drive_file_id    TEXT,
    canonical_checksum_sha256  TEXT,
    canonical_row_count        INTEGER CHECK (canonical_row_count IS NULL OR canonical_row_count >= 0),
    schema_hash                TEXT,
    schema_version             TEXT,
    transformation_metadata    TEXT,
    data_origin                TEXT DEFAULT 'REAL_USER_UPLOADED',
    parent_version_id          BIGINT,
    storage_status             TEXT DEFAULT 'AVAILABLE'
                               CHECK (storage_status IN ('AVAILABLE','UPLOAD_FAILED','CORRUPTED','ARCHIVED')),
    created_at                 TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (dataset_id, version_tag)
);

CREATE TABLE IF NOT EXISTS hub.dataset_column_mappings (
    id               BIGSERIAL PRIMARY KEY,
    version_id       BIGINT REFERENCES hub.dataset_versions(id) ON DELETE CASCADE,
    source_column    TEXT NOT NULL,
    canonical_column TEXT,
    confidence       DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    requires_review  BOOLEAN DEFAULT FALSE,
    mapped_by        TEXT,
    mapping_revision INTEGER DEFAULT 1,
    updated_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (version_id, source_column)
);

CREATE TABLE IF NOT EXISTS hub.dataset_validation_reports (
    id             BIGSERIAL PRIMARY KEY,
    version_id     BIGINT REFERENCES hub.dataset_versions(id) ON DELETE CASCADE UNIQUE,
    report_json    TEXT NOT NULL,
    quality_score  DOUBLE PRECISION CHECK (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1)),
    passed         BOOLEAN NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- GOV: Audit Log, Models & Governance
-- =============================================================
CREATE TABLE IF NOT EXISTS gov.audit_log (
    id           BIGSERIAL PRIMARY KEY,
    event_type   TEXT NOT NULL,
    actor_id     TEXT,
    actor_role   TEXT,
    entity_type  TEXT,
    entity_id    TEXT,
    payload      TEXT,  -- JSON structured payload
    created_at   TIMESTAMPTZ DEFAULT NOW()
    -- Note: append-only at application level; no UPDATE/DELETE in application code.
);

CREATE INDEX IF NOT EXISTS idx_audit_entity
    ON gov.audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_event_type
    ON gov.audit_log (event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS gov.training_runs (
    id                 BIGSERIAL PRIMARY KEY,
    run_tag            TEXT UNIQUE NOT NULL,
    -- Valid statuses: queued | running | completed | failed | cancelled | abandoned
    status             TEXT DEFAULT 'queued'
                       CHECK (status IN ('queued','running','completed','failed','cancelled','abandoned')),
    domain             TEXT NOT NULL,
    dataset_version_id BIGINT REFERENCES hub.dataset_versions(id) ON DELETE SET NULL,
    triggered_by       TEXT NOT NULL,
    triggered_at       TIMESTAMPTZ DEFAULT NOW(),
    started_at         TIMESTAMPTZ,
    completed_at       TIMESTAMPTZ,
    log_path           TEXT,
    error_message      TEXT,
    data_origin        TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_training_runs_domain_status
    ON gov.training_runs (domain, status);

-- Partial unique index: only one queued or running job per domain at a time.
-- This is enforced at the DB level to prevent race conditions.
CREATE UNIQUE INDEX IF NOT EXISTS uix_one_active_run_per_domain
    ON gov.training_runs (domain)
    WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS gov.model_registry (
    id                     BIGSERIAL PRIMARY KEY,
    task                   TEXT NOT NULL,
    model                  TEXT,
    version                TEXT NOT NULL,
    -- Valid statuses: challenger | approved | champion | retired | rejected | rolled_back | archived
    status                 TEXT DEFAULT 'champion'
                           CHECK (status IN ('challenger','approved','champion','retired','rejected','rolled_back','archived')),
    champion_metric        TEXT,
    champion_value         DOUBLE PRECISION,
    metric_roc_auc         DOUBLE PRECISION CHECK (metric_roc_auc IS NULL OR (metric_roc_auc >= 0 AND metric_roc_auc <= 1)),
    metric_pr_auc          DOUBLE PRECISION CHECK (metric_pr_auc IS NULL OR (metric_pr_auc >= 0 AND metric_pr_auc <= 1)),
    metric_mae             DOUBLE PRECISION CHECK (metric_mae IS NULL OR metric_mae >= 0),
    metric_r2              DOUBLE PRECISION,
    metric_lift            DOUBLE PRECISION CHECK (metric_lift IS NULL OR metric_lift >= 0),
    split_type             TEXT DEFAULT 'temporal',
    data_origin            TEXT DEFAULT 'SYNTHETIC',
    dataset_version_id     BIGINT REFERENCES hub.dataset_versions(id) ON DELETE SET NULL,
    artifact_path          TEXT,
    -- FK to training run that produced this model
    training_run_id        BIGINT REFERENCES gov.training_runs(id) ON DELETE SET NULL,
    artifact_drive_file_id TEXT,
    artifact_sha256        TEXT,
    artifact_size_bytes    BIGINT CHECK (artifact_size_bytes IS NULL OR artifact_size_bytes >= 0),
    smoke_test_status      TEXT,
    approved_by            TEXT,
    approved_at            TIMESTAMPTZ,
    promoted_at            TIMESTAMPTZ,
    retired_at             TIMESTAMPTZ,
    rollback_of            BIGINT REFERENCES gov.model_registry(id) ON DELETE SET NULL,
    leakage_status         TEXT DEFAULT 'PASS',
    registered_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (task, version)
);

CREATE INDEX IF NOT EXISTS idx_model_registry_task_status
    ON gov.model_registry (task, status);

-- DB-ENFORCED: At most one champion per task.
-- This prevents split-brain even if application logic fails.
CREATE UNIQUE INDEX IF NOT EXISTS uix_one_champion_per_task
    ON gov.model_registry (task)
    WHERE status = 'champion';

CREATE TABLE IF NOT EXISTS gov.model_approvals (
    id         BIGSERIAL PRIMARY KEY,
    model_id   BIGINT REFERENCES gov.model_registry(id) ON DELETE CASCADE,
    action     TEXT NOT NULL CHECK (action IN ('approved','rejected','promoted','rolled_back')),
    actor_id   TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    note       TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gov.model_artifacts (
    id              BIGSERIAL PRIMARY KEY,
    model_id        BIGINT REFERENCES gov.model_registry(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    drive_file_id   TEXT,
    drive_folder_id TEXT,
    sha256          TEXT,
    size_bytes      BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    content_type    TEXT DEFAULT 'application/octet-stream',
    status          TEXT DEFAULT 'REGISTERED'
                    CHECK (status IN ('REGISTERED','AVAILABLE','VERIFIED','MISSING','CORRUPTED','RETIRED')),
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    verified_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS gov.decisions (
    id              BIGSERIAL PRIMARY KEY,
    problem         TEXT NOT NULL,
    -- Nullable FK — decisions may exist before a specific prediction is linked
    prediction_id   BIGINT REFERENCES ml.predictions(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    recommendation  TEXT NOT NULL,
    decided_by      TEXT,
    decided_at      TIMESTAMPTZ DEFAULT NOW(),
    mine_id         TEXT,
    status          TEXT DEFAULT 'recommended'
                    CHECK (status IN ('recommended','under_review','approved','rejected','executed','outcome_recorded')),
    lifecycle_state TEXT DEFAULT 'RECOMMENDED'
                    CHECK (lifecycle_state IN ('RECOMMENDED','UNDER_REVIEW','APPROVED','REJECTED','EXECUTED','OUTCOME_RECORDED')),
    reviewed_by     TEXT,
    reviewed_at     TIMESTAMPTZ,
    executed_by     TEXT,
    executed_at     TIMESTAMPTZ,
    data_origin     TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_decisions_lifecycle
    ON gov.decisions (lifecycle_state, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_mine
    ON gov.decisions (mine_id, lifecycle_state);

CREATE TABLE IF NOT EXISTS gov.decision_outcomes (
    id              BIGSERIAL PRIMARY KEY,
    decision_id     BIGINT NOT NULL REFERENCES gov.decisions(id) ON DELETE CASCADE,
    predicted_value DOUBLE PRECISION NOT NULL,
    actual_value    DOUBLE PRECISION NOT NULL,
    delta           DOUBLE PRECISION,
    effectiveness   DOUBLE PRECISION CHECK (effectiveness IS NULL OR (effectiveness >= 0 AND effectiveness <= 1)),
    metric_type     TEXT,
    metric_details  TEXT,  -- JSON structured
    recorded_at     TIMESTAMPTZ DEFAULT NOW(),
    data_origin     TEXT DEFAULT 'SYNTHETIC',
    UNIQUE (decision_id)  -- only one outcome per decision
);

-- OPS: Alerts
CREATE TABLE IF NOT EXISTS gov.alerts (
    id           BIGSERIAL PRIMARY KEY,
    alert_type   TEXT NOT NULL,
    severity     TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
    mine_id      TEXT,
    entity_id    TEXT,
    message      TEXT NOT NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    data_origin  TEXT DEFAULT 'SYNTHETIC'
);

CREATE INDEX IF NOT EXISTS idx_alerts_mine_ack
    ON gov.alerts (mine_id, acknowledged, created_at DESC);

-- =============================================================
-- DEMO SEED DATA (clearly labelled — not for production)
-- =============================================================
INSERT INTO ops.mines (mine_id, mine_name, state, latitude, longitude) VALUES
  ('MINE-A', 'Nagpur Central',   'Maharashtra',    21.15, 79.09),
  ('MINE-B', 'Balaghat North',   'Madhya Pradesh', 21.83, 80.19),
  ('MINE-C', 'Keonjhar East',    'Odisha',         21.62, 85.58),
  ('MINE-D', 'Tumkur South',     'Karnataka',      13.34, 77.10),
  ('MINE-E', 'Panaji Coastal',   'Goa',            15.49, 73.82)
ON CONFLICT (mine_id) DO NOTHING;

INSERT INTO gov.schema_migrations (version, description) VALUES
  ('v1.0.0', 'Initial schema'),
  ('v2.0.0', 'Hardening v2: partial unique indexes, FK constraints, CHECK constraints, migration tracking')
ON CONFLICT (version) DO NOTHING;

SELECT 'Schema created successfully (MINEx Hardening v2)' AS status;
