'use client';

/**
 * insight.tsx — reusable decision-support components.
 * Reskinned to Earthy Industrial.
 * Default hierarchy (spec #9):
 *   CONCLUSION → SEVERITY → WHY → IMPACT → RECOMMENDED ACTION → EVIDENCE → TECHNICAL DETAILS
 */
import React, { useState } from 'react';
import { severityTone, type Insight, type Severity } from '@/lib/insight';

const TONE_CHIP: Record<string, string> = {
  danger: 'bg-error-container text-telemetry-crimson border-telemetry-crimson/20',
  warn: 'bg-surface-container-high text-telemetry-amber border-telemetry-amber/20',
  ok: 'bg-surface-container text-telemetry-emerald border-telemetry-emerald/20',
  neutral: 'bg-surface-container text-secondary border-earth-border',
};
const TONE_ICON: Record<string, string> = {
  danger: 'error',
  warn: 'warning',
  ok: 'check_circle',
  neutral: 'info',
};

export function SeverityChip({ severity, label }: { severity: Severity; label?: string }) {
  const tone = severityTone(severity);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-bold uppercase tracking-wider ${TONE_CHIP[tone]}`}>
      <span className="material-symbols-outlined !text-[14px]">{TONE_ICON[tone]}</span>
      {label ?? severity.toUpperCase()}
    </span>
  );
}

/** Level-3 disclosure: model metadata + contribution provenance. */
export function TechnicalDetails({ insight }: { insight: Insight }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-copper-accent transition-colors flex items-center gap-1"
      >
        <span className="material-symbols-outlined !text-[13px]">science</span>
        Technical details
        <span className="material-symbols-outlined !text-[13px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="mt-2 bg-surface-container-low border border-earth-border rounded p-3 text-[10px] text-secondary font-mono space-y-1 shadow-inner">
          <div>model: {insight.technical.modelVersion}</div>
          <div>probability: {insight.technical.probability.toFixed(3)}</div>
          <div>data: SYNTHETIC (simulated readings)</div>
          {insight.technical.contributions.length > 0 && (
            <div className="pt-2">
              <div className="text-on-surface-variant uppercase tracking-wider font-semibold">top contributions (coef × standardized value)</div>
              <table className="w-full mt-1.5">
                <tbody>
                  {insight.technical.contributions.map((c) => (
                    <tr key={c.feature} className="border-b border-earth-border/50 last:border-0">
                      <td className="py-1 pr-2 truncate max-w-[140px] text-earth-charcoal">{c.feature}</td>
                      <td className="py-1 pr-2 text-right text-on-surface-variant">{c.rawValue}{c.unit ? ` ${c.unit}` : ''}{c.normalRange ? ` (${c.normalRange})` : ''}</td>
                      <td className="py-1 pr-2 text-right text-secondary">z={c.standardizedValue}</td>
                      <td className={`py-1 text-right font-bold ${c.direction === 'up' ? 'text-telemetry-crimson' : 'text-telemetry-emerald'}`}>
                        {c.contribution > 0 ? '+' : ''}{c.contribution}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** WHY THIS WAS FLAGGED — max 3 sourced reasons. */
export function WhyBlock({ reasons }: { reasons: Insight['reasons'] }) {
  if (!reasons.length) return null;
  return (
    <div>
      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-2">Why this was flagged</div>
      <ul className="space-y-1.5">
        {reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-[11px] text-earth-charcoal leading-snug">
            <span className="material-symbols-outlined !text-[14px] text-on-surface-variant mt-0.5 shrink-0">
              {r.source === 'maintenance' ? 'build' : 'sensors'}
            </span>
            <span>
              <span className="font-semibold text-earth-charcoal">{r.label}</span> — <span className="text-secondary">{r.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** RECOMMENDED ACTION — concrete verb first. */
export function ActionBlock({ action }: { action: Insight['action'] }) {
  if (!action) return null;
  return (
    <div className="bg-primary-container/10 border border-primary-container/30 rounded p-3">
      <div className="text-[10px] font-bold text-primary-container uppercase tracking-widest mb-1">Recommended action</div>
      <div className="text-xs font-bold text-earth-charcoal leading-snug">{action.label}.</div>
      {action.detail && <div className="text-[11px] text-secondary mt-0.5">{action.detail}</div>}
    </div>
  );
}

/**
 * Conclusion-first risk card (spec §8/§9). Clicking opens the full evidence modal.
 */
export function InsightCard({
  insight,
  onOpen,
}: {
  insight: Insight;
  onOpen?: (i: Insight) => void;
}) {
  const tone = severityTone(insight.severity);
  const sevLabel = insight.severityLabel;
  return (
    <div
      onClick={() => onOpen?.(insight)}
      className={`rounded shadow-sm border bg-surface-parchment p-4 transition-all cursor-pointer hover:bg-surface-container-low overflow-hidden relative ${
        tone === 'danger' ? 'border-telemetry-crimson/20'
        : tone === 'warn' ? 'border-telemetry-amber/20'
        : 'border-earth-border'
      }`}
    >
      {tone === 'danger' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-telemetry-crimson" />}
      {tone === 'warn' && <div className="absolute left-0 top-0 bottom-0 w-1 bg-telemetry-amber" />}

      {/* CONCLUSION + SEVERITY */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <SeverityChip severity={insight.severity} label={sevLabel} />
        <span className="text-[10px] text-on-surface-variant font-mono uppercase font-semibold">
          {insight.state === 'action_required' ? 'ACTION REQ' : insight.state === 'watch' ? 'WATCH' : 'INFO'}
        </span>
      </div>

      <div className="text-[15px] font-bold text-earth-charcoal font-['Space_Grotesk'] tracking-tight">
        {insight.id} · <span className="capitalize">{insight.equipment_type}</span>
      </div>
      {insight.issue && (
        <div className="text-xs font-semibold text-earth-charcoal mt-1">{insight.issue}</div>
      )}
      {insight.timeframe && (
        <div className="text-[10px] font-medium text-secondary mt-1">{insight.timeframe}</div>
      )}

      {/* WHY */}
      {insight.reasons.length > 0 && (
        <div className="mt-3 pt-3 border-t border-earth-border">
          <WhyBlock reasons={insight.reasons} />
        </div>
      )}

      {/* IMPACT */}
      {insight.impact && (
        <div className="mt-3 text-xs text-secondary bg-surface-container-low p-2 rounded">
          <span className="font-bold uppercase tracking-wider text-[10px] text-on-surface-variant">Impact · </span>
          {insight.impact}
        </div>
      )}
    </div>
  );
}

/** Fleet health summary strip (spec §9): X need attention / Y monitoring / Z normal. */
export function HealthSummary({
  summary,
  total,
}: {
  summary: { critical: number; high: number; medium: number; low: number };
  total: number;
}) {
  const need = summary.critical + summary.high;
  const monitoring = summary.medium;
  const normal = summary.low;
  
  // Use earthy tokens
  const items = [
    { n: need, label: 'Need immediate attention', color: 'text-telemetry-crimson', icon: 'crisis_alert' },
    { n: monitoring, label: 'Need monitoring', color: 'text-telemetry-amber', icon: 'visibility' },
    { n: normal, label: 'Operating normally', color: 'text-telemetry-emerald', icon: 'check_circle' },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {items.map((it) => (
        <div key={it.label} className="rounded shadow-sm bg-surface-container-low border border-earth-border p-4 flex items-center justify-between">
          <div className="flex flex-col">
            <span className={`text-[10px] font-bold uppercase tracking-wider ${it.color}`}>{it.label}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className={`font-['Space_Grotesk'] text-3xl font-bold ${it.color}`}>{it.n}</span>
              <span className="text-[10px] text-secondary">/ {total}</span>
            </div>
          </div>
          <span className={`material-symbols-outlined !text-[32px] opacity-20 ${it.color}`}>{it.icon}</span>
        </div>
      ))}
    </div>
  );
}
