'use client';

/**
 * Alerts — Active Operations Sentry
 * 100% faithful port of the Stitch reference HTML:
 *   crucible_ai_operational_alerts/code.html
 *
 * Layout: 12-col grid
 *   Left  (col-span-8): L1 Critical | L2 Warning | L3 Advisory alert cards
 *   Right (col-span-4): Severity Matrix donut + Routing & AI Suppression + Incident Heatmap
 */
import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMineId } from '@/lib/useMineId';
import { apiFetch } from '@/lib/api';
import type { AlertItem } from '@/lib/crucible';

/* ─── Static Critical Alerts (from reference) ────────────────────────────── */
const STATIC_CRITICAL = [
  {
    id: 'c1', category: 'mill',
    badge: 'CRITICAL BREACH', badgeCls: 'bg-telemetry-crimson text-on-error',
    time: 'UTC 14:02:19.410', locIcon: 'factory', locText: 'Crushing Circuit 01 > Primary Throat',
    sla: '00:08:44',
    title: 'Gyratory Crusher 1 Cavity Under-fill (<38%)',
    body: 'Severe feed starvation cascade imminent in 14 min. Structural resonance harmonics approaching tolerance threshold. Projected Financial Impact: -$118,400/hr downstream mill deficit.',
    metric: 'Cavity Density', metricVal: '31.2%', trend: 'trending_down',
    telemetry: 'TELEMETRY: [RADAR_SONIC_04: 31.2%] [FEED_CHUTE_DIVERTER: STUCK_INTERMEDIATE_42%] [POWER_DRAW: -180kW]',
    telemetrySrc: 'Crucible AI Confidence: 99.1%', telIcon: 'memory',
    sparkPath: 'M0,4 L20,6 L40,5 L60,14 L80,18 L100,22', sparkCx: 100, sparkCy: 22,
    primaryBtn: 'Acknowledge', primaryBtnIcon: 'verified',
    secondBtn: 'Open Response Plan', secondBtnIcon: 'auto_graph',
    secondBtnCls: 'bg-surface-container-high hover:bg-surface-elevation text-earth-charcoal',
  },
  {
    id: 'c2', category: 'equipment',
    badge: 'MECHANICAL CRITICAL', badgeCls: 'bg-telemetry-crimson text-on-error',
    time: 'UTC 14:08:02.110', locIcon: 'local_shipping', locText: 'Haul Unit HK-402 > Bench 14 West',
    sla: '00:04:18',
    title: 'Hauler HK-402 Hoist Valve Cavitation & Pressure Drop',
    body: 'Hydraulic rupture vector detected while fully laden (340t copper ore). High probability of uncontrolled bed drop or steering assist stall at In-Pit Ramp B switchback. Impact: Pit artery block & fleet downtime.',
    metric: 'Hydraulic PSI', metricVal: '1,820', metricSub: '/ 3,400',
    telemetry: 'TELEMETRY: [HOIST_PUMP_DISCHARGE: 1820psi] [FLUID_AERATION: HIGH] [TEMP: 98.4C (EXCEEDED)]',
    telemetrySrc: 'AI Model: Komatsu-930E-Predict-v3', telIcon: 'precision_manufacturing',
    sparkPath: 'M0,6 L30,5 L50,8 L70,16 L90,21 L100,23', sparkCx: 100, sparkCy: 23,
    primaryBtn: 'Acknowledge', primaryBtnIcon: 'verified',
    secondBtn: 'Dispatch Mech (Team Charlie)', secondBtnIcon: 'construction',
    secondBtnCls: 'bg-earth-espresso hover:bg-earth-charcoal text-on-primary',
  },
  {
    id: 'c3', category: 'geotech',
    badge: 'GEOTECHNICAL HAZARD', badgeCls: 'bg-telemetry-crimson text-on-error',
    time: 'UTC 13:49:50.002', locIcon: 'landscape', locText: 'Tailings Storage 2 > Crest Embankment',
    sla: '00:19:12',
    title: 'Tailings Storage Facility (TSF 2) Piezometer Drift (+4.2 kPa)',
    body: 'Pore pressure surge exceeded 3-sigma statistical baseline. Downstream phreatic line elevated across 120m perimeter. Impact: GISTM compliance violation risk & immediate containment review mandated.',
    metric: 'Pore Delta', metricVal: '+4.2 kPa', trend: 'north_east',
    telemetry: 'TELEMETRY: [VIBRATING_WIRE_PZ09: 142.8kPa] [SLOPE_RADAR_DISP: +1.2mm] [RAINFALL_LAST_6H: 34mm]',
    telemetrySrc: 'Geotech Sentry Engine', telIcon: 'water_drop',
    sparkPath: 'M0,19 L30,17 L60,14 L80,7 L100,3', sparkCx: 100, sparkCy: 3,
    primaryBtn: 'Acknowledge', primaryBtnIcon: 'verified',
    secondBtn: 'Trigger LiDAR Drone Survey', secondBtnIcon: 'flight',
    secondBtnCls: 'bg-primary-container text-on-primary-container hover:bg-tertiary-container',
  },
];

