/**
 * lib/minex.ts — Shared types, India-corrected fallback data, and API mappers
 * for the MINEx Stitch-themed frontend. Every screen renders from live API data
 * and degrades gracefully to the synthetic fallbacks below when the API is down.
 */

export interface ProductionDataPoint {
  time: string;
  value: number;
  projected?: boolean;
  actual?: number;
  isPeak?: boolean;
  heightPercent: number;
}

export interface RiskVector {
  id: string;
  title: string;
  confidence: number;
  impact: string;
  severity: 'high' | 'medium' | 'low';
  evidence: {
    description: string;
    telemetrySource: string;
    affectedUnits: string[];
    syntheticAssumptions: string;
    recommendedMitigation: string;
  };
}

export interface PredictionLedgerEntry {
  id: string;
  time: string;
  entityNode: string;
  predictionType: string;
  confidence: number;
  recommendedAction: string;
  status: 'active' | 'auto-resolved' | 'executing' | 'deployed';
  scenarioLinked?: string;
  dataOrigin?: string;
}

export interface ExplorationTarget {
  id: string;
  name: string;
  coordinates: string;
  lat: number;
  lng: number;
  status: string;
  probability: number;
  subsurfaceConf: 'HIGH' | 'MEDIUM' | 'MODERATE';
  maturity: string;
  geologicalLayers: 'Real' | 'Synthetic';
  eoDataSynthesis: 'Real' | 'Synthetic';
  assayCorrelation: string;
  densityScore: number;
  estimatedReserveTons: string;
  description: string;
  drivers?: { feature: string; importance: number }[];
}

export interface ScenarioIntervention {
  id: string;
  title: string;
  description: string;
  icon: string;
  status: 'active' | 'disabled';
  tagColor: 'primary' | 'amber' | 'green' | 'blue';
  magnitude?: number;
  expected_delta_t?: number;
  cost_inr?: number;
  reason?: string;
  model_backed?: boolean;
}

export interface ScenarioMetrics {
  productionOutput: { baseline: string; scenario: string; trend: 'up' | 'down' | 'neutral' };
  riskReduction: { baseline: string; scenario: string; trend: 'enhanced' | 'nominal' };
  expectedImpact: { baseline: string; scenario: string; isSynthetic: boolean };
  feasibilityRating: {
    baseline: string;
    scenario: string;
    confidencePercent: number;
    hasWarning: boolean;
  };
  modelConfidence?: number;
}

export interface ScenarioControls {
  objective: "MAXIMIZE_PRODUCTION" | "BALANCED" | "MINIMIZE_COST" | "MINIMIZE_RISK";
  max_additional_fuel_pct: number;
  fleet_reallocation: "LOW" | "MEDIUM" | "HIGH";
  maintenance_flexibility: "PRESERVE" | "LIMITED" | "HIGH";
  route_flexibility: "LOW" | "MEDIUM" | "HIGH";
  operating_time_mode: "CURRENT" | "EXTENDED_AVAILABILITY" | "MAX_AVAILABLE";
  risk_tolerance: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
}

export interface FleetMachine {
  machine_id: string;
  equipment_type: string;
  failure_risk_prob: number;
  risk_level: 'HIGH' | 'MEDIUM' | 'LOW';
  maintenance_overdue_days: number;
  utilization_pct: number;
  last_seen: string;
}

export interface AlertItem {
  id: number | string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  mine_id: string;
  entity_id: string;
  message: string;
  created_at: string;
  acknowledged: boolean;
  data_origin?: string;
}

// ---------------------------------------------------------------------------
// Fallback data (used when the API is unreachable). Geography corrected to the
// Sausar Belt, Maharashtra — the synthetic dataset's survey region.
// ---------------------------------------------------------------------------

export const FALLBACK_FORECAST: ProductionDataPoint[] = [
  { time: '06:00', heightPercent: 40, projected: false, value: 3.2 },
  { time: '08:00', heightPercent: 45, projected: false, value: 3.6 },
  { time: '10:00', heightPercent: 35, projected: false, value: 2.9 },
  { time: '12:00', heightPercent: 50, projected: false, value: 4.1 },
  { time: '14:00', heightPercent: 60, projected: false, value: 4.8 },
  { time: '16:00', heightPercent: 55, projected: false, value: 4.4 },
  { time: '18:00', heightPercent: 75, isPeak: true, projected: false, value: 5.9 },
  { time: '20:00', heightPercent: 40, projected: true, value: 3.1 },
  { time: '22:00', heightPercent: 65, projected: true, value: 4.9 },
  { time: '00:00', heightPercent: 80, projected: true, value: 6.2 },
  { time: '02:00', heightPercent: 85, projected: true, value: 6.7 },
  { time: '04:00', heightPercent: 90, projected: true, value: 7.2 },
];

