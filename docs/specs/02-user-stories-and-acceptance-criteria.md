# 02 — User Stories and Acceptance Criteria
# MINEx — SIH26009 | v1.0

---

## Epic 1 — Exploration Intelligence

### US-E01: Prospectivity Map
**As an** exploration geologist,  
**I want to** view a colour-coded prospectivity map of the Central Indian manganese belt,  
**So that** I can quickly identify which areas are worth further investigation.

**Acceptance Criteria:**
- [ ] Map renders within 3 seconds for the default study region (Balaghat–Chhindwara–Bhandara)
- [ ] Colour scale represents prospectivity probability 0–1 (configurable ramp)
- [ ] Each visible cell shows probability, confidence tier (HIGH/MEDIUM/LOW), and data quality on hover
- [ ] Layer toggles: geology, structures, known occurrences, satellite evidence, uncertainty, boreholes
- [ ] India compliance badge visible ("India-only data gate: PASS")
- [ ] Data origin badge: REAL / DERIVED / SYNTHETIC displayed on map legend

### US-E02: Target Inspection
**As an** exploration geologist,  
**I want to** click any high-prospectivity zone and see the full evidence panel,  
**So that** I can understand *why* that cell is ranked highly.

**Acceptance Criteria:**
- [ ] Click on any cell opens side panel within 1 second
- [ ] Panel shows: probability, confidence, uncertainty range, data quality score, drilling density
- [ ] Evidence summary lists top 4 contributing feature groups (EO, terrain, geology, structural)
- [ ] SHAP/attribution values shown for top features
- [ ] Maturity status displayed: Detected / Screened / Geologically supported / Drill recommended / Drilled / Validated / Resource candidate
- [ ] "Advance maturity" action available to Exploration Admin only

### US-E03: Target Maturity Tracking
**As an** exploration geologist,  
**I want to** track a target through its lifecycle from detection to resource candidacy,  
**So that** I can manage the exploration pipeline.

**Acceptance Criteria:**
- [ ] Maturity transitions are role-gated (Exploration Admin can advance, not Management)
- [ ] Each transition requires a reason + evidence attachment or confirmation
- [ ] Prospectivity-only targets cannot be labelled "Resource candidate" without subsurface evidence
- [ ] History of all transitions is visible in the target detail panel

### US-E04: Borehole / Assay Overlay
**As an** exploration geologist,  
**I want to** overlay synthetic borehole locations and assay grade data,  
**So that** I can assess subsurface evidence behind a prospective zone.

**Acceptance Criteria:**
- [ ] Borehole markers show on map when "Subsurface" layer is toggled on
- [ ] Clicking a borehole shows: depth profile, lithology column, Mn%, Fe%, SiO2%
- [ ] Synthetic boreholes carry a prominent "SYNTHETIC BENCHMARK" badge
- [ ] Real drill data (when available) shown with "REAL" provenance badge

---

## Epic 2 — Production Intelligence

### US-P01: Shift Forecast
**As a** production manager,  
**I want to** see the production forecast for the next shift/day before operations begin,  
**So that** I can take action before a shortfall occurs.

**Acceptance Criteria:**
- [ ] Command Center shows P10/P50/P90 forecast vs planned target prominently
- [ ] Shortfall probability displayed as both percentage and risk level (HIGH/MEDIUM/LOW)
- [ ] Freshness indicator shows timestamp of last data update
- [ ] Data origin badges visible (SYNTHETIC PROTOTYPE for MVP demo)
- [ ] "Find feasible response" CTA opens the Scenario workspace (not "Fix automatically")

### US-P02: Root Cause Ranking
**As an** operations manager,  
**I want to** know what is driving the predicted shortfall,  
**So that** I can direct my team to the right problem.

**Acceptance Criteria:**
- [ ] SHAP-derived root cause bar chart shows top 5 drivers
- [ ] Each driver shows: name, percentage contribution, direction (increases/decreases risk)
- [ ] "Inspect evidence" link opens the data behind that driver
- [ ] Values are model-derived, not hard-coded
- [ ] Confidence level shown next to each attribution

### US-P03: Production History & Trend
**As a** production manager,  
**I want to** see historical production vs target over the last 30 days,  
**So that** I can understand whether the current risk is an anomaly.

**Acceptance Criteria:**
- [ ] Time-series chart loads in under 2 seconds
- [ ] Toggle between: actual, planned, forecast, P10, P90
- [ ] Monsoon period highlighted (June–September)
- [ ] Shortfall events marked on timeline

### US-P04: Equipment Failure Risk
**As a** maintenance engineer,  
**I want to** see equipment failure risk scores for all machines,  
**So that** I can prioritise preventive maintenance.

**Acceptance Criteria:**
- [ ] Fleet health table shows: machine_id, mine, type, failure_risk (probability), last maintenance, sensor freshness
- [ ] Clicking a machine opens: trend chart of risk score over time, top failure drivers, maintenance history
- [ ] Risk card shows "failure risk in next 24h window", NOT "will fail"
- [ ] No button sends maintenance commands to equipment
- [ ] SYNTHETIC PROTOTYPE badge on all telemetry-derived values

---

## Epic 3 — Scenario & Optimisation

