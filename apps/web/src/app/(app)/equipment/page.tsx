'use client';

/**
 * Equipment health — decision-first view.
 * Structure: health summary → needs-attention cards (conclusion-first) →
 * action-first registry. Technical values live in the machine modal.
 */
import React, { useMemo, useState } from 'react';
import { useMineId } from '@/lib/useMineId';
import { useFleetInsights } from '@/lib/hooks';
import { Card, PageHeader, Pill } from '@/components/mobile/ui';
import { SeverityChip, HealthSummary, InsightCard } from '@/components/minex/insight';
import { relTime, type Insight, type Severity } from '@/lib/insight';

type SevFilter = 'all' | 'attention' | 'medium' | 'low';
const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4 };

function primaryRisk(i: Insight): string {
  return i.issue ?? i.reasons[0]?.label ?? 'Under assessment';
}
function primaryWhy(i: Insight): string {
  return i.reasons[0]?.text ?? 'Awaiting telemetry';
}
function actionLabel(i: Insight): string {
  return i.action?.label ?? 'Monitor';
}

export default function EquipmentPage() {
  const mineId = useMineId();
  const { insights, summary, loading } = useFleetInsights(mineId);
  const [filter, setFilter] = useState<SevFilter>('all');

  const sorted = useMemo(
    () => [...insights].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]),
    [insights]
  );
  const filtered = useMemo(() => {
    if (filter === 'all') return sorted;
    if (filter === 'attention') return sorted.filter((i) => i.severity === 'critical' || i.severity === 'high');
    if (filter === 'medium') return sorted.filter((i) => i.severity === 'medium');
    return sorted.filter((i) => i.severity === 'low' || i.severity === 'healthy');
  }, [sorted, filter]);

  return (
    <main className="flex-1 bg-page min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      <PageHeader
        kicker="Fleet"
        title="Equipment health"
        subtitle={`${mineId} — which machines need attention, why, and what to do`}
        right={
          <div className="flex items-center gap-2 bg-panel2 px-3 py-1.5 rounded-full border border-line">
            <span className={`w-2 h-2 rounded-full ${loading ? 'bg-warn animate-pulse' : 'bg-ok animate-pulse'}`} />
            <span className="text-[10px] font-bold text-ink2 uppercase tracking-wider">
              {loading ? 'Assessing…' : `${insights.length} machines assessed`}
            </span>
          </div>
        }
      />

      {/* Health summary */}
      <HealthSummary summary={summary} total={insights.length} />

      {/* Needs attention — conclusion-first cards */}
      <section className="mt-7">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink2">
            Needs attention
          </h2>
          <span className="text-[10px] text-ink3">Most urgent first · tap a card for evidence</span>
        </div>
        {loading ? (
          <Card className="text-center text-xs text-ink3">Assessing fleet…</Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {sorted
              .filter((i) => i.severity === 'critical' || i.severity === 'high')
              .slice(0, 6)
              .map((i) => <InsightCard key={i.id} insight={i} />)}
            {sorted.filter((i) => i.severity === 'critical' || i.severity === 'high').length === 0 && (
              <Card className="md:col-span-2 xl:col-span-3 text-center py-8">
                <span className="material-symbols-outlined text-okt text-4xl">check_circle</span>
                <p className="mt-2 text-sm font-medium text-ink">No machines need immediate attention.</p>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* Machine registry — action-first columns */}
      <section className="mt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink2 flex items-center gap-2">
            <span className="material-symbols-outlined !text-[16px] text-inkb">precision_manufacturing</span>
            All machines
            <span className="text-[11px] text-ink3 font-normal normal-case">({filtered.length})</span>
          </h2>
          <div className="flex gap-2">
            <Pill active={filter === 'all'} onClick={() => setFilter('all')}>All</Pill>
            <Pill active={filter === 'attention'} onClick={() => setFilter('attention')}>Attention</Pill>
            <Pill active={filter === 'medium'} onClick={() => setFilter('medium')}>Watch</Pill>
            <Pill active={filter === 'low'} onClick={() => setFilter('low')}>Normal</Pill>
          </div>
        </div>

        <div className="rounded-[24px] bg-deep2 border border-line p-5 shadow-xl overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-line">
                {['Machine', 'Status', 'Primary risk', 'Why', 'Impact', 'Recommended', 'Last update'].map((h) => (
                  <th key={h} className="py-2.5 px-3 text-[10px] text-ink3 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="text-[13px] divide-y divide-line/60">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-panel3/40 transition-colors align-top">
                  <td className="py-3 px-3 font-medium text-ink font-mono text-xs whitespace-nowrap">{m.id}</td>
                  <td className="py-3 px-3">
                    <SeverityChip severity={m.severity} />
                  </td>
                  <td className="py-3 px-3 text-ink">{primaryRisk(m)}</td>
                  <td className="py-3 px-3 text-ink2 max-w-[220px]">{primaryWhy(m)}</td>
                  <td className="py-3 px-3 text-ink2 whitespace-nowrap">{m.impact ?? '—'}</td>
                  <td className="py-3 px-3 text-ink max-w-[200px]">{actionLabel(m)}</td>
                  <td className="py-3 px-3 text-ink3 whitespace-nowrap">{relTime(m.freshness.lastUpdate)}</td>
                </tr>
              ))}
              {!filtered.length && !loading && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-ink3">
                    No machines in this view. Start the API on :8000 for live assessments.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] text-ink3">
          Status reflects the failure-risk assessment from the latest telemetry. Some readings are simulated — treat assessments as indicative.
        </p>
      </section>
    </main>
  );
}
