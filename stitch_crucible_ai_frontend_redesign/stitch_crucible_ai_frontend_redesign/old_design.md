# Crucible AI - Frontend UI/UX & Architecture Guide

This document provides a comprehensive guide to the existing UI/UX, element placement, button behaviors, and backend wiring for Crucible AI. This is intended to serve as a blueprint for restyling ("reskinning") and recreating the frontend using a different design system or theme.

## 1. Global Navigation & Layout Architecture

The application uses a unified global navigation structure defined in `web/src/lib/roles.ts` and `web/src/components/crucible/Navigation.tsx`.

### Sidebar Navigation (Information Architecture)
The sidebar groups application modules based on what the user is trying to accomplish:

1. **COMMAND**
   - **Command Center** (`/command-center`): Landing surface answering "does anything need attention right now?"
2. **OPERATIONS**
   - **Production** (`/production`): Live telemetry & forecasting.
   - **Equipment** (`/equipment`): Fleet health.
   - **Haul Routing** (`/routing`): Dynamic haul routes.
3. **EXPLORE**
   - **Exploration** (`/exploration`): GIS rebuild, prospectivity mapping.
4. **DECIDE**
   - **Scenarios** (`/scenario`): Discrete event simulation.
   - **Intelligence** (`/intelligence`): Cross-domain reasoning workspace.
   - **Alerts** (`/alerts`): Operational alert list.
5. **DATA**
   - **Data Hub** (`/data-hub`): File upload wizard.
   - **ML Lab** (`/lab`): ML engine execution tracking.
6. **TRUST**
   - **Governance** (`/governance`): Model registry and AI human approval gates.

**Behavior:**
- The sidebar is responsive. It collapses to a narrow icon-only view (68px) and expands on hover/click to full width (224px). 
- Active tab is highlighted (`bg-chipon text-inkb`). 
- On mobile, it acts as a slide-in drawer.

### Topbar (`TopNavBar`)
- **Elements:** App branding, Breadcrumb/Current Page Icon & Label, Theme Toggle, Admin Link (for Super Admins), and User Avatar (Clerk).
- **Behavior:** Sticks to the top (`sticky top-0`). Displays the current active page title and icon based on the active route.

---

## 2. Core Modules & Page Details

### 2.1 Command Center (`/command-center`)
The primary hub for operations managers, displaying active risks without complex charts.
- **Backend:** Fetches data via `useCommandSummary(mineId)` from `/command` endpoints.
- **UI Elements & Flow:**
  - **Mine Context Bar:** Allows changing the active mine (saves to `localStorage`).
  - **Operational State Banner:** Top-level summary (e.g., "Critical issues detected"). Includes a **Refresh** button.
  - **Attention Queue (Left Panel):** Ranked list of items needing attention. 
    - *Action:* Clicking an item opens the `ResponsePlanDrawer` sliding in from the right to inspect details.
  - **Recommendation List (Left Panel):** Direct AI-suggested operational interventions.
  - **Do Nothing Panel (Right Panel):** Shows the projected financial/tonnage impact if no action is taken.
  - **Material Flow (Right Panel):** Visual representation of the supply chain stages and current bottlenecks.

### 2.2 Production Forecasting (`/production`)
A detailed dashboard for live telemetry and production yields. Designed as a "Bento Grid".
- **Backend:** Parallel fetching from `/production/{mine}/forecast`, `/production/{mine}/history`, `/production/{mine}/shortfall`, and `/ledger`.
- **UI Elements & Flow:**
  - **Header:** Mine Selector dropdown. **"Find feasible response" CTA button** (Navigates to `/scenario`).
  - **Forecast Chart (Main Card):**
    - Large typography showing P50 expected production. 
    - *Action:* Clicking the expected production metric opens the `ShortfallModal`.
    - Timeline Range Buttons: `1D`, `7D`, `1M`. Updates the chart granularity.
    - Chart consists of vertical bars. Hovering shows a tooltip with exact values. Projected bars have a hatched pattern and trigger `PredictionBrainstormModal` on click.
  - **Active Risk Vectors (Right Sidebar Card):**
    - List of equipment/operational risks. 
    - *Action:* Clicking a risk card opens the `EvidenceModal` to show the underlying telemetry/reasoning. Includes a "Simulate Mitigation" button that routes to `/scenario`.
  - **Prediction Ledger (Bottom Wide Card):**
    - Tabular log of AI predictions. Filters: `All`, `Active`, `Auto-Resolved`.
    - *Buttons:* `Export` (triggers CSV download of the ledger), `Full Ledger` (links to Governance).
    - *Action:* `Execute` button on a row triggers a toast notification, marks row as 'executing', and navigates to `/scenario`.

