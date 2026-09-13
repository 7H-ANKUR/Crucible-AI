# MINEx Data Hub & Dataset Ingestion Lifecycle

## 1. Overview

The MINEx Data Hub (`/data-hub` and `/api/v1/data/*`) is the governed gateway for incorporating new operational datasets into the platform. It guarantees that raw data is never ingested directly into machine learning pipelines without canonical schema alignment, deterministic quality validation, SHA-256 integrity verification, and durable storage persistence.

---

## 2. The 6-Step Ingestion & Canonicalization Pipeline

```
1. Select Domain ──► 2. Upload CSV/XLSX ──► 3. Schema Auto-Mapping ──► 4. 25-Point Validation ──► 5. Canonicalization ──► 6. Human Sign-Off Gate
   (prod/equip/         (Google Drive          (exact/normalized/       (0-100 quality score,      (Type coercion,        (APPROVED_FOR_
    geo/maint)           durable storage)       Levenshtein fuzzy)       25 discrete checks)        unit normalization)     TRAINING)
```

### Step 1: Select Domain
The user selects one of 4 canonical domains:
- `production`: Shift logs, ore grades, planned vs actual tonnages, blast delays
- `equipment`: Machine telemetry, vibration RMS, bearing temperatures, operating hours
- `exploration`: Geological drillholes, geochemical assays, satellite NDVI, elevation
- `maintenance`: Work orders, preventative maintenance schedules, downtime logs

### Step 2: File Upload & Remote Storage
- File (CSV or XLSX) is uploaded via `POST /api/v1/data/upload` with role-based domain access verification (`check_domain_access`).
- Saved durably to Google Drive object storage via `StorageService` (`datasets/{domain}/{filename}`) and cached locally in `apps/api/storage_cache/`.
- Computes and records SHA-256 integrity checksum and byte size.
- Supports true multi-version incrementing (`v1` → `v2`) with lineage linking via `parent_version_id`.

### Step 3: Schema Auto-Mapping Engine (`schema_mapper.py`)
Matches uploaded column headers against canonical target fields in 3 passes:
1. **Exact match**: Identical string comparison
2. **Normalized match**: Case-insensitive, strip whitespace, snake_case conversion
3. **Fuzzy similarity**: Levenshtein distance matching (>70% confidence)
*Uncertain mappings (<70% confidence) are flagged for human operator verification in the UI.*

### Step 4: 25-Point Deterministic Quality Validator (`data_validator.py`)
Executes 25 strict, deterministic checks grouped into 6 audit categories:
1. **Completeness**: `row_count`, `null_values`, `null_concentration`, `required_columns`
2. **Uniqueness**: `duplicates`, `duplicate_primary_keys`
3. **Temporal Validity**: `date_format`, `future_dates`, `temporal_ordering`, `sampling_regularity`
4. **Physical & Domain Bounds**: `numeric_bounds`, `india_bounds`, `percentage_bounds`, `non_negative_quantities`
5. **Statistical Distribution**: `constant_columns`, `extreme_outliers_iqr`, `cardinality_sanity`, `variance_threshold`
6. **Integrity & Leakage**: `target_leakage_risk`, `schema_drift_detection`, `encoding_validity`, `cross_field_consistency`, `unit_plausibility`, `foreign_key_lineage`, `monotonic_constraints`

Computes a composite 0-100 Data Health Score. Detailed diagnostics are saved to `hub.dataset_validation_reports` and backed up to Google Drive under `reports/validation/`.

### Step 5: Canonical Dataset Materialization (`canonicalizer.py`)
Upon successful validation (score $\ge 70$, zero critical blocking errors):
- Deterministically coerces column data types according to domain schemas.
- Normalizes physical units (e.g. converting tons to tonnes, raw vibration to RMS).
- Deduplicates rows and stamps `canonical_schema_hash`.
- Materializes clean snapshot into durable storage under `validated/{domain}/canonical_{domain}_v{N}.csv`.
- Writes reference `canonical_storage_id` to `hub.dataset_versions`.

### Step 6: Human Sign-Off Gate
A dataset version with quality score $\ge 70$ can be approved by an authorized domain administrator via `POST /api/v1/data/versions/{id}/approve`. Only datasets in `APPROVED_FOR_TRAINING` status with materialized canonical snapshots can trigger model retraining runs.

### Step 7: Event-Driven Cache Invalidation
When a new dataset version is uploaded or approved:
- The Data Hub triggers `invalidate_dataset(domain)`.
- Evicts affected domain keys (`minex:cache:v1:{domain}:*`) across all active L1 in-memory caches and L2 Upstash Redis.
- Guarantees that subsequent API dashboard queries and model inferences immediately reflect the new dataset without serving stale entries.

