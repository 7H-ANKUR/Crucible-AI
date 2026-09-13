"""scripts/migrate_phase4.py — Phase 4 Database Migrations:
Durable Storage Metadata, Lineage, Artifact Registry & Decision Lifecycle.

Non-destructive: uses CREATE TABLE IF NOT EXISTS and ALTER TABLE ADD COLUMN IF NOT EXISTS.
"""
import sys
from pathlib import Path

# Add project root to Python path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.core.db import execute, init_db


def migrate():
    print("Initializing DB connection...")
    init_db()
    print("Running Phase 4 migrations...")

    sql = """
    -- 1. Extend hub.dataset_versions for storage, checksums & canonicalization
    ALTER TABLE hub.dataset_versions
        ADD COLUMN IF NOT EXISTS drive_file_id            TEXT,
        ADD COLUMN IF NOT EXISTS drive_folder_id          TEXT,
        ADD COLUMN IF NOT EXISTS checksum_sha256          TEXT,
        ADD COLUMN IF NOT EXISTS file_size_bytes          BIGINT,
        ADD COLUMN IF NOT EXISTS content_type             TEXT,
        ADD COLUMN IF NOT EXISTS original_filename        TEXT,
        ADD COLUMN IF NOT EXISTS canonical_drive_file_id  TEXT,
        ADD COLUMN IF NOT EXISTS canonical_checksum_sha256 TEXT,
        ADD COLUMN IF NOT EXISTS canonical_row_count      INTEGER,
        ADD COLUMN IF NOT EXISTS schema_hash              TEXT,
        ADD COLUMN IF NOT EXISTS schema_version           TEXT,
        ADD COLUMN IF NOT EXISTS transformation_metadata  TEXT,
        ADD COLUMN IF NOT EXISTS data_origin              TEXT DEFAULT 'REAL_USER_UPLOADED',
        ADD COLUMN IF NOT EXISTS parent_version_id        BIGINT,
        ADD COLUMN IF NOT EXISTS storage_status           TEXT DEFAULT 'AVAILABLE';

    -- 2. Extend gov.model_registry for artifact provenance, checksums & lineage
    ALTER TABLE gov.model_registry
        ADD COLUMN IF NOT EXISTS training_run_id        BIGINT,
        ADD COLUMN IF NOT EXISTS artifact_drive_file_id TEXT,
        ADD COLUMN IF NOT EXISTS artifact_sha256        TEXT,
        ADD COLUMN IF NOT EXISTS artifact_size_bytes    BIGINT,
        ADD COLUMN IF NOT EXISTS smoke_test_status      TEXT,
        ADD COLUMN IF NOT EXISTS retired_at             TIMESTAMPTZ;

    -- 3. Dedicated model artifacts table (Section 18)
    CREATE TABLE IF NOT EXISTS gov.model_artifacts (
        id              BIGSERIAL PRIMARY KEY,
        model_id        BIGINT REFERENCES gov.model_registry(id) ON DELETE CASCADE,
        filename        TEXT NOT NULL,
        drive_file_id   TEXT,
        drive_folder_id TEXT,
        sha256          TEXT,
        size_bytes      BIGINT,
        content_type    TEXT,
        status          TEXT DEFAULT 'REGISTERED', -- REGISTERED | AVAILABLE | VERIFIED | MISSING | CORRUPTED | RETIRED
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        verified_at     TIMESTAMPTZ
    );

    -- 4. Extend gov.decisions for lifecycle state machine
    ALTER TABLE gov.decisions
        ADD COLUMN IF NOT EXISTS lifecycle_state TEXT DEFAULT 'RECOMMENDED',
        ADD COLUMN IF NOT EXISTS reviewed_by     TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS executed_by     TEXT,
        ADD COLUMN IF NOT EXISTS executed_at     TIMESTAMPTZ;

    -- 5. Extend gov.decision_outcomes for task-specific metric types
    ALTER TABLE gov.decision_outcomes
        ADD COLUMN IF NOT EXISTS metric_type    TEXT,
        ADD COLUMN IF NOT EXISTS metric_details TEXT;
    """

    try:
        execute(sql)
        print("[OK] Phase 4 migrations completed successfully.")
    except Exception as e:
        print(f"[ERROR] Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate()
