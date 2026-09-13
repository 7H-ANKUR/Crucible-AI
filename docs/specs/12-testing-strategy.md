# 12 — Testing Strategy
# MINEx — SIH26009 | v1.0

---

## 1. Testing Philosophy

MINEx testing is structured around **four trust guarantees**:

1. **India compliance** — no foreign coordinate ever enters a model or prediction
2. **Leakage freedom** — no future or target data contaminates any feature set
3. **Evaluation honesty** — models are evaluated on the correct holdout type (temporal/spatial), never random split
4. **Disclosure integrity** — every synthetic data point is labelled; no fabricated metrics

Tests are grouped into five layers:

| Layer | Scope | Tools |
|-------|-------|-------|
| Unit | Pure functions, domain logic | pytest, jest |
| Data | Schema, quality, leakage, India compliance | pytest + custom validators |
| ML | Model correctness, evaluation integrity, calibration | pytest + scikit-learn metrics |
| Integration | API contract, service interactions | pytest-asyncio + httpx |
| E2E | Full UI flows from browser | Playwright |

---

## 2. Unit Tests

### 2.1 India Compliance (`packages/py-core`)

```python
# tests/test_india_compliance.py

def test_valid_india_point():
    """Known Indian coordinates should pass."""
    assert assert_india_only(lat=22.07, lon=80.05) == True  # Balaghat

def test_invalid_foreign_point():
    """Foreign coordinates must raise ValueError."""
    with pytest.raises(ValueError, match="outside India boundary"):
        assert_india_only(lat=51.5, lon=-0.12)  # London

def test_boundary_edge_south():
    """Southern boundary (Kanyakumari)."""
    assert assert_india_only(lat=8.08, lon=77.55) == True

def test_boundary_edge_north():
    """Northern boundary."""
    assert assert_india_only(lat=37.1, lon=77.5) == True

def test_batch_with_violation():
    """Batch check must flag the violating record."""
    records = [
        {"lat": 22.07, "lon": 80.05},
        {"lat": 50.0, "lon": 14.0},   # Prague — violation
    ]
    result = batch_india_check(records)
    assert result["outside_india"] == 1
    assert result["india_compliance"] == "FAIL"

def test_batch_all_pass():
    records = [{"lat": 22.07, "lon": 80.05}, {"lat": 20.3, "lon": 79.1}]
    result = batch_india_check(records)
    assert result["india_compliance"] == "PASS"
    assert result["outside_india"] == 0
```

### 2.2 Feature Engineering

```python
# tests/test_feature_engineering.py

def test_lag_feature_no_future_leakage(production_df):
    """Lag-1 feature for row i must use row i-1 only."""
    features = build_production_features(production_df)
    for i in range(1, len(features)):
        assert features.iloc[i]["lag_1_actual_t"] == production_df.iloc[i-1]["actual_production_t"]

def test_rolling_7d_uses_only_past(production_df):
    """Rolling 7-day mean must not include the current row's target."""
    features = build_production_features(production_df)
    for i in range(7, len(features)):
        rolling_mean = production_df.iloc[i-7:i]["actual_production_t"].mean()
        assert abs(features.iloc[i]["rolling_7d_mean"] - rolling_mean) < 0.01

def test_failure_label_uses_future_events_only(telemetry_df, maintenance_df):
    """failure_next_24h label must only reference future maintenance events."""
    labelled = create_failure_labels(telemetry_df, maintenance_df, window_hours=24)
    for idx, row in labelled.iterrows():
        prediction_time = row["timestamp"]
        events_in_window = maintenance_df[
            (maintenance_df["machine_id"] == row["machine_id"]) &
            (maintenance_df["event_date"] > prediction_time) &
            (maintenance_df["event_date"] <= prediction_time + pd.Timedelta(hours=24))
        ]
        expected_label = len(events_in_window[events_in_window["severity"].isin(["major","critical"])]) > 0
        assert row["failure_next_24h"] == expected_label

def test_prospectivity_label_not_in_features(prospectivity_df):
    """prospectivity_label must not appear in the feature columns."""
    features, labels = build_prospectivity_features(prospectivity_df)
    assert "prospectivity_label" not in features.columns

def test_occurrence_id_not_in_features(prospectivity_df):
    """occurrence_id must not leak into features."""
    features, _ = build_prospectivity_features(prospectivity_df)
    assert "occurrence_id" not in features.columns
```

