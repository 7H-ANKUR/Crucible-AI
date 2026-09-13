"""
Phase 3 Database Migrations: Training Runs + Model Approval + Extended Model Registry
Non-destructive: uses CREATE TABLE IF NOT EXISTS and ALTER TABLE ADD COLUMN IF NOT EXISTS.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from apps.api.core.db import execute, init_db


def migrate():
    print("Initializing DB connection...")
    init_db()
    print("Running Phase 3 migrations...")

    sql = """
    -- Extend model_registry (non-destructive ALTER)
    ALTER TABLE gov.model_registry
        ADD COLUMN IF NOT EXISTS model          TEXT,
        ADD COLUMN IF NOT EXISTS metric_roc_auc DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_pr_auc  DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_mae     DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_r2      DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS metric_lift    DOUBLE PRECISION,
        ADD COLUMN IF NOT EXISTS split_type     TEXT DEFAULT 'temporal',
        ADD COLUMN IF NOT EXISTS data_origin    TEXT DEFAULT 'SYNTHETIC',
        ADD COLUMN IF NOT EXISTS dataset_version_id BIGINT,
        ADD COLUMN IF NOT EXISTS artifact_path  TEXT,
        ADD COLUMN IF NOT EXISTS approved_by    TEXT,
        ADD COLUMN IF NOT EXISTS approved_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS promoted_at    TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS rollback_of    BIGINT;

    -- Training runs
    CREATE TABLE IF NOT EXISTS gov.training_runs (
        id              BIGSERIAL PRIMARY KEY,
        run_tag         TEXT UNIQUE NOT NULL,
        status          TEXT DEFAULT 'queued',   -- queued | running | completed | failed
        domain          TEXT NOT NULL,
        dataset_version_id BIGINT,
        triggered_by    TEXT NOT NULL,
        triggered_at    TIMESTAMPTZ DEFAULT NOW(),
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        log_path        TEXT,
        error_message   TEXT,
        data_origin     TEXT DEFAULT 'SYNTHETIC'
    );

    -- Model approvals
    CREATE TABLE IF NOT EXISTS gov.model_approvals (
        id              BIGSERIAL PRIMARY KEY,
        model_id        BIGINT NOT NULL,
        action          TEXT NOT NULL,  -- approved | rejected | promoted | rolled_back
        actor_id        TEXT NOT NULL,
        actor_role      TEXT NOT NULL,
        note            TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    -- Decisions table (Phase 6 - create now as foreign key target)
    CREATE TABLE IF NOT EXISTS gov.decisions (
        id              BIGSERIAL PRIMARY KEY,
        problem         TEXT,
        prediction_id   BIGINT,
        recommendation  TEXT,
        decided_by      TEXT,
        decided_at      TIMESTAMPTZ DEFAULT NOW(),
        status          TEXT DEFAULT 'pending',  -- pending | approved | rejected | executed
        data_origin     TEXT DEFAULT 'SYNTHETIC'
    );

    CREATE TABLE IF NOT EXISTS gov.decision_outcomes (
        id              BIGSERIAL PRIMARY KEY,
        decision_id     BIGINT REFERENCES gov.decisions(id) ON DELETE CASCADE,
        predicted_value DOUBLE PRECISION,
        actual_value    DOUBLE PRECISION,
        delta           DOUBLE PRECISION,
        effectiveness   DOUBLE PRECISION,
        recorded_at     TIMESTAMPTZ DEFAULT NOW(),
        data_origin     TEXT DEFAULT 'SYNTHETIC'
    );
    """

    try:
        execute(sql)
        print("[OK] Phase 3 migrations completed successfully.")
    except Exception as e:
        print(f"[ERROR] Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate()
