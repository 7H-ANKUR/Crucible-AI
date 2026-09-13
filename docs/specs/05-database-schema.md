# 05 — Database Schema
# MINEx — SIH26009 | MANGANESIS | v1.0
# Technology: PostgreSQL 15 + PostGIS 3.4 + Alembic migrations

---

## 1. Schema Overview

| Schema | Purpose |
|--------|---------|
| `public` | Core operational entities (mines, equipment, production) |
| `geo` | Geospatial entities (occurrences, grids, boreholes) |
| `ml` | ML models, predictions, evaluation |
| `gov` | Governance (datasets, versions, audit, roles) |
| `ops` | Operational data (production records, equipment telemetry, maintenance, blast, stockpile, schedule) |

---

## 2. Core Entities (`public` schema)

### `public.regions`
```sql
CREATE TABLE public.regions (
    region_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(120) NOT NULL,
    state           VARCHAR(60) NOT NULL,
    district        VARCHAR(60),
    geometry        GEOMETRY(MULTIPOLYGON, 4326),
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_regions_geom ON public.regions USING GIST(geometry);
```

### `public.mines`
```sql
CREATE TABLE public.mines (
    mine_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mine_code       VARCHAR(20) UNIQUE NOT NULL,       -- e.g. 'BAL-001'
    mine_name       VARCHAR(120) NOT NULL,
    region_id       UUID REFERENCES public.regions(region_id),
    state           VARCHAR(60) NOT NULL,
    district        VARCHAR(60),
    mine_type       VARCHAR(20) CHECK (mine_type IN ('underground', 'opencast', 'mixed')),
    geometry        GEOMETRY(POINT, 4326),
    elevation_m     NUMERIC(8,2),
    source          VARCHAR(60) NOT NULL DEFAULT 'SYNTHETIC',
    data_origin     VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_mines_geom ON public.mines USING GIST(geometry);
CREATE INDEX idx_mines_region ON public.mines(region_id);
```

### `public.equipment`
```sql
CREATE TABLE public.equipment (
    machine_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_code        VARCHAR(30) UNIQUE NOT NULL,
    mine_id             UUID NOT NULL REFERENCES public.mines(mine_id),
    machine_type        VARCHAR(60) NOT NULL,   -- 'LHD', 'Drill', 'Loader', etc.
    manufacturer        VARCHAR(60),            -- 'L&T', 'BEML', 'Tata Hitachi', 'JCB'
    commission_date     DATE,
    engine_capacity_kw  NUMERIC(8,2),
    data_origin         VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    active              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_equipment_mine ON public.equipment(mine_id);
```

---

## 3. Geospatial Entities (`geo` schema)

### `geo.mn_occurrences`
```sql
CREATE TABLE geo.mn_occurrences (
    occurrence_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id           UUID REFERENCES public.regions(region_id),
    latitude            NUMERIC(10,7) NOT NULL,
    longitude           NUMERIC(10,7) NOT NULL,
    geometry            GEOMETRY(POINT, 4326) NOT NULL,
    host_rock           VARCHAR(80),
    formation           VARCHAR(80),
    lithology           VARCHAR(80),
    mn_grade_pct        NUMERIC(5,2),
    source              VARCHAR(80) NOT NULL,
    source_agency       VARCHAR(60),           -- 'GSI', 'NMET', 'IBM', 'SYNTHETIC'
    data_origin         VARCHAR(40) NOT NULL,
    spatial_accuracy_m  NUMERIC(10,2),
    created_at          TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_india_lat CHECK (latitude BETWEEN 6.0 AND 37.5),
    CONSTRAINT chk_india_lon CHECK (longitude BETWEEN 68.0 AND 98.0)
);
CREATE INDEX idx_mn_occ_geom ON geo.mn_occurrences USING GIST(geometry);
```