### 2.3 Scenario Optimization (`/scenario`)
A sandbox for discrete event simulation where users test "what-if" operational changes.
- **Backend:** Posts constraints to `/scenarios/evaluate`.
- **UI Elements & Flow:**
  - **Presets Bar:** Buttons for `Maximize Output`, `Cost Saver`, `Safe & Steady`, `Balanced Approach`. Clicking these instantly updates the slider controls and triggers a simulation.
  - **Operational Controls (Left Panel):**
    - Objective dropdown, discrete toggle buttons for Risk Tolerance, Fleet Flex, Maint Flex, Route Flex, and a range slider for Max Additional Fuel.
    - *Action:* **"Simulate Scenario"** button explicitly triggers the backend recalculation.
  - **Performance Projection (Center Panel):**
    - Table comparing `Baseline Current` vs `Simulated Scenario`.
    - *Action:* **"View Baseline"** button toggles back to original metrics.
  - **Proposed Interventions (Center Panel):**
    - List of actionable steps to achieve the scenario, including estimated impact (+ tonnes) and effort level.
  - **Evidence & Assurance (Right Panel):**
    - Shows Model Confidence, Calculation Mode (Model-Backed vs Heuristic), and Cost Assurance disclaimers.
  - **Header Action:** **"Send for Approval"** button. Opens the `DeploySuccessModal`.

### 2.4 Exploration Intelligence (`/exploration`)
A GIS/Map heavy page for geological target analysis.
- **Backend:** Map tiles (OpenFreeMap), `/api/ai/target-brief` for AI natural language summaries.
- **UI Elements & Flow:**
  - **Map Area:** Central view displaying GeoJSON layers, grid cells, and targets (with glow/pulse CSS effects). Every target is clickable.
  - **Data Strata (Left Panel):** Collapsible panel containing layer toggles (Geological, Electromagnetic, Heatmap, etc.).
  - **Target Details (Right Panel):** Collapsible panel showing selected target information.
    - Includes an **"Ask AI"** chat interface where the LLM explains the geological prospectivity.
    - **"Review Drill Target"** button opens the `DrillReviewModal`.

### 2.5 Equipment Health (`/equipment`)
Conclusion-first fleet health overview.
- **Backend:** `useFleetInsights()` hook.
- **UI Elements & Flow:**
  - **Health Summary Bar:** High-level metrics across the fleet.
  - **Filter Pills:** `All`, `Attention`, `Medium`, `Low`.
  - **Needs Attention Cards:** Grid of insight cards showing severity (Critical/High).
    - *Action:* Clicking a card expands evidence or opens a Machine Modal showing underlying sensor telemetry.

### 2.6 Intelligence Center (`/intelligence`)
Deep reasoning and cross-domain analytics workspace.
- **Backend:** `/intelligence/pulse`, `/intelligence/top-issues`.
- **UI Elements & Flow:**
  - **Mine Pulse:** Scorecards (1-100) for various pillars.
  - **Natural Language Query:** A search bar to ask operational questions. Yields AI-generated `NLQueryResult` with evidence and recommendations.
  - **Deep Reasoning Tabs:** Toggle between `Root Cause Explorer` (SHAP value visualization), `Mine Replay` (Chronological ledger timeline), and `Material Flow`.

### 2.7 Data Hub (`/data-hub`)
Multi-step data ingestion wizard.
- **UI Elements & Flow (State Machine):**
  1. **Domain Selection:** Choose from Production, Equipment, Exploration, Maintenance.
  2. **Upload:** Drag-and-drop file zone.
  3. **Mapping / Schema Analysis:** Table allowing user to review and correct column mappings detected by AI.
  4. **Validation:** Displays quality scores and data checks (passed/failed).
  5. **Done:** Final confirmation with CTA to proceed.

### 2.8 Governance (`/governance`)
Compliance and Model Registry dashboard.
- **Backend:** Model fetching, Approvals Log, Training Runs.
- **UI Elements & Flow:**
  - **Tabs:** `Data Health`, `Model Registry`, `Training Runs`, `Approvals`, `Ledger`.
  - **Model Registry:** Lists Champion and Challenger models. Shows metrics (ROC-AUC, MAE, etc.).
  - **Human Approval Gate:** Shows buttons/modals for managers to sign off on promoting a Challenger model to Champion.

### 2.9 Alerts (`/alerts`)
- **Backend:** `/alerts`
- **UI Elements:** Simple list of alerts grouped by severity. Contains buttons to Acknowledge alerts (removes from active queue).

### 2.10 ML Lab (`/lab`)
- **Backend:** Interacts directly with the engine API (`useEngine()`).
- **UI Elements:** Lists datasets, provides a UI to launch training runs, and displays real-time execution nodes and logs. Has a built-in `Unavailable` state fallback gracefully if the engine is offline.

