'use client';

/**
 * ResponsePlanDrawer.tsx — the decision itself.
 *
 * Situation, evidence, root cause, what to do in each window, what it costs,
 * what it risks, who must approve it — and the option comparison against doing
 * nothing, so the manager can see what they are choosing between rather than
 * being handed a single answer.
 *
 * The verbs matter. "File for approval" and "Record as started" describe what a
 * person does; nothing here says "deploy" or "execute", because Crucible AI does not
 * perform operational actions and the interface must not imply that it does.
 */
import React, { useEffect, useState } from 'react';
import {
  AttentionItem,
  ResponsePlan,
  rupees,
  tonnes,
  usePlanActions,
} from '@/lib/command';
import {
  Caveat,
  EvidenceBadge,
  Metric,
  PanelSkeleton,
  ProvenanceBadge,
  SectionLabel,
  SeverityChip,
} from './primitives';
import { RecommendationCard } from './sections';

export function ResponsePlanDrawer({
  mineId,
  item,
  onClose,
}: {
  mineId: string;
  item: AttentionItem | null;
  onClose: () => void;
}) {
  const { preview, file, act, pending, error } = usePlanActions();
  const [plan, setPlan] = useState<ResponsePlan | null>(null);
  const [filed, setFiled] = useState<{ id: number; ref: string; state: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!item) {
      setPlan(null);
      setFiled(null);
      setNotice(null);
      return;
    }
    let alive = true;
    void (async () => {
      const p = await preview(mineId, item.key);
      if (alive) setPlan(p);
    })();
    return () => {
      alive = false;
    };
  }, [item, mineId, preview]);

  if (!item) return null;

  async function onFile() {
    const p = await file(mineId, item!.key);
    if (p?.plan_id) {
      setPlan(p);
      setFiled({ id: p.plan_id, ref: p.plan_ref!, state: p.lifecycle_state });
      setNotice(`Filed as ${p.plan_ref}. It now needs approval before any work begins.`);
    }
  }

  async function onStep(step: string, body: Record<string, unknown> = {}) {
    if (!filed) return;
    const r = await act(filed.id, step, body);
    if (r && typeof r === 'object' && 'to' in r) {
      setFiled({ ...filed, state: String(r.to) });
      setNotice(`${filed.ref} moved to ${String(r.to).replace(/_/g, ' ').toLowerCase()}.`);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-line2 bg-page shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line2/60 px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SeverityChip severity={item.severity} />
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink2/70">
                Response plan
              </span>
              {filed && (
                <span className="rounded border border-sky-500/30 bg-sky-500/5 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-sky-400">
                  {filed.ref} · {filed.state.replace(/_/g, ' ').toLowerCase()}
                </span>
              )}
            </div>
            <h2 className="mt-1 text-lg font-bold text-ink truncate">
              {plan?.title || item.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1.5 text-ink2 hover:bg-panel3 hover:text-ink transition-colors"
          >
            <span className="material-symbols-outlined !text-[20px]">close</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {error && (
            <Caveat tone="warn" icon="error">
              {error}
            </Caveat>
          )}
          {notice && <Caveat icon="task_alt">{notice}</Caveat>}

          {!plan && pending && <PanelSkeleton rows={5} />}

          {plan && !plan.available && (
            <Caveat icon="info">{plan.reason || 'No plan could be generated.'}</Caveat>
          )}

          {plan?.available && (
            <>
              <Block title="Situation">
                <p className="text-sm leading-relaxed text-ink/90">{plan.situation}</p>
              </Block>

              <Block
                title="Root cause"
                action={<ProvenanceBadge mode={plan.root_cause_calculation_mode} />}
              >
                <p className="text-sm leading-relaxed text-ink2">{plan.root_cause}</p>
              </Block>

              <Block title="Expected result" action={<EvidenceBadge quality={plan.evidence_quality} />}>
                <div className="grid grid-cols-2 gap-4">
                  <Metric
                    label="If the plan is followed"
                    value={tonnes(plan.expected.delta_t, true)}
                    mode={plan.expected.calculation_mode}
                    tone="good"
                  />
                  <Metric
                    label="Gap still remaining"
                    value={
                      plan.expected.residual_gap_t === null
                        ? '—'
                        : plan.expected.residual_gap_t <= 0
                          ? 'Closed'
                          : tonnes(plan.expected.residual_gap_t)
                    }
                    tone={(plan.expected.residual_gap_t ?? 0) > 0 ? 'bad' : 'good'}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-snug text-ink2/60">{plan.expected.note}</p>
              </Block>

              {plan.action_groups.map((g) => (
                <Block key={g.horizon} title={g.label}>
                  <div className="space-y-2.5">
                    {g.actions.map((a) => (
                      <RecommendationCard key={a.key} rec={a} />
                    ))}
                  </div>
                </Block>
              ))}

              {plan.comparison?.available && plan.comparison.rows && (
                <Block title={`Options at ${plan.comparison.horizon_label?.toLowerCase()}`}>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-line2/40 text-left text-ink2/60">
                          <th className="py-1.5 pr-3 font-semibold">Option</th>
                          <th className="py-1.5 pr-3 text-right font-semibold">Shortfall</th>
                          <th className="py-1.5 pr-3 text-right font-semibold">Recovered</th>
                          <th className="py-1.5 text-right font-semibold">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.comparison.rows.map((r) => (
                          <tr
                            key={r.key}
                            className={`border-b border-line2/20 ${r.is_baseline ? 'text-red-300/80' : 'text-ink2'}`}
                          >
                            <td className="py-1.5 pr-3">{r.label}</td>
                            <td className="py-1.5 pr-3 text-right tabular-nums">
                              {tonnes(r.shortfall_t)}
                            </td>
                            <td className="py-1.5 pr-3 text-right tabular-nums text-emerald-400/80">
                              {r.recovered_t > 0 ? tonnes(r.recovered_t, true) : '—'}
                            </td>
                            <td className="py-1.5 text-right tabular-nums">{rupees(r.cost_inr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {plan.comparison.note && (
                    <p className="mt-2 text-[11px] leading-snug text-ink2/60">
                      {plan.comparison.note}
                    </p>
                  )}
                </Block>
              )}

              {plan.not_available.length > 0 && (
                <Block title="Considered and refused">
                  <div className="space-y-1.5">
                    {plan.not_available.map((b) => (
                      <div key={b.key} className="rounded-lg border border-line2/40 px-3 py-2">
                        <span className="text-[11px] font-semibold text-ink2">{b.title}</span>
                        <p className="mt-0.5 text-[11px] leading-snug text-ink2/70">
                          {b.constraint_summary}
                        </p>
                      </div>
                    ))}
                  </div>
                </Block>
              )}

              {plan.risks.length > 0 && (
                <Block title="Risks">
                  <ul className="space-y-1">
                    {plan.risks.map((r) => (
                      <li key={r} className="text-[11px] leading-snug text-amber-200/70">
                        · {r}
                      </li>
                    ))}
                  </ul>
                </Block>
              )}

              <Block title="Accountability">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <SectionLabel>Owners</SectionLabel>
                    <p className="text-[11px] text-ink2">{plan.owners.join(', ') || '—'}</p>
                  </div>
                  <div>
                    <SectionLabel>Approval required</SectionLabel>
                    <p className="text-[11px] text-ink2">
                      {plan.approval_required.map((r) => r.replace(/_/g, ' ')).join(' or ') || '—'}
                    </p>
                  </div>
                </div>
              </Block>

              <Caveat icon="gavel">{plan.disclaimer}</Caveat>
            </>
          )}
        </div>

        {plan?.available && (
          <footer className="border-t border-line2/60 bg-panel2/60 px-5 py-3">
            <div className="flex flex-wrap gap-2">
              {!filed && (
                <button
                  onClick={onFile}
                  disabled={pending}
                  className="rounded-lg bg-chipon px-4 py-2 text-xs font-bold text-inkb hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  File for approval
                </button>
              )}
              {filed?.state === 'SIMULATED' && (
                <button
                  onClick={() => onStep('submit')}
                  disabled={pending}
                  className="rounded-lg bg-chipon px-4 py-2 text-xs font-bold text-inkb hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  Submit for review
                </button>
              )}
              {filed?.state === 'READY_FOR_REVIEW' && (
                <>
                  <button
                    onClick={() =>
                      onStep('approve', { rationale: 'Approved from the Command Center.' })
                    }
                    disabled={pending}
                    className="rounded-lg bg-emerald-500/90 px-4 py-2 text-xs font-bold text-white hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      const reason = window.prompt('Why is this plan being declined?');
                      if (reason) void onStep('reject', { rationale: reason });
                    }}
                    disabled={pending}
                    className="rounded-lg border border-red-500/40 px-4 py-2 text-xs font-bold text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition-all"
                  >
                    Reject
                  </button>
                </>
              )}
              {filed?.state === 'APPROVED' && (
                <button
                  onClick={() => onStep('start')}
                  disabled={pending}
                  className="rounded-lg bg-chipon px-4 py-2 text-xs font-bold text-inkb hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  Record as started
                </button>
              )}
              {filed?.state === 'EXECUTING' && (
                <button
                  onClick={() => onStep('complete')}
                  disabled={pending}
                  className="rounded-lg bg-chipon px-4 py-2 text-xs font-bold text-inkb hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  Record as complete
                </button>
              )}
              {filed?.state === 'COMPLETED' && (
                <button
                  onClick={() => {
                    const actual = window.prompt('Tonnes actually recovered?');
                    if (actual === null) return;
                    const value = Number(actual);
                    if (Number.isNaN(value)) return;
                    const why = window.prompt('Why did it differ from the prediction?') || undefined;
                    void onStep('outcome', { actual_value: value, variance_reason: why });
                  }}
                  disabled={pending}
                  className="rounded-lg bg-chipon px-4 py-2 text-xs font-bold text-inkb hover:brightness-110 disabled:opacity-50 transition-all"
                >
                  Record what happened
                </button>
              )}
              <button
                onClick={onClose}
                className="ml-auto rounded-lg border border-line2/60 px-4 py-2 text-xs font-semibold text-ink2 hover:text-ink transition-colors"
              >
                Close
              </button>
            </div>
          </footer>
        )}
      </aside>
    </div>
  );
}

function Block({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <SectionLabel>{title}</SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}
