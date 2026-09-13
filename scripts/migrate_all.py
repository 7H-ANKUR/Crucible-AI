"""scripts/migrate_all.py — Authoritative, Idempotent PostgreSQL Migration Runner.

Applies all base schemas (geo, ml, ops, gov, hub), tables, columns, constraints,
and indexes non-destructively using IF NOT EXISTS and DO $$ blocks.
Safe to run on clean deployments, staging environments, and live production databases.
Includes schema migration version tracking (gov.schema_migrations) and stale run recovery.
"""
import sys
from pathlib import Path

# Add project root to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apps.api.core.db import execute, init_db, query

CURRENT_MIGRATION_VERSION = "2026_09_v2_deep_hardening"

def run_all_migrations():
    print("=" * 65)
    print("MINEx Database Migration Runner (Authoritative v2.0 Hardened)")
    print("=" * 65)
    
    print("1. Connecting to PostgreSQL database...")
    init_db()
    
    print("2. Applying authoritative schemas, tables, and migration tracker...")
    
    base_sql = """
    -- 1. Schemas
    CREATE SCHEMA IF NOT EXISTS geo;
    CREATE SCHEMA IF NOT EXISTS ml;
    CREATE SCHEMA IF NOT EXISTS ops;
    CREATE SCHEMA IF NOT EXISTS gov;
    CREATE SCHEMA IF NOT EXISTS hub;

    -- Migration version tracking
    CREATE TABLE IF NOT EXISTS gov.schema_migrations (
        version     TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ DEFAULT NOW(),
        description TEXT
    );

    -- 2. GEO: Prospectivity grid
    CREATE TABLE IF NOT EXISTS geo.prospectivity_grid (
        grid_id          TEXT PRIMARY KEY,
        latitude         DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN 6.0 AND 37.5),
        longitude        DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN 68.0 AND 98.0),
        belt             TEXT,
        prospectivity_label INTEGER,
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

    -- 3. ML: Predictions ledger
    CREATE TABLE IF NOT EXISTS ml.predictions (
        id               BIGSERIAL PRIMARY KEY,
        task             TEXT NOT NULL,
        entity_id        TEXT NOT NULL,
        mine_id          TEXT,
        model_version    TEXT NOT NULL DEFAULT 'v1.0',
        dataset_version  TEXT,
        predicted_at     TIMESTAMPTZ DEFAULT NOW(),
        prediction_value DOUBLE PRECISION,
        probability      DOUBLE PRECISION,
        confidence_tier  TEXT,
        p10              DOUBLE PRECISION,
        p50              DOUBLE PRECISION,
        p90              DOUBLE PRECISION,
        prediction_status TEXT DEFAULT 'OK',
        top_driver_1     TEXT,
        top_driver_2     TEXT,
        top_driver_3     TEXT,
        shap_json        TEXT,
        data_origin      TEXT DEFAULT 'SYNTHETIC',
        leakage_status   TEXT DEFAULT 'PASS'
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_task_entity
        ON ml.predictions (task, entity_id, predicted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_predictions_mine_task
        ON ml.predictions (mine_id, task, predicted_at DESC);

    -- 4. OPS: Equipment telemetry
    CREATE TABLE IF NOT EXISTS ops.equipment_telemetry (
        id                       BIGSERIAL PRIMARY KEY,
        timestamp                TEXT,
        datetime                 TIMESTAMPTZ,
        machine_id               TEXT NOT NULL,
        mine_id                  TEXT NOT NULL,
        equipment_type           TEXT,
        machine_age_years        DOUBLE PRECISION,
        shift_number             DOUBLE PRECISION,
        vibration_rms            DOUBLE PRECISION,
        engine_temperature_c     DOUBLE PRECISION,
        hydraulic_pressure_bar   DOUBLE PRECISION,
        fuel_consumption_lph     DOUBLE PRECISION,
        payload_tons             DOUBLE PRECISION,
        operating_hours          DOUBLE PRECISION,
        idle_hours               DOUBLE PRECISION,
        load_cycle_count         DOUBLE PRECISION,
        speed_kmh                DOUBLE PRECISION,
        odometer_km              DOUBLE PRECISION,
        coolant_temperature_c    DOUBLE PRECISION,
        oil_pressure_bar         DOUBLE PRECISION,
        battery_voltage_v        DOUBLE PRECISION,
        ambient_temperature_c    DOUBLE PRECISION,
        humidity_pct             DOUBLE PRECISION,
        altitude_m               DOUBLE PRECISION,
        maintenance_overdue_days DOUBLE PRECISION,
        maintenance_days_since   DOUBLE PRECISION,
        failure_count_7d         INTEGER,
        failure_count_30d        INTEGER,
        failure_count_90d        INTEGER,
        downtime_hours_7d        DOUBLE PRECISION,
        downtime_hours_past_24h  DOUBLE PRECISION,
        total_operating_hours    DOUBLE PRECISION,
        utilization_pct          DOUBLE PRECISION,
        ground_condition_score   DOUBLE PRECISION,
        operator_experience_years DOUBLE PRECISION,
        production_tons          DOUBLE PRECISION,
        failure_next_24h         INTEGER,
        data_origin              TEXT DEFAULT 'SYNTHETIC'
    );
    CREATE INDEX IF NOT EXISTS idx_equip_machine_dt
        ON ops.equipment_telemetry (machine_id, datetime DESC);
    CREATE INDEX IF NOT EXISTS idx_equip_mine_machine_dt
        ON ops.equipment_telemetry (mine_id, machine_id, datetime DESC);

    -- 5. OPS: Production records
    CREATE TABLE IF NOT EXISTS ops.production_records (
        id                   BIGSERIAL PRIMARY KEY,
        date                 DATE NOT NULL,
        mine_id              TEXT NOT NULL,
        zone_id              TEXT,
        shift                TEXT,
        planned_production_t DOUBLE PRECISION,
        actual_production_t  DOUBLE PRECISION,
        shortfall_flag       INTEGER,
        ore_grade_mn_pct     DOUBLE PRECISION,
        working_hours        DOUBLE PRECISION,
        data_origin          TEXT DEFAULT 'SYNTHETIC'
    );
    CREATE INDEX IF NOT EXISTS idx_prod_mine_date
        ON ops.production_records (mine_id, date DESC);

    -- 6. OPS: Mines master
    CREATE TABLE IF NOT EXISTS ops.mines (
        mine_id     TEXT PRIMARY KEY,
        mine_name   TEXT,
        state       TEXT,
        district    TEXT,
        latitude    DOUBLE PRECISION CHECK (latitude BETWEEN 6.0 AND 37.5),
        longitude   DOUBLE PRECISION CHECK (longitude BETWEEN 68.0 AND 98.0),
        active      BOOLEAN DEFAULT TRUE,
        data_origin TEXT DEFAULT 'SYNTHETIC'
    );

    -- 7. HUB: Canonical schemas
    CREATE TABLE IF NOT EXISTS hub.canonical_schemas (
        id          SERIAL PRIMARY KEY,
        domain      TEXT UNIQUE NOT NULL,
        version     TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    -- 8. HUB: Datasets
    CREATE TABLE IF NOT EXISTS hub.datasets (
        id          BIGSERIAL PRIMARY KEY,
        domain      TEXT NOT NULL,
        name        TEXT NOT NULL,
        description TEXT,
        created_by  TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );

    -- 9. HUB: Dataset versions
    CREATE TABLE IF NOT EXISTS hub.dataset_versions (
        id                         BIGSERIAL PRIMARY KEY,
        dataset_id                 BIGINT REFERENCES hub.datasets(id) ON DELETE CASCADE,
        version_tag                TEXT NOT NULL,
        file_path                  TEXT NOT NULL,
        status                     TEXT DEFAULT 'UPLOADED',
        row_count                  INTEGER,
        uploaded_by                TEXT NOT NULL,
        created_at                 TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (dataset_id, version_tag)
    );

    ALTER TABLE hub.dataset_versions
        ADD COLUMN IF NOT EXISTS drive_file_id             TEXT,
        ADD COLUMN IF NOT EXISTS drive_folder_id           TEXT,
        ADD COLUMN IF NOT EXISTS checksum_sha256           TEXT,
        ADD COLUMN IF NOT EXISTS file_size_bytes           BIGINT,
        ADD COLUMN IF NOT EXISTS content_type              TEXT,
        ADD COLUMN IF NOT EXISTS original_filename         TEXT,
        ADD COLUMN IF NOT EXISTS canonical_drive_file_id   TEXT,
        ADD COLUMN IF NOT EXISTS canonical_checksum_sha256 TEXT,
        ADD COLUMN IF NOT EXISTS canonical_row_count       INTEGER,
        ADD COLUMN IF NOT EXISTS schema_hash               TEXT,
        ADD COLUMN IF NOT EXISTS schema_version            TEXT,
        ADD COLUMN IF NOT EXISTS transformation_metadata   TEXT,
        ADD COLUMN IF NOT EXISTS data_origin               TEXT DEFAULT 'REAL_USER_UPLOADED',
        ADD COLUMN IF NOT EXISTS parent_version_id         BIGINT,
        ADD COLUMN IF NOT EXISTS storage_status            TEXT DEFAULT 'AVAILABLE';

    -- 10. HUB: Column mappings
    CREATE TABLE IF NOT EXISTS hub.dataset_column_mappings (
        id               BIGSERIAL PRIMARY KEY,
        version_id       BIGINT REFERENCES hub.dataset_versions(id) ON DELETE CASCADE,
        source_column    TEXT NOT NULL,
        canonical_column TEXT,
        confidence       DOUBLE PRECISION,
        requires_review  BOOLEAN DEFAULT FALSE,
        mapped_by        TEXT,
        mapping_revision INTEGER DEFAULT 1,
        updated_at       TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (version_id, source_column)
    );

    ALTER TABLE hub.dataset_column_mappings
        ADD COLUMN IF NOT EXISTS mapping_revision INTEGER DEFAULT 1;

    -- 11. HUB: Validation reports
    CREATE TABLE IF NOT EXISTS hub.dataset_validation_reports (
        id            BIGSERIAL PRIMARY KEY,
        version_id    BIGINT REFERENCES hub.dataset_versions(id) ON DELETE CASCADE UNIQUE,
        report_json   TEXT NOT NULL,
        quality_score DOUBLE PRECISION,
        passed        BOOLEAN NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
    );

    -- 12. GOV: Audit log
    CREATE TABLE IF NOT EXISTS gov.audit_log (
        id          BIGSERIAL PRIMARY KEY,
        event_type  TEXT NOT NULL,
        actor_id    TEXT,
        actor_role  TEXT,
        entity_type TEXT,
        entity_id   TEXT,
        payload     TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity
        ON gov.audit_log (entity_type, entity_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_event_type
        ON gov.audit_log (event_type, created_at DESC);

    -- 13. GOV: Training runs
    CREATE TABLE IF NOT EXISTS gov.training_runs (
        id                 BIGSERIAL PRIMARY KEY,
        run_tag            TEXT UNIQUE NOT NULL,
        status             TEXT DEFAULT 'queued',
        domain             TEXT NOT NULL,
        dataset_version_id BIGINT,
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

    -- 14. GOV: Model registry
    CREATE TABLE IF NOT EXISTS gov.model_registry (
        id              BIGSERIAL PRIMARY KEY,
        task            TEXT NOT NULL,
        version         TEXT NOT NULL,
        status          TEXT DEFAULT 'champion',
        champion_metric TEXT,
        champion_value  DOUBLE PRECISION,
        artifact_path   TEXT,
        leakage_status  TEXT DEFAULT 'PASS',
        registered_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (task, version)
    );

    ALTER TABLE gov.model_registry
        ADD COLUMN IF NOT EXISTS model                  TEXT,
        ADD COLUMN IF NOT EXISTS metric_roc_auc         DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_pr_auc          DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_mae             DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_r2              DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_lift            DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS split_type             TEXT DEFAULT 'temporal',
        ADD COLUMN IF NOT EXISTS data_origin            TEXT DEFAULT 'SYNTHETIC',
        ADD COLUMN IF NOT EXISTS dataset_version_id     BIGINT,
        ADD COLUMN IF NOT EXISTS training_run_id        BIGINT,
        ADD COLUMN IF NOT EXISTS artifact_drive_file_id TEXT,
        ADD COLUMN IF NOT EXISTS artifact_sha256        TEXT,
        ADD COLUMN IF NOT EXISTS artifact_size_bytes    BIGINT,
        ADD COLUMN IF NOT EXISTS smoke_test_status      TEXT,
        ADD COLUMN IF NOT EXISTS approved_by            TEXT,
        ADD COLUMN IF NOT EXISTS approved_at            TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS promoted_at            TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS retired_at             TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rollback_of            BIGINT;

    CREATE INDEX IF NOT EXISTS idx_model_registry_task_status
        ON gov.model_registry (task, status);

    -- 15. GOV: Model approvals
    CREATE TABLE IF NOT EXISTS gov.model_approvals (
        id         BIGSERIAL PRIMARY KEY,
        model_id   BIGINT REFERENCES gov.model_registry(id) ON DELETE CASCADE,
        action     TEXT NOT NULL,
        actor_id   TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        note       TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- 16. GOV: Model artifacts
    CREATE TABLE IF NOT EXISTS gov.model_artifacts (
        id              BIGSERIAL PRIMARY KEY,
        model_id        BIGINT REFERENCES gov.model_registry(id) ON DELETE CASCADE,
        filename        TEXT NOT NULL,
        drive_file_id   TEXT,
        drive_folder_id TEXT,
        sha256          TEXT,
        size_bytes      BIGINT,
        content_type    TEXT DEFAULT 'application/octet-stream',
        status          TEXT DEFAULT 'REGISTERED',
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        verified_at     TIMESTAMPTZ
    );

    -- 17. GOV: Decisions
    CREATE TABLE IF NOT EXISTS gov.decisions (
        id              BIGSERIAL PRIMARY KEY,
        problem         TEXT,
        prediction_id   BIGINT,
        recommendation  TEXT,
        decided_by      TEXT,
        decided_at      TIMESTAMPTZ DEFAULT NOW(),
        status          TEXT DEFAULT 'pending',
        lifecycle_state TEXT DEFAULT 'RECOMMENDED',
        reviewed_by     TEXT,
        reviewed_at     TIMESTAMPTZ,
        executed_by     TEXT,
        executed_at     TIMESTAMPTZ,
        data_origin     TEXT DEFAULT 'SYNTHETIC'
    );

    -- 18. GOV: Decision outcomes
    CREATE TABLE IF NOT EXISTS gov.decision_outcomes (
        id              BIGSERIAL PRIMARY KEY,
        decision_id     BIGINT REFERENCES gov.decisions(id) ON DELETE CASCADE,
        predicted_value DOUBLE PRECISION,
        actual_value    DOUBLE PRECISION,
        delta           DOUBLE PRECISION,
        effectiveness   DOUBLE PRECISION,
        metric_type     TEXT,
        metric_details  TEXT,
        recorded_at     TIMESTAMPTZ DEFAULT NOW(),
        data_origin     TEXT DEFAULT 'SYNTHETIC'
    );

    -- 19. Seed mines
    INSERT INTO ops.mines (mine_id, mine_name, state, latitude, longitude) VALUES
      ('MINE-A', 'Nagpur Central',   'Maharashtra',    21.15, 79.09),
      ('MINE-B', 'Balaghat North',   'Madhya Pradesh', 21.83, 80.19),
      ('MINE-C', 'Keonjhar East',    'Odisha',         21.62, 85.58),
      ('MINE-D', 'Tumkur South',     'Karnataka',      13.34, 77.10),
      ('MINE-E', 'Panaji Coastal',   'Goa',            15.49, 73.82)
    ON CONFLICT (mine_id) DO NOTHING;
    """
    execute(base_sql)

    print("3. Applying advanced constraints, unique indexes, and foreign keys...")
    advanced_constraints_sql = """
    -- Deduplicate champions before applying partial unique index (keep newest champion)
    UPDATE gov.model_registry m
    SET status = 'retired', retired_at = NOW()
    WHERE status = 'champion'
      AND EXISTS (
          SELECT 1 FROM gov.model_registry m2
          WHERE m2.task = m.task
            AND m2.status = 'champion'
            AND (m2.promoted_at > m.promoted_at OR (m2.promoted_at = m.promoted_at AND m2.id > m.id))
      );

    -- Partial unique index: at most one champion per task
    CREATE UNIQUE INDEX IF NOT EXISTS uix_one_champion_per_task
        ON gov.model_registry (task)
        WHERE status = 'champion';

    -- Partial unique index: at most one active (queued/running) run per domain
    CREATE UNIQUE INDEX IF NOT EXISTS uix_one_active_run_per_domain
        ON gov.training_runs (domain)
        WHERE status IN ('queued', 'running');

    -- Safe idempotent FKs and DB CHECKs using DO blocks
    DO $$
    BEGIN
        -- FK: gov.model_registry.training_run_id -> gov.training_runs(id)
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_model_registry_training_run'
        ) THEN
            ALTER TABLE gov.model_registry
                ADD CONSTRAINT fk_model_registry_training_run
                FOREIGN KEY (training_run_id) REFERENCES gov.training_runs(id) ON DELETE SET NULL;
        END IF;

        -- FK: gov.decisions.prediction_id -> ml.predictions(id)
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_decisions_prediction'
        ) THEN
            ALTER TABLE gov.decisions
                ADD CONSTRAINT fk_decisions_prediction
                FOREIGN KEY (prediction_id) REFERENCES ml.predictions(id) ON DELETE SET NULL;
        END IF;

        -- CHECK: ml.predictions.probability in [0, 1]
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_predictions_probability'
        ) THEN
            ALTER TABLE ml.predictions
                ADD CONSTRAINT chk_predictions_probability
                CHECK (probability IS NULL OR (probability >= 0.0 AND probability <= 1.0));
        END IF;

        -- CHECK: gov.decision_outcomes.effectiveness in [0, 1]
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_decision_outcomes_effectiveness'
        ) THEN
            ALTER TABLE gov.decision_outcomes
                ADD CONSTRAINT chk_decision_outcomes_effectiveness
                CHECK (effectiveness IS NULL OR (effectiveness >= 0.0 AND effectiveness <= 1.0));
        END IF;

        -- CHECK: ops.production_records.actual_production_t >= 0
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_actual_non_neg'
        ) THEN
            ALTER TABLE ops.production_records
                ADD CONSTRAINT chk_production_actual_non_neg
                CHECK (actual_production_t IS NULL OR actual_production_t >= 0.0);
        END IF;

        -- CHECK: ops.production_records.planned_production_t >= 0
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_production_planned_non_neg'
        ) THEN
            ALTER TABLE ops.production_records
                ADD CONSTRAINT chk_production_planned_non_neg
                CHECK (planned_production_t IS NULL OR planned_production_t >= 0.0);
        END IF;
    END $$;
    """
    execute(advanced_constraints_sql)

    print("4. Recovering stale training runs (RUNNING / QUEUED > 2h marked ABANDONED)...")
    stale_recovery_sql = """
    UPDATE gov.training_runs
    SET status = 'abandoned',
        error_message = COALESCE(error_message, 'Auto-abandoned: exceeded 2h runtime without heartbeat')
    WHERE status IN ('queued', 'running')
      AND triggered_at < NOW() - INTERVAL '2 hours';
    """
    execute(stale_recovery_sql)

    print("5. Recording migration version...")
    version_record_sql = """
    INSERT INTO gov.schema_migrations (version, description)
    VALUES (%s, 'MINEx v2 deep hardening: partial unique champion index, FKs, DB CHECKs, stale recovery')
    ON CONFLICT (version) DO UPDATE SET applied_at = NOW();
    """
    execute(version_record_sql, (CURRENT_MIGRATION_VERSION,))

    print("6. Validating migration state...")
    tables = query("""
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema IN ('geo', 'ml', 'ops', 'gov', 'hub')
        ORDER BY table_schema, table_name;
    """)
    print(f"   [OK] {len(tables)} tables verified across all schemas.")
    for t in tables:
        print(f"      • {t['table_schema']}.{t['table_name']}")
        
    print("\n" + "=" * 65)
    print(f"[SUCCESS] Migration {CURRENT_MIGRATION_VERSION} applied and verified successfully.")
    print("=" * 65)

if __name__ == "__main__":
    run_all_migrations()