---

## 3. Styling & Theming Core Concepts

The existing application relies heavily on modern, glassmorphic UI patterns driven by Tailwind CSS classes. When reskinning, these concepts should be preserved or mapped to the new theme:

- **Glassmorphism:** Extensive use of `backdrop-blur-xl`, `bg-page/60`, `liquid-glass`, and `liquid-glass-dark`.
- **Borders & Separation:** Uses subtle borders like `border-line2/50` or `border-frost/10` to delineate panels without heavy shadows.
- **Gradients & Glows:** Active elements (like targets or critical alerts) often use `animate-pulse` and box-shadow glows (e.g., `shadow-[0_0_20px_rgba(...)]`).
- **Typography:** Uses `Space_Grotesk` for major headings and numbers, and `Manrope` for general UI text.
- **Colors:**
  - `accentt`: Primary brand color (often a warm orange/gold like `#FFC56F`).
  - `okt`, `warnt`, `dangert`: Status colors mapped to green, amber, red.
  - Backgrounds: Deep layered backgrounds (`bg-deep`, `bg-page`, `bg-panel`) usually dark-themed with subtle radial gradients or noise textures.

## 4. Key Reusable Components to Implement

When recreating the frontend, the following custom components will need to be built:
1. **InsightCard / AttentionItem:** Used in Production, Command Center, and Equipment. Needs to support Severity colors, Title, Impact Description, and a CTA/Arrow.
2. **Modals (EvidenceModal, ShortfallModal, DrillReviewModal):** Slide-up or centered overlays used heavily to keep the main dashboards clean while offering deep dives.
3. **Sliders & Discrete Toggles:** Used heavily in the Scenario workspace. Needs custom styling for the range tracks and segment controls.
4. **Data Tables:** Used in Ledger and Scenario projection. Must support row-level actions and custom column rendering (like confidence bars).
5. **Timeline / Step Progress:** Used in Data Hub and Intelligence Replay.

*Note: The frontend is heavily state-driven. Many API calls fail gracefully to fallback synthetic data for demonstration purposes. The new UI must handle these loading and fallback states elegantly as demonstrated in the original codebase.*

---

## 5. Mobile Experience (`/m/*`)

The Crucible AI platform has a dedicated mobile shell tailored for field usage and quick managerial glances.

### Mobile Layout & Navigation (`/m/layout.tsx`)
- **Global Header:** A slim, sticky top bar (height 52px) rather than the expansive desktop Topbar.
  - **Left Side:** Hamburger menu button and branded logo. 
  - **Right Side:** Theme toggle, "Desktop" mode button (overrides user agent via cookie), and User Avatar.
- **Drawer Menu (Sidebar Replacement):**
  - Triggered by clicking the hamburger menu button.
  - Uses an animated slide-in effect (`animate-drawerIn`) from the left. Contains a semi-transparent backdrop overlay.
  - Lists the currently authenticated user's profile details at the top, followed by navigation links filtered based on their role (`pagesForRole()`). 
  - Each item click closes the drawer and routes to the respective `/m/*` page.

### Mobile Home Page (`/m/page.tsx`)
- **Behavior:** The initial landing surface for authenticated mobile users.
- **Elements:**
  - **Role Greeting:** Displays the user's role (e.g., "Management") and name.
  - **KPI Grid (Top Stats):** A grid of 4 `StatCard` components (P50 Forecast, Shortfall Risk, Fleet At Risk, Open Alerts).
    - Wired to multiple hooks: `useForecastSummary`, `useAlertsList`, `useFleet`.
  - **Departments Grid:** Navigational cards with large icons directing to other mobile subpages (Production, Equipment, Alerts, etc.).

### Mobile Production (`/m/production/page.tsx`)
- **Behavior:** A vertical, simplified, scrollable version of the desktop production dashboard.
- **Elements:**
  - **P50 Hero Card:** Displays the main metric. Integrates a highly compact version of the forecast timeline bars (dynamically heights mapped as `(b.heightPercent / maxVal) * 100`).
  - **Active Risks List:** Vertically stacked cards for each risk factor (fetched via `useRiskVectors`), with severity badges prominently displayed.
  - **Prediction Ledger:** A shortened list of the most recent ledger events with confidence percentage badges.
- **Wiring:** Directly invokes `useForecastSummary(mineId)`, `useRiskVectors(mineId)`, and `useLedgerList(10)`.

### Desktop Fallbacks (e.g. `/m/command-center`)
- Some mobile views explicitly re-export the desktop component (e.g., `<DesktopCommandCenter />`) if the responsive design inherently supports both viewports.
