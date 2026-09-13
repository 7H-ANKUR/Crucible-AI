'use client';

/**
 * sections.tsx — the Command Center's major blocks.
 *
 * Ordered as the page is ordered, and as the backend payload is ordered: state,
 * then what needs attention, then what to do, then what happens if nothing is
 * done. Charts do not appear above decisions.
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
  STATE_TONE,
  tonnes,
} from '@/lib/command';
import {
  Caveat,
  EvidenceBadge,
  Metric,
  Panel,
  ProvenanceBadge,
  SectionLabel,
  SeverityChip,
  UtilisationBar,
} from './primitives';

/* ------------------------------------------------------- operational state */

/**
 * The dominant element. Answers "does the mine need me right now?" before the
 * manager reads anything else.
 *
 * Deliberately a state, not a score. "82/100" does not tell anyone whether to
 * act, and blending production, equipment and data quality into one number mixes
 * scopes that cannot meaningfully be averaged.
 */
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
  const tone = STATE_TONE[summary.state.state];
  const driving = summary.state.signals.filter((s) => s.severity !== 'NONE');

  return (
    <section className={`rounded-xl border border-line2/60 ${tone.bg} overflow-hidden`}>
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${tone.dot} animate-pulse`} />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink2/70">
                Mine status
              </span>
            </div>
            <h1 className={`mt-1 text-2xl sm:text-3xl font-bold tracking-tight ${tone.fg}`}>
              {tone.label}
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-ink/90">
              {summary.state.headline}
            </p>
          </div>

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="shrink-0 rounded-lg border border-line2/60 bg-panel3/60 px-3 py-1.5 text-xs font-semibold text-ink2 hover:text-ink hover:bg-panel4/60 disabled:opacity-50 transition-colors"
          >
            <span
              className={`material-symbols-outlined !text-[14px] mr-1 align-[-2px] ${refreshing ? 'animate-spin' : ''}`}
            >
              refresh
            </span>
            {refreshing ? 'Checking' : 'Refresh'}
          </button>
        </div>

        {driving.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-ink2 hover:text-ink transition-colors"
          >
            {open ? 'Hide' : 'Show'} the {driving.length} signal{driving.length === 1 ? '' : 's'}{' '}
            behind this
            <span className="material-symbols-outlined !text-[14px]">
              {open ? 'expand_less' : 'expand_more'}
            </span>
          </button>
        )}
      </div>

      {open && (
        <div className="border-t border-line2/40 bg-panel2/40 px-5 py-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {summary.state.signals.map((s) => (
              <SignalRow key={s.key} signal={s} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SignalRow({ signal }: { signal: Signal }) {
  const body = (
    <div className="rounded-lg border border-line2/40 bg-panel3/40 p-2.5 h-full">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-ink truncate">{signal.label}</span>
        <SeverityChip severity={signal.severity} />
      </div>
      <p className="mt-1 text-[11px] leading-snug text-ink2/80">{signal.reason}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <ProvenanceBadge mode={signal.calculation_mode} />
        {signal.threshold !== null && signal.value !== null && (
          <span className="text-[10px] tabular-nums text-ink2/50">
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
      <Panel title="Attention required">
        <Caveat icon="check_circle">
          Nothing at this mine currently exceeds its operational thresholds.
        </Caveat>
        {knowledgeGaps.length > 0 && <KnowledgeGaps gaps={knowledgeGaps} />}
      </Panel>
    );
  }

  return (
    <Panel
      title="Attention required"
      subtitle={`${items.length} ranked by severity, impact, urgency and evidence`}
    >
      <div className="space-y-2.5">
        {items.map((item) => (
          <article
            key={item.key}
            className="rounded-lg border border-line2/50 bg-panel3/40 p-3 transition-colors hover:border-line2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <SeverityChip severity={item.severity} />
                <h3 className="text-sm font-semibold text-ink truncate">{item.title}</h3>
              </div>
              <EvidenceBadge quality={item.evidence_quality} />
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-ink2">{item.summary}</p>

            <div className="mt-2.5 flex flex-wrap items-end justify-between gap-3">
              <Metric
                label="Production at stake"
                value={item.impact_t === null ? 'Not estimated' : tonnes(item.impact_t)}
                mode={item.calculation_mode}
                hint={item.impact_basis}
                tone={item.impact_t === null ? 'muted' : 'bad'}
                size="sm"
              />
              <div className="flex gap-2">
                {item.deep_link && (
                  <Link
                    href={item.deep_link}
                    className="rounded-lg border border-line2/60 px-2.5 py-1.5 text-[11px] font-semibold text-ink2 hover:text-ink hover:bg-panel4/50 transition-colors"
                  >
                    Investigate
                  </Link>
                )}
                <button
                  onClick={() => onInvestigate(item)}
                  className="rounded-lg bg-chipon px-2.5 py-1.5 text-[11px] font-bold text-inkb hover:brightness-110 transition-all"
                >
                  Build response plan
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {suppressed > 0 && (
        <p className="mt-2 text-[11px] text-ink2/60">
          {suppressed} lower-priority item{suppressed === 1 ? '' : 's'} not shown.
        </p>
      )}

      {knowledgeGaps.length > 0 && <KnowledgeGaps gaps={knowledgeGaps} />}
    </Panel>
  );
}

/**
 * Things the platform cannot see, kept apart from things going wrong.
 *
 * Ranking "we cannot measure this" alongside "production is 15% down" invites a
 * manager to treat them as comparable problems, and they are not.
 */
function KnowledgeGaps({
  gaps,
}: {
  gaps: { key: string; label: string; reason: string; deep_link: string | null }[];
}) {
  return (
    <div className="mt-3">
      <SectionLabel>Not measurable</SectionLabel>
      <div className="space-y-1.5">
        {gaps.map((g) => (
          <Caveat key={g.key} icon="visibility_off">
            <span className="font-semibold text-ink2">{g.label}:</span> {g.reason}
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
    <Panel
      title="Recommended actions"
      subtitle="Each evaluated against live constraints. Approval by a person is required."
    >
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

      <div className="space-y-2.5">
        {recommendations.map((r) => (
          <RecommendationCard key={r.key} rec={r} />
        ))}
      </div>

      {blocked.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowBlocked((v) => !v)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-ink2 hover:text-ink transition-colors"
          >
            {showBlocked ? 'Hide' : 'Show'} {blocked.length} action
            {blocked.length === 1 ? '' : 's'} Crucible AI considered and refused
            <span className="material-symbols-outlined !text-[14px]">
              {showBlocked ? 'expand_less' : 'expand_more'}
            </span>
          </button>

          {showBlocked && (
            <div className="mt-2 space-y-1.5">
              {blocked.map((b) => (
                <div
                  key={b.key}
                  className="rounded-lg border border-line2/40 bg-panel3/30 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined !text-[13px] text-red-400/70">
                      block
                    </span>
                    <span className="text-[11px] font-semibold text-ink2">{b.title}</span>
                  </div>
                  <p className="mt-0.5 pl-5 text-[11px] leading-snug text-ink2/70">
                    {b.constraint_summary}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

export function RecommendationCard({ rec }: { rec: Recommendation }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="rounded-lg border border-line2/50 bg-panel3/40 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded border border-line2/60 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-ink2/70">
              {HORIZON_LABEL[rec.horizon].split('—')[0].trim()}
            </span>
            <h3 className="text-sm font-semibold text-ink truncate">{rec.title}</h3>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink2">{rec.reason}</p>
        </div>
        <EvidenceBadge quality={rec.evidence_quality} />
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric
          label="Expected"
          value={tonnes(rec.expected_delta_t, true)}
          mode={rec.calculation_mode}
          tone={(rec.expected_delta_t ?? 0) > 0 ? 'good' : 'muted'}
          size="sm"
        />
        <Metric label="Cost" value={rupees(rec.cost_inr)} size="sm" tone="muted" />
        <Metric
          label="Added risk"
          value={rec.risk_delta > 0 ? `+${(rec.risk_delta * 100).toFixed(0)}%` : 'None'}
          size="sm"
          tone={rec.risk_delta > 0.1 ? 'bad' : 'muted'}
        />
        <Metric label="Owner" value={rec.owner} size="sm" tone="muted" />
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-ink2 hover:text-ink transition-colors"
      >
        {open ? 'Hide' : 'Why, and what it costs'}
        <span className="material-symbols-outlined !text-[14px]">
          {open ? 'expand_less' : 'expand_more'}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-line2/40 pt-2">
          <div>
            <SectionLabel>How this was worked out</SectionLabel>
            <p className="text-[11px] leading-snug text-ink2/80">{rec.method}</p>
          </div>
          <div>
            <SectionLabel>Cost basis</SectionLabel>
            <p className="text-[11px] leading-snug text-ink2/80">{rec.cost_basis}</p>
          </div>
          <div>
            <SectionLabel>Constraints checked</SectionLabel>
            <p className="text-[11px] leading-snug text-ink2/80">{rec.constraint_summary}</p>
          </div>
          {rec.tradeoffs.length > 0 && (
            <div>
              <SectionLabel>Trade-offs</SectionLabel>
              <ul className="space-y-0.5">
                {rec.tradeoffs.map((t) => (
                  <li key={t} className="text-[11px] leading-snug text-amber-200/70">
                    · {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <SectionLabel>Approval</SectionLabel>
            <p className="text-[11px] leading-snug text-ink2/80">
              Requires {rec.approval_roles.map((r) => r.replace(/_/g, ' ')).join(' or ')}.
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------ do nothing */

export function DoNothingPanel({ projection }: { projection: Projection }) {
  if (!projection.available) {
    return (
      <Panel title="If nothing is done">
        <Caveat icon="help">
          {projection.unavailable_reason || 'This cannot be projected from available data.'}
        </Caveat>
      </Panel>
    );
  }

  if (projection.points.length === 0) {
    return (
      <Panel title="If nothing is done">
        <Caveat icon="check_circle">{projection.assumptions[0]}</Caveat>
      </Panel>
    );
  }

  const worst = projection.points[projection.points.length - 1];

  return (
    <Panel
      title="If nothing is done"
      subtitle={`Shortfall continues at ${projection.shortfall_rate_tph?.toFixed(1)} t per hour`}
      action={<ProvenanceBadge mode={projection.calculation_mode} />}
    >
      <div className="space-y-1.5">
        {projection.points.map((p) => (
          <div
            key={p.key}
            className="flex items-center gap-3 rounded-lg border border-line2/40 bg-panel3/30 px-3 py-2"
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.recoverable ? 'bg-amber-400' : 'bg-red-400'}`}
            />
            <span className="w-32 shrink-0 text-[11px] font-semibold text-ink2">{p.label}</span>
            <span className="w-20 shrink-0 text-right text-sm font-semibold tabular-nums text-orange-400">
              {tonnes(p.shortfall_t)}
            </span>
            <span className="min-w-0 flex-1 text-[11px] leading-snug text-ink2/60">{p.note}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2">
        <p className="text-xs text-red-200/90">
          Taking no action leaves <strong>{tonnes(worst.shortfall_t)}</strong> outstanding by{' '}
          {worst.label.toLowerCase()}.
        </p>
      </div>

      <details className="mt-2.5">
        <summary className="cursor-pointer text-[11px] font-semibold text-ink2 hover:text-ink">
          What this assumes
        </summary>
        <ul className="mt-1.5 space-y-1">
          {projection.assumptions.map((a) => (
            <li key={a} className="text-[11px] leading-snug text-ink2/70">
              · {a}
            </li>
          ))}
        </ul>
      </details>
    </Panel>
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
    <Panel
      title="Material flow"
      subtitle={
        bottleneck
          ? `Most loaded: ${bottleneck.label.toLowerCase()} at ${bottleneck.utilisation_pct.toFixed(0)}%`
          : 'No stage could be measured'
      }
    >
      <div className="space-y-2">
        {stages.map((s) => (
          <div key={s.key} className="group">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink2">{s.label}</span>
              <span className="text-[11px] tabular-nums text-ink2/70">
                {s.utilisation_pct === null
                  ? 'Not measured'
                  : `${s.utilisation_pct.toFixed(0)}% · ${tonnes(s.capacity_t)} capacity`}
              </span>
            </div>
            <div className="mt-1">
              <UtilisationBar pct={s.utilisation_pct} status={s.status} />
            </div>
            <p className="mt-1 text-[10px] leading-snug text-ink2/50 opacity-0 group-hover:opacity-100 transition-opacity">
              {s.unavailable_reason || s.basis}
            </p>
          </div>
        ))}
      </div>

      {bottleneck && (
        <div className="mt-3 rounded-lg border border-line2/40 bg-panel3/40 p-2.5">
          <div className="flex items-center gap-2">
            <SectionLabel>Constraint</SectionLabel>
            <ProvenanceBadge mode={bottleneck.calculation_mode} />
          </div>
          <p className="text-[11px] leading-snug text-ink2/80">{bottleneck.reason}</p>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------- context */

/**
 * Mine, shift, and the data's own reference point.
 *
 * The clock caveat is not decoration. This platform runs against a historical
 * benchmark, and a freshness figure without its reference point is misleading —
 * "live" has to be live relative to something stated.
 */
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
  const platformTone = STATE_TONE[platform.state];

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line2/50 bg-panel2/50 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined !text-[16px] text-ink2/60">landscape</span>
        <select
          value={mine.mine_id}
          onChange={(e) => onSelect(e.target.value)}
          className="bg-transparent text-sm font-semibold text-ink outline-none cursor-pointer"
        >
          {mines.map((m) => (
            <option key={m.mine_id} value={m.mine_id} className="bg-panel3 text-ink">
              {m.name || m.mine_id}
            </option>
          ))}
        </select>
      </div>

      {mine.state && (
        <span className="text-[11px] text-ink2/60">
          {mine.district ? `${mine.district}, ` : ''}
          {mine.state}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${platformTone.dot}`} />
        <span className="text-[11px] text-ink2/70">
          Platform {platform.state.toLowerCase()}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {clock.mode === 'BENCHMARK' && (
          <span
            title={clock.caveat || ''}
            className="inline-flex items-center gap-1 rounded border border-amber-500/25 bg-amber-500/5 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-amber-400/90"
          >
            <span className="material-symbols-outlined !text-[11px]">science</span>
            Benchmark data
          </span>
        )}
        <span className="text-[11px] tabular-nums text-ink2/50">
          {clock.dataset_epoch
            ? new Date(clock.dataset_epoch).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })
            : 'No dated data'}
        </span>
      </div>
    </div>
  );
}
