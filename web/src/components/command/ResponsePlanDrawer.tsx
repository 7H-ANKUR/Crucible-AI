'use client';

/**
 * ResponsePlanDrawer.tsx — the decision itself.
 * Reskinned to Stitch "Earthy Industrial" design system (light-only).
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
        className="absolute inset-0 bg-earth-charcoal/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />

      <aside className="relative flex h-full w-full max-w-2xl flex-col border-l border-earth-border bg-surface-parchment shadow-2xl animate-drawerIn">
        <header className="flex items-start justify-between gap-3 border-b border-earth-border bg-surface-container-high px-5 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SeverityChip severity={item.severity} />
              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary">
                Response plan
              </span>
              {filed && (
                <span className="rounded border border-primary/30 bg-primary-fixed/40 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-primary">
                  {filed.ref} · {filed.state.replace(/_/g, ' ').toLowerCase()}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-lg font-bold text-earth-charcoal truncate font-['Space_Grotesk']">
              {plan?.title || item.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1.5 text-on-surface-variant hover:bg-surface-container-highest hover:text-earth-charcoal transition-colors"
          >
            <span className="material-symbols-outlined !text-[20px]">close</span>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
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
                <p className="text-sm leading-relaxed text-earth-charcoal">{plan.situation}</p>
              </Block>

              <Block
                title="Root cause"
                action={<ProvenanceBadge mode={plan.root_cause_calculation_mode} />}
              >
                <p className="text-sm leading-relaxed text-secondary">{plan.root_cause}</p>
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
                <p className="mt-2 text-[11px] leading-snug text-on-surface-variant">{plan.expected.note}</p>
              </Block>

              {plan.action_groups.map((g) => (
                <Block key={g.horizon} title={g.label}>
                  <div className="space-y-3">
                    {g.actions.map((a) => (
                      <RecommendationCard key={a.key} rec={a} />
                    ))}
                  </div>
                </Block>
              ))}

              {plan.comparison?.available && plan.comparison.rows && (
                <Block title={`Options at ${plan.comparison.horizon_label?.toLowerCase()}`}>
                  <div className="overflow-x-auto rounded border border-earth-border">
                    <table className="w-full text-[11px]">
                      <thead className="bg-surface-container-low">
                        <tr className="border-b border-earth-border text-left text-secondary">
                          <th className="py-2 pl-3 pr-3 font-semibold">Option</th>
                          <th className="py-2 pr-3 text-right font-semibold">Shortfall</th>
                          <th className="py-2 pr-3 text-right font-semibold">Recovered</th>
                          <th className="py-2 pr-3 text-right font-semibold">Cost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.comparison.rows.map((r, i) => (
                          <tr
                            key={r.key}
                            className={`border-b border-earth-border ${
                              r.is_baseline ? 'bg-telemetry-crimson/5 text-telemetry-crimson' : 'text-earth-charcoal'
                            } ${i === plan.comparison!.rows!.length - 1 ? 'border-b-0' : ''}`}
                          >
                            <td className="py-2 pl-3 pr-3 font-medium">{r.label}</td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {tonnes(r.shortfall_t)}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums font-semibold text-telemetry-emerald">
                              {r.recovered_t > 0 ? tonnes(r.recovered_t, true) : '—'}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">{rupees(r.cost_inr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {plan.comparison.note && (
                    <p className="mt-2 text-[11px] leading-snug text-on-surface-variant">
                      {plan.comparison.note}
                    </p>
                  )}
                </Block>
              )}

              {plan.not_available.length > 0 && (
                <Block title="Considered and refused">
                  <div className="space-y-2">
                    {plan.not_available.map((b) => (
                      <div key={b.key} className="rounded border border-earth-border bg-surface-container-low px-3 py-2">
                        <span className="text-[11px] font-semibold text-secondary">{b.title}</span>
                        <p className="mt-1 text-[11px] leading-snug text-on-surface-variant">
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
                      <li key={r} className="text-[11px] leading-snug text-telemetry-amber">
                        · {r}
                      </li>
                    ))}
                  </ul>
                </Block>
              )}

              <Block title="Accountability">
                <div className="grid grid-cols-2 gap-4 rounded border border-earth-border bg-surface-container-lowest p-3">
                  <div>
                    <SectionLabel>Owners</SectionLabel>
                    <p className="text-[11px] font-medium text-earth-charcoal">{plan.owners.join(', ') || '—'}</p>
                  </div>
                  <div>
                    <SectionLabel>Approval required</SectionLabel>
                    <p className="text-[11px] font-medium text-earth-charcoal">
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
          <footer className="border-t border-earth-border bg-surface-container-high px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {!filed && (
                <button
                  onClick={onFile}
                  disabled={pending}
                  className="rounded bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-container hover:text-on-primary-container disabled:opacity-50 transition-all"
                >
                  File for approval
                </button>
              )}
              {filed?.state === 'SIMULATED' && (
                <button
                  onClick={() => onStep('submit')}
                  disabled={pending}
                  className="rounded bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-container disabled:opacity-50 transition-all"
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
                    className="rounded bg-telemetry-emerald px-4 py-2 text-xs font-bold text-white shadow-sm hover:brightness-110 disabled:opacity-50 transition-all"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => {
                      const reason = window.prompt('Why is this plan being declined?');
                      if (reason) void onStep('reject', { rationale: reason });
                    }}
                    disabled={pending}
                    className="rounded border border-telemetry-crimson/50 px-4 py-2 text-xs font-bold text-telemetry-crimson hover:bg-telemetry-crimson/10 disabled:opacity-50 transition-all"
                  >
                    Reject
                  </button>
                </>
              )}
              {filed?.state === 'APPROVED' && (
                <button
                  onClick={() => onStep('start')}
                  disabled={pending}
                  className="rounded bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-container disabled:opacity-50 transition-all"
                >
                  Record as started
                </button>
              )}
              {filed?.state === 'EXECUTING' && (
                <button
                  onClick={() => onStep('complete')}
                  disabled={pending}
                  className="rounded bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-container disabled:opacity-50 transition-all"
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
                  className="rounded bg-primary px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-primary-container disabled:opacity-50 transition-all"
                >
                  Record what happened
                </button>
              )}
              <button
                onClick={onClose}
                className="ml-auto rounded border border-earth-border px-4 py-2 text-xs font-semibold text-secondary hover:text-earth-charcoal hover:bg-surface-container transition-colors"
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
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-earth-border pb-1">
        <SectionLabel>{title}</SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}
