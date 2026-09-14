'use client';

/**
 * insight.ts — the presentation/explainability layer.
 *
 * Pipeline (strict, per spec):
 *   model contribution → feature-to-human mapping → validated domain rule
 *   → POSSIBLE/DETECTED failure mode → evidence → human-readable explanation
 *
 * A failure mode is never produced from probability alone, and no reason is
 * ever invented: every reason carries its source and, for model-derived
 * reasons, a traceable contribution inside `technical`.
 */

import { formatTonnes } from './crucible';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'healthy';

export interface Reason {
  label: string;
  text: string;
  source: 'telemetry' | 'maintenance' | 'model';
  feature?: string;
}

export interface EvidenceItem {
  feature: string;
  label: string;
  detail: string;
  source: string;
}

export interface TechnicalContribution {
  feature: string;
  label: string;
  contribution: number;       // coefficient × standardized value
  coefficient: number;
  standardizedValue: number;
  rawValue: number;
  direction: 'up' | 'down';
  unit?: string | null;
  normalRange?: string | null;
  timestamp?: string | null;
}

export interface Insight {
  id: string;
  kind: 'equipment_failure';
  equipment_type: string;
  severity: Severity;
  severityLabel: string;
  probability: number;
  issue: string | null;       // POSSIBLE/DETECTED failure mode, or null
  timeframe: string | null;
  reasons: Reason[];          // max 3, each sourced (model reasons trace via technical)
  impact: string | null;
  action: { label: string; detail: string } | null;
  confidence: 'high' | 'medium' | 'low';
  state: 'action_required' | 'watch' | 'information';
  freshness: { lastUpdate: string; stale: boolean; simulated: boolean };
  evidence: EvidenceItem[];
  technical: {
    modelVersion: string;
    probability: number;
    contributions: TechnicalContribution[];
    note?: string;
  };
}

export interface FleetSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

/* ---------- fallbacks (exact spec wording) ---------- */
const DATA_UNAVAILABLE = 'Data unavailable';

/* ---------- equipment insights (from /equipment/{mine}/fleet) ---------- */

export function mapFleetInsights(api: any): Insight[] {
  const rows: any[] = Array.isArray(api?.insights) ? api.insights : [];
  return rows.map((r) => ({
    id: r.machine_id,
    kind: 'equipment_failure' as const,
    equipment_type: r.equipment_type ?? 'unknown',
    severity: (r.severity ?? 'healthy') as Severity,
    severityLabel: r.severity_label ?? severityLabel(r.severity),
    probability: Number(r.probability) || 0,
    issue: r.issue ?? null,
    timeframe: r.timeframe ?? null,
    reasons: (r.reasons ?? []).slice(0, 3),
    impact: r.impact ?? null,
    action: r.action ?? null,
    confidence: r.confidence ?? 'low',
    state: r.state ?? 'information',
    freshness: {
      lastUpdate: r.freshness?.lastUpdate ?? '',
      stale: Boolean(r.freshness?.stale),
      simulated: r.freshness?.simulated ?? true,
    },
    evidence: r.evidence ?? [],
    technical: {
      modelVersion: r.technical?.modelVersion ?? 'v1.0-logistic',
      probability: Number(r.technical?.probability ?? r.probability) || 0,
      contributions: r.technical?.contributions ?? [],
      note: r.technical?.note,
    },
  }));
}

export function fleetSummary(api: any): FleetSummary {
  const s = api?.summary ?? {};
  return {
    critical: Number(s.critical) || 0,
    high: Number(s.high) || 0,
    medium: Number(s.medium) || 0,
    low: Number(s.low) || 0,
  };
}

export function severityLabel(sev: Severity): string {
  return {
    critical: 'CRITICAL',
    high: 'HIGH RISK',
    medium: 'WATCH',
    low: 'LOW RISK',
    healthy: 'HEALTHY',
  }[sev];
}

export function severityTone(sev: Severity): 'danger' | 'warn' | 'ok' | 'neutral' {
  if (sev === 'critical' || sev === 'high') return 'danger';
  if (sev === 'medium') return 'warn';
  if (sev === 'healthy') return 'ok';
  return 'neutral';
}

/* ---------- validity guards (spec #7) ---------- */

/** Utilization is a 0–1 fraction. Anything outside renders "Data unavailable". */
export function formatUtilization(u: number | null | undefined): string {
  if (u == null || !Number.isFinite(u) || u < 0 || u > 1.0001) return DATA_UNAVAILABLE;
  if (u === 0) return '0%';
  return `${Math.round(u * 100)}%`;
}

/* ---------- production insight (forecast + SHAP drivers + shortfall) ---------- */

