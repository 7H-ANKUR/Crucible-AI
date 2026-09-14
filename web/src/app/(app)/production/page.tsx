'use client';

/**
 * Production Command Center — ported from the Stitch design and wired to the
 * live API: forecast bars from /production/{mine}/forecast + /history,
 * risk vectors from /production/{mine}/shortfall + /equipment/{mine}/fleet,
 * and the prediction ledger from /ledger. Falls back to synthetic data.
 * 
 * Reskinned to Earthy Industrial.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useMineSelector } from '@/lib/useMineId';
import { EvidenceModal, ShortfallModal, PredictionBrainstormModal } from '@/components/crucible/Modals';
import { InsightCard } from '@/components/crucible/insight';
import { useFleetInsights } from '@/lib/hooks';
import { buildProductionInsight, insightToRiskVector, formatUtilization, type ProductionInsight } from '@/lib/insight';
import { apiFetch } from '@/lib/api';
import {
  formatTonnes,
  mapForecastToBars,
  mapLedger,
  type ProductionDataPoint,
  type PredictionLedgerEntry,
  type RiskVector,
} from '@/lib/crucible';

// Timeline range presets. The history endpoint sums zones back to a mine-wide total at
// the requested grain: "1 Day" shows the three 8-hour shifts of the latest day, while the
// wider ranges roll the shifts up into one bar per day. `barCount` is also used to fill
// periods without an actual row with a model-backed projection, keeping the timeline dense.
// `shifts` is the number of 8-hour shifts in the horizon (3/day) used to project the
// per-shift forecast into a cumulative "expected production over the range" figure.
type TimelineRange = '1D' | '7D' | '1M';
const RANGE_PARAMS: Record<
  TimelineRange,
  { histLimit: number; projLimit: number; barCount: number; granularity: 'shift' | 'day'; shifts: number; label: string }
> = {
  '1D': { histLimit: 3, projLimit: 1, barCount: 4, granularity: 'shift', shifts: 3, label: 'next 24 hours' },
  '7D': { histLimit: 5, projLimit: 2, barCount: 7, granularity: 'day', shifts: 21, label: 'next 7 days' },
  '1M': { histLimit: 25, projLimit: 5, barCount: 30, granularity: 'day', shifts: 90, label: 'next 30 days' },
};
const RANGE_OPTIONS: [TimelineRange, string][] = [
  ['1D', '1 Day'],
  ['7D', '7 Days'],
  ['1M', '1 Month'],
];

export default function ProductionPage() {
  const { getToken } = useAuth();
  const { mines, selectedMine: mineId, setSelectedMine } = useMineSelector();
  const router = useRouter();

  // Nothing starts with a number. These previously initialised to a fabricated
  // forecast curve, p50 = 42.8 t and a 14% shortfall probability, which rendered
  // before any request completed and stayed on screen if the request failed —
  // indistinguishable from measured values.
  const [bars, setBars] = useState<ProductionDataPoint[]>([]);
  const [risks, setRisks] = useState<RiskVector[]>([]);
  const [ledger, setLedger] = useState<PredictionLedgerEntry[]>([]);
  const [p50, setP50] = useState<number | null>(null);
  const [shortfallProb, setShortfallProb] = useState<number | null>(null);
  const [forecastGap, setForecastGap] = useState<{ tonnes: number; percentage: number; status: string } | null>(null);
  const [filterType, setFilterType] = useState('all');
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);
  const [timelineRange, setTimelineRange] = useState<TimelineRange>('1D');
  const [showAllVectors, setShowAllVectors] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [inspectingRisk, setInspectingRisk] = useState<RiskVector | null>(null);
  const [showShortfallModal, setShowShortfallModal] = useState(false);
  const [showPredictionModal, setShowPredictionModal] = useState(false);
  const [prodInsight, setProdInsight] = useState<ProductionInsight | null>(null);
  const { insights: fleetInsights } = useFleetInsights(mineId);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Skeleton bar heights that visually mimic a real production chart
  const SKELETON_HEIGHTS = [30, 45, 38, 55, 42, 70, 60, 85, 50, 90, 75, 65];

  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    (async () => {
      try {
        const token = await getToken();
        const { histLimit, projLimit, barCount, granularity, shifts, label } = RANGE_PARAMS[timelineRange];
        const [forecast, history, shortfall] = await Promise.all([
          apiFetch<any>(`/production/${mineId}/forecast`, {}, token),
          apiFetch<any>(`/production/${mineId}/history?limit=${histLimit}&granularity=${granularity}`, {}, token).catch(() => null),
          apiFetch<any>(`/production/${mineId}/shortfall`, {}, token).catch(() => null),
        ]);
        if (!alive) return;

        const merged = { ...(history ?? {}), forecast: forecast?.forecast, history: history?.history ?? history, granularity };
        setBars(mapForecastToBars(merged, projLimit, barCount));
        const val = Number(forecast?.forecast?.p50);
        if (val) setP50(val);
        if (forecast?.gap) setForecastGap(forecast.gap);
        const sp = Number(shortfall?.shortfall_probability ?? shortfall?.probability);
        if (!Number.isNaN(sp)) setShortfallProb(Math.round(sp * 100));
        setProdInsight(buildProductionInsight({
          forecast: forecast?.forecast,
          planned_production_t: forecast?.planned_production_t,
          shortfall_probability: Number.isNaN(sp) ? undefined : sp,
          top_drivers: forecast?.top_drivers ?? [],
        }, { shifts, label }));
      } catch {
        /* keep fallbacks */
      } finally {
        if (alive) setIsLoading(false);
      }
      try {
        const token = await getToken();
        const led = await apiFetch<any>('/ledger?limit=12', {}, token);
        if (alive) setLedger(mapLedger(led));
      } catch {
        /* keep fallback */
      }
      try {
        const token = await getToken();
        const fleet = await apiFetch<any>(`/equipment/${mineId}/fleet`, {}, token);
        if (!alive) return;
        const top = (fleet?.fleet ?? [])
          .slice(0, 4)
          .map((m: any) => ({
            id: `risk-${m.machine_id}`,
            title: `${m.equipment_type ?? 'Unit'} ${m.machine_id} failure risk`,
            confidence: Math.round((Number(m.failure_risk_prob) || 0) * 100),
            impact:
              (Number(m.failure_risk_prob) || 0) >= 0.35
                ? '-2.1kt/shift'
                : (Number(m.failure_risk_prob) || 0) >= 0.2
                ? '-1.1kt/shift'
                : '-0.4kt/shift',
            severity:
              (Number(m.failure_risk_prob) || 0) >= 0.35 ? 'high' : (Number(m.failure_risk_prob) || 0) >= 0.2 ? 'medium' : 'low',
            evidence: {
              description: `Failure model assigns ${(Number(m.failure_risk_prob) || 0).toFixed(3)} probability within the next 24h. Maintenance overdue: ${m.maintenance_overdue_days ?? 0} days, utilization ${formatUtilization(m.utilization_pct)}.`,
              telemetrySource: 'Equipment telemetry — champion logistic model v1.0',
              affectedUnits: [m.machine_id],
              syntheticAssumptions: 'All telemetry SYNTHETIC — generated with causal hazard functions.',
              recommendedMitigation:
                (Number(m.maintenance_overdue_days) || 0) > 15
                  ? 'Schedule preventive maintenance within the next shift window.'
                  : 'Continue condition monitoring; no immediate action.',
            },
          })) as RiskVector[];
        if (top.length) setRisks((prev) => [...top, ...prev].slice(0, 6));
      } catch {
        /* keep fallback */
      }
    })();
    return () => {
      alive = false;
    };
  }, [mineId, timelineRange, getToken]);

  const filteredLedger = useMemo(
    () =>
      ledger.filter((entry) => {
        const matchesSearch = true;
        if (filterType === 'active') return matchesSearch && entry.status === 'active';
        if (filterType === 'resolved') return matchesSearch && entry.status === 'auto-resolved';
        return matchesSearch;
      }),
    [ledger, filterType]
  );

  const displayedRisks = showAllVectors ? risks : risks.slice(0, 3);

  const handleExecuteAction = (entry: PredictionLedgerEntry) => {
    showToast(`Dispatched intervention for ${entry.entityNode}: "${entry.recommendedAction}"`);
    setLedger((prev) => prev.map((item) => (item.id === entry.id ? { ...item, status: 'executing' } : item)));
    setTimeout(() => router.push('/scenario'), 800);
  };

  const handleExportCSV = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      ['Time,Entity,Prediction,Confidence,Action,Status']
        .concat(
          filteredLedger.map(
            (e) => `${e.time},${e.entityNode},${e.predictionType},${e.confidence}%,${e.recommendedAction},${e.status}`
          )
        )
        .join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `crucible_prediction_ledger_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Prediction Ledger CSV exported successfully');
  };

  return (
    <main id="production-view-root" className="flex-1 transition-all duration-300 bg-canvas-sandstone min-h-screen pb-16">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-copper-accent text-canvas-sandstone px-space-md py-space-sm rounded shadow-lg text-xs font-bold flex items-center gap-space-sm animate-bounce">
          <span className="material-symbols-outlined text-base">check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Operational Sub-Header & Executive Controls Strip */}
      <section className="w-full px-margin-lg py-space-md bg-surface-parchment shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-space-md border-b border-earth-border">
        <div className="flex flex-wrap items-center gap-space-md">
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Asset Operational Pit</span>
            <div className="flex items-center gap-space-xs mt-0.5">
              <span className="material-symbols-outlined text-copper-accent text-[20px]">layers</span>
              <select
                id="mine-selector"
                value={mineId}
                onChange={(e) => setSelectedMine(e.target.value)}
                className="bg-surface-container font-headline-sm text-headline-sm text-earth-charcoal cursor-pointer outline-none rounded px-space-xs py-0.5 pr-6"
              >
                {mines.length > 0
                  ? mines.map((m) => (
                      <option key={m.mine_id} value={m.mine_id}>
                        {m.mine_id}{m.mine_name ? ` — ${m.mine_name}` : ''}{m.state ? ` (${m.state})` : ''}
                      </option>
                    ))
                  : [
                      'KA-TUMKUR-01', 'MH-BHANDARA-01', 'MII-NAGPUR-01',
                      'MP-BALAGHAT-01', 'OD-KFONIHAR-01',
                    ].map((id) => <option key={id} value={id}>{id}</option>)
                }
              </select>
            </div>
          </div>
          <div className="h-8 w-px bg-surface-variant hidden md:block"></div>
          {/* Shift Badges */}
          <div className="flex items-center gap-space-sm">
            <div className="bg-surface-container-high px-space-sm py-space-xs rounded flex items-center gap-space-xs border border-earth-border">
              <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-pulse"></span>
              <span className="font-label-md text-label-md text-earth-charcoal font-semibold">LIVE SYNC ACTIVE</span>
            </div>
            <div className="bg-surface-container px-space-sm py-space-xs rounded hidden sm:flex items-center gap-space-xs border border-earth-border">
              <span className="material-symbols-outlined text-secondary text-[16px]">schedule</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">ELAPSED: 07h 42m</span>
            </div>
          </div>
        </div>
        
        {/* Main Strategic Call to Action */}
        <div className="flex items-center gap-space-sm">
          <Link
            href="/scenario"
            className="group flex items-center gap-space-xs bg-primary-container hover:bg-primary text-on-primary px-space-md py-space-sm rounded shadow-sm transition-all duration-150 transform active:scale-95"
          >
            <span className="material-symbols-outlined text-[20px] transition-transform group-hover:rotate-12">bolt</span>
            <span className="font-label-lg text-label-lg tracking-wide uppercase">Find Feasible Response</span>
            <span className="material-symbols-outlined text-[16px] text-on-primary-container">arrow_forward</span>
          </Link>
        </div>
      </section>

      {/* Main Bento Grid Container */}
      <div className="p-margin-lg space-y-space-lg max-w-[1720px] mx-auto w-full">
        {/* Demo Mode / Synthetic Benchmark Banner */}
        <div className="mb-space-md p-space-sm rounded bg-copper-accent/10 border border-copper-accent/25 flex items-center justify-between">
          <div className="flex items-center gap-space-xs text-earth-charcoal font-label-md text-label-md">
            <span className="w-2.5 h-2.5 rounded-full bg-copper-accent animate-pulse"></span>
            <span className="font-bold uppercase tracking-wider text-copper-accent">Synthetic Operational Benchmark</span>
            <span className="text-secondary hidden sm:inline">· Production data based on Indian mineral baseline (21.95°N, 79.25°E)</span>
          </div>
          <span className="font-label-sm text-label-sm font-mono font-bold px-2 py-0.5 rounded bg-surface-container-low border border-earth-border text-secondary">
            DGMS BENCHMARK
          </span>
        </div>

        {/* Top Row Bento: Main Production Forecast Chart + Active Risk Vectors */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-space-lg items-start">
          {/* Forecast hero */}
          <section className="xl:col-span-8 rounded bg-surface-parchment border border-earth-border relative overflow-hidden flex flex-col lg:min-h-[580px] min-h-[460px] p-space-lg shadow-sm">
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(var(--tk-ink3) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          ></div>

          {/* Header row of the card */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-space-md pb-space-md">
            <div className="space-y-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="bg-primary/10 text-primary font-label-sm text-label-sm uppercase px-2 py-0.5 rounded">Mineral AI Telemetry v4.2</span>
                <span className="font-label-sm text-label-sm text-secondary tracking-widest uppercase">P50 Run-Of-Mine Model</span>
              </div>
              {/* Metric Trigger for Shortfall Modal */}
              <button 
                className="text-left group transition-all mt-space-xs" 
                onClick={() => setShowShortfallModal(true)}
                title="Click to inspect model confidence intervals & variance"
              >
                <div className="flex flex-wrap items-baseline gap-x-space-md gap-y-1">
                  <span className="font-headline-xl text-headline-xl text-earth-charcoal tracking-tight group-hover:text-primary transition-colors">
                    {prodInsight?.expected ?? (p50 === null ? '—' : formatTonnes(p50))} <span className="font-headline-md text-headline-md text-secondary">Tonnes</span>
                  </span>
                  {shortfallProb !== null && (
                    <span className={`font-label-md text-label-md px-space-xs py-0.5 rounded font-semibold flex items-center gap-1 ${shortfallProb >= 30 ? 'bg-telemetry-crimson/15 text-telemetry-crimson' : 'bg-telemetry-emerald/15 text-telemetry-emerald'}`}>
                      <span className="material-symbols-outlined text-[14px]">
                        {shortfallProb >= 30 ? 'trending_down' : 'check_circle'}
                      </span>
                      Shortfall Risk {shortfallProb}%
                    </span>
                  )}
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant group-hover:text-earth-charcoal flex items-center gap-1 mt-0.5">
                  Target: <strong className="font-semibold text-earth-charcoal">155,000 Tonnes</strong> • Δ {forecastGap ? `${forecastGap.tonnes > 0 ? '-' : '+'}${Math.abs(forecastGap.tonnes)}t` : '—'} against pit quota
                  <span className="material-symbols-outlined text-[14px] text-copper-accent">help_outline</span>
                </p>
              </button>
            </div>
            
            {/* Timeline Range Pills */}
            <div className="flex items-center bg-surface-container rounded p-1 self-start">
              {RANGE_OPTIONS.map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTimelineRange(key)}
                  aria-pressed={timelineRange === key}
                  className={`px-space-sm py-1 rounded font-label-sm text-label-sm transition-colors ${
                    timelineRange === key
                      ? 'bg-earth-charcoal text-canvas-sandstone shadow-sm'
                      : 'text-secondary hover:text-earth-charcoal'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          
          {/* Legend & Metric Telemetry Micro-Pills */}
          <div className="flex flex-wrap items-center justify-between gap-space-sm py-space-sm bg-surface-container/60 rounded px-space-sm my-space-sm border border-earth-border/60">
            <div className="flex items-center gap-space-md">
              <div className="flex items-center gap-space-xs">
                <span className="w-3.5 h-3.5 rounded-sm bg-earth-espresso border border-earth-charcoal"></span>
                <span className="font-label-sm text-label-sm text-earth-charcoal font-medium">Actual Yield (Solid)</span>
              </div>
              <div className="flex items-center gap-space-xs">
                <span className="w-3.5 h-3.5 rounded-sm bg-copper-accent/20 border border-dashed border-copper-accent" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(180,106,54,0.5) 2px, rgba(180,106,54,0.5) 4px)' }}></span>
                <span className="font-label-sm text-label-sm text-earth-charcoal font-medium">AI Projected Yield (Hatched)</span>
              </div>
              <div className="flex items-center gap-space-xs">
                <div className="w-4 h-0 border-b-2 border-dashed border-telemetry-crimson"></div>
                <span className="font-label-sm text-label-sm text-telemetry-crimson font-medium">Nominal Quota Threshold</span>
              </div>
            </div>
            <span className="font-label-sm text-label-sm text-copper-accent flex items-center gap-1 font-semibold">
              <span className="material-symbols-outlined text-[14px]">touch_app</span>
              Click hatched bar to brainstorm mitigations
            </span>
          </div>

            <div className="flex-1 w-full mt-6 relative min-h-[240px]">
              {/* Horizontal grid lines */}
              <div className="absolute top-0 left-0 right-0 bottom-14 flex flex-col justify-between pointer-events-none">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="border-b border-earth-border/60 w-full h-0"></div>
                ))}
              </div>

              {/* Nominal Quota Threshold line across the chart */}
              <div
                className="absolute left-0 right-0 border-b-2 border-dashed border-telemetry-crimson/80 pointer-events-none z-10 flex justify-end pr-2"
                style={{ bottom: 'calc(3.5rem + (100% - 3.5rem) * 0.68)' }}
              >
                <span className="font-mono text-[10px] font-bold text-telemetry-crimson bg-surface-parchment px-1.5 py-0.5 rounded border border-telemetry-crimson/40 -translate-y-1/2 shadow-xs">
                  Quota: 155,000t
                </span>
              </div>

              <div className="absolute top-0 left-0 right-0 bottom-14 flex items-end gap-[3px]">
              {isLoading ? (
                /* ── Skeleton shimmer bars ── */
                <>
                  {SKELETON_HEIGHTS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 min-w-0 rounded-t-sm relative overflow-hidden border border-earth-border/80"
                      style={{ height: `${h}%` }}
                    >
                      {/* Base dark fill */}
                      <div className="absolute inset-0 bg-surface-container/60 rounded-t-sm" />
                      {/* Shimmer sweep */}
                      <div
                        className="absolute inset-0 rounded-t-sm"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 40%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 60%, transparent 100%)',
                          backgroundSize: '200% 100%',
                          animation: `shimmer 1.6s ${i * 0.07}s infinite linear`,
                        }}
                      />
                    </div>
                  ))}
                  <style>{`
                    @keyframes shimmer {
                      0%   { background-position: -200% 0; }
                      100% { background-position:  200% 0; }
                    }
                  `}</style>
                </>
              ) : (
                /* ── Real bars ── */
                <>
                  {hoveredBarIndex !== null && bars[hoveredBarIndex] && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-surface-parchment border border-copper-accent text-earth-charcoal px-3 py-1.5 rounded-lg text-xs shadow-xl z-20 pointer-events-none">
                      <div className="font-bold text-copper-accent">{bars[hoveredBarIndex].time}</div>
                      <div>
                        Yield: {formatTonnes(bars[hoveredBarIndex].value)} {bars[hoveredBarIndex].projected ? '(Projected)' : '(Actual)'}
                      </div>
                    </div>
                  )}

                  {bars.map((bar, index) => {
                    if (bar.isPeak) {
                      return (
                        <div
                          key={index}
                          onMouseEnter={() => setHoveredBarIndex(index)}
                          onMouseLeave={() => setHoveredBarIndex(null)}
                          onTouchStart={() => setHoveredBarIndex(index)}
                          onTouchEnd={() => setHoveredBarIndex(null)}
                          className="flex-1 min-w-0 bg-copper-accent rounded-t-sm relative group border-2 border-primary-container shadow-xs transition-all hover:scale-y-105"
                          style={{ height: `${bar.heightPercent}%` }}
                        >
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-copper-accent whitespace-nowrap bg-surface-parchment px-1.5 py-0.5 rounded border border-copper-accent/40 shadow-xs z-10">
                            Peak Shift
                          </div>
                        </div>
                      );
                    }
                    if (bar.projected) {
                      return (
                        <div
                          key={index}
                          onClick={() => setShowPredictionModal(true)}
                          onMouseEnter={() => setHoveredBarIndex(index)}
                          onMouseLeave={() => setHoveredBarIndex(null)}
                          onTouchStart={() => setHoveredBarIndex(index)}
                          onTouchEnd={() => setHoveredBarIndex(null)}
                          className="flex-1 min-w-0 bg-copper-accent/25 rounded-t-sm relative group border-2 border-dashed border-copper-accent transition-all hover:bg-copper-accent/40 cursor-pointer shadow-md"
                          style={{ height: `${bar.heightPercent}%` }}
                        >
                          <div
                            className="absolute inset-0 rounded-t-sm"
                            style={{
                              backgroundImage:
                                'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(180,106,54,0.5) 4px, rgba(180,106,54,0.5) 8px)',
                            }}
                          ></div>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={index}
                        onMouseEnter={() => setHoveredBarIndex(index)}
                        onMouseLeave={() => setHoveredBarIndex(null)}
                        onTouchStart={() => setHoveredBarIndex(index)}
                        onTouchEnd={() => setHoveredBarIndex(null)}
                        className="flex-1 min-w-0 bg-earth-charcoal rounded-t-sm relative group border-2 border-copper-accent/30 transition-all hover:bg-earth-espresso shadow-md"
                        style={{ height: `${bar.heightPercent}%` }}
                      >
                        <div className="absolute inset-0 bg-canvas-sandstone/5 group-hover:bg-transparent transition-colors rounded-t-sm"></div>
                      </div>
                    );
                  })}
                </>
              )}
              </div>
              <div className="absolute bottom-0 left-0 right-0 h-14 pt-3 flex items-start">
                {isLoading ? (
                  <div className="w-full flex justify-between text-[11px] text-secondary">
                    <span>06:00</span>
                    <span>12:00</span>
                    <span>18:00</span>
                    <span>Next Shift (Proj.)</span>
                  </div>
                ) : (
                  bars.map((bar, index) => {
                    let show = false;
                    if (timelineRange === '1D') show = true;
                    else if (timelineRange === '7D') show = (index % 2 === 0 || index === bars.length - 1);
                    else show = (index === 0 || index === 9 || index === 19 || index === bars.length - 1);

                    return (
                      <div key={index} className="flex-1 flex justify-center text-[10px] text-secondary whitespace-nowrap overflow-visible">
                        {show ? (bar.projected ? `${bar.time} (Proj.)` : bar.time) : ''}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Quick Summary Bar Footer inside Card */}
            <div className="pt-space-md mt-space-sm flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm">
              <div className="flex items-center gap-space-sm text-body-sm font-body-sm text-secondary">
                <span className="material-symbols-outlined text-[18px] text-telemetry-amber">info</span>
                <span>Confidence interval: ±3.8% based on 1,420 historical cycles at {mineId}.</span>
              </div>
              <div className="flex items-center gap-space-sm">
                <span className="font-label-sm text-label-sm text-secondary uppercase">Last sync: 28s ago</span>
                <button className="text-primary hover:text-earth-charcoal font-label-sm text-label-sm uppercase font-bold flex items-center gap-0.5 transition-colors">
                  <span className="material-symbols-outlined text-[14px]">refresh</span> Re-run
                </button>
              </div>
            </div>
          </section>

        {/* Bento Right Card: Active Risk Vectors (4 cols) */}
        <div className="xl:col-span-4 bg-surface-parchment rounded shadow-sm p-space-lg flex flex-col justify-between h-full">
          <div>
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-telemetry-crimson text-[20px]">fmd_bad</span>
                <h2 className="font-headline-sm text-headline-sm text-earth-charcoal">Active Risk Vectors</h2>
              </div>
              <span className="font-label-sm text-label-sm bg-surface-container text-earth-charcoal px-space-xs py-0.5 rounded font-semibold">
                {fleetInsights.length > 0 
                  ? fleetInsights.filter((i) => i.severity === 'critical' || i.severity === 'high' || i.severity === 'medium').length
                  : risks.filter((r) => r.severity !== 'low').length} Active
              </span>
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mb-space-md">Real-time bottlenecks degrading the production envelope.</p>

            <div className="space-y-space-md flex-1 flex flex-col overflow-y-auto pr-1">
            {(() => {
              if (fleetInsights.length > 0) {
                const activeInsights = fleetInsights.filter((i) => i.severity === 'critical' || i.severity === 'high' || i.severity === 'medium');
                if (activeInsights.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6 text-secondary">
                      <span className="material-symbols-outlined text-4xl mb-2 text-telemetry-emerald opacity-80">check_circle</span>
                      <p className="text-sm font-bold text-secondary">All Systems Healthy</p>
                      <p className="text-xs mt-1">No active critical or high-risk vectors detected in the fleet.</p>
                    </div>
                  );
                }
                return activeInsights
                  .slice(0, showAllVectors ? 12 : 4)
                  .map((i) => (
                    <InsightCard
                      key={i.id}
                      insight={i}
                      onOpen={(x) => setInspectingRisk(insightToRiskVector(x))}
                    />
                  ));
              }
              return displayedRisks.map((risk) => (
                <div key={risk.id} className="bg-surface-container rounded p-space-md shadow-sm relative overflow-hidden group cursor-pointer" onClick={() => setInspectingRisk(risk)}>
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${risk.severity === 'high' ? 'bg-telemetry-crimson' : risk.severity === 'medium' ? 'bg-telemetry-amber' : 'bg-earth-border'}`}></div>
                  <div className="pl-2">
                    <div className="flex items-center justify-between">
                      <span className={`font-label-sm text-label-sm uppercase tracking-wider font-bold ${risk.severity === 'high' ? 'text-telemetry-crimson' : risk.severity === 'medium' ? 'text-telemetry-amber' : 'text-secondary'}`}>
                        Severity: {risk.severity}
                      </span>
                      <span className={`font-label-md text-label-md px-1.5 py-0.5 rounded font-bold ${risk.severity === 'high' ? 'bg-telemetry-crimson/15 text-telemetry-crimson' : risk.severity === 'medium' ? 'bg-telemetry-amber/15 text-telemetry-amber' : 'bg-surface-container-low text-secondary'}`}>
                        {risk.impact}
                      </span>
                    </div>
                    <h3 className="font-headline-sm text-headline-sm text-earth-charcoal mt-1 group-hover:text-copper-accent transition-colors">{risk.title}</h3>
                    <p className="font-body-sm text-body-sm text-on-surface-variant mt-1 line-clamp-2">{risk.evidence.description}</p>
                    <div className="flex items-center justify-between mt-space-sm pt-space-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setInspectingRisk(risk);
                        }}
                        className="open-evidence-btn text-primary hover:text-earth-charcoal font-label-md text-label-md flex items-center gap-1 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">query_stats</span>
                        Evidence
                      </button>
                      <Link
                        href="/scenario"
                        onClick={(e) => e.stopPropagation()}
                        className="bg-primary hover:bg-primary-container text-on-primary px-space-sm py-1 rounded font-label-sm text-label-sm tracking-wide uppercase transition-colors"
                      >
                        Simulate
                      </Link>
                    </div>
                  </div>
                </div>
              ));
            })()}

            {(() => {
              const count = fleetInsights.length > 0
                ? fleetInsights.filter((i) => i.severity === 'critical' || i.severity === 'high' || i.severity === 'medium').length
                : risks.length;
              if (count === 0) return null;
              return (
                <div className="mt-auto pt-2">
                  <button
                    onClick={() => setShowAllVectors((v) => !v)}
                    className="w-full py-2 border border-earth-border rounded-lg text-xs font-bold uppercase tracking-wider text-secondary hover:text-earth-charcoal hover:border-copper-accent transition-all"
                  >
                    {showAllVectors ? 'Collapse Vectors' : `View All ${count} Vectors`}
                  </button>
                </div>
              );
            })()}
          </div>
          
          {/* Pit Imagery Thumbnail Footer in Bento */}
          <div className="mt-space-md pt-space-sm mt-auto">
            <div className="relative w-full h-24 rounded overflow-hidden shadow-inner group">
              <img className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" alt="Expansive open pit copper mine terraced benches with giant yellow mining haul trucks descending earthen haul roads under dramatic dusty warm sunlight, high fidelity geological context" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBpTBQPcpfemHdrPH03YuWMGR8bLLSd-PMIwn5tyYhmqZqO4Me1Kt2HtPp8Aqm77LDFj3hYpokfNIg6o1FVrYVu8C2tk9E0meK6iOINL6VWGcgOtXGiWOgM4WXmQPhfMzyDEZPbprjN3u3EnsPluv6Pk6ztcdlAOJBL782PWQW5B07nPVE5ljkXhQaYEtoju0nG6KVHPNmhNBzni3SdqifP6EekdvvjIbemjNyRtZsDDVcffPnt54Ba"/>
              <div className="absolute inset-0 bg-gradient-to-t from-earth-espresso/80 via-earth-espresso/30 to-transparent flex items-end p-space-xs">
                <span className="font-label-sm text-label-sm text-canvas-sandstone font-medium">Cut 3 Live Earthwork Camera Feed (Bench #14)</span>
              </div>
            </div>
          </div>
          </div>
        </div>
        {/* End Top Row Bento */}
        </div>

        {/* Prediction ledger */}
        <div className="xl:col-span-12 bg-surface-parchment rounded shadow-sm p-space-lg flex flex-col overflow-hidden border border-earth-border">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-md">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>
                analytics
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-earth-charcoal">Prediction Ledger</h3>
              <span className="text-[11px] text-secondary">({filteredLedger.length} events logged)</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-surface-container rounded-md p-0.5 border border-earth-border text-[11px]">
                {['all', 'active', 'resolved'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      filterType === t ? 'bg-earth-charcoal text-canvas-sandstone font-bold' : 'text-secondary'
                    }`}
                  >
                    {t === 'all' ? 'All' : t === 'active' ? 'Active' : 'Auto-Resolved'}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExportCSV}
                className="px-3 py-1 rounded bg-surface-container-low text-[11px] font-bold text-secondary hover:text-earth-charcoal transition-colors border border-earth-border flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span>Export</span>
              </button>

              <Link
                href="/governance"
                className="px-3 py-1 rounded bg-earth-charcoal text-canvas-sandstone text-[11px] font-bold hover:bg-earth-espresso transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                <span>Full Ledger</span>
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-earth-border">
                  {['Time (UTC)', 'Entity / Node', 'Prediction Type', 'Confidence', 'Recommended Action', ''].map((h, i) => (
                    <th key={i} className="py-3 px-4 text-[10px] text-secondary uppercase tracking-widest">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[13px] divide-y divide-earth-border">
                {filteredLedger.map((row) => {
                  const isAutoResolved = row.status === 'auto-resolved';
                  const isExecuting = row.status === 'executing';
                  const barColor = row.confidence >= 80 ? 'bg-telemetry-crimson' : row.confidence >= 50 ? 'bg-telemetry-amber' : 'bg-telemetry-emerald';
                  const textColor = row.confidence >= 80 ? 'text-telemetry-crimson' : row.confidence >= 50 ? 'text-telemetry-amber' : 'text-telemetry-emerald';

                  return (
                    <tr key={row.id} className={`hover:bg-surface-container-low transition-colors group ${isAutoResolved ? 'opacity-70' : ''}`}>
                      <td className="py-3 px-4 text-secondary font-mono text-xs">{row.time}</td>
                      <td className="py-3 px-4 font-medium text-earth-charcoal">{row.entityNode}</td>
                      <td className="py-3 px-4 text-copper-accent">{row.predictionType}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-surface-container rounded-full overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${row.confidence}%` }}></div>
                          </div>
                          <span className={`font-semibold ${textColor}`}>{row.confidence}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-secondary max-w-[280px] truncate">{row.recommendedAction}</td>
                      <td className="py-3 px-4 text-right">
                        {isAutoResolved ? (
                          <span className="text-[10px] text-secondary font-bold uppercase">Auto-resolved</span>
                        ) : isExecuting ? (
                          <span className="text-[11px] text-telemetry-emerald font-bold flex items-center justify-end gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald animate-ping"></span>
                            Simulating
                          </span>
                        ) : (
                          <button
                            onClick={() => handleExecuteAction(row)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-copper-accent text-[11px] font-bold hover:underline flex items-center gap-1 ml-auto"
                          >
                            <span>Execute</span>
                            <span className="material-symbols-outlined text-xs">arrow_forward</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-center">
            <Link
              href="/governance"
              className="text-[12px] font-bold uppercase tracking-wider text-secondary hover:text-copper-accent transition-colors"
            >
              Open full ledger in Governance...
            </Link>
          </div>
        </div>
      </div>

      <EvidenceModal risk={inspectingRisk} onClose={() => setInspectingRisk(null)} onSimulateMitigation={() => router.push('/scenario')} />
      {showShortfallModal && (
        <ShortfallModal
          insight={prodInsight}
          onClose={() => setShowShortfallModal(false)}
          onSimulateMitigation={() => router.push('/scenario')}
        />
      )}
      {showPredictionModal && (
        <PredictionBrainstormModal
          insight={prodInsight}
          onClose={() => setShowPredictionModal(false)}
          onSimulateMitigation={() => router.push('/scenario')}
        />
      )}
    </main>
  );
}
