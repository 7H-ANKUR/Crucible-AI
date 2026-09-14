'use client';

/**
 * sections.tsx — the Command Center's major blocks.
 * Reskinned to Stitch "Earthy Industrial" design system.
 */
import React, { useState } from 'react';
import Link from 'next/link';
import {
  AttentionItem,
  Bottleneck,
  CommandSummary,
  HORIZON_LABEL,
  Projection,
  Recommendation,
  rupees,
  Signal,
  Stage,
  tonnes,
} from '@/lib/command';
import {
  Caveat,
  EvidenceBadge,
  ProvenanceBadge,
  SectionLabel,
  SeverityChip,
} from './primitives';

/* ------------------------------------------------------- operational state */

export function OperationalStateBanner({
  summary,
  onRefresh,
  refreshing,
}: {
  summary: CommandSummary;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tone = summary.state.state === 'CRITICAL' ? { bg: 'bg-gradient-to-r from-earth-espresso via-earth-charcoal to-[#3B2219]', border: 'border-telemetry-crimson', fg: 'text-white', dot: 'bg-telemetry-crimson animate-pulse', sub: 'text-[#D8CFC4]', iconBg: 'bg-telemetry-crimson/20 text-telemetry-crimson' } :
               (summary.state.state === 'WATCH' || summary.state.state === 'DISRUPTION') ? { bg: 'bg-gradient-to-r from-[#2C2114] via-earth-charcoal to-[#261E15]', border: 'border-telemetry-amber', fg: 'text-white', dot: 'bg-telemetry-amber animate-pulse', sub: 'text-[#D8CFC4]', iconBg: 'bg-telemetry-amber/20 text-telemetry-amber' } :
                                                    { bg: 'bg-gradient-to-r from-surface-container via-surface-parchment to-canvas-sandstone', border: 'border-earth-border', fg: 'text-earth-charcoal', dot: 'bg-telemetry-emerald', sub: 'text-on-surface-variant', iconBg: 'bg-surface-parchment/10 text-earth-charcoal' };
  
  const driving = summary.state.signals.filter((s) => s.severity !== 'NONE');

  return (
    <section className="w-full flex flex-col">
      <div className={`w-full px-gutter-lg py-space-md flex flex-wrap items-center justify-between gap-space-md shadow-md ${tone.bg}`}>
        <div className="flex items-center gap-space-md">
          <div className={`w-10 h-10 rounded border flex items-center justify-center ${tone.border} ${tone.iconBg}`}>
            <span className="material-symbols-outlined text-[24px]">
              {summary.state.state === 'CRITICAL' ? 'crisis_alert' : summary.state.state === 'NORMAL' ? 'check_circle' : 'warning'}
            </span>
          </div>
          <div>
            <div className="flex items-center gap-space-xs">
              <span className={`text-[10px] font-label-sm tracking-wider uppercase px-2 py-0.5 rounded font-bold ${summary.state.state === 'CRITICAL' ? 'bg-telemetry-crimson text-white' : summary.state.state === 'NORMAL' ? 'bg-telemetry-emerald text-white' : 'bg-telemetry-amber text-white'}`}>
                State: {summary.state.state}
              </span>
              <span className="font-label-sm text-label-sm text-copper-accent uppercase tracking-wider">
                Crucible AI Evaluated
              </span>
            </div>
            <h1 className={`font-headline-md text-headline-md tracking-tight mt-0.5 ${tone.fg}`}>
              {summary.state.headline}
            </h1>
            <p className={`font-body-sm text-body-sm mt-0.5 ${tone.sub}`}>
              Operational state evaluated against live constraints.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-space-sm">
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className={`flex items-center gap-space-xs px-space-md py-space-sm rounded font-label-md text-label-md transition-all disabled:opacity-50 ${
              summary.state.state !== 'NORMAL' 
                ? 'bg-surface-parchment/10 text-white border border-[#867369] hover:bg-surface-parchment/20'
                : 'bg-surface-container-high border border-earth-border text-earth-charcoal hover:bg-surface-container-highest'
            }`}
          >
            <span className={`material-symbols-outlined text-[18px] ${refreshing ? 'animate-spin' : summary.state.state !== 'NORMAL' ? 'text-copper-accent' : 'text-secondary'}`}>
              refresh
            </span>
            <span>{refreshing ? 'Checking' : 'Refresh Telemetry'}</span>
          </button>
          {driving.length > 0 && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="flex items-center gap-space-xs px-space-lg py-space-sm bg-primary hover:bg-primary-container text-white rounded font-label-md text-label-md shadow transition-all"
            >
              <span>{open ? 'Hide Drivers' : `View ${driving.length} Driver${driving.length === 1 ? '' : 's'}`}</span>
              <span className="material-symbols-outlined text-[16px]">{open ? 'expand_less' : 'expand_more'}</span>
            </button>
          )}
        </div>
      </div>

      {open && driving.length > 0 && (
        <div className={`px-gutter-lg py-space-lg border-b border-earth-border ${summary.state.state !== 'NORMAL' ? 'bg-[#2A160F]' : 'bg-surface-container-low'}`}>
          <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-3">
            {summary.state.signals.map((s) => (
              <SignalRow key={s.key} signal={s} isAlertTheme={summary.state.state !== 'NORMAL'} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SignalRow({ signal, isAlertTheme }: { signal: Signal; isAlertTheme: boolean }) {
  const body = (
    <div className={`rounded border p-3 h-full ${isAlertTheme ? 'border-[#867369]/50 bg-surface-parchment/5' : 'border-earth-border bg-surface-parchment shadow-sm'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold truncate ${isAlertTheme ? 'text-white' : 'text-earth-charcoal'}`}>{signal.label}</span>
        <SeverityChip severity={signal.severity} />
      </div>
      <p className={`mt-1.5 text-[11px] leading-snug ${isAlertTheme ? 'text-[#D8CFC4]' : 'text-on-surface-variant'}`}>{signal.reason}</p>
      <div className="mt-2 flex items-center gap-2">
        <ProvenanceBadge mode={signal.calculation_mode} />
        {signal.threshold !== null && signal.value !== null && (
          <span className={`text-[10px] tabular-nums ${isAlertTheme ? 'text-[#867369]' : 'text-secondary'}`}>
            {signal.value.toFixed(1)}
            {signal.unit === '%' ? '%' : ` ${signal.unit}`} · threshold {signal.threshold}
          </span>
        )}
      </div>
    </div>
  );

  return signal.deep_link ? (
    <Link href={signal.deep_link} className="block hover:brightness-110 transition-all">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ------------------------------------------------------ attention required */

export function AttentionQueue({
  items,
  suppressed,
  knowledgeGaps,
  onInvestigate,
}: {
  items: AttentionItem[];
  suppressed: number;
  knowledgeGaps: { key: string; label: string; reason: string; deep_link: string | null }[];
  onInvestigate: (item: AttentionItem) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="bg-surface-parchment rounded border border-earth-border p-space-md shadow-sm">
        <div className="flex items-center gap-space-sm pb-space-sm border-b border-earth-border">
          <span className="material-symbols-outlined text-copper-accent text-[20px]">notifications_active</span>
          <h2 className="font-headline-sm text-headline-sm font-semibold text-earth-charcoal">Ranked Operational Attention Queue</h2>
        </div>
        <div className="mt-space-md">
          <Caveat icon="check_circle">
            Nothing at this mine currently exceeds its operational thresholds.
          </Caveat>
        </div>
        {knowledgeGaps.length > 0 && <KnowledgeGaps gaps={knowledgeGaps} />}
      </div>
    );
  }

  return (
    <div className="bg-surface-parchment rounded border border-earth-border p-space-md shadow-sm">
      <div className="flex items-center justify-between pb-space-sm border-b border-earth-border flex-wrap gap-space-sm">
        <div className="flex items-center gap-space-sm">
          <span className="material-symbols-outlined text-copper-accent text-[20px]">notifications_active</span>
          <h2 className="font-headline-sm text-headline-sm font-semibold text-earth-charcoal">Ranked Operational Attention Queue</h2>
          <span className="bg-telemetry-crimson text-white font-label-sm text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shadow-sm">
            {items.length} Issue{items.length === 1 ? '' : 's'}
          </span>
        </div>
        <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider font-bold">
          Ranked by Severity &amp; Impact
        </span>
      </div>

      <div className="divide-y divide-earth-border mt-space-sm">
        {items.map((item, idx) => {
          const isCritical = item.severity === 'CRITICAL';
          const borderClass = isCritical ? 'border-telemetry-crimson' : 
                              item.severity === 'DISRUPTION' ? 'border-copper-accent' : 
                              'border-telemetry-amber';
          
          const rankClass = isCritical ? 'bg-telemetry-crimson/10 text-telemetry-crimson' :
                            item.severity === 'DISRUPTION' ? 'bg-copper-accent/10 text-copper-accent' :
                            'bg-telemetry-amber/10 text-telemetry-amber';

          return (
            <div
              key={item.key}
              onClick={() => onInvestigate(item)}
              className={`py-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-space-md hover:bg-surface-container-high/60 px-space-sm rounded transition-colors cursor-pointer border-l-4 ${borderClass}`}
            >
              <div className="space-y-space-xs min-w-0">
                <div className="flex items-center gap-space-sm flex-wrap">
                  <span className={`font-label-sm text-label-sm text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${rankClass}`}>
                    Rank #{idx + 1} • {item.severity}
                  </span>
                  <span className="font-mono text-[10px] text-secondary bg-surface-container-low px-1.5 py-0.5 rounded border border-earth-border/50">
                    LOC: {item.key}
                  </span>
                  {item.impact_t !== null && (
                    <span className="font-label-sm text-[10px] font-semibold text-earth-charcoal bg-surface-elevation px-1.5 py-0.5 rounded shadow-sm flex items-center gap-space-xs">
                      <span className="material-symbols-outlined text-[12px] text-telemetry-crimson">trending_down</span>
                      Impact: {tonnes(item.impact_t)}
                    </span>
                  )}
                </div>
                <h3 className="font-headline-sm text-[17px] text-earth-charcoal font-semibold truncate mt-1">
                  {item.title}
                </h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant max-w-2xl leading-relaxed">
                  {item.summary}
                </p>
                <div className="pt-space-xs flex items-center gap-space-md">
                  <EvidenceBadge quality={item.evidence_quality} />
                  {item.deep_link && (
                    <Link
                      href={item.deep_link}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[11px] font-semibold text-secondary hover:text-earth-charcoal hover:underline"
                    >
                      Investigate Data â†’
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-space-sm sm:self-center shrink-0">
                <button
                  className={`px-space-md py-space-sm rounded font-label-md text-label-md font-bold flex items-center gap-space-xs transition-all shadow-sm ${
                    isCritical
                      ? 'bg-primary-container text-on-primary-container hover:bg-primary hover:text-white'
                      : 'bg-surface-container text-earth-charcoal border border-earth-border hover:bg-surface-elevation'
                  }`}
                >
                  <span>View Plan</span>
                  <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {suppressed > 0 && (
        <p className="mt-space-sm px-space-sm font-body-sm text-[11px] text-on-surface-variant font-medium italic">
          + {suppressed} lower-priority item{suppressed === 1 ? '' : 's'} not shown.
        </p>
      )}

      {knowledgeGaps.length > 0 && <KnowledgeGaps gaps={knowledgeGaps} />}
    </div>
  );
}

function KnowledgeGaps({
  gaps,
}: {
  gaps: { key: string; label: string; reason: string; deep_link: string | null }[];
}) {
  return (
    <div className="mt-4 border-t border-earth-border pt-4">
      <SectionLabel>Not measurable</SectionLabel>
      <div className="space-y-2 mt-2">
        {gaps.map((g) => (
          <Caveat key={g.key} icon="visibility_off">
            <span className="font-semibold text-earth-charcoal">{g.label}:</span> {g.reason}
          </Caveat>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- responses */

export function RecommendationList({
  recommendations,
  blocked,
  note,
  failed,
}: {
  recommendations: Recommendation[];
  blocked: Recommendation[];
  note: string | null;
  failed?: boolean;
}) {
  const [showBlocked, setShowBlocked] = useState(false);

  return (
    <div className="bg-surface-parchment rounded border border-earth-border p-space-md shadow-sm">
      <div className="flex items-center justify-between pb-space-sm border-b border-earth-border flex-wrap gap-space-sm">
        <div className="flex items-center gap-space-sm">
          <span className="material-symbols-outlined text-copper-accent text-[20px]">neurology</span>
          <h2 className="font-headline-sm text-headline-sm font-semibold text-earth-charcoal">Crucible AI Autonomous Recommendations</h2>
        </div>
        <span className="font-label-sm text-label-sm text-telemetry-emerald bg-telemetry-emerald/10 px-2 py-0.5 rounded font-semibold">
          Optimizer: ACTIVE
        </span>
      </div>

      <div className="mt-space-md space-y-space-md">
        {failed && (
          <Caveat tone="warn" icon="error">
            {note}
          </Caveat>
        )}

        {!failed && recommendations.length === 0 && (
          <Caveat icon="block">
            {note || 'No permitted action is currently available for the detected problems.'}
          </Caveat>
        )}

        {recommendations.map((r) => (
          <RecommendationCard key={r.key} rec={r} />
        ))}

        {blocked.length > 0 && (
          <div className="pt-space-xs border-t border-earth-border">
            <button
              onClick={() => setShowBlocked((v) => !v)}
              className="inline-flex items-center gap-space-xs font-label-sm text-label-sm text-[11px] font-bold text-secondary hover:text-earth-charcoal transition-colors uppercase tracking-wider"
            >
              <span className="material-symbols-outlined text-[14px]">
                {showBlocked ? 'visibility_off' : 'visibility'}
              </span>
              {showBlocked ? 'Hide' : 'Show'} {blocked.length} action{blocked.length === 1 ? '' : 's'} Crucible AI refused
            </button>

            {showBlocked && (
              <div className="mt-space-sm space-y-space-xs">
                {blocked.map((b) => (
                  <div
                    key={b.key}
                    className="rounded border border-earth-border bg-surface-container px-space-sm py-space-xs opacity-80"
                  >
                    <div className="flex items-center gap-space-sm">
                      <span className="material-symbols-outlined text-[16px] text-telemetry-crimson">block</span>
                      <span className="font-headline-sm text-[14px] font-semibold text-earth-charcoal line-through">{b.title}</span>
                    </div>
                    <p className="mt-1 pl-7 font-body-sm text-[11px] leading-snug text-telemetry-crimson font-medium">
                      Constraint: {b.constraint_summary}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false);

  return (
    <article className={`border ${rec.horizon === 'NOW' ? 'border-telemetry-emerald/40 bg-telemetry-emerald/5' : 'border-earth-border bg-surface-container-lowest'} rounded p-space-md shadow-sm relative overflow-hidden transition-colors`}>
      {rec.horizon === 'NOW' && (
        <div className="absolute right-0 top-0 w-32 h-32 bg-telemetry-emerald/10 rounded-bl-full pointer-events-none"></div>
      )}
      
      <div className="flex items-start justify-between relative z-10 gap-space-md flex-wrap">
        <div className="space-y-space-xs max-w-2xl min-w-0">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className={`font-label-sm text-label-sm text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
              rec.horizon === 'NOW' ? 'text-telemetry-emerald bg-telemetry-emerald/10 border-telemetry-emerald/30' : 'text-copper-accent bg-copper-accent/10 border-copper-accent/30'
            }`}>
              {HORIZON_LABEL[rec.horizon].split('—')[0].trim()} Priority
            </span>
          </div>
          <h3 className="font-headline-sm text-[18px] font-semibold text-earth-charcoal">{rec.title}</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
            {rec.reason}
          </p>
        </div>
        
        <button className={`px-space-md py-space-sm font-label-md text-label-md font-bold rounded shadow transition-all flex items-center gap-space-xs shrink-0 ${
          rec.horizon === 'NOW' ? 'bg-primary text-white hover:text-on-primary-container hover:bg-primary-container' : 'bg-surface-container text-earth-charcoal border border-earth-border hover:bg-surface-elevation'
        }`}>
          <span className="material-symbols-outlined text-[18px]">
            {rec.horizon === 'NOW' ? 'check_circle' : 'bolt'}
          </span>
          Approve Action
        </button>
      </div>

      <div className="mt-space-md pt-space-sm border-t border-earth-border/50 grid grid-cols-2 md:grid-cols-4 gap-space-md relative z-10">
        <div>
          <span className="font-label-sm text-label-sm text-[10px] text-secondary uppercase tracking-wider block mb-1 font-bold">Expected Delta</span>
          <span className={`font-headline-sm text-[15px] font-bold ${(rec.expected_delta_t ?? 0) > 0 ? 'text-telemetry-emerald' : 'text-earth-charcoal'}`}>
            {tonnes(rec.expected_delta_t, true)}
          </span>
        </div>
        <div>
          <span className="font-label-sm text-label-sm text-[10px] text-secondary uppercase tracking-wider block mb-1 font-bold">Implied Cost</span>
          <span className="font-headline-sm text-[15px] font-semibold text-earth-charcoal opacity-90">{rupees(rec.cost_inr)}</span>
        </div>
        <div>
          <span className="font-label-sm text-label-sm text-[10px] text-secondary uppercase tracking-wider block mb-1 font-bold">Added Risk</span>
          <span className={`font-headline-sm text-[15px] font-semibold ${rec.risk_delta > 0.1 ? 'text-telemetry-crimson' : 'text-earth-charcoal opacity-90'}`}>
            {rec.risk_delta > 0 ? `+${(rec.risk_delta * 100).toFixed(0)}%` : 'None'}
          </span>
        </div>
        <div>
          <span className="font-label-sm text-label-sm text-[10px] text-secondary uppercase tracking-wider block mb-1 font-bold">Owner</span>
          <span className="font-headline-sm text-[15px] font-semibold text-earth-charcoal opacity-90">{rec.owner}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 relative z-10 flex flex-col items-start gap-2 border-t border-earth-border/50">
        <button
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold text-secondary hover:text-earth-charcoal transition-colors font-['Space_Grotesk'] uppercase tracking-wider"
        >
          <span className="material-symbols-outlined !text-[16px] text-copper-accent">search_insights</span>
          {open ? 'Hide Calculations' : 'Inspect AI Reasoning & Costs'}
          <span className="material-symbols-outlined !text-[16px]">
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {open && (
          <div className="w-full mt-2 bg-surface-container-lowest border border-earth-border/60 rounded p-3 text-[12px] text-earth-charcoal space-y-3 font-sans">
            <div>
              <span className="font-semibold block mb-0.5 text-secondary text-[11px] uppercase tracking-wider font-['Space_Grotesk']">How this was worked out</span>
              <p className="leading-snug text-on-surface-variant">{rec.method}</p>
            </div>
            <div>
              <span className="font-semibold block mb-0.5 text-secondary text-[11px] uppercase tracking-wider font-['Space_Grotesk']">Cost basis</span>
              <p className="leading-snug text-on-surface-variant">{rec.cost_basis}</p>
            </div>
            <div>
              <span className="font-semibold block mb-0.5 text-secondary text-[11px] uppercase tracking-wider font-['Space_Grotesk']">Constraints checked</span>
              <p className="leading-snug text-on-surface-variant">{rec.constraint_summary}</p>
            </div>
            {rec.tradeoffs.length > 0 && (
              <div>
                <span className="font-semibold block mb-0.5 text-secondary text-[11px] uppercase tracking-wider font-['Space_Grotesk']">Trade-offs</span>
                <ul className="space-y-1 list-disc list-inside text-telemetry-amber opacity-90 marker:text-telemetry-amber">
                  {rec.tradeoffs.map((t) => (
                    <li key={t} className="leading-snug">{t}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <span className="font-semibold block mb-0.5 text-secondary text-[11px] uppercase tracking-wider font-['Space_Grotesk']">Approval</span>
              <p className="leading-snug text-on-surface-variant">Requires {rec.approval_roles.map((r) => r.replace(/_/g, ' ')).join(' or ')}.</p>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------ do nothing */

export function DoNothingPanel({ projection }: { projection: Projection }) {
  if (!projection.available) {
    return (
      <div className="bg-gradient-to-br from-earth-espresso via-earth-charcoal to-[#2A160F] rounded border border-telemetry-crimson/50 p-space-md text-white shadow-lg relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-telemetry-crimson/10 rounded-full blur-2xl pointer-events-none"></div>
        <div className="flex items-center gap-space-sm pb-space-sm border-b border-white/10">
          <span className="material-symbols-outlined text-telemetry-crimson text-[20px]">trending_down</span>
          <h2 className="font-headline-sm text-headline-sm text-white tracking-tight">&quot;Do Nothing&quot; Consequence Ledger</h2>
        </div>
        <div className="mt-space-md relative z-10">
          <Caveat icon="help">
            {projection.unavailable_reason || 'This cannot be projected from available data.'}
          </Caveat>
        </div>
      </div>
    );
  }

  if (projection.points.length === 0) {
    return (
      <div className="bg-gradient-to-br from-earth-espresso via-earth-charcoal to-[#2A160F] rounded border border-telemetry-crimson/50 p-space-md text-white shadow-lg relative overflow-hidden">
        <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-telemetry-crimson/10 rounded-full blur-2xl pointer-events-none"></div>
        <div className="flex items-center gap-space-sm pb-space-sm border-b border-white/10">
          <span className="material-symbols-outlined text-telemetry-crimson text-[20px]">trending_down</span>
          <h2 className="font-headline-sm text-headline-sm text-white tracking-tight">&quot;Do Nothing&quot; Consequence Ledger</h2>
        </div>
        <div className="mt-space-md relative z-10">
          <Caveat icon="check_circle">{projection.assumptions[0]}</Caveat>
        </div>
      </div>
    );
  }

  const worst = projection.points[projection.points.length - 1];

  return (
    <div className="bg-gradient-to-br from-earth-espresso via-earth-charcoal to-[#2A160F] rounded border border-telemetry-crimson/50 p-space-md text-white shadow-lg relative overflow-hidden">
      <div className="absolute -right-10 -bottom-10 w-44 h-44 bg-telemetry-crimson/10 rounded-full blur-2xl pointer-events-none"></div>
      
      <div className="flex items-center justify-between pb-space-sm border-b border-white/10 relative z-10 gap-space-sm flex-wrap">
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-telemetry-crimson text-[20px]">trending_down</span>
          <h2 className="font-headline-sm text-headline-sm text-white tracking-tight">&quot;Do Nothing&quot; Consequence Ledger</h2>
        </div>
        <span className="font-label-sm text-label-sm bg-telemetry-crimson/20 border border-telemetry-crimson/40 text-white uppercase px-2 py-0.5 rounded font-mono">
          Status Quo Sim
        </span>
      </div>

      <div className="mt-space-md grid grid-cols-2 gap-space-md relative z-10">
        <div className="bg-white/5 border border-white/10 p-space-sm rounded">
          <span className="font-label-sm text-[11px] text-[#D8CFC4] uppercase tracking-wider block">Projected Shortfall</span>
          <div className="font-headline-lg text-headline-lg text-telemetry-amber font-mono font-bold mt-0.5">
            -{tonnes(worst.shortfall_t)}
          </div>
          <span className="font-body-sm text-[11px] text-[#A69B91]">Continuing at {projection.shortfall_rate_tph?.toFixed(1) ?? 0} t/hr</span>
        </div>
        <div className="bg-white/5 border border-white/10 p-space-sm rounded">
          <span className="font-label-sm text-[11px] text-[#D8CFC4] uppercase tracking-wider block">Est. Impact by</span>
          <div className="font-headline-lg text-headline-lg text-telemetry-crimson font-mono font-bold mt-0.5">
            {worst.label}
          </div>
          <span className="font-body-sm text-[11px] text-[#A69B91]">Without immediate intervention</span>
        </div>
      </div>

      <div className="mt-space-md space-y-space-xs relative z-10">
        {projection.points.map((p) => (
          <div
            key={p.key}
            className="flex flex-wrap sm:flex-nowrap items-center gap-space-sm sm:gap-space-md rounded bg-white/5 border border-white/10 px-space-md py-space-sm"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.recoverable ? 'bg-telemetry-amber animate-pulse' : 'bg-telemetry-crimson'}`} />
            <span className="w-24 sm:w-32 shrink-0 font-label-sm text-[12px] font-bold text-[#D8CFC4] uppercase tracking-wider">{p.label}</span>
            <span className={`w-24 shrink-0 text-right font-headline-sm text-[16px] font-bold ${p.recoverable ? 'text-telemetry-amber' : 'text-telemetry-crimson'}`}>
              -{tonnes(p.shortfall_t)}
            </span>
            <span className="min-w-0 flex-1 font-body-sm text-[12px] leading-snug text-[#A69B91] w-full sm:w-auto">{p.note}</span>
          </div>
        ))}
      </div>

      <details className="mt-space-md group border-t border-white/10 pt-space-sm relative z-10">
        <summary className="cursor-pointer font-label-sm text-[11px] font-bold text-[#A69B91] hover:text-white uppercase tracking-wider flex items-center gap-1 transition-colors">
          <span className="material-symbols-outlined text-[16px]">psychology</span>
          Simulation Assumptions
          <span className="material-symbols-outlined text-[16px] group-open:-scale-y-100 transition-transform ml-auto">expand_more</span>
        </summary>
        <ul className="mt-space-sm space-y-2 pl-4 border-l-2 border-white/10 ml-1.5">
          {projection.assumptions.map((a) => (
             <li key={a} className="font-body-sm text-[12px] leading-snug text-[#D8CFC4] list-none relative before:content-[''] before:absolute before:-left-4 before:top-2 before:w-2 before:h-px before:bg-white/10">
               {a}
             </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/* --------------------------------------------------------- material flow */

export function MaterialFlow({
  stages,
  bottleneck,
}: {
  stages: Stage[];
  bottleneck: Bottleneck | null;
}) {
  return (
    <div className="bg-surface-parchment rounded border border-earth-border p-space-md shadow-sm">
      <div className="flex items-center justify-between pb-space-sm border-b border-earth-border flex-wrap gap-space-sm">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-sm">
            <span className="material-symbols-outlined text-copper-accent text-[20px]">schema</span>
            <h2 className="font-headline-sm text-headline-sm text-earth-charcoal">End-to-End Extraction Flow</h2>
          </div>
          <span className="font-label-sm text-label-sm text-secondary font-mono mt-1">
            {bottleneck
              ? `Most loaded: ${bottleneck.label.toLowerCase()} at ${bottleneck.utilisation_pct.toFixed(0)}%`
              : 'No stage could be measured'}
          </span>
        </div>
        <ProvenanceBadge mode={bottleneck?.calculation_mode || 'HEURISTIC'} />
      </div>

      <div className="mt-space-md space-y-space-sm">
        {stages.map((s, idx) => {
          const isBottleneck = bottleneck?.stage === s.key;
          const textColors = 
            s.status === 'SATURATED' ? 'text-telemetry-crimson' :
            s.status === 'CONSTRAINED' ? 'text-telemetry-amber' : 'text-telemetry-emerald';
            
          return (
            <div 
              key={s.key} 
              className={`p-space-sm rounded ${isBottleneck ? 'bg-surface-container-high border-2 border-telemetry-crimson relative shadow-sm' : 'bg-surface-container border border-earth-border hover:border-earth-charcoal transition-colors'} flex items-center justify-between`}
            >
              {isBottleneck && (
                <div className="absolute -top-2.5 right-3 bg-telemetry-crimson text-white font-label-sm text-[10px] uppercase font-bold px-2 py-0.5 rounded shadow">
                  ACTIVE BOTTLENECK
                </div>
              )}
              <div className="flex items-center gap-space-sm">
                <div className={`w-7 h-7 rounded ${isBottleneck ? 'bg-telemetry-crimson text-white' : 'bg-surface-elevation border border-earth-border text-earth-charcoal'} flex items-center justify-center font-label-sm font-bold`}>
                  {String(idx + 1).padStart(2, '0')}
                </div>
                <div>
                  <div className={`font-label-md text-label-md ${isBottleneck ? 'font-bold' : 'font-semibold'} text-earth-charcoal`}>{s.label}</div>
                  <div className={`font-body-sm text-[12px] ${isBottleneck ? 'text-earth-charcoal' : 'text-secondary'}`}>
                    {s.utilisation_pct === null
                      ? 'Not measured'
                      : `${s.utilisation_pct.toFixed(0)}% Utilisation · ${tonnes(s.capacity_t)} capacity`}
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                {s.utilisation_pct !== null && (
                  <span className={`font-label-md text-label-md font-mono font-bold ${textColors}`}>
                    {s.utilisation_pct.toFixed(0)}%
                  </span>
                )}
                <span className={`block font-body-sm text-[11px] ${isBottleneck ? 'text-telemetry-crimson font-bold' : 'text-secondary'}`}>
                  {s.unavailable_reason || s.basis}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {bottleneck && (
        <div className="mt-space-md rounded border border-telemetry-crimson/20 bg-telemetry-crimson/5 p-space-md flex items-start gap-space-sm">
          <span className="material-symbols-outlined text-telemetry-crimson text-[20px]">warning</span>
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-[10px] font-bold uppercase tracking-wider text-telemetry-crimson/80 mb-0.5">Constraint Identified</span>
            <p className="font-body-sm text-body-sm leading-relaxed text-earth-charcoal font-medium">{bottleneck.reason}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------- pit aerial card */

export function PitAerialCard() {
  return (
    <div className="bg-surface-parchment rounded border border-earth-border p-space-md shadow-sm">
      <div className="flex items-center justify-between pb-space-sm border-b border-earth-border">
        <div className="flex items-center gap-space-sm">
          <span className="material-symbols-outlined text-copper-accent text-[20px]">layers</span>
          <h3 className="font-headline-sm text-headline-sm text-earth-charcoal">Pit 4 Bench Stratigraphy &amp; Haul Node Status</h3>
        </div>
        <div className="flex items-center gap-space-xs text-secondary font-label-sm text-label-sm">
          <span>UAV ORTHOMOSAIC REFRESH: 4M AGO</span>
        </div>
      </div>

      <div className="mt-space-md relative rounded overflow-hidden border border-earth-border" style={{ height: 224, background: '#2C1A14' }}>
        <img
          className="w-full h-full object-cover"
          style={{ opacity: 0.8 }}
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuAMfmMLicHE7FQdUzVshknka2oBacqueK4kSVrRFq3m92RlZACRK4Zutnd12bLuXJ-bYrvlcRrux5-2Aj6mzchloYihUB9MpuXlKDnMfafBEAkQG1fvUdL6_uW_mEYWn0DjNzUmkWZpTHpfRhfKq9MrwVkgJMQLgGHBNoRgbws0zlXujOE0ZSOX953i9-crvVmOdWOqfKl236SuEiVVPKbtYsM_iqywG2Wy2fzDkxLtlVteiYGEbl_L"
          alt="High-resolution aerial orthomosaic of Kansanshi open-cast copper mine pit showing terrace benches, haul trucks and excavators"
        />
        {/* HUD Overlay */}
        <div className="absolute inset-0 flex flex-col justify-between p-space-md pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(44,26,20,0.90) 0%, transparent 50%, rgba(0,0,0,0.30) 100%)' }}>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-1.5 px-space-sm py-1 rounded border text-white font-label-sm text-label-sm"
              style={{ background: 'rgba(44,26,20,0.80)', backdropFilter: 'blur(8px)', borderColor: 'rgba(216,207,196,0.3)' }}>
              <span className="w-2 h-2 rounded-full bg-telemetry-crimson animate-ping" />
              <span>CONGESTION: Ramp West Choke (14.8 min delay)</span>
            </div>
            <div className="px-space-sm py-1 rounded font-mono text-[11px] text-white"
              style={{ background: 'rgba(44,26,20,0.80)', backdropFilter: 'blur(8px)', borderColor: 'rgba(216,207,196,0.3)', border: '1px solid' }}>
              COORD: -12.0948° S, 26.4271° E
            </div>
          </div>
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-space-md">
              <div className="px-space-sm py-1 rounded border"
                style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)' }}>
                <span className="text-[10px] uppercase font-label-sm block" style={{ color: '#D8CFC4' }}>Bench Grade</span>
                <span className="font-label-md text-label-md font-semibold text-ore-gold">1.84% Cu Eq</span>
              </div>
              <div className="px-space-sm py-1 rounded border"
                style={{ background: 'rgba(255,255,255,0.10)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.18)' }}>
                <span className="text-[10px] uppercase font-label-sm block" style={{ color: '#D8CFC4' }}>Excavator EX-04 Status</span>
                <span className="font-label-md text-label-md font-semibold text-white">Dumping (Load 92t)</span>
              </div>
            </div>
            <button
              className="pointer-events-auto bg-white text-earth-charcoal hover:bg-copper-accent hover:text-white px-space-sm py-1 rounded font-label-sm text-label-sm font-semibold transition-colors flex items-center gap-1"
            >
              <span>Enlarge GIS Telemetry</span>
              <span className="material-symbols-outlined text-[14px]">open_in_full</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- context */

export function MineContextBar({
  summary,
  mines,
  onSelect,
}: {
  summary: CommandSummary;
  mines: { mine_id: string; name: string | null }[];
  onSelect: (mineId: string) => void;
}) {
  const { mine, platform, clock } = summary;
  const platformTone = platform.state === 'CRITICAL' ? 'bg-telemetry-crimson animate-pulse' :
                       (platform.state === 'WATCH' || platform.state === 'DISRUPTION') ? 'bg-telemetry-amber animate-pulse' : 'bg-telemetry-emerald';

  return (
    <div className="w-full bg-surface-parchment border-b border-earth-border px-gutter-lg py-space-sm flex flex-wrap items-center justify-between gap-space-md">
      <div className="flex items-center gap-space-md flex-wrap">
        <div className="flex items-center gap-space-sm">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Asset Pit</span>
          <div className="flex items-center gap-space-xs bg-surface-container-high px-space-sm py-1 rounded border border-earth-border relative">
            <span className={`w-2 h-2 rounded-full ${platformTone}`}></span>
            <select
              value={mine.mine_id}
              onChange={(e) => onSelect(e.target.value)}
              className="appearance-none bg-transparent font-headline-sm text-[15px] text-earth-charcoal font-semibold outline-none cursor-pointer pr-4"
            >
              {mines.map((m) => (
                <option key={m.mine_id} value={m.mine_id} className="bg-surface-parchment text-earth-charcoal">
                  {m.name || m.mine_id}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined text-[16px] text-secondary absolute right-2 pointer-events-none">expand_more</span>
          </div>
        </div>
        <div className="h-4 w-px bg-earth-border hidden sm:block"></div>
        <div className="flex items-center gap-space-xs">
          <span className="material-symbols-outlined text-copper-accent text-[18px]">sensors</span>
          <span className="font-label-md text-label-md text-earth-charcoal">
            {mine.state ? `${mine.district ? mine.district + ', ' : ''}${mine.state}` : 'Nominal Stratum Sync'}
          </span>
          <span className="font-label-sm text-label-sm text-secondary bg-surface-container px-1.5 py-0.5 rounded ml-1">
            Platform {platform.state.toLowerCase()}
          </span>
        </div>
      </div>
      
      <div className="flex items-center gap-space-lg">
        {/* Dynamic Supervisor Section (currently mocked in layout but can be real) */}
        <div className="flex items-center gap-space-sm hidden sm:flex">
          <div className="w-7 h-7 rounded-full bg-surface-elevation border border-earth-border flex items-center justify-center font-label-sm text-earth-charcoal font-bold">MV</div>
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-earth-charcoal font-semibold leading-tight">Marcus Vance</span>
            <span className="font-body-sm text-[11px] text-secondary leading-tight">Shift A Supervisor</span>
          </div>
        </div>
        <div className="h-4 w-px bg-earth-border hidden sm:block"></div>
        <div className="flex items-center gap-space-xs text-secondary font-label-sm text-label-sm">
          {clock.mode === 'BENCHMARK' && (
            <span
              title={clock.caveat || ''}
              className="inline-flex items-center gap-1 rounded border border-telemetry-amber/30 bg-telemetry-amber/10 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-telemetry-amber mr-2"
            >
              <span className="material-symbols-outlined !text-[11px]">science</span>
              Benchmark data
            </span>
          )}
          <span className="material-symbols-outlined text-[16px]">schedule</span>
          <span>
            {clock.dataset_epoch
              ? new Date(clock.dataset_epoch).toLocaleString('en-IN', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
                })
              : 'No dated data'}
          </span>
        </div>
      </div>
    </div>
  );
}
