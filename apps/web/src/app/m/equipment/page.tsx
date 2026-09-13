'use client';

/**
 * m/equipment — risk filter chips + machine cards (conclusion-first).
 */
import React, { useMemo, useState } from 'react';
import { useMineId } from '@/lib/useMineId';
import { useFleetInsights } from '@/lib/hooks';
import { Card, PageHeader, Pill } from '@/components/mobile/ui';
import { InsightCard } from '@/components/minex/insight';
import type { Severity } from '@/lib/insight';

type SevFilter = 'all' | 'attention' | 'medium' | 'low';
const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4 };

export default function MobileEquipment() {
  const mineId = useMineId();
  const { insights, loading } = useFleetInsights(mineId);
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
    <div className="animate-fadeIn pb-8">
      <PageHeader kicker="Fleet" title="Equipment" subtitle={`${mineId} · 24h failure risk`} />

      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-3">
        <Pill active={filter === 'all'} onClick={() => setFilter('all')}>
          All {insights.length}
        </Pill>
        <Pill active={filter === 'attention'} onClick={() => setFilter('attention')}>
          Attention
        </Pill>
        <Pill active={filter === 'medium'} onClick={() => setFilter('medium')}>
          Watch
        </Pill>
        <Pill active={filter === 'low'} onClick={() => setFilter('low')}>
          Normal
        </Pill>
      </div>

      {loading && <Card className="text-center text-xs text-ink3">Assessing fleet…</Card>}
      {!loading && !filtered.length && (
        <Card className="text-center text-xs text-ink3">
          No machines match.
        </Card>
      )}

      <div className="flex flex-col gap-3">
        {filtered.map((i) => (
          <InsightCard key={i.id} insight={i} />
        ))}
      </div>
    </div>
  );
}