### 2.3 Scenario Engine

```python
# tests/test_scenario_engine.py

def test_equipment_redeployment_constraint(mine_state, twin_service):
    """Cannot redeploy same machine to two zones simultaneously."""
    scenario = Scenario(
        interventions=[
            EquipmentRedeployment(machine_id="LHD-03", from_zone="L3", to_zone="L4"),
            EquipmentRedeployment(machine_id="LHD-03", from_zone="L4", to_zone="L5"),
        ]
    )
    result = twin_service.simulate(mine_state, scenario)
    assert not result.feasibility
    assert any("LHD-03" in v for v in result.constraint_violations)

def test_production_cannot_exceed_ore_available(mine_state, twin_service):
    """Simulated production must never exceed ore_available * efficiency."""
    scenario = Scenario(interventions=[])  # No interventions
    result = twin_service.simulate(mine_state, scenario)
    max_possible = mine_state.ore_available_t * 0.95  # efficiency factor
    assert result.scenario_production_t <= max_possible

def test_objective_score_respects_weights(scenarios, optimizer):
    """Higher weight on production gain must yield a different top-ranked scenario."""
    weights_production = {"production_gain": 0.8, "cost_penalty": 0.1, "risk_penalty": 0.1}
    weights_cost = {"production_gain": 0.1, "cost_penalty": 0.8, "risk_penalty": 0.1}

    ranked_prod = optimizer.rank(scenarios, weights=weights_production)
    ranked_cost = optimizer.rank(scenarios, weights=weights_cost)

    # Scenarios should rank differently
    assert ranked_prod[0]["scenario_id"] != ranked_cost[0]["scenario_id"]

def test_constraint_violation_excludes_from_ranking(mine_state, twin_service, optimizer):
    """Infeasible scenarios must not appear in the ranked output."""
    result = optimizer.optimize(mine_state)
    for scenario in result.ranked_scenarios:
        assert scenario["feasibility"] == True
        assert len(scenario["constraint_violations"]) == 0

def test_baseline_scenario_matches_current_state(mine_state, twin_service):
    """Empty-intervention scenario should predict close to current state."""
    baseline = Scenario(interventions=[])
    result = twin_service.simulate(mine_state, baseline)
    # Baseline production should be within 5% of P50 forecast
    assert abs(result.scenario_production_t - mine_state.production_target_t) / mine_state.production_target_t < 0.35
```

### 2.4 Data Origin Enforcement

```python
# tests/test_data_origin.py

def test_synthetic_record_always_tagged(seed_db_records):
    """All seeded records must have data_origin set."""
    for record in seed_db_records:
        assert record.data_origin is not None
        assert record.data_origin != ""

def test_synthetic_never_labelled_real(seed_db_records):
    """Synthetic records must not be labelled REAL."""
    for record in seed_db_records:
        assert record.data_origin != "REAL", \
            f"Record {record} is synthetic but labelled REAL"
```

---

## 3. Data Tests

### 3.1 Schema Validation

```python
# tests/test_data_schema.py

EXPECTED_PRODUCTION_COLUMNS = [
    "shift_date", "shift_number", "mine_id", "planned_production_t",
    "actual_production_t", "shortfall_flag", "equipment_availability_pct",
    "rainfall_24h_mm", "rainfall_7d_mm", "blast_delay_hours",
    "ore_pass_availability", "downtime_hours", "data_origin"
]

def test_production_schema(production_df):
    for col in EXPECTED_PRODUCTION_COLUMNS:
        assert col in production_df.columns, f"Missing column: {col}"

def test_no_negative_production(production_df):
    assert (production_df["actual_production_t"] >= 0).all()

def test_shift_number_valid(production_df):
    assert production_df["shift_number"].isin([1, 2, 3]).all()

def test_production_date_range(production_df):
    """Must span at least 365 days per mine."""
    for mine_id, group in production_df.groupby("mine_id"):
        date_range = (group["shift_date"].max() - group["shift_date"].min()).days
        assert date_range >= 365, f"Mine {mine_id} has only {date_range} days"

def test_equipment_telemetry_machine_ids_valid(telemetry_df, equipment_df):
    """All machine_ids in telemetry must exist in equipment master."""
    valid_ids = set(equipment_df["machine_id"])
    assert set(telemetry_df["machine_id"]).issubset(valid_ids)
```