### `geo.prospectivity_grid`
```sql
CREATE TABLE geo.prospectivity_grid (
    grid_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id               UUID REFERENCES public.regions(region_id),
    geometry                GEOMETRY(POLYGON, 4326) NOT NULL,
    centroid                GEOMETRY(POINT, 4326),
    resolution_m            INTEGER NOT NULL DEFAULT 500,
    -- EO features
    b4_red                  NUMERIC(8,4),
    b8_nir                  NUMERIC(8,4),
    b11_swir1               NUMERIC(8,4),
    b12_swir2               NUMERIC(8,4),
    ndvi                    NUMERIC(6,4),
    ndmi                    NUMERIC(6,4),
    ndwi                    NUMERIC(6,4),
    swir_ratio              NUMERIC(6,4),
    -- Terrain features
    elevation_m             NUMERIC(8,2),
    slope_deg               NUMERIC(6,3),
    aspect_deg              NUMERIC(6,2),
    curvature               NUMERIC(8,5),
    roughness               NUMERIC(8,5),
    terrain_ruggedness      NUMERIC(8,5),
    drainage_density        NUMERIC(8,5),
    -- Geology features
    lithology_code          VARCHAR(20),
    formation_code          VARCHAR(20),
    host_rock_flag          BOOLEAN DEFAULT FALSE,
    -- Structural features
    fault_distance_km       NUMERIC(8,3),
    lineament_distance_km   NUMERIC(8,3),
    structural_density      NUMERIC(8,5),
    -- Context features
    occ_distance_km         NUMERIC(8,3),
    drill_density           NUMERIC(8,5),
    exploration_density     NUMERIC(8,5),
    data_quality_score      NUMERIC(4,3),
    -- Target (prospectivity ML)
    prospectivity_label     SMALLINT CHECK (prospectivity_label IN (0,1)),
    data_origin             VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_prosp_grid_geom ON geo.prospectivity_grid USING GIST(geometry);
CREATE INDEX idx_prosp_grid_region ON geo.prospectivity_grid(region_id);
```

### `geo.boreholes`
```sql
CREATE TABLE geo.boreholes (
    borehole_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mine_id         UUID REFERENCES public.mines(mine_id),
    region_id       UUID REFERENCES public.regions(region_id),
    borehole_code   VARCHAR(30),
    latitude        NUMERIC(10,7) NOT NULL,
    longitude       NUMERIC(10,7) NOT NULL,
    geometry        GEOMETRY(POINT, 4326) NOT NULL,
    elevation_m     NUMERIC(8,2),
    total_depth_m   NUMERIC(8,2),
    dip_deg         NUMERIC(5,2),
    azimuth_deg     NUMERIC(6,2),
    project_id      VARCHAR(60),
    data_origin     VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT chk_bh_lat CHECK (latitude BETWEEN 6.0 AND 37.5),
    CONSTRAINT chk_bh_lon CHECK (longitude BETWEEN 68.0 AND 98.0)
);

CREATE TABLE geo.borehole_intervals (
    interval_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    borehole_id     UUID NOT NULL REFERENCES geo.boreholes(borehole_id) ON DELETE CASCADE,
    depth_from_m    NUMERIC(8,2) NOT NULL,
    depth_to_m      NUMERIC(8,2) NOT NULL,
    lithology       VARCHAR(80),
    mn_pct          NUMERIC(5,2),
    fe_pct          NUMERIC(5,2),
    sio2_pct        NUMERIC(5,2),
    ore_flag        BOOLEAN DEFAULT FALSE,
    data_origin     VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    CONSTRAINT chk_interval CHECK (depth_to_m > depth_from_m)
);
```

---

## 4. Operational Data (`ops` schema)

