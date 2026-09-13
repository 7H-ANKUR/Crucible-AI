# 03 — Information Architecture
# MINEx — SIH26009 | v1.0

---

## 1. Site Map

```
PUBLIC ZONE (unauthenticated)
├── / (Landing page)
│   ├── Hero + CTA
│   ├── Evidence strip
│   ├── Workflow band
│   ├── Department workspace previews
│   ├── Data Trust section
│   └── Footer
├── /auth/login
└── /auth/callback

AUTHENTICATED ZONE (role-scoped)
├── /app (global shell)
│   ├── Command bar [Mine selector | As-of time | Freshness | Search/Copilot | Alerts | Profile]
│   └── Sidebar [Overview | My queue | Alerts | Data Health | Prediction Ledger | Decision Memory | Data Trust | Help]
│
├── EXPLORATION ADMIN WORKSPACE
│   ├── /app/exploration               ← Prospectivity map
│   ├── /app/exploration/:target_id    ← Target detail + evidence
│   ├── /app/exploration/drillholes    ← Borehole/assay workspace
│   └── /app/exploration/queue         ← Target maturity queue
│
├── PRODUCTION ADMIN WORKSPACE
│   ├── /app/production                ← Command Center (forecast + shortfall)
│   ├── /app/production/risk           ← Root cause detail
│   ├── /app/production/upload         ← Production data update
│   └── /app/production/outcomes       ← Outcome review / feedback
│
├── EQUIPMENT ADMIN WORKSPACE
│   ├── /app/equipment                 ← Fleet health overview
│   ├── /app/equipment/:machine_id     ← Machine detail
│   ├── /app/equipment/upload          ← Telemetry / maintenance upload
│   └── /app/equipment/queue           ← Maintenance event queue
│
├── MINE PLANNING ADMIN WORKSPACE
│   ├── /app/scenarios                 ← MineState + scenario builder
│   ├── /app/scenarios/compare         ← Baseline vs scenario comparison
│   └── /app/scenarios/optimizer       ← Ranked recommendation output
│
├── MANAGEMENT WORKSPACE
│   ├── /app/portfolio                 ← Mine portfolio overview
│   ├── /app/portfolio/decisions        ← Executive decision cards
│   ├── /app/portfolio/changes          ← Change explanation report
│   └── /app/portfolio/roi             ← ROI / assumptions view
│
├── PLATFORM ADMIN WORKSPACE
│   ├── /app/admin/governance           ← Governance control room
│   ├── /app/admin/datasets             ← Dataset onboarding queue
│   ├── /app/admin/models               ← Model health + champion/challenger
│   ├── /app/admin/releases             ← Release safety + rollback
│   └── /app/admin/users                ← User & policy management
│
└── SHARED SCREENS (all roles, scoped by permission)
    ├── /app/data-health               ← Data Health Center
    ├── /app/models                    ← Model Health dashboard
    ├── /app/ledger                    ← Prediction Ledger
    ├── /app/memory                    ← Decision Memory
    ├── /app/alerts                    ← Alert & notification centre
    └── /app/copilot                   ← AI Mine Copilot panel
```

---

## 2. Navigation Hierarchy

### Global Command Bar (always visible, authenticated)
```
[MINEx logo] [Mine/Region v] [As-of: 2026-08-28 09:00 IST] [Freshness: FRESH] 
[🔍 Search / Copilot] [🔔 Alerts (3)] [👤 Profile]
```

- **Mine/Region selector** — changes the shared MineState context for all screens
- **As-of time** — exposes the timestamp behind the active prediction / scenario
- **Freshness indicator** — colour pill linking to Data Health Center
- **Alerts** — role-routed inbox with severity badges

### Sidebar (role-scoped, persistent on desktop, collapsible on laptop)
```
Overview
My work queue
Alerts
─────────────
Data Health
Prediction Ledger
Decision Memory
Data Trust & Lineage
─────────────
Help
```

Department-specific links injected above the separator based on role.

---

## 3. Page Templates

### Template A — Map + Panel (Exploration screens)
```
┌─────────────────────────────┬───────────────────────┐
│  FULL-BLEED MAP              │  EVIDENCE / DETAIL     │
│  [Layer toggles]             │  PANEL                 │
│  [Zoom / Legend]             │  (slides in on click)  │
└─────────────────────────────┴───────────────────────┘
```

### Template B — Cards + Chart (Production Command Center)
```
┌──────┬──────┬──────┬──────┐
│Target│Fcst  │Shortf│ Risk │  ← KPI cards row
└──────┴──────┴──────┴──────┘
┌──────────────────────────────────────────┐
│  P10/P50/P90 time series chart           │
└──────────────────────────────────────────┘
┌──────────────────┬───────────────────────┐
│  Root cause list  │  Top driver chart     │
└──────────────────┴───────────────────────┘
```