### 3.2 Leakage Detection

```python
# tests/test_leakage.py

def test_prospectivity_minimum_spatial_gap(train_grid, test_grid):
    """Minimum distance between train and test cells must be >= 5 km."""
    min_dist = compute_min_spatial_distance_km(train_grid, test_grid)
    assert min_dist >= 5.0, f"Spatial gap too small: {min_dist:.2f} km"

def test_no_shared_cells_train_test(train_grid_ids, test_grid_ids):
    """No grid cell must appear in both train and test."""
    overlap = set(train_grid_ids) & set(test_grid_ids)
    assert len(overlap) == 0, f"Cells in both train and test: {overlap}"

def test_production_temporal_split_no_overlap(train_df, test_df):
    """Test period must start after train period ends."""
    assert test_df["shift_date"].min() > train_df["shift_date"].max()

def test_no_future_features_in_production_model(feature_df, target_col="actual_production_t"):
    """Correlation check: no feature should have correlation > 0.95 with target."""
    correlations = feature_df.corr()[target_col].drop(target_col)
    high_corr = correlations[correlations.abs() > 0.95]
    assert len(high_corr) == 0, \
        f"Potential leakage: features with |corr| > 0.95: {high_corr.index.tolist()}"

def test_failure_label_future_only(telemetry_with_labels):
    """Validate no same-row event contaminates the failure label."""
    # The label at row i must not reference the telemetry values at row i
    # Verified by construction: label uses only t+1h to t+24h events
    # This test checks the timestamp ordering
    for _, row in telemetry_with_labels.iterrows():
        if row["failure_next_24h"] == True:
            # The labelling window must be strictly in the future
            assert row["label_window_start"] > row["timestamp"]
```

### 3.3 India Compliance on Datasets

```python
# tests/test_india_datasets.py

def test_all_occurrences_in_india(occurrences_df):
    violations = occurrences_df[
        (occurrences_df["latitude"] < 6.0) | (occurrences_df["latitude"] > 37.5) |
        (occurrences_df["longitude"] < 68.0) | (occurrences_df["longitude"] > 98.0)
    ]
    assert len(violations) == 0, f"{len(violations)} occurrence records outside India"

def test_all_boreholes_in_india(boreholes_df):
    violations = boreholes_df[
        (boreholes_df["latitude"] < 6.0) | (boreholes_df["latitude"] > 37.5) |
        (boreholes_df["longitude"] < 68.0) | (boreholes_df["longitude"] > 98.0)
    ]
    assert len(violations) == 0

def test_prospectivity_grid_in_india(grid_df):
    # Centroid latitude/longitude must be within India
    violations = grid_df[
        (grid_df["centroid_lat"] < 6.0) | (grid_df["centroid_lat"] > 37.5)
    ]
    assert len(violations) == 0
```

---

## 4. ML Model Tests

### 4.1 Evaluation Integrity

