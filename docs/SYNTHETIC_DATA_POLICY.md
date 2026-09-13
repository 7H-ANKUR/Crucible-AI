# Crucible AI Synthetic Data Policy & Transparency Standard

## 1. Purpose & Guiding Principles

Crucible AI is developed as a high-fidelity operational prototype calibrated on real geological and mining dynamics of the Sausar Manganese Belt (Central India). To enable rigorous simulation without proprietary enterprise data leakage, the baseline dataset uses calibrated synthetic data.

This policy defines the standards for transparency, data origin labeling, and the procedure for replacing synthetic benchmarks with live industrial telemetry.

---

## 2. Mandatory Labeling Standard

Every API response, database record, and UI panel in Crucible AI adheres to the following labeling requirements:
1. **API Contracts**: All JSON payloads transmitting synthetic or benchmark data include `"data_origin": "SYNTHETIC"`.
2. **Dashboard Badges**: UI dashboards display prominent indicator chips (e.g. `Includes simulated readings` or `SYNTHETIC BENCHMARK`).
3. **Ledger Integrity**: The immutable prediction ledger (`ml.predictions`) records `data_origin = 'SYNTHETIC'` for every inference run during demo/benchmark operations.
4. **Reserve Claims Disclaimer**: All exploration prospectivity scores carry explicit disclaimers: *"Model score — not an official UNFC/JORC reserve claim."*

---

## 3. Realism Constraints & Geographic Fidelity

All synthetic data generation adheres to real physical mining constraints:
- **India Geobounds Gate**: All coordinates are checked against `assertIndiaOnly(lat, lon)` (Lat 6.0°N to 37.5°N, Lon 68.0°E to 98.0°E).
- **Physical Feasibility**: Truck cycle times, fuel consumption rates, ore grades (15% - 48% Mn), and crusher throughput limits mirror real manganese open-pit and underground operations.
- **DGMS Safety Rules**: Operational constraints block blasting simulations during night shifts (Shift 3) in compliance with Directorate General of Mines Safety regulations.

---

## 4. Path to Production (Replacing Synthetic with Real IoT)

When deploying Crucible AI to an active mining concession:
1. **Data Hub Upload**: Ingest site-specific CSV/XLSX logs via `/data-hub`.
2. **IoT Kafka/MQTT Connector**: Configure sensor stream ingestion into `ops.equipment_telemetry` and `ops.production_records`.
3. **Environment Gate**: Set `ENVIRONMENT=production` in backend configuration.
4. When verified real-world telemetry feeds are established, the top-level benchmark banner automatically transitions to `LIVE CONCESSION OPERATIONAL`.