### Template C — Comparison Table (Scenario workspace)
```
┌──────────────┬──────────┬──────────┬──────────┐
│ Metric        │ Baseline │ Scenario │ Scenario │
│               │          │    A     │    B     │
├──────────────┼──────────┼──────────┼──────────┤
│ Production t  │  8,200   │  8,720   │  8,580   │
│ Shortfall %   │  74%     │  21%     │  38%     │
│ Cost INR      │  0       │  185,000 │  95,000  │
└──────────────┴──────────┴──────────┴──────────┘
```

### Template D — Data Table (Prediction Ledger, Decision Memory)
```
Filters: [Mine v] [Model v] [Date range] [Status v]
┌────────────┬──────┬──────┬──────────┬──────┬──────┐
│ Time        │Entity│ Pred │Confidence│Actual│Status│
└────────────┴──────┴──────┴──────────┴──────┴──────┘
← pagination / infinite scroll →
```

### Template E — Upload / Review Flow (Governance screens)
```
Step 1: Upload file  →  Step 2: Review mapping  →  Step 3: Validate  →  Step 4: Approve/Reject
```

---

## 4. State Flows

### Prediction Flow
```
User selects Mine + Date
       ↓
MineState assembled (equipment, ore, weather, maintenance, blast, stockpile, schedule)
       ↓
Feature pipeline runs (lag features, rolling features, constraint features)
       ↓
Production Forecast model (P10/P50/P90)
       ↓
Shortfall model (probability)
       ↓
SHAP attribution (root cause ranking)
       ↓
Prediction Ledger entry created
       ↓
Dashboard cards updated
```

### Scenario Flow
```
User opens Scenario workspace (baseline = current MineState)
       ↓
User adds intervention(s)
       ↓
"Run simulation" → scenario evaluated by Digital Twin
       ↓
Scenario result returned (production, shortfall_prob, cost, violations)
       ↓
User saves / compares / sends for acknowledgement
       ↓
Decision Memory entry created (if intervention adopted)
```

### Dataset Onboarding Flow
```
Upload → Quarantine → Auto-classify domain → Propose column mapping
       ↓
User confirms / corrects mapping
       ↓
Validation rules applied (schema, India scope, units, dates, duplicates, leakage)
       ↓
PASS → Immutable version created → Feature refresh eligible
FAIL → Rejection with findings → File retained for audit
```

### Model Release Flow
```
Approved dataset version → Feature build → Challenger training
       ↓
Holdout evaluation (temporal/spatial) + Calibration + FN-rate + Stability
       ↓
Compare with Champion (all gates must pass)
       ↓
Platform Admin approval → Promotion event recorded
       ↓
Champion replaced → Old version retained for rollback
```

---

## 5. Role × Screen Access Matrix

| Screen | Platform Admin | Exploration Admin | Equipment Admin | Production Admin | Mine Planning Admin | Management |
|--------|:-:|:-:|:-:|:-:|:-:|:-:|
| Landing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Exploration map | R | R+W | R | R | R | R |
| Target detail | R | R+W | R | R | R | R |
| Production command | R | R | R | R+W | R | R |
| Scenario builder | R | - | - | R | R+W | R |
| Equipment fleet | R | - | R+W | R | R | R |
| Data Health | R | R | R | R | R | R |
| Dataset upload | Approve | Explore domain | Equipment domain | Production domain | Planning domain | - |
| Model Health | R+Approve | R | R | R | R | R |
| Prediction Ledger | R | R | R | R | R | R |
| Decision Memory | R | R | R | R+W | R+W | R |
| User management | R+W | - | - | - | - | - |
| Portfolio / ROI | R | - | - | - | - | R |

R = Read, W = Write/Upload, Approve = Can approve actions, - = No access

---

## 6. Content Taxonomy

### Prediction Cards (always show)
- Entity (mine / target / machine)
- Timestamp + as-of time
- Prediction value + units
- Confidence tier (HIGH / MEDIUM / LOW)
- Freshness status
- Data origin badge (REAL / DERIVED / SYNTHETIC)
- Top 1 driver (with "Explain" link)

### Evidence Panels (on demand)
- Full SHAP attribution chart
- Feature values at prediction time
- Data lineage (dataset_version, model_version)
- Limitation text

### Action Cards (optimizer output)
- Action description
- Expected gain (t)
- Shortfall probability change
- Cost (INR) — tagged SYNTHETIC ASSUMPTION if applicable
- Risk change
- Urgency
- Confidence
- Feasibility status
- "Send for acknowledgement" CTA