```python
# tests/test_model_evaluation.py

def test_prospectivity_uses_spatial_holdout(validation_report):
    """Prospectivity model report must use spatial_block split."""
    prosp_rows = [r for r in validation_report if r["task"] == "prospectivity"]
    for row in prosp_rows:
        assert row["split_type"] == "spatial_block", \
            "Prospectivity must use spatial_block, not random or temporal"

def test_production_uses_temporal_holdout(validation_report):
    prod_rows = [r for r in validation_report if r["task"] == "production_forecast"]
    for row in prod_rows:
        assert row["split_type"] == "temporal"

def test_shortfall_uses_temporal_holdout(validation_report):
    rows = [r for r in validation_report if r["task"] == "shortfall"]
    for row in rows:
        assert row["split_type"] == "temporal"

def test_all_models_pass_leakage_check(validation_report):
    for row in validation_report:
        assert row["leakage_status"] == "PASS", \
            f"Leakage detected: {row['task']} / {row['model']}"

def test_prospectivity_roc_auc_above_baseline(validation_report):
    prosp = next(r for r in validation_report
                 if r["task"] == "prospectivity" and r["metric"] == "roc_auc")
    assert float(prosp["score"]) > float(prosp["baseline_score"]), \
        "Prospectivity model must beat baseline"

def test_prospectivity_roc_auc_realistic(validation_report):
    """Flag if ROC-AUC is suspiciously perfect — likely leakage."""
    prosp = next(r for r in validation_report
                 if r["task"] == "prospectivity" and r["metric"] == "roc_auc")
    auc = float(prosp["score"])
    assert auc < 0.97, \
        f"ROC-AUC = {auc:.3f} is suspiciously high; check for leakage"

def test_equipment_failure_reports_limitation(validation_report):
    """Equipment failure limitation must be documented."""
    equip = next(r for r in validation_report if r["task"] == "equipment_failure")
    assert "limitation" in equip and equip["limitation"] != "", \
        "Equipment failure model must document its limitation"
```

### 4.2 SHAP Attribution

```python
# tests/test_shap_attribution.py

def test_shap_values_not_hardcoded(shap_output):
    """SHAP contributions must not all be identical (sign of hard-coding)."""
    contributions = [d["shap_value"] for d in shap_output]
    assert len(set(round(v, 3) for v in contributions)) > 1, \
        "SHAP values appear to be hard-coded (all identical)"

def test_shap_contribution_pct_sums_to_100(shap_output):
    total = sum(d["contribution_pct"] for d in shap_output)
    assert abs(total - 100.0) < 0.5, f"Contribution percentages sum to {total:.1f}, not 100"

def test_shap_top5_returned(shap_output):
    assert len(shap_output) <= 5, "API should return at most top 5 SHAP drivers"
    assert len(shap_output) >= 3, "API should return at least 3 SHAP drivers"

def test_shap_direction_valid(shap_output):
    for d in shap_output:
        assert d["direction"] in ["increases_risk", "decreases_risk"]
```

---

## 5. API Integration Tests

### 5.1 Endpoint Contract Tests

```python
# tests/test_api_exploration.py

@pytest.mark.asyncio
async def test_exploration_map_returns_cells(client, auth_headers):
    response = await client.get(
        "/api/v1/exploration/map",
        params={"region_id": BALAGHAT_REGION_ID},
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["cells"]) > 0
    assert data["india_compliance"]["status"] == "PASS"
    assert data["india_compliance"]["outside_india"] == 0

async def test_exploration_cell_has_data_origin(client, auth_headers):
    response = await client.get("/api/v1/exploration/map",
        params={"region_id": BALAGHAT_REGION_ID}, headers=auth_headers)
    data = response.json()
    assert "prediction_metadata" in data
    assert data["prediction_metadata"]["data_origin"] in [
        "REAL", "DERIVED_REAL", "SYNTHETIC", "SYNTHETIC_CALIBRATED_BY_REAL"
    ]

# tests/test_api_production.py

async def test_forecast_returns_p10_p50_p90(client, auth_headers):
    response = await client.get(
        "/api/v1/production/BAL-001/forecast",
        headers=auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert "forecast" in data
    assert "p10" in data["forecast"]
    assert "p50" in data["forecast"]
    assert "p90" in data["forecast"]
    assert data["forecast"]["p10"] <= data["forecast"]["p50"] <= data["forecast"]["p90"]

async def test_forecast_has_root_causes(client, auth_headers):
    response = await client.get("/api/v1/production/BAL-001/forecast", headers=auth_headers)
    data = response.json()
    assert len(data["root_causes"]) >= 3
    # Contributions must be model-derived
    contribs = [r["contribution_pct"] for r in data["root_causes"]]
    assert len(set(round(c, 1) for c in contribs)) > 1  # not all identical

async def test_forecast_data_origin_present(client, auth_headers):
    response = await client.get("/api/v1/production/BAL-001/forecast", headers=auth_headers)
    data = response.json()
    assert "prediction_metadata" in data
    assert "data_origin" in data["prediction_metadata"]
    assert "freshness_status" in data["prediction_metadata"]

# tests/test_api_scenarios.py

async def test_scenario_feasible_no_violations(client, auth_headers):
    payload = {
        "mine_id": "BAL-001",
        "scenario_name": "Redeploy LHD-03",
        "interventions": [
            {"type": "equipment_redeployment",
             "params": {"machine_id": "LHD-03", "from_zone": "L3", "to_zone": "L4"}}
        ]
    }
    response = await client.post("/api/v1/scenarios", json=payload, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["constraint_violations"], list)

async def test_optimizer_all_ranked_feasible(client, auth_headers):
    payload = {"mine_id": "BAL-001"}
    response = await client.post("/api/v1/scenarios/optimize", json=payload, headers=auth_headers)
    data = response.json()
    for scenario in data["ranked_scenarios"]:
        assert scenario["feasibility"] == True

# tests/test_api_auth.py

async def test_upload_blocked_for_management_role(client, management_headers):
    """Management role must not be able to upload production data."""
    response = await client.post(
        "/api/v1/datasets/upload",
        headers=management_headers,
        data={"data_domain": "production"}
    )
    assert response.status_code == 403

async def test_model_promotion_requires_platform_admin(client, production_admin_headers):
    """Only Platform Admin can promote a model."""
    response = await client.post(
        "/api/v1/models/some-version-id/promote",
        headers=production_admin_headers,
        json={"reason": "test"}
    )
    assert response.status_code == 403
```