### `ops.production_records`
```sql
CREATE TABLE ops.production_records (
    record_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mine_id                 UUID NOT NULL REFERENCES public.mines(mine_id),
    zone_id                 VARCHAR(30),
    shift_date              DATE NOT NULL,
    shift_number            SMALLINT CHECK (shift_number IN (1,2,3)),
    shift_start             TIMESTAMPTZ,
    planned_production_t    NUMERIC(10,2),
    actual_production_t     NUMERIC(10,2),
    shortfall_flag          BOOLEAN,
    -- Underground mining fields
    mine_type               VARCHAR(20),
    underground_level       VARCHAR(20),
    stope_id                VARCHAR(30),
    ore_pass_availability   BOOLEAN,
    ventilation_status      VARCHAR(20),
    underground_haul_dist_km NUMERIC(6,3),
    ground_condition_score  NUMERIC(4,3),
    development_delay_hours NUMERIC(6,2),
    -- Weather
    rainfall_24h_mm         NUMERIC(6,2),
    rainfall_7d_mm          NUMERIC(6,2),
    soil_moisture_pct       NUMERIC(5,2),
    temperature_c           NUMERIC(5,2),
    -- Equipment state
    equipment_availability_pct NUMERIC(5,2),
    equipment_utilization_pct  NUMERIC(5,2),
    downtime_hours             NUMERIC(6,2),
    breakdown_count            SMALLINT,
    -- Blast
    blast_delay_hours       NUMERIC(6,2),
    fragmentation_score     NUMERIC(4,3),
    blast_success           BOOLEAN,
    -- Logistics
    haul_distance_km        NUMERIC(6,3),
    cycle_time_min          NUMERIC(6,2),
    queue_time_min          NUMERIC(6,2),
    road_condition_score    NUMERIC(4,3),
    -- Costs (INR)
    equipment_cost_inr      NUMERIC(12,2),
    maintenance_cost_inr    NUMERIC(12,2),
    blast_cost_inr          NUMERIC(12,2),
    haul_cost_inr           NUMERIC(12,2),
    ore_value_inr           NUMERIC(14,2),
    -- Metadata
    dataset_version_id      UUID,
    data_origin             VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_prod_mine_date ON ops.production_records(mine_id, shift_date);
CREATE INDEX idx_prod_date ON ops.production_records(shift_date);
```

### `ops.equipment_telemetry`
```sql
CREATE TABLE ops.equipment_telemetry (
    telemetry_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id          UUID NOT NULL REFERENCES public.equipment(machine_id),
    mine_id             UUID NOT NULL REFERENCES public.mines(mine_id),
    timestamp           TIMESTAMPTZ NOT NULL,
    engine_hours        NUMERIC(8,1),
    temperature_c       NUMERIC(6,2),
    vibration_g         NUMERIC(6,3),
    load_factor         NUMERIC(5,3),
    fuel_rate_lph       NUMERIC(6,2),
    hydraulic_pressure  NUMERIC(8,2),
    machine_age_months  SMALLINT,
    maintenance_overdue BOOLEAN,
    failure_next_24h    BOOLEAN,                  -- ML TARGET (excluded from features)
    dataset_version_id  UUID,
    data_origin         VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tel_machine_ts ON ops.equipment_telemetry(machine_id, timestamp);
CREATE INDEX idx_tel_mine_ts ON ops.equipment_telemetry(mine_id, timestamp);
```

### `ops.maintenance_events`
```sql
CREATE TABLE ops.maintenance_events (
    event_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id              UUID NOT NULL REFERENCES public.equipment(machine_id),
    mine_id                 UUID NOT NULL REFERENCES public.mines(mine_id),
    event_date              DATE NOT NULL,
    maintenance_type        VARCHAR(40),   -- 'preventive', 'corrective', 'emergency'
    severity                VARCHAR(20),   -- 'minor', 'major', 'critical'
    duration_hours          NUMERIC(6,2),
    cost_inr                NUMERIC(12,2),
    post_maintenance_status VARCHAR(20),
    downtime_caused_hours   NUMERIC(6,2),
    dataset_version_id      UUID,
    data_origin             VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_maint_machine ON ops.maintenance_events(machine_id, event_date);
```

