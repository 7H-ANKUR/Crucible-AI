'use client';

/**
 * m/production — P50 hero, compact forecast bars, shortfall, risk cards, ledger list.
 * Reskinned to Earthy Industrial.
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
      <Card className="!p-4 mb-3 relative overflow-hidden bg-surface-parchment border-earth-border shadow-sm">
        <div
          className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: 'radial-gradient(var(--tk-ink3) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
        />
        <div className="relative">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">P50 Forecast</span>
            <span className="px-2 py-0.5 rounded-full bg-telemetry-emerald/20 border border-telemetry-emerald text-telemetry-emerald text-[9px] font-bold">
              FRESH
            </span>
          </div>
          <div className="flex items-end justify-between mt-1">
            <div className="font-['Space_Grotesk'] text-4xl font-bold text-copper-accent leading-none">
              {p50 != null ? (p50 >= 1000 ? `${(p50 / 1000).toFixed(1)} kt` : `${Math.round(p50)} t`) : '...'}
            </div>
            <div className={`text-xs font-bold ${shortfallProb != null && shortfallProb >= 50 ? 'text-telemetry-crimson' : 'text-telemetry-amber'}`}>
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
                    ? 'bg-copper-accent/85 border-t border-copper-accent'
                    : b.projected
                    ? 'bg-surface-container-low/50 border-t border-dashed border-copper-accent/50'
                    : 'bg-surface-container-low/60'
                }`}
                style={{ height: `${Math.max(6, (b.heightPercent / maxVal) * 100)}%` }}
              />
            ))}
          </div>
          <div className="flex justify-between text-[9px] text-secondary mt-1">
            <span>{bars[0]?.time?.slice(0, 5) ?? ''}</span>
            <span>Next shift (proj.)</span>
          </div>
        </div>
      </Card>

      {/* Risk vectors */}
      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mt-4 mb-2">
        Active Risks ({risks.length})
      </div>
      <div className="flex flex-col gap-2.5">
        {risks.slice(0, 4).map((r) => (
          <Card key={r.id} className={`!p-3.5 border-l-4 bg-surface-parchment border-y-earth-border border-r-earth-border shadow-sm ${
            r.severity === 'high' ? 'border-l-telemetry-crimson' : r.severity === 'medium' ? 'border-l-telemetry-amber' : 'border-l-earth-border'
          }`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-earth-charcoal leading-snug">{r.title}</span>
              <SeverityBadge severity={r.severity} />
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-secondary">
              <span>Impact {r.impact}</span>
              <span className="font-bold text-copper-accent">{r.confidence}% conf</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Ledger list */}
      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mt-5 mb-2">
        Prediction Ledger ({ledger.length})
      </div>
      <div className="flex flex-col gap-2">
        {ledger.slice(0, 8).map((e) => (
          <Card key={e.id} className="!p-3 bg-surface-parchment border-earth-border shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-earth-charcoal truncate">{e.entityNode}</span>
              <span className="text-[10px] text-secondary font-mono">{e.time}</span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[11px] text-secondary">{e.predictionType}</span>
              <span
                className={`text-[11px] font-bold ${
                  e.confidence >= 80 ? 'text-telemetry-crimson' : e.confidence >= 50 ? 'text-telemetry-amber' : 'text-telemetry-emerald'
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