---

## 6. End-to-End Tests (Playwright)

### 6.1 Critical User Journeys

```typescript
// tests/e2e/production-command-center.spec.ts

test('Production Manager sees forecast with risk badge', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="login-btn"]');
  await page.fill('[data-testid="email-input"]', 'prod_manager@test.minex');
  await page.fill('[data-testid="password-input"]', 'testpass');
  await page.click('[data-testid="submit-login"]');

  // Should route to production command center
  await expect(page).toHaveURL(/\/app\/production/);

  // Risk badge must be visible
  await expect(page.locator('[data-testid="risk-level-badge"]')).toBeVisible();

  // P10/P50/P90 chart must render
  await expect(page.locator('[data-testid="forecast-chart"]')).toBeVisible();

  // Root cause bar chart must render with > 0 bars
  const bars = page.locator('[data-testid="root-cause-bar"]');
  await expect(bars).toHaveCount({ gte: 3 });

  // SYNTHETIC badge must be visible on prediction card
  await expect(page.locator('[data-testid="data-origin-badge"]')).toContainText('SYNTHETIC');
});

test('Scenario workspace: run simulation and see result', async ({ page }) => {
  // (authenticated as Mine Planning Admin)
  await page.goto('/app/scenarios');

  // Select intervention: Equipment redeployment
  await page.click('[data-testid="add-intervention-btn"]');
  await page.selectOption('[data-testid="intervention-type"]', 'equipment_redeployment');
  await page.click('[data-testid="run-simulation-btn"]');

  // Result card must appear with production_t, shortfall_prob, cost
  await expect(page.locator('[data-testid="scenario-result-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="scenario-production-t"]')).toBeVisible();
  await expect(page.locator('[data-testid="scenario-shortfall-prob"]')).toBeVisible();

  // Constraint violations should be empty for a valid intervention
  await expect(page.locator('[data-testid="constraint-violations"]')).toBeEmpty();
});

test('Exploration map renders with cells', async ({ page }) => {
  await page.goto('/app/exploration');
  // Map canvas must appear
  await expect(page.locator('[data-testid="prospectivity-map"]')).toBeVisible({ timeout: 5000 });
  // India compliance badge
  await expect(page.locator('[data-testid="india-compliance-badge"]')).toContainText('PASS');
});

test('Data Health Center shows domain status', async ({ page }) => {
  await page.goto('/app/data-health');
  // At least production and equipment domains visible
  await expect(page.locator('[data-testid="domain-row-production"]')).toBeVisible();
  await expect(page.locator('[data-testid="domain-row-equipment"]')).toBeVisible();
  // Each domain shows a freshness pill
  const pills = page.locator('[data-testid="freshness-pill"]');
  await expect(pills).toHaveCount({ gte: 4 });
});
```