/* ─── Static Warning Alerts ─────────────────────────────────────────────── */
const STATIC_WARNING = [
  {
    id: 'w1', category: 'equipment',
    badge: 'HAUL LATENCY', badgeCls: 'bg-telemetry-amber text-on-surface',
    time: 'UTC 14:11:08.204', locIcon: 'alt_route', locText: 'Ramp B Arterial Corridors',
    sla: '00:32:00',
    title: 'Ramp B Haul Cycle Latency (+6.2m delay)',
    body: 'Three consecutive Komatsu 930E units decelerated below target speed (14 km/h vs. 26 km/h nominal). Wet uncompacted grading patch at Switchback 3.',
    metric: 'Queue Delay', metricVal: '+6.2 min',
    telemetry: 'TELEMETRY: [SPEED_TELEMETRY: -42%] [ROLLING_RESISTANCE: +3.8%] [AFFECTED_HAULERS: HK-402, HK-405, HK-412]',
    quickAction: 'Re-route Fleet to Ramp C',
  },
  {
    id: 'w2', category: 'mill',
    badge: 'THERMAL RUNAWAY', badgeCls: 'bg-telemetry-amber text-on-surface',
    time: 'UTC 13:58:30.990', locIcon: 'settings', locText: 'Grinding Line 02 > SAG Mill Drive',
    sla: '00:24:10',
    title: 'SAG Motor Bearing Temp Delta (+14C Above Ambient Drift)',
    body: 'Non-drive end journal temperature climbing at 0.4C/min. Lube oil filter differential pressure elevated to 110 kPa.',
    metric: 'Bearing T', metricVal: '88.4C',
    telemetry: 'TELEMETRY: [RTD_BRG_02: 88.4C] [OIL_FLOW: 42L/min (-8%)] [SPECTRAL_VIBE_1X: 2.1mm/s]',
    quickAction: 'Activate Auxiliary Lube Skids',
  },
  {
    id: 'w3', category: 'geotech',
    badge: 'DRILL & BLAST', badgeCls: 'bg-telemetry-amber text-on-surface',
    time: 'UTC 13:42:15.118', locIcon: 'crisis_alert', locText: 'Bench 09 East > Pattern B-104',
    sla: '01:10:00',
    title: 'Explosive Emulsion Loading Density Variance',
    body: 'Holes 14-22 show gassing density at 1.28 g/cc (spec 1.15 g/cc). High risk of ground heave toe hang-ups and oversize boulders for shovel load-out.',
    metric: 'Density', metricVal: '+11.3%',
    telemetry: 'TELEMETRY: [MMU_TRUCK_08: FLOW_RATIO_ERROR] [STEMMING_HEIGHT: 3.2m] [BLAST_SCHEDULE: 17:00 UTC]',
    quickAction: 'Recalibrate MMU Meter',
  },
];

const FILTERS = [
  { key: 'all',       label: 'All Alerts (14)' },
  { key: 'critical',  label: 'Critical (3)' },
  { key: 'equipment', label: 'Equipment (4)' },
  { key: 'mill',      label: 'Processing / Mill (5)' },
  { key: 'geotech',   label: 'Safety & Geotech (2)' },
];

