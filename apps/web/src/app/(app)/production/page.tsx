'use client';

/**
 * Production Command Center — ported from the Stitch design and wired to the
 * live API: forecast bars from /production/{mine}/forecast + /history,
 * risk vectors from /production/{mine}/shortfall + /equipment/{mine}/fleet,
 * and the prediction ledger from /ledger. Falls back to synthetic data.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useMineId } from '@/lib/useMineId';
import { EvidenceModal, ShortfallModal, PredictionBrainstormModal } from '@/components/minex/Modals';
import { InsightCard } from '@/components/minex/insight';
import { useFleetInsights } from '@/lib/hooks';
import { buildProductionInsight, insightToRiskVector, formatUtilization, type ProductionInsight } from '@/lib/insight';
import { apiFetch } from '@/lib/api';
import {
  FALLBACK_FORECAST,
  formatTonnes,
  FALLBACK_LEDGER,
  FALLBACK_RISKS,
  mapForecastToBars,
  mapLedger,
  type ProductionDataPoint,
  type PredictionLedgerEntry,
  type RiskVector,
} from '@/lib/minex';

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
  const mineId = useMineId();
  const router = useRouter();

  const [bars, setBars] = useState<ProductionDataPoint[]>(FALLBACK_FORECAST);
  const [risks, setRisks] = useState<RiskVector[]>(FALLBACK_RISKS);
  const [ledger, setLedger] = useState<PredictionLedgerEntry[]>(FALLBACK_LEDGER);
  const [p50, setP50] = useState(42.8);
  const [shortfallProb, setShortfallProb] = useState(14);
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
    link.setAttribute('download', `minex_prediction_ledger_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Prediction Ledger CSV exported successfully');
  };

  return (
    <main id="production-view-root" className="flex-1 transition-all duration-300 bg-deep min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-accent text-onaccent px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined text-base">check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Demo Mode / Synthetic Benchmark Banner */}
      <div className="mb-6 p-3 rounded-xl bg-accentt/10 border border-accentt/25 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-ink">
          <span className="w-2.5 h-2.5 rounded-full bg-accentt animate-pulse"></span>
          <span className="font-bold uppercase tracking-wider text-accentt">Synthetic Operational Benchmark</span>
          <span className="text-ink3 hidden sm:inline">· Production data based on Indian mineral baseline (21.95°N, 79.25°E)</span>
        </div>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-panel3 border border-line text-ink2">
          DGMS BENCHMARK
        </span>
      </div>

      {/* Header */}
      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-ink3 tracking-widest uppercase">Command Center</span>
            <span className="text-ink3">/</span>
            <span className="text-[11px] font-bold text-accentt tracking-widest uppercase">Live View</span>
          </div>
          <h1 className="font-['Manrope'] text-3xl md:text-4xl font-bold text-ink tracking-tight">
            Production Forecasting
          </h1>
          <p className="text-sm text-ink2 mt-1 max-w-2xl">
            Real-time predictive models analyzing haulage, processing, and environmental variables across {mineId} operations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-panel4/40 px-3 py-1.5 rounded-full border border-line2/30">
            <span className="w-2 h-2 rounded-full bg-ok animate-pulse"></span>
            <span className="text-[10px] font-bold text-ink2 uppercase tracking-wider">Live Sync Active</span>
          </div>

          <Link
            href="/scenario"
            className="bg-accent3 text-onaccent text-xs font-bold uppercase tracking-wider py-2.5 px-6 rounded-[18px] hover:bg-accent transition-all shadow-lg flex items-center gap-2 h-11 active:scale-95 shadow-accent3/20"
          >
            <span className="material-symbols-outlined text-[18px]">model_training</span>
            <span>Find feasible response</span>
          </Link>
        </div>
      </header>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 auto-rows-min">
        {/* Forecast hero */}
        <section className="lg:col-span-8 rounded-[24px] liquid-glass border border-white/5 relative overflow-hidden flex flex-col lg:min-h-[580px] min-h-[460px] p-6 md:p-8">
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(var(--tk-ink3) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          ></div>

          <details className="z-10 mt-4 text-[11px] text-ink3" open>
            <summary className="cursor-pointer select-none font-semibold text-ink2 hover:text-ink transition-colors flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[14px] text-accentt">tune</span>
              Dual Signals: Volume Variance vs. Event Probability
            </summary>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono">
              <div className="p-2.5 rounded-xl bg-deep2/80 border border-line2/40">
                <div className="text-[10px] text-ink3 uppercase font-sans font-bold flex items-center justify-between">
                  <span>Forecast Gap (Plan vs P50)</span>
                  <span className="text-[9px] px-1.5 py-0.2 rounded bg-panel3 text-ink2">Volume Delta</span>
                </div>
                <div className={`text-sm font-bold mt-1 ${(forecastGap?.tonnes ?? 0) > 0 ? 'text-warnt' : 'text-okt'}`}>
                  {forecastGap
                    ? `${forecastGap.tonnes > 0 ? '−' : '+'}${Math.abs(forecastGap.tonnes)} t (${forecastGap.percentage > 0 ? '−' : '+'}${Math.abs(forecastGap.percentage)}%)`
                    : '—'}
                </div>
                <div className="text-[10px] text-ink3 font-sans mt-0.5">Physical shortfall gap between planned shift target and median regression</div>
              </div>
              <div className="p-2.5 rounded-xl bg-deep2/80 border border-line2/40">
                <div className="text-[10px] text-ink3 uppercase font-sans font-bold flex items-center justify-between">
                  <span>Shortfall Risk (Classifier)</span>
                  <span className={`text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ${
                    shortfallProb >= 30 ? 'bg-danger/20 text-dangert' : 'bg-ok/20 text-okt'
                  }`}>
                    {shortfallProb >= 30 ? 'Alert ≥ 30%' : 'Normal'}
                  </span>
                </div>
                <div className={`text-sm font-bold mt-1 ${shortfallProb >= 30 ? 'text-dangert' : 'text-okt'}`}>
                  {shortfallProb}% probability
                </div>
                <div className="text-[10px] text-ink3 font-sans mt-0.5">Calibrated logistic baseline · independent probabilistic shortfall event model</div>
              </div>
            </div>
          </details>
          <div className="z-10 flex-1 flex flex-col justify-between mt-3">
            <div
              className="flex justify-between items-start mb-4 cursor-pointer hover:bg-white/5 p-2 -m-2 rounded-xl transition-colors group"
              onClick={() => setShowShortfallModal(true)}
              title="Click to view full shortfall analysis"
            >
              <div>
                <h2 className="font-['Manrope'] text-2xl font-semibold text-ink mb-1 group-hover:text-accentt transition-colors flex items-center gap-2">
                  Expected production
                  <span className="material-symbols-outlined text-lg opacity-0 group-hover:opacity-100 transition-opacity">open_in_new</span>
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-ok/20 border border-ok text-okt text-[10px] font-bold flex items-center gap-1" title="Latest telemetry received">
                    <span className="w-1.5 h-1.5 rounded-full bg-okt"></span>
                    Live data
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-line text-ink2 text-[10px] border border-line2/30" title="Some readings in this assessment are simulated. Treat results as indicative.">
                    Includes simulated readings
                  </span>
                </div>
              </div>

              <div className="text-right">
                <div className="font-['Space_Grotesk'] text-5xl md:text-6xl font-bold text-accentt tracking-tighter leading-none group-hover:scale-105 origin-right transition-transform">
                  {prodInsight?.expected ?? formatTonnes(p50)}
                </div>
                <div className="text-[11px] font-semibold text-ink3 uppercase tracking-wider mt-1">
                  Expected · {prodInsight?.horizonLabel ?? RANGE_PARAMS[timelineRange].label}
                </div>
                <div className={`text-sm font-semibold flex items-center justify-end gap-1 mt-1 ${
                  (prodInsight?.state ?? 'on_track') === 'on_track' ? 'text-okt' : 'text-warnt'
                }`}>
                  <span className="material-symbols-outlined text-[16px]">
                    {(prodInsight?.state ?? 'on_track') === 'on_track' ? 'check_circle' : 'trending_down'}
                  </span>
                  {prodInsight?.stateLabel ?? 'Assessing…'}
                </div>
              </div>
            </div>

            {/* WHY — main drivers from the forecast model */}
            {prodInsight && prodInsight.drivers.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] font-bold text-ink3 uppercase tracking-widest mb-1">Main drivers</div>
                <ul className="flex flex-wrap gap-x-5 gap-y-1">
                  {prodInsight.drivers.map((d, i) => (
                    <li key={i} className="text-xs text-ink2 flex items-center gap-1.5">
                      <span className={`material-symbols-outlined !text-[14px] ${d.direction === 'negative' ? 'text-dangert' : 'text-okt'}`}>
                        {d.direction === 'negative' ? 'south' : 'north'}
                      </span>
                      {d.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Range selector */}
            <div className="mt-4 flex items-center justify-end gap-2">
              <span className="text-[10px] font-bold text-ink3 uppercase tracking-widest mr-1">Range</span>
              <div className="inline-flex rounded-lg border border-line2/40 bg-page/60 p-0.5 gap-0.5">
                {RANGE_OPTIONS.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTimelineRange(key)}
                    aria-pressed={timelineRange === key}
                    className={`px-3 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      timelineRange === key
                        ? 'bg-accent/85 text-deep2 shadow'
                        : 'text-ink3 hover:text-ink2'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 w-full mt-6 relative min-h-[240px]">
              {/* Horizontal grid lines */}
              <div className="absolute top-0 left-0 right-0 bottom-14 flex flex-col justify-between pointer-events-none">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="border-b border-line/60 w-full h-0"></div>
                ))}
              </div>

              <div className="absolute top-0 left-0 right-0 bottom-14 flex items-end gap-[3px]">
              {isLoading ? (
                /* ── Skeleton shimmer bars ── */
                <>
                  {SKELETON_HEIGHTS.map((h, i) => (
                    <div
                      key={i}
                      className="flex-1 min-w-0 rounded-t-sm relative overflow-hidden"
                      style={{ height: `${h}%` }}
                    >
                      {/* Base dark fill */}
                      <div className="absolute inset-0 bg-line/30 rounded-t-sm" />
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
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-deep2 border border-accent text-ink px-3 py-1.5 rounded-lg text-xs shadow-2xl z-20 pointer-events-none">
                      <div className="font-bold text-accentt">{bars[hoveredBarIndex].time}</div>
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
                          className="flex-1 min-w-0 bg-accent/85 rounded-t-sm relative group shadow-[0_0_20px_rgba(255,197,111,0.3)] border-t border-accent transition-all hover:scale-y-105"
                          style={{ height: `${bar.heightPercent}%` }}
                        >
                          <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-bold text-accentt whitespace-nowrap">
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
                          className="flex-1 min-w-0 bg-panel4/40 rounded-t-sm relative group border-t border-dashed border-accent/60 transition-all hover:bg-panel4/70 cursor-pointer"
                          style={{ height: `${bar.heightPercent}%` }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              backgroundImage:
                                'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,197,111,0.12) 4px, rgba(255,197,111,0.12) 8px)',
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
                        className="flex-1 min-w-0 bg-panel4/40 rounded-t-sm relative group transition-all hover:bg-inkb/20"
                        style={{ height: `${bar.heightPercent}%` }}
                      >
                        <div className="absolute inset-0 bg-inkb/10 group-hover:bg-inkb/30 transition-colors"></div>
                      </div>
                    );
                  })}
                </>
              )}
              </div>

              <div className="absolute bottom-0 left-0 right-0 h-14 pt-3 flex items-start">
                {isLoading ? (
                  <div className="w-full flex justify-between text-[11px] text-ink3">
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
                      <div key={index} className="flex-1 flex justify-center text-[10px] text-ink3 whitespace-nowrap overflow-visible">
                        {show ? (bar.projected ? `${bar.time} (Proj.)` : bar.time) : ''}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Risk vectors */}
        <section className="lg:col-span-4 rounded-[24px] bg-page border border-line2/30 p-6 flex flex-col shadow-xl lg:h-[520px]">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-line2/30">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-warnt" style={{ fontVariationSettings: "'FILL' 1" }}>
                warning
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Active Risk Vectors</h3>
            </div>
            <span className="text-[10px] bg-danger/20 text-dangert border border-danger/40 px-2 py-0.5 rounded-full font-bold">
              {fleetInsights.length > 0 
                ? fleetInsights.filter((i) => i.severity === 'critical' || i.severity === 'high').length
                : risks.filter((r) => r.severity === 'high').length} Critical
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-3 overflow-y-auto pr-1">
            {(() => {
              if (fleetInsights.length > 0) {
                const activeInsights = fleetInsights.filter((i) => i.severity === 'critical' || i.severity === 'high' || i.severity === 'medium');
                if (activeInsights.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-full text-center p-6 text-ink3">
                      <span className="material-symbols-outlined text-4xl mb-2 text-okt opacity-80">check_circle</span>
                      <p className="text-sm font-bold text-ink2">All Systems Healthy</p>
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
                <div
                  key={risk.id}
                  className={`dark-glass rounded-lg p-3 border-l-2 ${
                    risk.severity === 'high' ? 'border-l-danger' : risk.severity === 'medium' ? 'border-l-warn' : 'border-l-line3'
                  } hover:bg-panel4/30 transition-all cursor-pointer group`}
                  onClick={() => setInspectingRisk(risk)}
                >
                  <div className="flex justify-between items-start mb-1.5">
                    <div className="text-sm font-medium text-ink group-hover:text-accentt transition-colors">{risk.title}</div>
                    <span
                      className={`bg-page px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                        risk.severity === 'high' ? 'text-dangert border-danger/30' : 'text-warnt border-warn/30'
                      }`}
                    >
                      {risk.confidence}% conf
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[11px] text-ink2">Impact: {risk.impact}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectingRisk(risk);
                      }}
                      className="text-[11px] font-bold text-inkb hover:text-ink flex items-center gap-1 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">policy</span>
                      <span>Inspect evidence</span>
                    </button>
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
                    className="w-full py-2 border border-line3 rounded-lg text-xs font-bold uppercase tracking-wider text-inkb hover:text-ink hover:border-accent transition-all"
                  >
                    {showAllVectors ? 'Collapse Vectors' : `View All ${count} Vectors`}
                  </button>
                </div>
              );
            })()}
          </div>
        </section>

        {/* Prediction ledger */}
        <section className="lg:col-span-12 rounded-[24px] bg-deep2 border border-line p-6 overflow-hidden flex flex-col shadow-2xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-inkb" style={{ fontVariationSettings: "'FILL' 1" }}>
                analytics
              </span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-ink">Prediction Ledger</h3>
              <span className="text-[11px] text-ink3">({filteredLedger.length} events logged)</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-panel2 rounded-md p-0.5 border border-line2/30 text-[11px]">
                {['all', 'active', 'resolved'].map((t) => (
                  <button
                    key={t}
                    onClick={() => setFilterType(t)}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      filterType === t ? 'bg-chipon text-inkb font-bold' : 'text-ink2'
                    }`}
                  >
                    {t === 'all' ? 'All' : t === 'active' ? 'Active' : 'Auto-Resolved'}
                  </button>
                ))}
              </div>

              <button
                onClick={handleExportCSV}
                className="px-3 py-1 rounded bg-panel4 text-[11px] font-bold text-ink2 hover:text-ink transition-colors border border-line2/30 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                <span>Export</span>
              </button>

              <Link
                href="/governance"
                className="px-3 py-1 rounded bg-accent3 text-onaccent text-[11px] font-bold hover:bg-accent transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                <span>Full Ledger</span>
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line">
                  {['Time (UTC)', 'Entity / Node', 'Prediction Type', 'Confidence', 'Recommended Action', ''].map((h, i) => (
                    <th key={i} className="py-3 px-4 text-[10px] text-ink3 uppercase tracking-widest">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[13px] divide-y divide-line/50">
                {filteredLedger.map((row) => {
                  const isAutoResolved = row.status === 'auto-resolved';
                  const isExecuting = row.status === 'executing';
                  const barColor = row.confidence >= 80 ? 'bg-danger' : row.confidence >= 50 ? 'bg-warn' : 'bg-ok';
                  const textColor = row.confidence >= 80 ? 'text-dangert' : row.confidence >= 50 ? 'text-warnt' : 'text-okt';

                  return (
                    <tr key={row.id} className={`hover:bg-panel4/30 transition-colors group ${isAutoResolved ? 'opacity-70' : ''}`}>
                      <td className="py-3 px-4 text-ink2 font-mono text-xs">{row.time}</td>
                      <td className="py-3 px-4 font-medium text-ink">{row.entityNode}</td>
                      <td className="py-3 px-4 text-inkb">{row.predictionType}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-panel2 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${row.confidence}%` }}></div>
                          </div>
                          <span className={`font-semibold ${textColor}`}>{row.confidence}%</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-ink2 max-w-[280px] truncate">{row.recommendedAction}</td>
                      <td className="py-3 px-4 text-right">
                        {isAutoResolved ? (
                          <span className="text-[10px] text-ink3 font-bold uppercase">Auto-resolved</span>
                        ) : isExecuting ? (
                          <span className="text-[11px] text-okt font-bold flex items-center justify-end gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-ok animate-ping"></span>
                            Simulating
                          </span>
                        ) : (
                          <button
                            onClick={() => handleExecuteAction(row)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-accentt text-[11px] font-bold hover:underline flex items-center gap-1 ml-auto"
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
              className="text-[12px] font-bold uppercase tracking-wider text-ink3 hover:text-accentt transition-colors"
            >
              Open full ledger in Governance...
            </Link>
          </div>
        </section>
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
