# MINEx UI Design Specification

**Product name:** MINEx  
**Positioning:** One Mine. One Intelligence Layer. Governed Continuous Learning.  
**Document purpose:** Interaction, visual and information-architecture specification for the MINEx landing experience and role-based mining-intelligence platform.  
**Product boundary:** MINEx is the customer-facing interface for the MANGANESIS platform architecture. It is decision support, not autonomous mine control.

---

## 1. Design direction

MINEx takes inspiration from the supplied Earth industrial-mining reference and [its Dribbble source](https://dribbble.com/shots/27165894-Earth-Smart-Industrial-Mining-Website-UI-Design): a full-bleed industrial image, editorial display typography, compact pill navigation, large numeric evidence and restrained floating overlays. It must be an original design—not a copy of that work’s branding, composition, imagery or text.

The visual system combines that premium industrial tone with a **liquid-glass** interface:

- dark geological blue/charcoal imagery for environmental context;
- translucent, softly blurred panels for navigation, alerts and controls;
- crisp white data surfaces where dense comparison matters;
- manganese amber only for action, active state and high-priority attention;
- data-led cards rather than decorative glass everywhere.

The desired feeling is **calm, precise and operational**. It must look credible in a mine control-room context, never like a game or an opaque “AI magic” dashboard.

### Design principles

1. **Decision first.** Lead with what needs attention, why, confidence and the next feasible action.
2. **Evidence remains available.** Every score opens its provenance, data freshness, uncertainty and model version.
3. **Glass frames; data stays readable.** Glass is used for controls and summary overlays, not high-density tables.
4. **Risk is not certainty.** Use probability, confidence, data origin and freshness beside every critical prediction.
5. **Role-aware by default.** The system opens each user’s assigned department workspace; permission is never a visual afterthought.
6. **No unsupported automation.** “Approve,” “Promote,” “Run scenario,” and “Acknowledge” are visibly different actions.

---

# 2. Brand and visual system

## 2.1 Brand

**Wordmark:** `MINEx` — use an uppercase `MINE` with a small amber `x` or subscript-like accent only if legibility remains excellent. Do not use a generic pickaxe or hard-hat logo.

**Suggested lock-up:**

```text
MINEx
Mining Intelligence Operating Platform
```

**Tagline for landing hero:**

> One Mine. One Intelligence Layer.

**Supporting copy:**

> Turn geological, operational and environmental evidence into governed decisions for Indian manganese mining.

## 2.2 Color tokens

| Token | Value | Use |
|---|---:|---|
| `ink-950` | `#07141B` | hero overlay, deep navigation, primary text on light surfaces |
| `slate-800` | `#16313D` | dark glass tint, navigation outline |
| `slate-600` | `#41606B` | secondary text, inactive indicators |
| `mist-050` | `#F4F7F6` | app background, light cards |
| `glass-white` | `rgba(244,247,246,.72)` | light liquid-glass surface |
| `glass-dark` | `rgba(7,20,27,.48)` | hero and command-bar glass surface |
| `manganese-500` | `#F59A23` | primary action, selected state, high-priority focus |
| `manganese-300` | `#FFC56F` | hover/highlight on dark surfaces |
| `signal-red` | `#D9574F` | critical condition only |
| `signal-amber` | `#D99523` | warning/aging condition |
| `signal-green` | `#2E9B76` | healthy, approved or within tolerance |
| `signal-blue` | `#4D8EA8` | information, derived/real data state |

Use red, amber and green with text/icon labels; never rely on colour alone.

## 2.3 Typography and spacing

- **Display/hero:** `DM Mono` or `Space Mono`, 52–72 px desktop, 700 weight, tight tracking. This preserves the reference’s engineered/editorial tone.
- **Product UI/headings:** `Manrope` or `Inter`, 18–32 px, 600–700 weight.
- **Body/data:** `Inter`, 14–16 px; tabular numerals enabled for metrics.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64 px.
- **Radius:** 18 px controls, 24 px glass cards, 32 px hero/large panels, 999 px pills.
- **Border:** 1 px `rgba(255,255,255,.26)` on dark glass; `rgba(7,20,27,.10)` on light cards.

## 2.4 Liquid-glass rules

```css
/* Conceptual token, not production code */
background: linear-gradient(135deg, rgba(255,255,255,.20), rgba(255,255,255,.06));
backdrop-filter: blur(18px) saturate(135%);
border: 1px solid rgba(255,255,255,.26);
box-shadow: 0 16px 48px rgba(2,12,17,.22), inset 0 1px 0 rgba(255,255,255,.22);
```

- Keep background blur at 14–20 px; excessive blur reduces data clarity.
- Use a soft inner highlight only on interactive glass surfaces.
- Maintain at least 4.5:1 contrast for text. If a background image makes that impossible, increase the solid scrim rather than brightening text alone.
- Respect `prefers-reduced-transparency`: replace glass with opaque dark/light surfaces.

---

# 3. Product navigation and access model

## 3.1 Public landing navigation

```text
[ MINEx ]  Platform  Intelligence  Trust & Governance  About   [ Sign in ]  [ Menu ]
```

The sole primary landing CTA is **Sign in to MINEx**. It opens identity/authentication; it does not imply a sales quote. Secondary CTAs may be **Explore the platform** and **View decision workflow**.

## 3.2 Sign-in and workspace routing

```text
Landing -> Sign in to MINEx -> SSO / email authentication -> role lookup
        -> assigned department dashboard -> role-scoped navigation
```

The login screen shows the MINEx wordmark, secure sign-in, help contact and a short trust statement. It must not offer a “choose your department” privilege selector. A user with multiple approved assignments may use a **Switch workspace** control; this changes view context only after permission verification.

### Global authenticated command bar

```text
[MINEx] [Mine / Region v] [As-of time] [Data freshness] [Search / Copilot] [Alerts] [Profile]
```

- **Mine / Region:** changes the common MineState context.
- **As-of time:** exposes the timestamp behind a prediction or scenario.
- **Data freshness:** opens the Data Health Center with `FRESH`, `AGING`, `STALE` or `CRITICAL` status.
- **Search / Copilot:** natural-language entry point; responses cite platform outputs.
- **Alerts:** role-routed alert inbox with acknowledgement, not silent dismissal.
- **Profile:** role, workspace switcher, notification preferences and sign out.

## 3.3 Common sidebar

Each role sees only permitted items. Shared shell items are:

```text
Overview
My work queue
Alerts
Data Health
Prediction Ledger
Decision Memory
Data Trust & Lineage
Help
```

The product uses compact outline icons plus visible labels; never icon-only navigation for primary destinations.

---

# 4. Landing page specification

## 4.1 Page anatomy

```text
1. Full-bleed industrial-mining hero with glass top navigation
2. Hero value proposition + two CTAs + small “governed, not autonomous” trust marker
3. Evidence strip: exploration / production / data health / decision traceability
4. “One intelligence layer” workflow band
5. Department workspace preview cards
6. Data Trust and governed-learning section
7. Exploration-to-operations story
8. Footer
```

## 4.2 Hero

**Background:** original licensed/owned photograph or generated visual of an Indian underground/industrial mining environment. Use an 65–75% navy/charcoal scrim and a very subtle geological contour/lineament texture. Do not reuse the Dribbble image.

**Hero copy:**

```text
MINEx
One Mine. One Intelligence Layer.

Evidence-backed exploration, production and planning decisions for Indian manganese operations.

[ Sign in to MINEx ]  [ Explore the platform ]
```

**Floating insight card:**

```text
GOVERNED DECISION LOOP
Data -> Validate -> Predict -> Explain -> Simulate -> Human approval
```

**Trust chips:** `India-first` · `Provenance visible` · `Human approval required`

## 4.3 Evidence strip

Avoid invented commercial claims such as “2M tonnes processed.” Use product-capability facts:

| Card | Display copy |
|---|---|
| Exploration | `Target maturity` / `Detected -> Resource candidate` |
| Operations | `Risk before shift` / `Forecast + root cause + confidence` |
| Data Trust | `Evidence status` / `Origin, version, freshness, lineage` |
| Decisions | `Learning loop` / `Predicted vs actual intervention effect` |

## 4.4 Workflow band

Use a horizontal progress line, with each stage clickable to a concise explanation:

```text
Explore -> Validate -> Forecast -> Explain -> Simulate -> Optimise -> Review outcome
```

The last stage must say **Review outcome**, not “autonomous action.”

---

# 5. Department dashboards and actions

## 5.1 Platform Admin — Governance Control Room

**Primary purpose:** ensure sources, data, model releases and permissions are governed.

| Area | Key content | Primary actions |
|---|---|---|
| Governance overview | source approvals, pending dataset reviews, model-release health, audit activity | `Review queue`, `Open audit log` |
| Data onboarding queue | file type, proposed domain, mapping confidence, validation findings, provenance | `Review mapping`, `Approve version`, `Reject with reason` |
| Model Health | champion/challenger comparison, holdout metric, calibration, drift, release state | `View evaluation`, `Approve promotion`, `Keep champion`, `Freeze model` |
| Release safety | active freeze, rollback-ready versions, incidents | `Start rollback`, `View incident` |
| Users and policy | access assignments, source policy, notification rules | `Manage access`, `Configure policy` |

**Destructive/meaningful actions:** Promotion, freeze, rollback, source approval and rejection need a confirmation sheet showing impact, reason field and audit event. “Approve promotion” never directly changes a mine plan.

## 5.2 Exploration Admin — Exploration Intelligence

**Primary purpose:** progress an exploration target with evidence and uncertainty.

| Area | Key content | Primary actions |
|---|---|---|
| Prospectivity map | geology, structures, EO evidence, targets, uncertainty layers | `Inspect target`, `Compare layers`, `Create target` |
| Target detail | maturity, probability, geological evidence, subsurface confidence, data origin | `Advance review`, `Request drilling review`, `Attach evidence` |
| Drill/assay workspace | borehole intervals, lithology, assay depth profile, validation warnings | `Upload drill data`, `Review mapping`, `Validate batch` |
| Exploration queue | target maturity transitions and unresolved evidence gaps | `Mark screened`, `Recommend drill`, `Submit validation` |

**Mandatory display:** a target is labelled `Detected`, `Screened`, `Geologically supported`, `Drill recommended`, `Drilled`, `Validated` or `Resource candidate`. A high prospectivity score is never labelled “reserve.”

## 5.3 Equipment Admin — Equipment Health

**Primary purpose:** investigate machine health and keep maintenance/telemetry evidence current.

| Area | Key content | Primary actions |
|---|---|---|
| Fleet health | machine availability, failure risk, sensor freshness, open alerts | `Inspect machine`, `Acknowledge alert` |
| Machine detail | trend chart, failure probability, uncertainty, top drivers, maintenance history | `View evidence`, `Add maintenance record`, `Attach failure outcome` |
| Telemetry onboarding | file health, schema mapping, device/machine ID errors | `Upload telemetry`, `Review mapping`, `Submit for approval` |
| Maintenance queue | overdue records, event history, feedback pending review | `Record maintenance`, `Confirm outcome` |

Risk cards use “failure risk in the next prediction window,” not a claim of guaranteed failure. No button sends maintenance commands to equipment.

## 5.4 Production Admin — Production Command Center

**Primary purpose:** identify a forecast shortfall before the next shift/day and close outcomes after operations.

| Area | Key content | Primary actions |
|---|---|---|
| Command overview | target, P10/P50/P90 forecast, shortfall probability, freshness, top driver | `Explain risk`, `Open scenario`, `View ledger` |
| Risk detail | root-cause ranking, time series, confidence, data origin and lineage | `Inspect evidence`, `Acknowledge risk` |
| Production updates | daily/weekly/monthly production, targets, ore availability, stockpile | `Upload report`, `Review mapping`, `Confirm data` |
| Outcome review | prior predictions versus actuals; reviewed cause feedback | `Record actual`, `Suggest cause`, `Submit for review` |

The prominent CTA is **Find feasible response**, not “Fix automatically.” It opens the constrained scenario workspace.

## 5.5 Mine Planning Admin — Scenario and Optimisation Workspace

**Primary purpose:** test feasible plans, not manipulate forecasts directly.

| Area | Key content | Primary actions |
|---|---|---|
| MineState | equipment, ore, stockpile, weather, blast, schedule, constraints at selected time | `Set scenario baseline`, `Inspect constraints` |
| Scenario builder | equipment deployment, maintenance timing, blast schedule, routing and schedule changes | `Add intervention`, `Reset scenario`, `Run simulation` |
| Comparison | baseline vs scenarios: production, risk, cost, disruption, violations | `Compare`, `Save scenario`, `Recommend for review` |
| Optimiser result | ranked feasible action, confidence, feasibility, expected impact, INR assumptions, urgency | `View rationale`, `Send for acknowledgement` |

Actions display `confidence`, `feasibility`, `expected impact`, `cost`, `risk reduction` and `urgency`. INR/ROI is tagged `Synthetic assumption` unless backed by approved real cost data.

## 5.6 Management — Strategic Overview

**Primary purpose:** compare strategic state and approve/acknowledge decisions without altering raw operational evidence.

| Area | Key content | Primary actions |
|---|---|---|
| Portfolio overview | mines at risk, high-priority targets, alert severity, data-health posture | `Compare mines`, `View decision history` |
| Executive decision cards | recommendation, expected impact, confidence, feasibility, data origin | `Open evidence`, `Acknowledge recommendation` |
| Change report | approved data/model changes, metric movement, new dominant driver, limitations | `View what changed`, `Open model health` |
| ROI view | expected net benefit with assumptions and confidence | `View assumptions`, `Export review` |

Management has no `Upload raw data`, `Approve dataset`, `Promote model` or direct edit control.

---

# 6. Shared operational screens

## 6.1 Data Health Center

**Header:** “Data Health — as of [timestamp]” with aggregate status and a `View lineage` control.

| Domain | Health content | Drill-in actions |
|---|---|---|
| Production | expected update, last successful update, completeness, anomalies | `Open update`, `View validation` |
| Equipment | telemetry freshness, machine-ID mapping, drift | `Inspect telemetry` |
| Maintenance | event timestamp gaps, duplicates, overdue feed | `Open maintenance queue` |
| Exploration | evidence coverage, source completeness, spatial accuracy | `Inspect evidence gaps` |
| Environment | feed freshness, coverage, source state | `View source status` |
| Planning | schedule/constraint update currency | `Inspect schedule` |

Show an explanation beneath the score, e.g. “AGING — production data is eight days overdue.” Never show a percentage without its drivers.

## 6.2 Model Health

**Primary UI pattern:** champion/challenger comparison table.

```text
Metric                 Champion v4.2     Challenger v4.3
Temporal MAE           measured value    measured value
Shortfall recall       measured value    measured value
Calibration            measured value    measured value
Stability              HIGH              MEDIUM
Decision               KEEP CHAMPION
```

Use actual measured values only. Controls: `View evaluation`, `View data version`, `Freeze model`, `Approve promotion` (Platform Admin only), `Rollback` (Platform Admin only).

## 6.3 Prediction Ledger

Columns: prediction time, entity, model/data version, prediction, confidence, freshness, top driver, recommended action, actual outcome, error and review status.

Filters: mine, model, date, confidence, outcome pending/reviewed, data origin. Selecting a row opens full lineage and the associated Decision Memory record if an intervention was used.

## 6.4 Decision Memory

Show a simple comparison, not a decorative dashboard:

```text
Action                Baseline     Predicted effect    Actual effect    Review status
Move Loader A         8,200 t      +650 t              +520 t           Partially successful
```

Actions: `Open scenario`, `View evidence`, `Add reviewed outcome`. Do not expose “train on this” as a one-click action.

## 6.5 Alerts and notification centre

Alert classes: production, equipment, data freshness, drift, exploration priority and model health. Every alert includes severity, mine/region, observed time, affected decision, owner, data freshness and a direct deep link. Buttons are `Inspect`, `Acknowledge`, `Assign` and `Escalate`; acknowledgement requires a note for critical alerts.

## 6.6 AI Mine Copilot

Place a small spark/compass icon beside global search. Opening the panel shows suggested grounded prompts:

- “Why is [mine] at risk tomorrow?”
- “Show the evidence behind this target.”
- “What changes if [equipment] is unavailable?”
- “Summarise what changed since the last approved release.”

Every numerical answer includes source badges such as `Forecast model v4.2`, `MineState 09:00 IST`, `Scenario SC-024`, and `Synthetic prototype data` when appropriate. Scenario requests show an **Run scenario** confirmation before evaluation. The copilot must respond with “I need to run a scenario” instead of fabricating a counterfactual.

---

# 7. Critical interaction states

| State | Visual treatment | Required behaviour |
|---|---|---|
| `FRESH` | green status dot + readable label | normal confidence handling |
| `AGING` | amber label | retain output; flag diminished freshness |
| `STALE` | amber/red banner on dependent cards | restrict recommendation confidence; guide to update source |
| `CRITICAL` | red alert + affected cards muted | do not present a high-confidence recommendation |
| `REAL` | blue provenance badge | link to source/lineage |
| `DERIVED_SYNTHETIC` / `SYNTHETIC` | outlined provenance badge | make prototype limitations visible |
| `Model frozen` | neutral lock badge | serving champion continues; promotion unavailable |
| `Challenger rejected` | neutral result card | show reasons and retain champion |
| `Permission denied` | quiet, explanatory empty state | explain required role; do not show disabled hidden controls without reason |
| `No data` | structured empty state | show data gap, effect on confidence and appropriate next action |

## Confirmations

Use a right-side confirmation sheet—not a browser alert—for: dataset approval/rejection, model promotion, model freeze, rollback and sending a scenario recommendation for review. The sheet shows affected object/version, consequence, reason field, approver identity and audit event statement.

---

# 8. Responsive, accessibility and motion

## Responsive rules

- **Desktop (1440+):** persistent sidebar, 12-column grid, map/tables side-by-side.
- **Laptop (1024–1439):** collapsible sidebar, 8-column grid, scenario comparison remains a horizontal table with scroll.
- **Tablet (768–1023):** one contextual panel at a time; map filters in bottom sheet.
- **Mobile (<768):** landing is fully responsive; authenticated MVP is read-first with alert acknowledgement, evidence review and basic outcome entry. Complex mapping, model promotion and scenario construction should remain desktop/tablet tasks.

## Accessibility

- Contrast meets WCAG AA; all status colours have label and icon support.
- Keyboard order follows visual/task order; all map and chart insights have text/table alternatives.
- Minimum 44×44 px touch targets; never place critical actions only in hover menus.
- Respect reduced motion/transparency. Blur, parallax and floating cards are nonessential enhancements.
- Use clear names: `Approve challenger model v4.3`, not `Confirm`.

## Motion

- Glass cards may rise 2–4 px on hover; duration 160–220 ms.
- Map and scenario transitions use 220–300 ms ease-out.
- Alerts do not pulse continuously; use a single entrance emphasis then a persistent labelled state.
- Never animate risk values in a way that implies live certainty unless the data is genuinely streaming.

---

# 9. MVP screen priority

Build and demo in this order:

1. **Landing page + Sign in to MINEx** — establishes premium industrial visual language and secure role routing.
2. **Production Command Center** — forecast, shortfall risk, explanation, freshness and “Find feasible response.”
3. **Scenario and Optimisation workspace** — baseline/scenario comparison and recommendation rationale.
4. **Exploration Intelligence** — map, target detail, confidence, evidence and maturity.
5. **Data Health + Data Trust** — source origin, freshness, validation, lineage.
6. **Model Health + Prediction Ledger** — governed continuous-learning proof.
7. **Role-specific upload/review flows and Copilot** — only after the underlying actions are demonstrable.

---

# 10. UI acceptance checklist

- [ ] Landing page presents MINEx, “One Mine. One Intelligence Layer.” and a **Sign in to MINEx** CTA.
- [ ] Login routes users to assigned department workspace; it does not let users grant themselves a role.
- [ ] Every critical forecast/risk card shows timestamp, confidence, freshness and data origin.
- [ ] Exploration screens distinguish prospectivity, target maturity and resource confidence; no reserve claim is made from a map score.
- [ ] Production screens expose forecast, shortfall risk, explanation and constrained scenario path.
- [ ] Scenario actions show feasibility, expected impact, risk reduction, cost, urgency and assumption/provenance state.
- [ ] Data Health and Data Trust screens expose actionable reasons rather than opaque health percentages.
- [ ] Dataset upload requires review of proposed classification/mapping and creates an immutable version.
- [ ] Champion/challenger status, freeze and rollback are visible and approval-gated.
- [ ] Prediction Ledger and Decision Memory expose predicted versus actual results without treating feedback as automatic truth.
- [ ] Copilot answers are grounded in platform outputs and scenarios; it never invents numerical results.
- [ ] Liquid-glass treatment preserves readable contrast, works with reduced transparency and does not obscure dense data.
