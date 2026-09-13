'use client';

/**
 * m/production — P50 hero, compact forecast bars, shortfall, risk cards, ledger list.
 */
import React, { useMemo } from 'react';
import { useMineId } from '@/lib/useMineId';
import { useForecastSummary, useLedgerList, useRiskVectors } from '@/lib/hooks';
import { Card, PageHeader, SeverityBadge } from '@/components/mobile/ui';

export default function MobileProduction() {
  const mineId = useMineId();
  const { p50, shortfallProb, bars } = useForecastSummary(mineId);
  const risks = useRiskVectors(mineId);
  const ledger = useLedgerList(10);

  const maxVal = useMemo(() => Math.max(...bars.map((b) => b.heightPercent), 1), [bars]);

  return (
    <div className="animate-fadeIn">
      <PageHeader kicker="Command Center" title="Production" subtitle={`${mineId} · P50 forecast + risks`} />

      {/* P50 hero */}
      <Card className="!p-4 mb-3 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(var(--tk-ink3) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-ink2 uppercase tracking-wider">P50 Forecast</span>
            <span className="px-2 py-0.5 rounded-full bg-ok/20 border border-ok text-okt text-[9px] font-bold">
              FRESH
            </span>
          </div>
          <div className="flex items-end justify-between mt-1">
            <div className="font-['Space_Grotesk'] text-4xl font-bold text-accentt leading-none">
              {p50 != null ? (p50 >= 1000 ? `${(p50 / 1000).toFixed(1)} kt` : `${Math.round(p50)} t`) : '...'}
            </div>
            <div className={`text-xs font-bold ${shortfallProb != null && shortfallProb >= 50 ? 'text-dangert' : 'text-warnt'}`}>
              Shortfall {shortfallProb != null ? `${shortfallProb}%` : '...'}
            </div>
          </div>

          {/* Compact bars */}
          <div className="h-24 flex items-end gap-1 mt-4">
            {bars.map((b, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t-sm relative overflow-hidden ${
                  b.isPeak
                    ? 'bg-accent/85 border-t border-accent'
                    : b.projected
                    ? 'bg-panel4/50 border-t border-dashed border-accent/50'
                    : 'bg-panel4/60'
                }`}
                style={{ height: `${Math.max(6, (b.heightPercent / maxVal) * 100)}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-ink3 mt-1">
            <span>{bars[0]?.time?.slice(0, 5) ?? ''}</span>
            <span>Next shift (proj.)</span>
          </div>
        </div>
      </Card>

      {/* Risk vectors */}
      <div className="text-[10px] font-bold text-ink3 uppercase tracking-widest mt-4 mb-2">
        Active Risks ({risks.length})
      </div>
      <div className="flex flex-col gap-2.5">
        {risks.slice(0, 4).map((r) => (
          <Card key={r.id} className={`!p-3.5 border-l-4 ${
            r.severity === 'high' ? 'border-l-danger' : r.severity === 'medium' ? 'border-l-warn' : 'border-l-line3'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-ink leading-snug">{r.title}</span>
              <SeverityBadge severity={r.severity} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-ink2">
              <span>Impact {r.impact}</span>
              <span className="font-bold text-accentt">{r.confidence}% conf</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Ledger list */}
      <div className="text-[10px] font-bold text-ink3 uppercase tracking-widest mt-5 mb-2">
        Prediction Ledger ({ledger.length})
      </div>
      <div className="flex flex-col gap-2">
        {ledger.slice(0, 8).map((e) => (
          <Card key={e.id} className="!p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-ink truncate">{e.entityNode}</span>
              <span className="text-[10px] text-ink3 font-mono">{e.time}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-inkb">{e.predictionType}</span>
              <span
                className={`text-[11px] font-bold ${
                  e.confidence >= 80 ? 'text-dangert' : e.confidence >= 50 ? 'text-warnt' : 'text-okt'
                }`}
              >
                {e.confidence}%
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