export const FALLBACK_RISKS: RiskVector[] = [
  {
    id: 'risk-1',
    title: 'Haulage Congestion (Zone B)',
    confidence: 92,
    impact: '-2.4kt/shift',
    severity: 'high',
    evidence: {
      description:
        'FMS velocity telemetry across Haul Route B-2 shows queue buildup exceeding 5 haul trucks near the Ramp 3 junction.',
      telemetrySource: 'Fleet Management System (FMS) Node-72B',
      affectedUnits: ['TATA-3718 (H-12)', 'CAT-773E (H-14)', 'Komatsu HD785 (H-09)'],
      syntheticAssumptions: 'Cycle time elongation calibrated from historical monsoon shift patterns.',
      recommendedMitigation: 'Reroute active trucks H-12 and H-14 to the Western Haulway to clear the bottleneck.',
    },
  },
  {
    id: 'risk-2',
    title: 'Loader L-04 Downtime (Unplanned)',
    confidence: 78,
    impact: '-1.1kt/shift',
    severity: 'medium',
    evidence: {
      description:
        'Hydraulic temperature anomaly on Loader EX-04 exceeding safe operating limits (98°C vs 85°C threshold).',
      telemetrySource: 'IoT Condition Monitoring Core #EX04',
      affectedUnits: ['Loader EX-04', 'Feeder Hopper 2'],
      syntheticAssumptions: 'Linear heat dissipation rate assuming ambient 34°C open-pit condition.',
      recommendedMitigation: 'Schedule a preemptive 45-minute seal flushing before catastrophic blowout.',
    },
  },
  {
    id: 'risk-3',
    title: 'Crusher Feed Rate Variation',
    confidence: 64,
    impact: '-0.8kt/shift',
    severity: 'medium',
    evidence: {
      description: 'Moisture content in incoming run-of-mine manganese ore causing bridging in Primary Crusher 1 chute.',
      telemetrySource: 'Optical Ore Sizing & Moisture Sensor #CR1',
      affectedUnits: ['Primary Gyratory Crusher 1', 'Screen Deck S-01'],
      syntheticAssumptions: 'Ore hardness grade estimated at 5.5 Mohs scale.',
      recommendedMitigation: 'Reduce feed rate by 15% for the next 30 minutes to stabilize throughput.',
    },
  },
];

export const FALLBACK_LEDGER: PredictionLedgerEntry[] = [
  { id: 'pred-1', time: '14:22:05', entityNode: 'Haul Route B-2', predictionType: 'Throughput Degradation', confidence: 92, recommendedAction: 'Reroute trucks H-12, H-14 to Route C', status: 'active' },
  { id: 'pred-2', time: '14:18:30', entityNode: 'Primary Crusher 1', predictionType: 'Feed Blockage Prob.', confidence: 68, recommendedAction: 'Reduce feed rate by 15% for next 30m', status: 'active' },
  { id: 'pred-3', time: '14:05:12', entityNode: 'Loader EX-04', predictionType: 'Hydraulic Temp Anomaly', confidence: 55, recommendedAction: 'Schedule preemptive maintenance inspection', status: 'active' },
  { id: 'pred-4', time: '13:45:00', entityNode: 'Processing Plant Alpha', predictionType: 'Power Draw Spike', confidence: 30, recommendedAction: 'Monitor. No immediate action required.', status: 'auto-resolved' },
  { id: 'pred-5', time: '13:12:44', entityNode: 'Beneficiation Circuit 3', predictionType: 'Density Gradient Drift', confidence: 84, recommendedAction: 'Adjust magnetic separator drum RPM to 320', status: 'active' },
  { id: 'pred-6', time: '12:50:18', entityNode: 'Tailings Slurry Line 1', predictionType: 'Pressure Surge', confidence: 42, recommendedAction: 'Verify backpressure relief valve telemetry', status: 'auto-resolved' },
];