export default function AlertsPage() {
  const { getToken } = useAuth();
  const mineId = useMineId();
  const [liveAdvisory, setLiveAdvisory] = useState<AlertItem[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState('all');
  const [escalation, setEscalation] = useState(5);
  const [suppression, setSuppression] = useState(92);
  const [toast, setToast] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastRef.current) clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }

  function dismiss(id: string) {
    setDismissed(prev => new Set(Array.from(prev).concat(id)));
    showToast('Incident acknowledged & transferred to dispatch queue.');
  }

  function acknowledgeAll() {
    setDismissed(new Set(
      STATIC_CRITICAL.map(a => a.id).concat(STATIC_WARNING.map(a => a.id))
    ));
    showToast('Acknowledged all 14 filtered incidents simultaneously.');
  }

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const api = await apiFetch<any>('/alerts', {}, token);
        const rows: any[] = Array.isArray(api) ? api : (api?.alerts ?? []);
        setLiveAdvisory(
          rows
            .filter((r: any) => (r.severity ?? 'info') === 'info' && !r.acknowledged)
            .slice(0, 5)
            .map((r: any, i: number) => ({
              id: String(r.id ?? i),
              alert_type: r.alert_type ?? 'system',
              severity: 'info' as const,
              mine_id: r.mine_id ?? mineId,
              entity_id: r.entity_id ?? '—',
              message: r.message ?? 'Operational advisory',
              created_at: String(r.created_at ?? '').replace('T', ' ').slice(0, 19),
              acknowledged: false,
              data_origin: r.data_origin ?? 'SYNTHETIC',
            }))
        );
      } catch { /* advisory from API supplements static data */ }
    })();
  }, [getToken, mineId]);

  const filterMatch = (cat: string, sev: string) => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'critical') return sev === 'critical';
    if (activeFilter === 'equipment') return cat === 'equipment';
    if (activeFilter === 'mill') return cat === 'mill';
    if (activeFilter === 'geotech') return cat === 'geotech';
    return true;
  };

  const visibleCrit = STATIC_CRITICAL.filter(a => !dismissed.has(a.id) && filterMatch(a.category, 'critical'));
  const visibleWarn = STATIC_WARNING.filter(a => !dismissed.has(a.id) && filterMatch(a.category, 'warning'));

  return (
    <div className="bg-canvas-sandstone min-h-screen">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none">
          <div className="pointer-events-auto bg-earth-charcoal text-canvas-sandstone px-4 py-2 rounded shadow-xl flex items-center gap-2 font-label-md text-label-md">
            <span className="material-symbols-outlined text-copper-accent text-[18px]">verified</span>
            <span>{toast}</span>
          </div>
        </div>
      )}

      {/* Section 1: Top bar */}
      <div className="p-space-lg bg-surface-container-high shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-col gap-space-md">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center gap-space-xs font-label-sm text-label-sm uppercase tracking-wider text-secondary">
                <span>Decide</span>
                <span className="material-symbols-outlined text-[12px] text-outline">chevron_right</span>
                <span className="text-primary font-semibold">Incident Triage</span>
                <span className="material-symbols-outlined text-[12px] text-outline">chevron_right</span>
                <span className="text-copper-accent">Pit North Sentry</span>
              </div>
              <div className="flex items-baseline gap-space-md">
                <h1 className="font-headline-lg text-headline-lg text-earth-charcoal tracking-tight">Active Operations Sentry</h1>
                <span className="font-label-md text-label-md px-space-sm py-0.5 rounded bg-telemetry-crimson text-on-error uppercase font-bold tracking-widest animate-pulse">
                  3 Critical Threats
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-3 px-space-md py-space-xs bg-surface-parchment rounded shadow-sm">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm uppercase text-secondary">Active Ledger</span>
                  <span className="font-headline-sm text-headline-sm text-earth-charcoal leading-none">14</span>
                </div>
                <div className="h-6 w-px bg-earth-border" />
                <div className="flex items-center gap-2 font-label-sm text-label-sm">
                  <span className="flex items-center gap-1 text-telemetry-crimson font-bold">
                    <span className="w-2 h-2 rounded-full bg-telemetry-crimson" /> 3 Crit
                  </span>
                  <span className="flex items-center gap-1 text-telemetry-amber font-bold">
                    <span className="w-2 h-2 rounded-full bg-telemetry-amber" /> 5 Warn
                  </span>
                  <span className="flex items-center gap-1 text-secondary font-medium">
                    <span className="w-2 h-2 rounded-full bg-secondary" /> 6 Adv
                  </span>
                </div>
              </div>
              <button onClick={acknowledgeAll}
                className="flex items-center gap-space-xs px-space-sm py-2 bg-surface-parchment hover:bg-surface-elevation text-earth-charcoal font-label-md text-label-md rounded shadow-sm transition-all active:scale-95">
                <span className="material-symbols-outlined text-[16px] text-telemetry-emerald">done_all</span>
                <span>Acknowledge All</span>
              </button>
              <button onClick={() => showToast('Compiling Kansanshi Pit North CSV telemetry ledger... Export generated.')}
                className="flex items-center gap-space-xs px-space-sm py-2 bg-surface-parchment hover:bg-surface-elevation text-earth-charcoal font-label-md text-label-md rounded shadow-sm transition-all active:scale-95">
                <span className="material-symbols-outlined text-[16px] text-copper-accent">file_download</span>
                <span>Export Log</span>
              </button>
            </div>
          </div>

          {/* Filter + Suppression row */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-space-sm p-space-sm bg-surface-container rounded shadow-sm">
            <div className="flex items-center gap-1 overflow-x-auto">
              {FILTERS.map(f => (
                <button key={f.key} onClick={() => setActiveFilter(f.key)}
                  className={`px-space-sm py-1.5 rounded font-label-md text-label-md whitespace-nowrap transition-colors ${
                    activeFilter === f.key
                      ? 'bg-earth-charcoal text-canvas-sandstone font-semibold shadow-sm'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-space-md justify-between lg:justify-end">
              <div className="flex items-center gap-2">
                <span className="font-label-sm text-label-sm uppercase text-secondary">Suppression Engine:</span>
                <span className="px-2 py-0.5 rounded bg-surface-container-high font-label-sm text-label-sm text-copper-accent font-semibold">92.4% NOISE DAMPED</span>
              </div>
              <button className="flex items-center gap-1 text-primary hover:text-earth-espresso font-label-md text-label-md font-semibold transition-colors">
                <span className="material-symbols-outlined text-[18px]">tune</span>
                <span>Routing Rules</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main 12-col Grid */}
      <div className="max-w-7xl mx-auto px-space-lg py-space-xl w-full">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">

          {/* Left: Alert Feed (col-span-8) */}
          <div className="xl:col-span-8 flex flex-col gap-space-lg">

            {/* L1: Critical */}
            {visibleCrit.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-space-sm pb-1">
                  <div className="flex items-center gap-space-xs">
                    <span className="w-3 h-3 rounded-full bg-telemetry-crimson animate-ping" />
                    <span className="font-headline-sm text-headline-sm text-telemetry-crimson uppercase tracking-wide">L1: Critical Incidents</span>
                    <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-error-container text-on-error-container font-bold">Requires Command Override</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary uppercase">{visibleCrit.length} Items Active</span>
                </div>
                <div className="flex flex-col gap-space-sm">
                  {visibleCrit.map(alert => (
                    <div key={alert.id} id={`alert-card-${alert.id}`}
                      className="relative bg-surface-parchment rounded shadow-md overflow-hidden transition-all duration-300 hover:shadow-lg">
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-telemetry-crimson" />
                      <div className="p-space-md pl-space-lg flex flex-col gap-space-sm">
                        {/* Meta */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-space-xs">
                            <span className={`font-label-sm text-label-sm px-2 py-0.5 rounded font-bold uppercase tracking-wider ${alert.badgeCls}`}>{alert.badge}</span>
                            <span className="font-label-sm text-label-sm text-secondary font-mono">{alert.time}</span>
                            <span className="text-earth-border">•</span>
                            <span className="font-label-md text-label-md text-copper-accent font-semibold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">{alert.locIcon}</span>
                              {alert.locText}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 bg-error-container px-2 py-1 rounded">
                            <span className="material-symbols-outlined text-[16px] text-telemetry-crimson">timer</span>
                            <span className="font-label-sm text-label-sm text-on-error-container font-bold font-mono">SLA LOCK: {alert.sla}</span>
                          </div>
                        </div>
                        {/* Body */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                          <div className="max-w-2xl">
                            <h3 className="font-headline-sm text-headline-sm text-earth-charcoal font-bold tracking-tight mb-1">{alert.title}</h3>
                            <p className="font-body-md text-body-md text-on-surface-variant">{alert.body}</p>
                          </div>
                          <div className="bg-surface-container-high p-space-xs rounded flex flex-col items-end min-w-[140px]">
                            <span className="font-label-sm text-label-sm text-secondary">{alert.metric}</span>
                            <div className="flex items-center gap-1">
                              <span className="font-headline-sm text-headline-sm text-telemetry-crimson font-mono">{alert.metricVal}</span>
                              {(alert as any).metricSub && <span className="font-label-sm text-label-sm text-secondary">{(alert as any).metricSub}</span>}
                              {(alert as any).trend && <span className="material-symbols-outlined text-telemetry-crimson text-[18px]">{(alert as any).trend}</span>}
                            </div>
                            <svg className="w-28 h-7 text-telemetry-crimson" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 100 24">
                              <path d={alert.sparkPath} />
                              <circle cx={alert.sparkCx} cy={alert.sparkCy} r="3" fill="currentColor" />
                            </svg>
                          </div>
                        </div>
                        {/* Telemetry */}
                        <div className="p-space-xs bg-surface-container rounded flex items-center justify-between gap-2 font-mono text-body-sm text-on-surface-variant">
                          <div className="flex items-center gap-2 truncate">
                            <span className="material-symbols-outlined text-[16px] text-copper-accent">{alert.telIcon}</span>
                            <span className="truncate">{alert.telemetry}</span>
                          </div>
                          <span className="text-secondary whitespace-nowrap text-[11px]">{alert.telemetrySrc}</span>
                        </div>
                        {/* Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-space-sm pt-space-xs">
                          <div className="flex items-center gap-space-xs">
                            <button onClick={() => dismiss(alert.id)}
                              className="px-space-md py-1.5 bg-telemetry-crimson text-on-error font-label-md text-label-md rounded shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1">
                              <span className="material-symbols-outlined text-[16px]">{alert.primaryBtnIcon}</span>
                              <span>{alert.primaryBtn}</span>
                            </button>
                            <button onClick={() => showToast(`Action dispatched.`)}
                              className={`px-space-md py-1.5 font-label-md text-label-md rounded shadow-sm hover:opacity-90 active:scale-95 transition-all flex items-center gap-1 ${alert.secondBtnCls}`}>
                              <span className="material-symbols-outlined text-[16px]">{alert.secondBtnIcon}</span>
                              <span>{alert.secondBtn}</span>
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => showToast('Alert muted for 15 minutes across Pit telemetry channel.')}
                              className="text-secondary hover:text-earth-charcoal font-label-md text-label-md flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-container-high transition-colors">
                              <span className="material-symbols-outlined text-[16px]">snooze</span>
                              <span>Mute 15m</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* L2: Warning */}
            {visibleWarn.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-space-sm pb-1">
                  <div className="flex items-center gap-space-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-telemetry-amber" />
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal uppercase tracking-wide">L2: Warning &amp; Drift Vectors</span>
                    <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-telemetry-amber font-bold">Action within 45m</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary uppercase">{visibleWarn.length} Items Active</span>
                </div>
                <div className="flex flex-col gap-space-sm">
                  {visibleWarn.map(alert => (
                    <div key={alert.id} id={`alert-card-${alert.id}`}
                      className="relative bg-surface-parchment rounded shadow-sm overflow-hidden transition-all duration-300 hover:shadow-md">
                      <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-telemetry-amber" />
                      <div className="p-space-md pl-space-lg flex flex-col gap-space-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-space-xs">
                            <span className={`font-label-sm text-label-sm px-2 py-0.5 rounded font-bold uppercase tracking-wider ${alert.badgeCls}`}>{alert.badge}</span>
                            <span className="font-label-sm text-label-sm text-secondary font-mono">{alert.time}</span>
                            <span className="text-earth-border">•</span>
                            <span className="font-label-md text-label-md text-copper-accent font-semibold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">{alert.locIcon}</span>
                              {alert.locText}
                            </span>
                          </div>
                          <span className="font-label-sm text-label-sm text-secondary font-mono bg-surface-container-high px-2 py-0.5 rounded">SLA: {alert.sla}</span>
                        </div>
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                          <div>
                            <h3 className="font-headline-sm text-headline-sm text-earth-charcoal font-bold tracking-tight mb-1">{alert.title}</h3>
                            <p className="font-body-md text-body-md text-on-surface-variant">{alert.body}</p>
                          </div>
                          <div className="bg-surface-container-high p-space-xs rounded flex flex-col items-end min-w-[120px]">
                            <span className="font-label-sm text-label-sm text-secondary">{alert.metric}</span>
                            <span className="font-headline-sm text-headline-sm text-telemetry-amber font-mono">{alert.metricVal}</span>
                          </div>
                        </div>
                        <div className="p-space-xs bg-surface-container rounded font-mono text-body-sm text-on-surface-variant truncate">{alert.telemetry}</div>
                        <div className="flex items-center justify-between pt-space-xs">
                          <button onClick={() => dismiss(alert.id)}
                            className="px-space-md py-1 bg-surface-container-high hover:bg-surface-elevation text-earth-charcoal font-label-md text-label-md rounded shadow-sm flex items-center gap-1">
                            <span className="material-symbols-outlined text-[16px] text-telemetry-emerald">check</span>
                            <span>Acknowledge</span>
                          </button>
                          <button onClick={() => showToast(`${alert.quickAction} dispatched.`)}
                            className="font-label-md text-label-md text-primary hover:text-earth-espresso flex items-center gap-1">
                            <span>{alert.quickAction}</span>
                            <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* L3: Advisory */}
            {activeFilter === 'all' && (
              <div>
                <div className="flex items-center justify-between mb-space-sm pb-1">
                  <div className="flex items-center gap-space-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                    <span className="font-headline-sm text-headline-sm text-secondary uppercase tracking-wide">L3: Advisory &amp; Optimization</span>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary uppercase">6 Items Active</span>
                </div>
                <div className="flex flex-col gap-space-sm">
                  <div id="alert-card-i1" className="bg-surface-parchment rounded shadow-sm p-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                    <div className="flex items-start gap-space-md">
                      <span className="material-symbols-outlined text-secondary text-[24px]">info</span>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-secondary uppercase font-bold">OPTIMIZATION</span>
                          <span className="font-label-sm text-label-sm text-secondary font-mono">UTC 13:15:00</span>
                          <span className="font-label-md text-label-md text-copper-accent font-semibold">Flotation Cells 4-8</span>
                        </div>
                        <h4 className="font-headline-sm text-headline-sm text-earth-charcoal">Frother Reagent Feed Consumption Drift (-3.2%)</h4>
                        <p className="font-body-md text-body-md text-on-surface-variant">Reagent pump metering slightly behind target setpoint based on copper grade feed variation.</p>
                      </div>
                    </div>
                    <button onClick={() => showToast('Advisory dismissed.')}
                      className="px-space-md py-1 bg-surface-container-high hover:bg-surface-elevation text-earth-charcoal font-label-md text-label-md rounded whitespace-nowrap">
                      Dismiss
                    </button>
                  </div>
                  {liveAdvisory.map(a => (
                    <div key={a.id} className="bg-surface-parchment rounded shadow-sm p-space-md flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
                      <div className="flex items-start gap-space-md">
                        <span className="material-symbols-outlined text-secondary text-[24px]">info</span>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high text-secondary uppercase font-bold">{a.alert_type.toUpperCase()}</span>
                            <span className="font-label-sm text-label-sm text-secondary font-mono">{a.created_at}</span>
                            <span className="font-label-md text-label-md text-copper-accent font-semibold">{a.entity_id}</span>
                          </div>
                          <p className="font-body-md text-body-md text-on-surface-variant">{a.message}</p>
                        </div>
                      </div>
                      <button className="px-space-md py-1 bg-surface-container-high hover:bg-surface-elevation text-earth-charcoal font-label-md text-label-md rounded whitespace-nowrap">Dismiss</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Sidebar (col-span-4) */}
          <div className="xl:col-span-4 flex flex-col gap-space-md sticky top-20">

            {/* Severity Matrix Donut */}
            <div className="bg-surface-parchment rounded shadow-md p-space-md">
              <div className="flex items-center justify-between mb-space-sm">
                <span className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">Severity Matrix</span>
                <span className="font-label-sm text-label-sm text-copper-accent font-mono font-semibold">REALTIME TELEMETRY</span>
              </div>
              <div className="flex items-center justify-center gap-space-md py-space-sm">
                <div className="relative w-32 h-32 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path className="text-surface-container-high" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4.5" />
                    <path className="text-telemetry-crimson stroke-current" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeDasharray="21.4, 100" strokeLinecap="round" strokeWidth="4.5" />
                    <path className="text-telemetry-amber stroke-current" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeDasharray="35.7, 100" strokeDashoffset="-21.4" strokeLinecap="round" strokeWidth="4.5" />
                    <path className="text-secondary stroke-current" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" strokeDasharray="42.9, 100" strokeDashoffset="-57.1" strokeLinecap="round" strokeWidth="4.5" />
                  </svg>
                  <div className="absolute flex flex-col items-center">
                    <span className="font-headline-md text-headline-md text-earth-charcoal font-bold leading-none">14</span>
                    <span className="font-label-sm text-label-sm text-secondary uppercase">Vectors</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {[
                    { color: 'bg-telemetry-crimson', label: 'Critical Breaches', count: 3 },
                    { color: 'bg-telemetry-amber',   label: 'Warning Drifts',    count: 5 },
                    { color: 'bg-secondary',          label: 'Advisory Log',      count: 6 },
                  ].map(item => (
                    <div key={item.label} className="flex items-center gap-2 font-label-md text-label-md">
                      <span className={`w-3 h-3 rounded ${item.color}`} />
                      <span className="text-earth-charcoal font-semibold">{item.label}</span>
                      <span className="font-mono text-secondary ml-auto">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Routing & AI Suppression */}
            <div className="bg-surface-parchment rounded shadow-md p-space-md flex flex-col gap-space-md">
              <div className="flex items-center justify-between pb-space-xs border-b border-earth-border">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">tune</span>
                  <h3 className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">Routing &amp; AI Suppression</h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-copper-accent font-mono font-semibold">POLICY: TIER-1</span>
              </div>
              <div className="flex flex-col gap-space-xs">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary font-bold">Broadcast Dispatch Channels</span>
                {[
                  { icon: 'notifications_active', cls: 'text-telemetry-crimson', label: 'PagerDuty (L1 Critical Only)', sub: 'Mine Ops Manager & Chief Geotech' },
                  { icon: 'cell_tower', cls: 'text-copper-accent', label: 'Pit Radio Broadcast (VHF-Ch4)', sub: 'Automated text-to-speech for haulers' },
                  { icon: 'sms', cls: 'text-secondary', label: 'SMS Escalation (Supervisor On-Call)', sub: 'Triggers if unacknowledged > 5 min' },
                ].map(ch => (
                  <div key={ch.label} className="flex items-center justify-between p-space-xs bg-surface-container rounded">
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-[18px] ${ch.cls}`}>{ch.icon}</span>
                      <div className="flex flex-col">
                        <span className="font-label-md text-label-md text-earth-charcoal font-semibold">{ch.label}</span>
                        <span className="font-body-sm text-body-sm text-secondary">{ch.sub}</span>
                      </div>
                    </div>
                    <input defaultChecked type="checkbox" className="accent-primary w-4 h-4 cursor-pointer" />
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-space-xs">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary font-bold">Escalation Timer (Unack SLA)</span>
                  <span className="font-label-sm text-label-sm text-copper-accent font-mono font-bold">{escalation} Minutes</span>
                </div>
                <input type="range" min={1} max={15} value={escalation} onChange={e => setEscalation(Number(e.target.value))}
                  className="w-full accent-primary h-1.5 bg-surface-container-high rounded cursor-pointer" />
                <div className="flex justify-between font-label-sm text-label-sm text-secondary font-mono">
                  <span>1m (Aggressive)</span><span>15m (Standard)</span>
                </div>
              </div>
              <div className="flex flex-col gap-space-xs">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary font-bold">AI Suppression Sensitivity</span>
                  <span className="font-label-sm text-label-sm text-telemetry-emerald font-mono font-bold">{suppression}.0% Filtered</span>
                </div>
                <input type="range" min={50} max={99} value={suppression} onChange={e => setSuppression(Number(e.target.value))}
                  className="w-full accent-copper-accent h-1.5 bg-surface-container-high rounded cursor-pointer" />
                <span className="font-body-sm text-body-sm text-secondary">
                  Crucible Neural Core suppresses sensor chatter, mechanical micro-jitters, and non-actionable vibration surges.
                </span>
              </div>
              <button onClick={() => showToast('Routing protocols & threshold matrix saved into Core Controller.')}
                className="w-full py-2 bg-primary-container hover:bg-tertiary-container text-on-primary-container font-label-md text-label-md rounded font-semibold shadow-sm transition-all text-center">
                Deploy Updated Routing Schema
              </button>
            </div>

            {/* Incident Heatmap */}
            <div className="bg-surface-parchment rounded shadow-md p-space-md">
              <div className="flex items-center justify-between mb-space-xs">
                <span className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">Incident Heatmap</span>
                <span className="font-label-sm text-label-sm text-secondary uppercase">Pit Coordinates</span>
              </div>
              <div className="w-full h-44 bg-cover bg-center rounded shadow-inner relative flex flex-col justify-end p-2 overflow-hidden"
                style={{ backgroundImage: `url('https://lh3.googleusercontent.com/aida-public/AB6AXuCmPux6BHvYyQne_tgFZD2jCuUnd7Ir7FzQUkoSVSP-fmtBWHa67Z71Lzvm9n5aL0PJXTKzPEv0Zftf-JB3IWQDnFgmJoQD-twjqzBgJtXPjJCRG8VEZMfUyP9pvtk66R-aDzAl5Yp1tiUFwhcNG18i6CLCk6zTrRKnlA3H_1BKgs-tYIofCtYJl3wCKpRn0VkpR6GU4WFrUpG7-icpiTS4nxXUhA_Zs2eMikibokc2sqE-dKck7PMw')` }}>
                <div className="absolute inset-0 bg-earth-charcoal/20 backdrop-brightness-95" />
                <div className="absolute top-1/4 left-1/3 flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-telemetry-crimson animate-ping absolute" />
                  <span className="w-3 h-3 rounded-full bg-telemetry-crimson relative" />
                  <span className="px-1 bg-earth-charcoal/90 text-[9px] font-mono text-on-primary rounded">CRUSH-01</span>
                </div>
                <div className="absolute bottom-1/3 left-1/2 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-telemetry-crimson animate-pulse" />
                  <span className="px-1 bg-earth-charcoal/90 text-[9px] font-mono text-on-primary rounded">HK-402</span>
                </div>
                <div className="absolute top-4 right-8 flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-telemetry-crimson" />
                  <span className="px-1 bg-earth-charcoal/90 text-[9px] font-mono text-on-primary rounded">TSF-02</span>
                </div>
                <div className="relative bg-surface-parchment/95 backdrop-blur-sm p-1.5 rounded flex items-center justify-between text-[11px] font-mono">
                  <span className="text-earth-charcoal font-semibold">Bench 14 - Concentrator 1 Axis</span>
                  <span className="text-copper-accent font-bold">3 ACTIVE NODES</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