export interface ProductionInsight {
  expected: string;            // range-scaled total, e.g. "4.9 kt over next 7 days"
  expectedPerShift: string;    // single-shift p50, e.g. "234 t"
  horizonLabel: string;        // "next 24 hours" | "next 7 days" | "next 30 days"
  horizonShifts: number;
  plannedTarget: string | null; // range-scaled planned target
  deficit: string | null;       // shortfall vs plan over the horizon, when expected < planned
  state: 'on_track' | 'at_risk' | 'action_required';
  stateLabel: string;
  shortfallProbability: number;
  drivers: { label: string; direction: 'positive' | 'negative' }[];
  simulated: boolean;
}

const PROD_FEATURE_LABELS: Record<string, string> = {
  planned_production_t: 'Planned production target',
  ore_available_t: 'Ore availability',
  ore_grade_mn_pct: 'Ore grade',
  rainfall_7d_mm: 'Rainfall over the last 7 days',
  equipment_availability_pct: 'Equipment availability',
  equipment_utilization_pct: 'Equipment utilization',
  processing_capacity_t: 'Processing capacity',
  operator_availability_pct: 'Operator availability',
  shift_efficiency: 'Shift efficiency',
  total_downtime_hours: 'Downtime',
  unplanned_downtime_hours: 'Unplanned downtime',
  waste_t: 'Waste volume',
  stockpile_t: 'Stockpile level',
  soil_moisture_mean: 'Soil moisture',
};