### US-S01: Scenario Builder
**As a** mine planning engineer,  
**I want to** define a set of interventions and see the simulated production outcome,  
**So that** I can compare options before committing.

**Acceptance Criteria:**
- [ ] Baseline scenario auto-loaded from current MineState
- [ ] User can add interventions: equipment redeployment, maintenance reschedule, blast reschedule, ore routing, schedule adjustment
- [ ] "Run simulation" executes and returns result within 5 seconds
- [ ] Result shows: scenario_production_t, shortfall_probability, cost_inr, risk_change, constraint_violations
- [ ] Constraint violations listed explicitly if any exist
- [ ] INR/ROI values tagged "SYNTHETIC ASSUMPTION" unless backed by approved real cost data

### US-S02: Scenario Comparison
**As a** mine planning engineer,  
**I want to** compare up to 4 scenarios side-by-side,  
**So that** I can select the best intervention.

**Acceptance Criteria:**
- [ ] Comparison table shows: scenario name, production_t, shortfall_prob, cost_inr, risk, feasibility
- [ ] Recommended scenario highlighted (highest multi-objective score)
- [ ] "Send for acknowledgement" routes to Production Manager / Management
- [ ] Saved scenarios retained for 7 days in the session

### US-S03: Optimizer Recommendation
**As a** mine planner,  
**I want to** receive an automatically ranked list of feasible interventions,  
**So that** I don't have to manually enumerate all options.

**Acceptance Criteria:**
- [ ] Optimizer returns top 3 ranked scenarios with scores
- [ ] Each recommendation shows: action description, expected_gain_t, risk_change, cost_inr, urgency, confidence
- [ ] Feasibility filter excludes scenarios with constraint violations
- [ ] "View rationale" opens the objective function weights and constraint set

---

## Epic 4 — Data Governance

### US-G01: Dataset Upload
**As a** Production Admin,  
**I want to** upload a new production CSV and have the system validate and version it,  
**So that** the platform uses the latest data without corrupting history.

**Acceptance Criteria:**
- [ ] Upload accepts CSV, XLSX, Parquet
- [ ] System classifies probable domain and proposes column mapping with confidence scores
- [ ] User must confirm mapping before approval
- [ ] Validation checks: schema, India/mine scope, units, time coverage, missingness, duplicates, leakage
- [ ] Approved file creates an immutable version with checksum
- [ ] Rejected file shows reason; history retained

### US-G02: Model Promotion
**As a** Platform Admin,  
**I want to** review a challenger model and approve or reject its promotion,  
**So that** only validated models serve predictions.

**Acceptance Criteria:**
- [ ] Challenger comparison table shows: metric, champion score, challenger score, delta
- [ ] Promotion blocked if: calibration worsens, FN-rate increases, stability < MEDIUM
- [ ] "Approve promotion" requires reason field and creates audit event
- [ ] "Keep champion" retains current model without creating a new version
- [ ] Rollback available to any previously approved version

### US-G03: Data Health Center
**As any** authenticated user,  
**I want to** see the health of each data domain at a glance,  
**So that** I can assess whether predictions are reliable.

**Acceptance Criteria:**
- [ ] Each domain shows: FRESH / AGING / STALE / CRITICAL status with timestamp
- [ ] Explanation shown (e.g., "AGING — production data is 8 days overdue")
- [ ] Stale source surfaces warning banner on dependent prediction cards
- [ ] CRITICAL source mutes high-confidence recommendation on dependent cards

---

## Epic 5 — AI Mine Copilot

### US-C01: Natural Language Query
**As any** authenticated user,  
**I want to** ask "Why is Balaghat mine at risk tomorrow?" in plain English,  
**So that** I can get an answer without navigating multiple screens.

**Acceptance Criteria:**
- [ ] Copilot retrieves and cites platform outputs (not fabricated values)
- [ ] Every numeric answer shows source badge: model version, MineState timestamp, data origin
- [ ] Counterfactual questions ("What if Loader 4 also fails?") trigger "Run scenario" confirmation before evaluation
- [ ] Copilot never claims it can control equipment or approve data uploads

---

## Epic 6 — Landing & Auth

### US-L01: Landing Page
**As a** first-time visitor,  
**I want to** understand what MINEx does within 10 seconds,  
**So that** I know whether to sign in.

**Acceptance Criteria:**
- [ ] Hero section shows MINEx wordmark, tagline, and two CTAs (Sign in, Explore platform)
- [ ] Evidence strip shows 4 capability cards (Exploration, Operations, Data Trust, Decisions)
- [ ] Workflow band shows: Explore → Validate → Forecast → Explain → Simulate → Optimise → Review outcome
- [ ] Trust chips visible: "India-first", "Provenance visible", "Human approval required"
- [ ] Page loads under 2 seconds (no auth required)

### US-L02: Sign-In & Role Routing
**As an** authenticated user,  
**I want to** land directly on my department dashboard after sign-in,  
**So that** I see relevant information immediately.

**Acceptance Criteria:**
- [ ] SSO / email authentication supported
- [ ] Role lookup routes to assigned department workspace
- [ ] Users with multiple roles see a "Switch workspace" control
- [ ] No "choose your own role" selector visible on the login screen
