'use client';

/**
 * insight.tsx — reusable decision-support components.
 * Default hierarchy (spec #9):
 *   CONCLUSION → SEVERITY → WHY → IMPACT → RECOMMENDED ACTION → EVIDENCE → TECHNICAL DETAILS
 * Raw numbers/model metadata live only inside <TechnicalDetails>.
 */
import React, { useState } from 'react';
import { severityTone, type Insight, type Severity } from '@/lib/insight';

const TONE_CHIP: Record<string, string> = {
  danger: 'bg-danger/15 text-dangert border-danger/40',
  warn: 'bg-warn/15 text-warnt border-warn/40',
  ok: 'bg-ok/15 text-okt border-ok/40',
  neutral: 'bg-panel2 text-ink2 border-line3/40',
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
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wider ${TONE_CHIP[tone]}`}>
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
        className="text-[10px] font-bold uppercase tracking-wider text-ink3 hover:text-accentt transition-colors flex items-center gap-1"
      >
        <span className="material-symbols-outlined !text-[13px]">science</span>
        Technical details
        <span className="material-symbols-outlined !text-[13px]">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="mt-2 bg-deep2 border border-line rounded-xl p-3 text-[10px] text-ink2 font-mono space-y-1">
          <div>model: {insight.technical.modelVersion}</div>
          <div>probability: {insight.technical.probability.toFixed(3)}</div>
          <div>data: SYNTHETIC (simulated readings)</div>
          {insight.technical.contributions.length > 0 && (
            <div className="pt-1">
              <div className="text-ink3 uppercase tracking-wider">top contributions (coef × standardized value)</div>
              <table className="w-full mt-1">
                <tbody>
                  {insight.technical.contributions.map((c) => (
                    <tr key={c.feature}>
                      <td className="pr-2 truncate max-w-[140px]">{c.feature}</td>
                      <td className="pr-2 text-right text-ink3">{c.rawValue}{c.unit ? ` ${c.unit}` : ''}{c.normalRange ? ` (${c.normalRange})` : ''}</td>
                      <td className="pr-2 text-right">z={c.standardizedValue}</td>
                      <td className={`text-right ${c.direction === 'up' ? 'text-dangert' : 'text-okt'}`}>
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
      <div className="text-[10px] font-bold text-ink2 uppercase tracking-widest mb-1.5">Why this was flagged</div>
      <ul className="space-y-1">
        {reasons.map((r, i) => (
          <li key={i} className="flex gap-2 text-xs text-ink leading-snug">
            <span className="material-symbols-outlined !text-[14px] text-ink3 mt-0.5 shrink-0">
              {r.source === 'maintenance' ? 'build' : 'sensors'}
            </span>
            <span>
              <span className="font-semibold">{r.label}</span> — {r.text}
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
    <div className="bg-accent/10 border border-accent/40 rounded-xl p-3">
      <div className="text-[10px] font-bold text-accentt uppercase tracking-widest mb-0.5">Recommended action</div>
      <div className="text-sm font-bold text-ink leading-snug">{action.label}.</div>
      {action.detail && <div className="text-[11px] text-ink2 mt-0.5">{action.detail}</div>}
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
      className={`rounded-2xl border bg-panel p-4 transition-all cursor-pointer hover:border-accent/50 ${
        tone === 'danger' ? 'border-l-4 border-l-danger border-line'
        : tone === 'warn' ? 'border-l-4 border-l-warn border-line'
        : 'border-line'
      }`}
    >
      {/* CONCLUSION + SEVERITY */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <SeverityChip severity={insight.severity} label={sevLabel} />
        <span className="text-[10px] text-ink3 font-mono uppercase">{insight.state === 'action_required' ? 'ACTION REQUIRED' : insight.state === 'watch' ? 'WATCH' : 'INFO'}</span>
      </div>

      <div className="text-sm font-bold text-ink">
        {insight.id} · <span className="capitalize">{insight.equipment_type}</span>
      </div>
      {insight.issue && (
        <div className="text-sm text-ink mt-0.5">{insight.issue}</div>
      )}
      {insight.timeframe && (
        <div className="text-[11px] text-ink3 mt-0.5">{insight.timeframe}</div>
      )}

      {/* WHY */}
      {insight.reasons.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-line">
          <WhyBlock reasons={insight.reasons} />
        </div>
      )}

      {/* IMPACT */}
      {insight.impact && (
        <div className="mt-2.5 text-xs text-ink2">
          <span className="font-bold uppercase tracking-wider text-[10px] text-ink3">Impact · </span>
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
  const items = [
    { n: need, label: 'Need immediate attention', color: 'text-dangert', icon: 'error' },
    { n: monitoring, label: 'Need monitoring', color: 'text-warnt', icon: 'visibility' },
    { n: normal, label: 'Operating normally', color: 'text-okt', icon: 'check_circle' },
  ];
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl bg-panel border border-line p-4">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink3">
            <span className={`material-symbols-outlined !text-[15px] ${it.color}`}>{it.icon}</span>
            <span className={`truncate ${it.color}`}>{it.label}</span>
          </div>
          <div className={`font-['Space_Grotesk'] text-3xl font-bold mt-1 ${it.color}`}>{it.n}</div>
          <div className="text-[10px] text-ink3 mt-0.5">of {total} machines</div>
        </div>
      ))}
    </div>
  );
}