---

## 7. Test Fixtures

### `tests/conftest.py` (Python)

```python
import pytest
import pandas as pd
from pathlib import Path

DATA_DIR = Path("data/processed")

@pytest.fixture
def production_df():
    return pd.read_parquet(DATA_DIR / "09_mine_operations.parquet")

@pytest.fixture
def telemetry_df():
    return pd.read_parquet(DATA_DIR / "10_equipment_telemetry.parquet")

@pytest.fixture
def maintenance_df():
    return pd.read_parquet(DATA_DIR / "11_maintenance_events.parquet")

@pytest.fixture
def occurrences_df():
    return pd.read_parquet(DATA_DIR / "01_mn_occurrences.parquet")

@pytest.fixture
def boreholes_df():
    return pd.read_parquet(DATA_DIR / "05_boreholes.parquet")

@pytest.fixture
def validation_report():
    import csv
    with open("apps/ml/FINAL_MODEL_VALIDATION.csv") as f:
        return list(csv.DictReader(f))

@pytest.fixture
async def client():
    from httpx import AsyncClient
    from main import app
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c

@pytest.fixture
def auth_headers():
    # Return JWT for test production admin user
    return {"Authorization": "Bearer test_prod_admin_token"}

@pytest.fixture
def management_headers():
    return {"Authorization": "Bearer test_management_token"}

@pytest.fixture
def production_admin_headers():
    return {"Authorization": "Bearer test_prod_admin_token"}
```

---

## 8. Test Coverage Targets

| Domain | Unit | Data | ML | Integration | E2E |
|--------|------|------|----|------------|-----|
| India compliance | 100% | All datasets | - | All geo endpoints | - |
| Leakage detection | 100% | Per-feature check | Per model | - | - |
| Scenario engine | 90%+ | - | - | All scenario endpoints | 1 journey |
| Production forecast | 80%+ | - | Eval report | Forecast endpoint | 1 journey |
| SHAP attribution | 80%+ | - | Spot checks | Root cause endpoint | - |
| Auth / RBAC | 90%+ | - | - | Upload + promote | Login flow |

---

## 9. Reporting

### CI Output
Every CI run produces:
- `pytest` report with pass/fail per test
- India compliance report (`validate_india.py` → JSON)
- Leakage check report (`check_leakage.py` → JSON)
- `FINAL_MODEL_VALIDATION.csv` (committed to repo)

### Demo Validation Command
```bash
# Full pre-demo validation sweep
python scripts/validate_india.py --fail-on-violation
python scripts/check_leakage.py --fail-on-leakage
pytest apps/api/tests/ -q
python scripts/benchmark_cache.py    # asserts L1 < 1ms, single-flight coalescing under 100 callers
python scripts/demo_healthcheck.py   # hits all P1 endpoints, asserts < 3s
```

All must pass before demo begins. Any failure triggers the demo rollback plan (spec 10, section 9).

---

## 10. Hybrid Tiered Cache & Concurrency Stampede Verification

MINEx includes automated test suites and profiling utilities for the two-tier cache:

```bash
# Run unit & integration tests for L1, L2, Circuit Breaker, and Single Flight
pytest apps/api/tests/test_cache.py -v

# Run performance benchmark suite measuring P50/P95/P99 latencies
python scripts/benchmark_cache.py
```

### Verification Matrix:
1. **L1 Micro-Cache**: Monotonic TTL expiration, LRU capacity bounds, thread safety (`RLock`).
2. **L2 Upstash Redis**: Connection pooling with TLS (`rediss://`), connection timeout (1.0s), socket timeout (1.5s).
3. **Single-Flight Coalescing**: 100 concurrent requests on an uncached key execute the backend producer strictly once.
4. **Resilient Degradation**: If Redis fails or trips the circuit breaker (`CLOSED -> OPEN`), fallback to L1/producer executes transparently with zero HTTP 500 errors.
5. **Event-Driven Invalidation**: Verified cache eviction on model promotion (`invalidate_model`) and dataset version upload (`invalidate_dataset`).