export const FALLBACK_TARGETS: ExplorationTarget[] = [
  {
    id: 'target-042-e',
    name: 'Target 042-E',
    coordinates: "21°56'N, 79°20'E",
    lat: 21.93,
    lng: 79.33,
    status: 'Resource Candidate',
    probability: 87,
    subsurfaceConf: 'HIGH',
    maturity: 'Drill recommended',
    geologicalLayers: 'Real',
    eoDataSynthesis: 'Synthetic',
    assayCorrelation: '0.84 Spearman Index',
    densityScore: 4.82,
    estimatedReserveTons: '14.2 Mt @ 43.5% Mn',
    description:
      'High-grade sedimentary manganese horizon within the Sausar Group gondite band, intersecting a deep synclinal fold with a pronounced gravity anomaly.',
  },
  {
    id: 'target-018-w',
    name: 'Target 018-W',
    coordinates: "21°49'N, 79°12'E",
    lat: 21.82,
    lng: 79.2,
    status: 'Exploration Lead',
    probability: 64,
    subsurfaceConf: 'MEDIUM',
    maturity: 'Geophysics pending',
    geologicalLayers: 'Real',
    eoDataSynthesis: 'Real',
    assayCorrelation: '0.68 Spearman Index',
    densityScore: 3.91,
    estimatedReserveTons: '8.7 Mt @ 38.2% Mn',
    description:
      'Electromagnetic conductor zone with fault-controlled manganese mineralization in the mansar formation.',
  },
  {
    id: 'target-099-n',
    name: 'Target 099-N',
    coordinates: "22°04'N, 79°31'E",
    lat: 22.07,
    lng: 79.52,
    status: 'Early Scout',
    probability: 48,
    subsurfaceConf: 'MODERATE',
    maturity: 'Surface mapping only',
    geologicalLayers: 'Synthetic',
    eoDataSynthesis: 'Synthetic',
    assayCorrelation: '0.51 Spearman Index',
    densityScore: 3.12,
    estimatedReserveTons: '5.1 Mt @ 34.0% Mn',
    description:
      'Outcropping pyrolusite veins along the northern unconformity with Deccan trap cover.',
  },
];

export const FALLBACK_INTERVENTIONS: ScenarioIntervention[] = [
  {
    id: 'int-1',
    title: 'Re-route Hauler 3',
    description: 'Divert from Sector B to Sector A to clear backlog. Estimated delay: 4 mins.',
    icon: 'route',
    status: 'active',
    tagColor: 'primary',
  },
  {
    id: 'int-2',
    title: 'Delay maintenance B',
    description: 'Postpone scheduled PM on Crusher 2 by 4 hours to sustain throughput.',
    icon: 'build_circle',
    status: 'active',
    tagColor: 'amber',
  },
];

export const FALLBACK_METRICS: ScenarioMetrics = {
  productionOutput: { baseline: '4,250 t/hr', scenario: '4,820 t/hr', trend: 'up' },
  riskReduction: { baseline: 'Nominal (Index 4.2)', scenario: 'Enhanced (Index 2.8)', trend: 'enhanced' },
  expectedImpact: { baseline: '₹ 1.2M / shift', scenario: '₹ 1.8M / shift', isSynthetic: true },
  feasibilityRating: { baseline: '100% (Actual)', scenario: '87% Confidence', confidencePercent: 87, hasWarning: true },
  modelConfidence: 87,
};

// ---------------------------------------------------------------------------
// API mappers — convert backend JSON into the UI shapes above.
// ---------------------------------------------------------------------------