function featureLabel(feature: string): string {
  return (
    PROD_FEATURE_LABELS[feature] ??
    feature.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function buildProductionInsight(
  api: any,
  horizon?: { shifts: number; label: string }
): ProductionInsight {
  const p50PerShift = Number(api?.forecast?.p50) || 0;
  const shifts = horizon?.shifts ?? 1;
  const horizonLabel = horizon?.label ?? 'next shift';
  const expectedT = p50PerShift * shifts;
  const plannedPerShift = Number(api?.planned_production_t) || 0;
  const plannedT = plannedPerShift * shifts;
  const shortfall = Number(api?.shortfall_probability) || 0;
  const deficitT = plannedT > 0 && expectedT < plannedT ? plannedT - expectedT : 0;
  const gapRatio = plannedT > 0 ? deficitT / plannedT : 0;

  // State combines two independent signals and takes the more severe:
  //  (1) the calibrated shortfall model probability, and
  //  (2) whether the point forecast (p50 × shifts) itself falls below plan.
  // A confident point forecast under target is flagged even if the model prob is modest.
  const rank = { on_track: 0, at_risk: 1, action_required: 2 } as const;
  const modelState: ProductionInsight['state'] =
    shortfall >= 0.5 ? 'action_required' : shortfall >= 0.3 ? 'at_risk' : 'on_track';
  const gapState: ProductionInsight['state'] =
    gapRatio >= 0.15 ? 'action_required' : gapRatio >= 0.05 ? 'at_risk' : 'on_track';
  const state: ProductionInsight['state'] =
    rank[gapState] > rank[modelState] ? gapState : modelState;
  const stateLabel =
    state === 'on_track' ? 'On track against target'
    : state === 'at_risk' ? 'At risk of missing target'
    : 'High risk of missing target';
  const drivers = (api?.top_drivers ?? []).slice(0, 3).map((d: any) => ({
    label: featureLabel(d.feature),
    direction: (d.direction === 'negative' ? 'negative' : 'positive') as 'positive' | 'negative',
  }));
  return {
    expected: formatTonnes(expectedT),
    expectedPerShift: formatTonnes(p50PerShift),
    horizonLabel,
    horizonShifts: shifts,
    plannedTarget: plannedT > 0 ? formatTonnes(plannedT) : null,
    deficit: deficitT > 0 ? formatTonnes(deficitT) : null,
    state,
    stateLabel,
    shortfallProbability: Math.round(shortfall * 100),
    drivers,
    simulated: true,
  };
}

/* ---------- helpers ---------- */

/** "2 min ago" / "3 h ago" / "5 d ago" style recency for last-update labels. */
export function relTime(iso: string): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/** Maps an equipment Insight onto the existing RiskVector shape so the
 *  EvidenceModal can present the level-2 evidence without duplication. */
export function insightToRiskVector(i: Insight) {
  return {
    id: `risk-${i.id}`,
    title: `${i.id} — ${i.issue ?? 'failure risk detected'}`,
    confidence: Math.round(i.probability * 100),
    impact: (i.impact ?? '').replace('~', '').replace(' potential loss', '/shift'),
    severity: (i.severity === 'critical' || i.severity === 'high'
      ? 'high'
      : i.severity === 'medium' ? 'medium' : 'low') as 'high' | 'medium' | 'low',
    evidence: {
      description:
        i.reasons.map((r) => `${r.label}: ${r.text}`).join('. ') + '.' || 'No sourced reasons available.',
      telemetrySource: `Equipment telemetry — ${i.technical.modelVersion}`,
      affectedUnits: [i.id],
      syntheticAssumptions: i.freshness.simulated
        ? 'Some readings are simulated — treat as indicative.'
        : 'Measured telemetry.',
      recommendedMitigation: i.action?.detail ?? i.action?.label ?? 'Review with maintenance.',
    },
  };
}

export const FALLBACK_FLEET_SUMMARY: FleetSummary = {
  critical: 1,
  high: 1,
  medium: 2,
  low: 38,
};

export const FALLBACK_FLEET_INSIGHTS: Insight[] = [
  {
    id: 'TATA-3718 (H-12)',
    kind: 'equipment_failure',
    equipment_type: 'Haul Truck',
    severity: 'critical',
    severityLabel: 'CRITICAL',
    probability: 0.92,
    issue: 'Transmission Overheating',
    timeframe: 'Immediate',
    reasons: [
      { label: 'Primary Cause', text: 'Transmission oil temperature critically high (>115°C)', source: 'telemetry' },
    ],
    impact: 'Potential complete transmission failure leading to prolonged downtime.',
    action: { label: 'Stop Vehicle', detail: 'Halt operations and dispatch maintenance crew immediately.' },
    confidence: 'high',
    state: 'action_required',
    freshness: { lastUpdate: new Date(Date.now() - 5000).toISOString(), stale: false, simulated: true },
    evidence: [],
    technical: { modelVersion: 'v2.1', probability: 0.92, contributions: [] },
  },
  {
    id: 'Loader EX-04',
    kind: 'equipment_failure',
    equipment_type: 'Loader',
    severity: 'high',
    severityLabel: 'HIGH RISK',
    probability: 0.78,
    issue: 'Hydraulic Temperature Anomaly',
    timeframe: 'Within Shift',
    reasons: [
      { label: 'Condition', text: 'Hydraulic fluid temperature exceeding safe limit (98°C vs 85°C)', source: 'telemetry' },
    ],
    impact: '-1.1kt/shift potential loss due to degraded loading efficiency.',
    action: { label: 'Preemptive Service', detail: 'Schedule a 45-minute seal flushing before failure.' },
    confidence: 'high',
    state: 'action_required',
    freshness: { lastUpdate: new Date(Date.now() - 120000).toISOString(), stale: false, simulated: true },
    evidence: [],
    technical: { modelVersion: 'v2.1', probability: 0.78, contributions: [] },
  },
  {
    id: 'Primary Crusher 1',
    kind: 'equipment_failure',
    equipment_type: 'Crusher',
    severity: 'medium',
    severityLabel: 'WATCH',
    probability: 0.64,
    issue: 'Feed Rate Variation',
    timeframe: 'Next 24h',
    reasons: [
      { label: 'Pattern', text: 'Moisture content causing bridging in feed chute', source: 'model' },
    ],
    impact: 'Reduced throughput and potential blockages.',
    action: { label: 'Adjust Feed', detail: 'Reduce feed rate by 15% for next 30 minutes.' },
    confidence: 'medium',
    state: 'watch',
    freshness: { lastUpdate: new Date(Date.now() - 300000).toISOString(), stale: false, simulated: true },
    evidence: [],
    technical: { modelVersion: 'v2.1', probability: 0.64, contributions: [] },
  },
  {
    id: 'CAT-773E (H-14)',
    kind: 'equipment_failure',
    equipment_type: 'Haul Truck',
    severity: 'medium',
    severityLabel: 'WATCH',
    probability: 0.55,
    issue: 'Brake Wear Accelerated',
    timeframe: 'Next 7 days',
    reasons: [
      { label: 'Wear Rate', text: 'Brake temperature consistently high on downward ramp', source: 'telemetry' },
    ],
    impact: 'Increased safety risk and maintenance costs.',
    action: { label: 'Monitor', detail: 'Monitor brake temperatures and advise operator on retarder usage.' },
    confidence: 'medium',
    state: 'watch',
    freshness: { lastUpdate: new Date(Date.now() - 600000).toISOString(), stale: false, simulated: true },
    evidence: [],
    technical: { modelVersion: 'v2.1', probability: 0.55, contributions: [] },
  },
  {
    id: 'Blast Drill D-02',
    kind: 'equipment_failure',
    equipment_type: 'Drill',
    severity: 'healthy',
    severityLabel: 'HEALTHY',
    probability: 0.12,
    issue: null,
    timeframe: null,
    reasons: [],
    impact: null,
    action: null,
    confidence: 'high',
    state: 'information',
    freshness: { lastUpdate: new Date(Date.now() - 10000).toISOString(), stale: false, simulated: true },
    evidence: [],
    technical: { modelVersion: 'v2.1', probability: 0.12, contributions: [] },
  }
];
