"""
Phase 2 Database Migrations: Data Hub Schema
Runs non-destructive CREATE TABLE IF NOT EXISTS against the live DB.
"""
import sys
from pathlib import Path

# Add project root to Python path so we can import app.api
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api.core.db import execute, init_db


def migrate():
    print("Initializing DB connection...")
    init_db()
    
    print("Running Phase 2 migrations...")
    
    sql = """
    -- Create schema
    CREATE SCHEMA IF NOT EXISTS hub;
    
    -- Canonical Schemas (defines the exact column structure expected for a domain)
    CREATE TABLE IF NOT EXISTS hub.canonical_schemas (
        id SERIAL PRIMARY KEY,
        domain TEXT UNIQUE NOT NULL, -- e.g., 'production', 'equipment'
        version TEXT NOT NULL,
        schema_json TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Datasets
    CREATE TABLE IF NOT EXISTS hub.datasets (
        id BIGSERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    
    -- Dataset Versions
    CREATE TABLE IF NOT EXISTS hub.dataset_versions (
        id BIGSERIAL PRIMARY KEY,
        dataset_id BIGINT REFERENCES hub.datasets(id) ON DELETE CASCADE,
        version_tag TEXT NOT NULL,
        file_path TEXT NOT NULL, -- Path in R2 or local storage
        status TEXT DEFAULT 'UPLOADED', -- UPLOADED, MAPPED, VALIDATED, APPROVED_FOR_TRAINING
        row_count INTEGER,
        uploaded_by TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (dataset_id, version_tag)
    );
    
    -- Dataset Column Mappings
    CREATE TABLE IF NOT EXISTS hub.dataset_column_mappings (
        id BIGSERIAL PRIMARY KEY,
        version_id BIGINT REFERENCES hub.dataset_versions(id) ON DELETE CASCADE,
        source_column TEXT NOT NULL,
        canonical_column TEXT,
        confidence DOUBLE PRECISION,
        requires_review BOOLEAN DEFAULT FALSE,
        mapped_by TEXT, -- System or Username
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (version_id, source_column)
    );
    
    -- Dataset Validation Reports
    CREATE TABLE IF NOT EXISTS hub.dataset_validation_reports (
        id BIGSERIAL PRIMARY KEY,
        version_id BIGINT REFERENCES hub.dataset_versions(id) ON DELETE CASCADE UNIQUE,
        report_json TEXT NOT NULL,
        quality_score DOUBLE PRECISION,
        passed BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    );
    """
    
    try:
        execute(sql)
        print("[OK] Phase 2 migrations completed successfully.")
    except Exception as e:
        print(f"[ERROR] Migration failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    migrate()