export function mapForecastToBars(
  api: any,
  projLimit: number = 1,
  targetBarCount?: number
): ProductionDataPoint[] {
  const hist: any[] = Array.isArray(api?.history?.actuals)
    ? api.history.actuals
    : Array.isArray(api?.history)
      ? api.history
      : [];

  const isDaily = api?.granularity === 'day';
  const p50Shift = Number(api?.forecast?.p50) || 0;
  const projectedValue = isDaily ? p50Shift * 3 : p50Shift;

  const shiftLabels: Record<string, string> = { '1': '06:00', '2': '14:00', '3': '22:00' };

  const desiredCount = targetBarCount && targetBarCount > 0 ? targetBarCount : undefined;

  if (!hist.length) {
    // No actual history: render model-backed projections for every requested period.
    const count = desiredCount ?? projLimit;
    const maxVal = Math.max(projectedValue, 1);
    return Array.from({ length: count }, (_, i) => ({
      time: `${isDaily ? 'Next day' : 'Next shift'}${i ? ` +${i}` : ''}`,
      value: projectedValue,
      projected: true,
      heightPercent: Math.max(8, Math.round((projectedValue / maxVal) * 92)),
    }));
  }

  // Sort chronologically
  const sorted = [...hist].sort((a, b) => {
    const da = String(a.date ?? a.period ?? '');
    const db = String(b.date ?? b.period ?? '');
    if (da !== db) return da < db ? -1 : 1;
    return Number(String(a.shift ?? '1').replace(/\D/g, '') || 1) -
           Number(String(b.shift ?? '1').replace(/\D/g, '') || 1);
  });

  const vals = sorted.map(h => Number(h.actual ?? h.actual_production_t) || 0);
  const maxVal = Math.max(...vals, projectedValue, 1);

  const actualGrid: ProductionDataPoint[] = sorted.map(h => {
    const v = Number(h.actual ?? h.actual_production_t) || 0;
    const mmdd = String(h.date ?? h.period ?? '').slice(5, 10); // MM-DD
    const shiftNum = String(h.shift ?? '').replace(/\D/g, '');
    const label = shiftNum
      ? `${mmdd} ${shiftLabels[shiftNum] ?? ''}`.trim()
      : mmdd;
    return {
      time: label,
      value: v,
      projected: false,
      heightPercent: v > 0 ? Math.max(10, Math.round((v / maxVal) * 92)) : 8,
    };
  });

  const grid = desiredCount ? actualGrid.slice(-desiredCount) : actualGrid;
  const projectionsNeeded = desiredCount
    ? Math.max(0, desiredCount - grid.length)
    : projLimit;

  if (api?.forecast) {
    for (let i = 0; i < projectionsNeeded; i++) {
      const label = i === 0
        ? (isDaily ? 'Next Day' : 'Next shift')
        : `${isDaily ? 'Next Day' : 'Next shift'} +${i}`;
      grid.push({
        time: label, value: projectedValue, projected: true,
        heightPercent: Math.max(8, Math.round((projectedValue / maxVal) * 92)),
      });
    }
  }

  return grid.length ? grid : FALLBACK_FORECAST;
}

export function formatTonnes(t: number): string {
  if (t >= 1000) return `${(t / 1000).toFixed(1)} kt`;
  return `${Math.round(t)} t`;
}

export function mapTargets(api: any): ExplorationTarget[] {
  const rows: any[] = Array.isArray(api?.targets) ? api.targets : [];
  if (!rows.length) return FALLBACK_TARGETS;
  return rows.slice(0, 12).map((r, i) => ({
    id: r.target_id ?? `target-${i}`,
    name: `Target ${String(r.target_id ?? `0${i + 1}`).slice(-5, -1).toUpperCase()}-${i + 1}`,
    coordinates: `${Math.abs(Number(r.latitude)).toFixed(2)}°${Number(r.latitude) >= 0 ? 'N' : 'S'}, ${Math.abs(Number(r.longitude)).toFixed(2)}°${Number(r.longitude) >= 0 ? 'E' : 'W'}`,
    lat: Number(r.latitude) || FALLBACK_TARGETS[0].lat,
    lng: Number(r.longitude) || FALLBACK_TARGETS[0].lng,
    status: r.maturity_stage ?? 'Screened',
    probability: Math.round((Number(r.prospectivity_prob) ?? 0.5) * 100),
    subsurfaceConf:
      (Number(r.prospectivity_prob) ?? 0) >= 0.75 ? 'HIGH' : (Number(r.prospectivity_prob) ?? 0) >= 0.55 ? 'MEDIUM' : 'MODERATE',
    maturity: r.maturity_stage ?? 'Screened',
    geologicalLayers: 'Real',
    eoDataSynthesis: 'Synthetic',
    assayCorrelation: `${((Number(r.mn_geochemistry) ?? 0.5)).toFixed(2)} Geochem Index`,
    densityScore: Number((1 + (Number(r.prospectivity_prob) ?? 0.5) * 3.8).toFixed(2)),
    estimatedReserveTons:
      r.lithology_code === '1' || r.lithology_code === 'gondite'
        ? 'Gondite host'
        : String(r.lithology_code ?? 'Undetermined'),
    description: `Prospectivity ${(Number(r.prospectivity_prob) ?? 0).toFixed(3)} from the champion model. Probability score — not a reserve claim. All data SYNTHETIC.`,
  }));
}