### `ops.blasting_events`
```sql
CREATE TABLE ops.blasting_events (
    blast_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mine_id                 UUID NOT NULL REFERENCES public.mines(mine_id),
    zone_id                 VARCHAR(30),
    bench_id                VARCHAR(30),
    planned_datetime        TIMESTAMPTZ,
    actual_datetime         TIMESTAMPTZ,
    blast_delay_hours       NUMERIC(6,2),
    hole_count              SMALLINT,
    hole_depth_m            NUMERIC(6,2),
    explosive_kg            NUMERIC(8,2),
    blast_success           BOOLEAN,
    fragmentation_score     NUMERIC(4,3),
    oversize_pct            NUMERIC(5,2),
    post_blast_clearance_h  NUMERIC(6,2),
    cost_inr                NUMERIC(12,2),
    dataset_version_id      UUID,
    data_origin             VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at              TIMESTAMPTZ DEFAULT now()
);
```

### `ops.stockpile_records`
```sql
CREATE TABLE ops.stockpile_records (
    record_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mine_id             UUID NOT NULL REFERENCES public.mines(mine_id),
    record_date         DATE NOT NULL,
    opening_stock_t     NUMERIC(12,2),
    closing_stock_t     NUMERIC(12,2),
    ore_received_t      NUMERIC(12,2),
    ore_dispatched_t    NUMERIC(12,2),
    mn_grade_pct        NUMERIC(5,2),
    ore_value_inr       NUMERIC(14,2),
    dataset_version_id  UUID,
    data_origin         VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at          TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. ML Registry (`ml` schema)

### `ml.model_releases`
```sql
CREATE TABLE ml.model_releases (
    model_version_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_family            VARCHAR(40) NOT NULL,  -- 'production_forecast', 'shortfall', 'prospectivity', 'equipment_failure'
    version_tag             VARCHAR(20) NOT NULL,  -- 'v4.2', 'challenger-v4.3'
    status                  VARCHAR(20) NOT NULL DEFAULT 'challenger',
                            -- 'challenger', 'champion', 'rejected', 'frozen', 'archived'
    dataset_version_id      UUID,
    feature_schema_version  VARCHAR(20),
    training_period_start   DATE,
    training_period_end     DATE,
    validation_method       VARCHAR(40),           -- 'temporal', 'spatial_block', 'entity'
    -- Metrics (JSONB for flexibility)
    validation_metrics      JSONB,
    -- e.g. {"roc_auc": 0.902, "pr_auc": 0.854, "f1": 0.778, "brier": 0.12}
    leakage_audit_status    VARCHAR(10) DEFAULT 'PASS',
    calibration_status      VARCHAR(10),
    fn_rate                 NUMERIC(5,4),
    stability_status        VARCHAR(10),           -- 'HIGH', 'MEDIUM', 'LOW'
    artifact_path           TEXT,
    git_commit              VARCHAR(40),
    random_seed             INTEGER DEFAULT 26009,
    limitations             TEXT,
    approved_by             UUID,
    approved_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_model_family ON ml.model_releases(model_family, status);
```

### `ml.predictions`
```sql
CREATE TABLE ml.predictions (
    prediction_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id           UUID NOT NULL,             -- mine_id, machine_id, grid_id
    entity_type         VARCHAR(20) NOT NULL,      -- 'mine', 'machine', 'grid'
    model_version_id    UUID REFERENCES ml.model_releases(model_version_id),
    dataset_version_id  UUID,
    prediction_type     VARCHAR(30) NOT NULL,      -- 'production_forecast', 'shortfall', 'prospectivity', 'failure'
    as_of_time          TIMESTAMPTZ NOT NULL,
    -- Outputs
    prediction_value    NUMERIC(14,4),
    p10                 NUMERIC(14,4),
    p50                 NUMERIC(14,4),
    p90                 NUMERIC(14,4),
    shortfall_prob      NUMERIC(5,4),
    confidence_tier     VARCHAR(10),               -- 'HIGH', 'MEDIUM', 'LOW'
    uncertainty_score   NUMERIC(5,4),
    -- Attribution (top drivers as JSONB)
    top_drivers         JSONB,
    -- Recommendation
    recommended_action  TEXT,
    -- Feedback
    actual_outcome      NUMERIC(14,4),
    outcome_error       NUMERIC(14,4),
    review_status       VARCHAR(20) DEFAULT 'pending', -- 'pending', 'reviewed', 'corrected'
    data_origin         VARCHAR(40) NOT NULL DEFAULT 'SYNTHETIC',
    created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_pred_entity ON ml.predictions(entity_id, entity_type, as_of_time);
CREATE INDEX idx_pred_type ON ml.predictions(prediction_type, created_at);
```

### `ml.scenarios`
```sql
CREATE TABLE ml.scenarios (
    scenario_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mine_id                 UUID NOT NULL REFERENCES public.mines(mine_id),
    created_by              UUID,
    scenario_name           VARCHAR(120),
    as_of_time              TIMESTAMPTZ NOT NULL,
    mine_state_snapshot     JSONB,
    interventions           JSONB,
    -- Results
    baseline_production_t   NUMERIC(12,2),
    scenario_production_t   NUMERIC(12,2),
    baseline_shortfall_prob NUMERIC(5,4),
    scenario_shortfall_prob NUMERIC(5,4),
    cost_inr                NUMERIC(14,2),
    risk_change             NUMERIC(5,4),
    objective_score         NUMERIC(8,4),
    constraint_violations   JSONB,
    recommended             BOOLEAN DEFAULT FALSE,
    status                  VARCHAR(20) DEFAULT 'draft', -- 'draft', 'saved', 'sent_for_review', 'adopted', 'rejected'
    created_at              TIMESTAMPTZ DEFAULT now()
);
```

### `ml.decision_memory`
```sql
CREATE TABLE ml.decision_memory (
    decision_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id         UUID REFERENCES ml.scenarios(scenario_id),
    prediction_id       UUID REFERENCES ml.predictions(prediction_id),
    intervention_type   VARCHAR(60),
    action_description  TEXT,
    baseline_prod_t     NUMERIC(12,2),
    predicted_effect_t  NUMERIC(12,2),
    actual_effect_t     NUMERIC(12,2),
    cost_inr            NUMERIC(14,2),
    risk_reduction      NUMERIC(5,4),
    execution_status    VARCHAR(20),               -- 'adopted', 'partial', 'rejected'
    reviewer_id         UUID,
    reviewed_at         TIMESTAMPTZ,
    model_version_id    UUID REFERENCES ml.model_releases(model_version_id),
    dataset_version_id  UUID,
    created_at          TIMESTAMPTZ DEFAULT now()
);
```

---

## 6. Governance (`gov` schema)

### `gov.dataset_versions`
```sql
CREATE TABLE gov.dataset_versions (
    dataset_version_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id          VARCHAR(60) NOT NULL,      -- '09_mine_operations', '10_equipment_telemetry'
    version_number      INTEGER NOT NULL,
    parent_version_id   UUID REFERENCES gov.dataset_versions(dataset_version_id),
    data_domain         VARCHAR(40) NOT NULL,      -- 'production', 'equipment', 'maintenance', 'exploration', 'environment', 'planning'
    data_origin         VARCHAR(40) NOT NULL,
    uploader_id         UUID,
    source_description  TEXT,
    file_name           VARCHAR(255),
    file_format         VARCHAR(20),               -- 'csv', 'parquet', 'xlsx', 'geojson'
    row_count           INTEGER,
    column_count        INTEGER,
    checksum_sha256     CHAR(64),
    schema_hash         CHAR(64),
    validation_status   VARCHAR(20) DEFAULT 'pending', -- 'pending', 'pass', 'fail'
    validation_findings JSONB,
    approval_status     VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
    approved_by         UUID,
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    artifact_path       TEXT,
    created_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE (dataset_id, version_number)
);
CREATE INDEX idx_dsv_domain ON gov.dataset_versions(data_domain, approval_status);
```

### `gov.data_freshness`
```sql
CREATE TABLE gov.data_freshness (
    domain_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_domain             VARCHAR(40) UNIQUE NOT NULL,
    expected_cadence        VARCHAR(30),            -- 'shift', 'daily', 'weekly', 'monthly', 'event'
    last_successful_update  TIMESTAMPTZ,
    next_expected_update    TIMESTAMPTZ,
    freshness_status        VARCHAR(10) DEFAULT 'FRESH',
                            -- 'FRESH', 'AGING', 'STALE', 'CRITICAL'
    latest_dataset_version_id UUID REFERENCES gov.dataset_versions(dataset_version_id),
    updated_at              TIMESTAMPTZ DEFAULT now()
);
```

### `gov.audit_log`
```sql
CREATE TABLE gov.audit_log (
    audit_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id        UUID,
    actor_email     VARCHAR(120),
    action          VARCHAR(60) NOT NULL,          -- 'dataset_approved', 'model_promoted', 'rollback', etc.
    entity_type     VARCHAR(40),
    entity_id       UUID,
    reason          TEXT,
    before_state    JSONB,
    after_state     JSONB,
    ip_address      INET,
    created_at      TIMESTAMPTZ DEFAULT now()
);
-- Append-only; no UPDATE or DELETE ever issued on this table
CREATE INDEX idx_audit_actor ON gov.audit_log(actor_id, created_at);
CREATE INDEX idx_audit_action ON gov.audit_log(action, created_at);
```

### `gov.users`
```sql
CREATE TABLE gov.users (
    user_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       VARCHAR(254) UNIQUE NOT NULL,
    name        VARCHAR(120),
    active      BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gov.user_roles (
    user_role_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES gov.users(user_id),
    role            VARCHAR(40) NOT NULL,
                    -- 'platform_admin', 'exploration_admin', 'equipment_admin',
                    -- 'production_admin', 'planning_admin', 'management'
    mine_id         UUID REFERENCES public.mines(mine_id),   -- NULL = global
    granted_by      UUID REFERENCES gov.users(user_id),
    granted_at      TIMESTAMPTZ DEFAULT now(),
    revoked_at      TIMESTAMPTZ,
    UNIQUE (user_id, role, mine_id)
);
```

---

## 7. Indexing Strategy

| Table | Index | Type | Rationale |
|-------|-------|------|-----------|
| `geo.prospectivity_grid` | `geometry` | GIST | Spatial queries (bounding box, nearest) |
| `geo.mn_occurrences` | `geometry` | GIST | Occurrence proximity queries |
| `ops.production_records` | `(mine_id, shift_date)` | B-tree | Time-series per mine |
| `ops.equipment_telemetry` | `(machine_id, timestamp)` | B-tree | Machine trend queries |
| `ml.predictions` | `(entity_id, entity_type, as_of_time)` | B-tree | Ledger lookups |
| `gov.audit_log` | `(action, created_at)` | B-tree | Audit reporting |
| `gov.dataset_versions` | `(data_domain, approval_status)` | B-tree | Onboarding queue |

---

## 8. Key Constraints & Invariants

```sql
-- India boundary enforcement (enforced at API + DB layer)
-- Latitude: 6.0 – 37.5, Longitude: 68.0 – 98.0

-- Data origin enum
-- 'REAL', 'REAL_NEEDS_CLEANING', 'DERIVED_REAL', 'SYNTHETIC',
-- 'SYNTHETIC_CALIBRATED_BY_REAL', 'PORTAL_ONLY'

-- Audit log is append-only (enforced via role: no UPDATE/DELETE granted)

-- Prospectivity label not usable as "reserve" (business rule, not DB constraint)
-- Enforced at application layer via target maturity validation
```

---

## 9. Migration Strategy

- Tool: **Alembic** (SQLAlchemy-compatible)
- Convention: `YYYYMMDDHHMMSS_description.py`
- Each migration is forward-only unless an explicit rollback migration exists
- All schema changes tested in staging before production
- Initial seed: synthetic datasets loaded via `alembic seed` script with `seed=26009`