export function mapLedger(api: any): PredictionLedgerEntry[] {
  const rows: any[] = Array.isArray(api?.predictions) ? api.predictions : Array.isArray(api) ? api : [];
  if (!rows.length) return FALLBACK_LEDGER;
  return rows.map((r: any, i: number) => ({
    id: String(r.id ?? i),
    time: String(r.predicted_at ?? '').replace('T', ' ').slice(11, 19) || '--:--:--',
    entityNode: String(r.entity_id ?? 'unknown'),
    predictionType: String(r.task ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    confidence: Math.round((Number(r.probability ?? r.prediction_value) || 0) * 100),
    recommendedAction: r.top_driver_1 
      ? (() => {
          const cleanDriver = String(r.top_driver_1).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const task = String(r.task || '').toLowerCase();
          if (task.includes('equipment')) return `Inspect ${cleanDriver} immediately & review PM schedule`;
          if (task.includes('production')) return `Optimize routing to compensate for ${cleanDriver}`;
          if (task.includes('exploration')) return `Deploy survey team to validate ${cleanDriver}`;
          return `Investigate process anomaly linked to ${cleanDriver}`;
        })()
      : 'Review prediction in scenario workspace',
    status: r.confidence_tier === 'LOW' ? 'auto-resolved' : 'active',
    dataOrigin: r.data_origin ?? 'SYNTHETIC',
  }));
}

export function mapFleet(api: any): FleetMachine[] {
  const rows: any[] = Array.isArray(api?.fleet) ? api.fleet : [];
  return rows.map((m) => ({
    machine_id: m.machine_id,
    equipment_type: m.equipment_type ?? 'unknown',
    failure_risk_prob: Number(m.failure_risk_prob) || 0,
    risk_level: m.risk_level ?? 'LOW',
    maintenance_overdue_days: Number(m.maintenance_overdue_days) || 0,
    utilization_pct: Number(m.utilization_pct) || 0,
    last_seen: String(m.last_seen ?? ''),
  }));
}

export function mapScenarioResponse(api: any): { metrics: ScenarioMetrics; interventions: ScenarioIntervention[] } {
  const s = api ?? {};
  
  // Real values from API
  const baseProd = s.baseline?.production_t ?? 0;
  const scenProd = s.scenario?.production_t ?? 0;
  const netCost = s.scenario?.net_cost_inr ?? 0;
  
  // Base risk vs Scenario Risk (based on shortfall prob)
  const baseRisk = s.baseline?.shortfall_prob ?? 0;
  const scenRisk = s.scenario?.shortfall_prob ?? 0;
  
  const fmt = (n: number) => `${Math.round(n).toLocaleString('en-IN')} t/shift`;
  const formatCost = (cost: number) => `₹ ${(cost / 100000).toFixed(2)} Lakh / shift`; // Assuming cost is in INR, converting to Lakhs
  
  return {
    metrics: {
      productionOutput: { 
        baseline: fmt(baseProd), 
        scenario: fmt(scenProd), 
        trend: scenProd >= baseProd ? 'up' : 'down' 
      },
      riskReduction: {
        baseline: `Shortfall Risk ${(baseRisk * 100).toFixed(1)}%`,
        scenario: `Shortfall Risk ${(scenRisk * 100).toFixed(1)}%`,
        trend: scenRisk <= baseRisk ? 'enhanced' : 'nominal',
      },
      expectedImpact: {
        baseline: '₹ 0.00 Lakh / shift',
        scenario: formatCost(netCost),
        isSynthetic: s.actions_applied?.[0]?.cost_source === 'SYNTHETIC_ASSUMPTION',
      },
      feasibilityRating: {
        baseline: '100% (Actual)',
        scenario: `${s.model_confidence ?? 80}% Confidence`,
        confidencePercent: s.model_confidence ?? 80,
        hasWarning: (s.model_confidence ?? 100) < 70,
      },
      modelConfidence: s.model_confidence ?? 0,
    },
    interventions: Array.isArray(s.actions_applied)
      ? s.actions_applied.map((a: any, i: number) => ({
          id: `int-${i + 1}`,
          title: a.detail || a.intervention || 'Intervention',
          description: a.reason || 'Model-evaluated operational adjustment.',
          icon: a.type?.includes('route') ? 'route' : 
                a.type?.includes('equipment') ? 'precision_manufacturing' : 
                a.type?.includes('maintenance') ? 'build' : 'settings',
          status: 'active' as const,
          tagColor: (a.urgency === 'HIGH' ? 'amber' : 'primary') as any,
          magnitude: a.magnitude,
          expected_delta_t: a.expected_delta_t,
          cost_inr: a.cost_inr,
          reason: a.reason,
          model_backed: a.model_backed,
        }))
      : FALLBACK_INTERVENTIONS,
  };
}

