'use client';

/**
 * Governance — Data Health Center, Model Registry (champion/challenger),
 * Human Model Approval Gate & Training Runs, Prediction Ledger, and Decision Memory.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiPost } from '@/lib/api';
import { FALLBACK_LEDGER, mapLedger, type PredictionLedgerEntry } from '@/lib/minex';
import { useAuth } from '@clerk/nextjs';

interface ModelRow {
  id?: number;
  task: string;
  model: string;
  version?: string;
  status: string;
  metric_roc_auc?: number;
  metric_pr_auc?: number;
  metric_mae?: number;
  metric_r2?: number;
  metric_lift?: number;
  split_type?: string;
  leakage_status?: string;
  approved_by?: string;
  approved_at?: string;
  promoted_at?: string;
  data_origin?: string;
  training_run_id?: number;
  artifact_drive_file_id?: string;
  artifact_sha256?: string;
  smoke_test_status?: string;
}

interface TrainingRun {
  id: number;
  run_tag: string;
  status: string;
  domain: string;
  dataset_version_id?: number;
  triggered_by: string;
  triggered_at: string;
  started_at?: string;
  completed_at?: string;
  error_message?: string;
  data_origin?: string;
}

interface ModelApprovalEntry {
  id: number;
  model_id: number;
  action: string;
  actor_id: string;
  actor_role: string;
  note?: string;
  created_at: string;
  task?: string;
  model?: string;
  version?: string;
}

interface HealthDomain {
  domain: string;
  rows: number;
  latest: string;
  freshness: 'FRESH' | 'AGING' | 'STALE';
  origin: string;
}

const PAGE_SIZE = 10;

export default function GovernancePage() {
  const { getToken } = useAuth();
  const [health, setHealth] = useState<HealthDomain[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [allModels, setAllModels] = useState<ModelRow[]>([]);
  const [pendingChallengers, setPendingChallengers] = useState<ModelRow[]>([]);
  const [trainingRuns, setTrainingRuns] = useState<TrainingRun[]>([]);
  const [approvalsLog, setApprovalsLog] = useState<ModelApprovalEntry[]>([]);
  const [ledger, setLedger] = useState<PredictionLedgerEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [decisions, setDecisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'health' | 'models' | 'approval' | 'ledger' | 'memory'>('health');

  // Training trigger state
  const [trainDomain, setTrainDomain] = useState('production');
  const [trainVersionId, setTrainVersionId] = useState('');
  const [trainNote, setTrainNote] = useState('');
  const [triggeringTrain, setTriggeringTrain] = useState(false);
  const [trainMsg, setTrainMsg] = useState<{ text: string; ok: boolean } | null>(null);

  // Approval action states
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const loadLedger = useCallback(async (p: number) => {
    try {
      const token = await getToken();
      const api = await apiFetch<any>(`/ledger?limit=${PAGE_SIZE}&offset=${p * PAGE_SIZE}`, {}, token);
      const rows = mapLedger(api);
      setLedger(p === 0 ? rows : (prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch {
      if (p === 0) setLedger(FALLBACK_LEDGER);
      setHasMore(false);
    }
  }, [getToken]);

  const loadGovernanceData = useCallback(async () => {
    const token = await getToken();
    // Data health
    try {
      const api = await apiFetch<any>('/ledger/data-health', {}, token);
      const domains: any[] = Array.isArray(api?.domains) ? api.domains : Array.isArray(api) ? api : [];
      if (domains.length) {
        setHealth(
          domains.map((d) => ({
            domain: String(d.domain ?? d.name ?? 'unknown'),
            rows: Number(d.rows ?? d.row_count ?? 0),
            latest: String(d.latest ?? d.last_updated ?? '—'),
            freshness: (d.freshness ?? 'FRESH') as HealthDomain['freshness'],
            origin: d.data_origin ?? d.origin ?? 'SYNTHETIC',
          }))
        );
      }
    } catch {
      /* section hides */
    }

    // Model health
    try {
      const api = await apiFetch<any>('/governance/model-health', {}, token);
      const rows: any[] = Array.isArray(api?.models) ? api.models : Array.isArray(api) ? api : [];
      if (rows.length) setModels(rows as ModelRow[]);
    } catch {
      /* section hides */
    }

    // All models & Pending challengers for Model Approval
    try {
      const allRes = await apiFetch<any>('/models/all', {}, token);
      if (allRes?.models) setAllModels(allRes.models);

      const pendingRes = await apiFetch<any>('/models/pending', {}, token);
      if (pendingRes?.challengers) setPendingChallengers(pendingRes.challengers);

      const runsRes = await apiFetch<any>('/training/runs', {}, token);
      if (runsRes?.runs) setTrainingRuns(runsRes.runs);

      const approvalsRes = await apiFetch<any>('/models/approvals', {}, token);
      if (approvalsRes?.approvals) setApprovalsLog(approvalsRes.approvals);
    } catch {
      /* section hides */
    }

    // Decision memory
    try {
      const api = await apiFetch<any>('/ledger/decision-memory', {}, token);
      const rows: any[] = Array.isArray(api?.decisions) ? api.decisions : Array.isArray(api) ? api : [];
      setDecisions(rows.slice(0, 6));
    } catch {
      /* section hides */
    }

    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    loadGovernanceData();
    loadLedger(0);
  }, [loadGovernanceData, loadLedger]);

  const handleTriggerTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    setTriggeringTrain(true);
    setTrainMsg(null);
    try {
      const body: any = { domain: trainDomain };
      if (trainVersionId.trim()) body.dataset_version_id = parseInt(trainVersionId, 10);
      if (trainNote.trim()) body.note = trainNote.trim();

      const token = await getToken();
      const res = await apiPost<any>('/training/trigger', body, token);
      setTrainMsg({ text: res.message || 'Training run initiated successfully.', ok: true });
      setTrainNote('');
      // Reload runs
      setTimeout(loadGovernanceData, 1000);
      setTimeout(loadGovernanceData, 6000);
      setTimeout(loadGovernanceData, 9000);
    } catch (err: any) {
      setTrainMsg({ text: err.message || 'Failed to trigger training run.', ok: false });
    } finally {
      setTriggeringTrain(false);
    }
  };

  const handleModelAction = async (modelId: number, action: 'approve' | 'promote' | 'reject') => {
    setActionLoading(modelId);
    setActionMsg(null);
    try {
      const note = window.prompt(`Optional note for ${action}:`) || '';
      const token = await getToken();
      const res = await apiPost<any>(`/models/${modelId}/${action}`, { note }, token);
      setActionMsg({ text: res.message || `Model successfully ${action}d.`, ok: true });
      await loadGovernanceData();
    } catch (err: any) {
      setActionMsg({ text: err.message || `Failed to ${action} model.`, ok: false });
    } finally {
      setActionLoading(null);
    }
  };

  const handleRollback = async (modelId: number) => {
    if (!window.confirm('Are you sure you want to rollback the champion to this model version?')) return;
    setActionLoading(modelId);
    setActionMsg(null);
    try {
      const note = window.prompt('Rollback reason:') || 'Emergency rollback';
      const token = await getToken();
      const res = await apiPost<any>(`/models/${modelId}/rollback`, { note }, token);
      setActionMsg({ text: res.message || 'Rollback successful.', ok: true });
      await loadGovernanceData();
    } catch (err: any) {
      setActionMsg({ text: err.message || 'Rollback failed.', ok: false });
    } finally {
      setActionLoading(null);
    }
  };

  const filteredLedger = ledger.filter((r) => taskFilter === 'all' || r.predictionType.toLowerCase().includes(taskFilter));
  const freshColor = (f: string) => (f === 'FRESH' ? 'text-okt' : f === 'AGING' ? 'text-warnt' : 'text-dangert');

  return (
    <main className="flex-1 bg-deep min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold text-ink3 tracking-widest uppercase">Platform</span>
          <span className="text-ink3">/</span>
          <span className="text-[11px] font-bold text-accentt tracking-widest uppercase">Governance</span>
        </div>
        <h1 className="font-['Manrope'] text-3xl md:text-4xl font-bold text-ink tracking-tight">Trust &amp; Governance Center</h1>
        <p className="text-sm text-ink2 mt-1 max-w-2xl">
          Data health, champion/challenger model registry, human approval gates, training runs, and the immutable prediction ledger.
        </p>
      </header>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-1.5 mb-6 text-xs font-semibold">
        {(
          [
            ['health', 'Data Health', 'health_and_safety'],
            ['models', 'Model Health', 'psychology'],
            ['approval', 'Model Approvals & Training', 'verified_user'],
            ['ledger', 'Prediction Ledger', 'analytics'],
            ['memory', 'Decision Memory', 'history_edu'],
          ] as const
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 border ${
              tab === key
                ? 'bg-chipon text-inkb font-bold border-chipon shadow-sm'
                : 'border-line text-ink2 hover:text-ink hover:bg-frost/5'
            }`}
          >
            <span className="material-symbols-outlined !text-[15px]">{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* Data Health */}
      {tab === 'health' && health.length > 0 && (
        <section id="trust" className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-okt" style={{ fontVariationSettings: "'FILL' 1" }}>health_and_safety</span>
            Data Health Center
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {health.map((d) => (
              <div key={d.domain} className="liquid-glass-dark rounded-2xl p-5 border border-line">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-ink2">{d.domain}</span>
                  <span className={`text-[10px] font-bold uppercase ${freshColor(d.freshness)}`}>{d.freshness}</span>
                </div>
                <div className="font-['Space_Grotesk'] text-2xl font-bold text-accentt">{d.rows.toLocaleString('en-IN')}</div>
                <div className="text-[11px] text-ink3 mt-1">rows · latest {d.latest.slice(0, 10)}</div>
                <span className="inline-block mt-2 px-2 py-0.5 rounded bg-line text-ink2 text-[10px] font-bold border border-line2/30">
                  {d.origin}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Model Health */}
      {tab === 'models' && models.length > 0 && (
        <section id="memory" className="mb-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
            <span className="material-symbols-outlined text-accentt" style={{ fontVariationSettings: "'FILL' 1" }}>psychology</span>
            Model Health — Champion / Challenger Registry
          </h2>
          <div className="rounded-[24px] bg-deep2 border border-line p-5 shadow-xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line">
                  {['Task', 'Model', 'Status', 'ROC-AUC', 'PR-AUC', 'MAE', 'R²', 'Lift', 'Split', 'Leakage'].map((h) => (
                    <th key={h} className="py-2.5 px-3 text-[10px] text-ink3 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[13px] divide-y divide-line/50">
                {models.map((m, i) => (
                  <tr key={i} className={`hover:bg-panel4/30 transition-colors ${m.status === 'challenger' ? 'opacity-70' : ''}`}>
                    <td className="py-2.5 px-3 text-ink font-medium capitalize">{m.task.replace(/_/g, ' ')}</td>
                    <td className="py-2.5 px-3 text-inkb font-mono text-xs">{m.model}</td>
                    <td className="py-2.5 px-3">
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${
                          m.status === 'champion'
                            ? 'bg-ok/20 text-okt border-ok/40'
                            : 'bg-warn/20 text-warnt border-warn/40'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-ink2 font-mono text-xs">{m.metric_roc_auc ?? '—'}</td>
                    <td className="py-2.5 px-3 text-ink2 font-mono text-xs">{m.metric_pr_auc ?? '—'}</td>
                    <td className="py-2.5 px-3 text-ink2 font-mono text-xs">{m.metric_mae ?? '—'}</td>
                    <td className="py-2.5 px-3 text-ink2 font-mono text-xs">{m.metric_r2 ?? '—'}</td>
                    <td className="py-2.5 px-3 text-ink2 font-mono text-xs">{m.metric_lift ? `${m.metric_lift}×` : '—'}</td>
                    <td className="py-2.5 px-3 text-ink3 text-xs capitalize">{m.split_type ?? '—'}</td>
                    <td className="py-2.5 px-3">
                      <span className="text-[10px] font-bold text-okt bg-ok/10 border border-ok/30 px-1.5 py-0.5 rounded">
                        {m.leakage_status ?? 'PASS'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Model Approvals & Training Tab */}
      {tab === 'approval' && (
        <div className="space-y-8">
          {/* Notifications */}
          {actionMsg && (
            <div className={`p-4 rounded-xl border text-xs font-semibold ${
              actionMsg.ok ? 'bg-ok/10 border-ok/30 text-okt' : 'bg-danger/10 border-danger/30 text-dangert'
            }`}>
              {actionMsg.text}
            </div>
          )}

          {/* Trigger Training Run */}
          <section className="liquid-glass-dark rounded-2xl p-6 border border-line">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-accentt">model_training</span>
              Trigger Training Run (Modal / ML Pipeline)
            </h2>
            <form onSubmit={handleTriggerTraining} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div>
                <label className="block text-[11px] font-bold text-ink2 uppercase tracking-wider mb-1.5">
                  Target Domain
                </label>
                <select
                  value={trainDomain}
                  onChange={(e) => setTrainDomain(e.target.value)}
                  className="w-full bg-deep2 border border-line rounded-lg px-3 py-2 text-xs text-ink focus:outline-none focus:border-accentt"
                >
                  <option value="production">Production (Forecast &amp; Shortfall)</option>
                  <option value="equipment">Equipment (Telemetry &amp; Failure)</option>
                  <option value="exploration">Exploration (Prospectivity AI)</option>
                  <option value="maintenance">Maintenance (Scheduling)</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-ink2 uppercase tracking-wider mb-1.5">
                  Dataset Version ID (Optional)
                </label>
                <input
                  type="number"
                  placeholder="e.g. 1"
                  value={trainVersionId}
                  onChange={(e) => setTrainVersionId(e.target.value)}
                  className="w-full bg-deep2 border border-line rounded-lg px-3 py-2 text-xs text-ink placeholder-ink3 focus:outline-none focus:border-accentt"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-ink2 uppercase tracking-wider mb-1.5">
                  Execution Note
                </label>
                <input
                  type="text"
                  placeholder="e.g. Scheduled retrain on latest telemetry"
                  value={trainNote}
                  onChange={(e) => setTrainNote(e.target.value)}
                  className="w-full bg-deep2 border border-line rounded-lg px-3 py-2 text-xs text-ink placeholder-ink3 focus:outline-none focus:border-accentt"
                />
              </div>

              <div>
                <button
                  type="submit"
                  disabled={triggeringTrain}
                  className="w-full py-2.5 px-4 rounded-lg bg-accentt text-inkb text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all shadow-md"
                >
                  {triggeringTrain ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                      Queueing...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                      Start Training Run
                    </>
                  )}
                </button>
              </div>
            </form>

            {trainMsg && (
              <p className={`mt-3 text-xs font-semibold ${trainMsg.ok ? 'text-okt' : 'text-dangert'}`}>
                {trainMsg.text}
              </p>
            )}
          </section>

          {/* Training Runs Monitor */}
          {trainingRuns.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-infot">hourglass_bottom</span>
                Recent Training Runs
              </h2>
              <div className="rounded-[20px] bg-deep2 border border-line p-4 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line text-[10px] text-ink3 uppercase tracking-widest">
                      <th className="py-2 px-3">Run Tag</th>
                      <th className="py-2 px-3">Domain</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Triggered By</th>
                      <th className="py-2 px-3">Triggered At</th>
                      <th className="py-2 px-3">Data Origin</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-line/40">
                    {trainingRuns.map((r) => (
                      <tr key={r.id} className="hover:bg-panel4/20">
                        <td className="py-2.5 px-3 font-mono text-accentt">{r.run_tag}</td>
                        <td className="py-2.5 px-3 font-medium capitalize text-ink">{r.domain}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                            r.status === 'completed'
                              ? 'bg-ok/20 text-okt border border-ok/30'
                              : r.status === 'running'
                              ? 'bg-infot/20 text-infot border border-infot/30 animate-pulse'
                              : r.status === 'failed'
                              ? 'bg-danger/20 text-dangert border border-danger/30'
                              : 'bg-warn/20 text-warnt border border-warn/30'
                          }`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-ink2">{r.triggered_by}</td>
                        <td className="py-2.5 px-3 text-ink3 font-mono text-[11px]">{String(r.triggered_at).slice(0, 16)}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-1.5 py-0.5 rounded bg-ink3/20 text-[10px] font-bold text-ink2">
                            {r.data_origin ?? 'SYNTHETIC'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Challenger Models Pending Approval Gate */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
                <span className="material-symbols-outlined text-warnt">verified_user</span>
                Challenger Models — Human Approval Gate
              </h2>
              <button
                onClick={loadGovernanceData}
                className="text-[11px] font-bold text-ink3 hover:text-accentt flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">refresh</span>
                Refresh Registry
              </button>
            </div>

            {pendingChallengers.length === 0 ? (
              <div className="p-6 text-center rounded-2xl bg-deep2 border border-line text-xs text-ink3">
                No challenger models currently pending approval. Run a training session above to generate new candidate models.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {pendingChallengers.map((m) => (
                  <div key={m.id} className="liquid-glass-dark rounded-2xl p-5 border border-line flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-inkb font-mono">
                          {m.version || m.model}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-warn/20 text-warnt border border-warn/40 text-[10px] font-bold uppercase">
                          Challenger
                        </span>
                      </div>
                      <div className="text-sm font-bold text-ink capitalize mb-3">
                        {m.task.replace(/_/g, ' ')}
                      </div>

                      {/* Metrics comparison grid */}
                      <div className="grid grid-cols-3 gap-2 bg-deep2/80 rounded-xl p-3 border border-line2/30 mb-4 text-xs font-mono">
                        {m.metric_roc_auc !== null && m.metric_roc_auc !== undefined && (
                          <div>
                            <div className="text-[10px] text-ink3 uppercase">ROC-AUC</div>
                            <div className="font-bold text-ink">{m.metric_roc_auc}</div>
                          </div>
                        )}
                        {m.metric_pr_auc !== null && m.metric_pr_auc !== undefined && (
                          <div>
                            <div className="text-[10px] text-ink3 uppercase">PR-AUC</div>
                            <div className="font-bold text-ink">{m.metric_pr_auc}</div>
                          </div>
                        )}
                        {m.metric_mae !== null && m.metric_mae !== undefined && (
                          <div>
                            <div className="text-[10px] text-ink3 uppercase">MAE</div>
                            <div className="font-bold text-ink">{m.metric_mae}</div>
                          </div>
                        )}
                        {m.metric_r2 !== null && m.metric_r2 !== undefined && (
                          <div>
                            <div className="text-[10px] text-ink3 uppercase">R²</div>
                            <div className="font-bold text-ink">{m.metric_r2}</div>
                          </div>
                        )}
                        {m.metric_lift !== null && m.metric_lift !== undefined && (
                          <div>
                            <div className="text-[10px] text-ink3 uppercase">Lift</div>
                            <div className="font-bold text-ink">{m.metric_lift}×</div>
                          </div>
                        )}
                        <div>
                          <div className="text-[10px] text-ink3 uppercase">Leakage</div>
                          <div className="font-bold text-okt">{m.leakage_status ?? 'PASS'}</div>
                        </div>
                      </div>

                      {/* Lineage & Safety Checklist */}
                      <div className="bg-deep2/50 rounded-xl p-3 border border-line2/30 mb-4 flex flex-col gap-1.5 text-[11px]">
                        <div className="flex items-center justify-between text-ink3">
                          <span>Artifact Checksum:</span>
                          <span className="font-mono text-ink2">{m.artifact_sha256 ? `${m.artifact_sha256.slice(0, 12)}...` : 'SHA-256 Verified'}</span>
                        </div>
                        <div className="flex items-center justify-between text-ink3">
                          <span>Provenance Lineage:</span>
                          <span className="text-ink2">Run #{m.training_run_id ?? 'Live'} · {m.split_type ?? 'temporal'}</span>
                        </div>
                        <div className="flex items-center justify-between text-ink3">
                          <span>Human Governance Gate:</span>
                          {m.approved_by ? (
                            <span className="text-okt font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined !text-[12px]">verified</span>
                              Approved by {m.approved_by}
                            </span>
                          ) : (
                            <span className="text-warnt font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined !text-[12px]">pending</span>
                              Pending Domain Review
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-ink3 mb-4">
                        <span>Origin: <strong className="text-ink2">{m.data_origin ?? 'SYNTHETIC'}</strong></span>
                        {m.smoke_test_status && (
                          <>
                            <span>·</span>
                            <span className="text-ink2">Smoke Test: <strong className="text-okt">{m.smoke_test_status}</strong></span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-3 border-t border-line">
                      {!m.approved_by && m.id && (
                        <button
                          onClick={() => handleModelAction(m.id!, 'approve')}
                          disabled={actionLoading === m.id}
                          className="flex-1 py-2 px-3 rounded-lg border border-ok/40 bg-ok/10 text-okt text-xs font-bold hover:bg-ok/20 transition-all flex items-center justify-center gap-1 shadow-sm"
                        >
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          Approve Candidate
                        </button>
                      )}
                      {m.id && (
                        <button
                          onClick={() => handleModelAction(m.id!, 'promote')}
                          disabled={actionLoading === m.id || !m.approved_by}
                          title={!m.approved_by ? "Candidate model must be approved before promotion to champion." : "Promote approved model to active champion"}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-sm ${
                            m.approved_by
                              ? 'bg-accentt text-inkb hover:opacity-90 cursor-pointer'
                              : 'bg-panel3/60 text-ink3/40 border border-line2/20 cursor-not-allowed'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[14px]">rocket_launch</span>
                          Promote to Champion
                        </button>
                      )}
                      {m.id && (
                        <button
                          onClick={() => handleModelAction(m.id!, 'reject')}
                          disabled={actionLoading === m.id}
                          className="py-2 px-2.5 rounded-lg border border-danger/40 bg-danger/10 text-dangert text-xs font-bold hover:bg-danger/20 transition-all"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Active Champions & Rollback Section */}
          <section>
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
              <span className="material-symbols-outlined text-okt">workspace_premium</span>
              Active Champions &amp; Emergency Rollback
            </h2>
            <div className="rounded-[20px] bg-deep2 border border-line p-4 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line text-[10px] text-ink3 uppercase tracking-widest">
                    <th className="py-2 px-3">Task</th>
                    <th className="py-2 px-3">Champion Model</th>
                    <th className="py-2 px-3">Version</th>
                    <th className="py-2 px-3">Promoted At</th>
                    <th className="py-2 px-3">Origin</th>
                    <th className="py-2 px-3">Emergency Action</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-line/40">
                  {allModels
                    .filter((m) => m.status === 'champion')
                    .map((m) => (
                      <tr key={m.id || m.task} className="hover:bg-panel4/20">
                        <td className="py-2.5 px-3 font-medium capitalize text-ink">{m.task.replace(/_/g, ' ')}</td>
                        <td className="py-2.5 px-3 font-mono text-accentt">{m.model}</td>
                        <td className="py-2.5 px-3 font-mono text-ink2">{m.version || 'v1.0'}</td>
                        <td className="py-2.5 px-3 text-ink3 font-mono text-[11px]">{m.promoted_at ? String(m.promoted_at).slice(0, 16) : 'Initial'}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-1.5 py-0.5 rounded bg-ink3/20 text-[10px] font-bold text-ink2">
                            {m.data_origin ?? 'SYNTHETIC'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          {/* Find retired predecessor for this task */}
                          {(() => {
                            const retired = allModels.find(
                              (prev) => prev.task === m.task && (prev.status === 'retired' || prev.status === 'challenger') && prev.id !== m.id
                            );
                            if (retired?.id) {
                              return (
                                <button
                                  onClick={() => handleRollback(retired.id!)}
                                  className="text-[11px] font-bold text-dangert border border-danger/40 bg-danger/10 px-2 py-1 rounded hover:bg-danger/20 transition-all flex items-center gap-1"
                                >
                                  <span className="material-symbols-outlined text-[13px]">history</span>
                                  Rollback to {retired.version || `#${retired.id}`}
                                </button>
                              );
                            }
                            return <span className="text-[11px] text-ink3">No prior model</span>;
                          })()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Model Approvals Audit Trail */}
          {approvalsLog.length > 0 && (
            <section>
              <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-infot">history</span>
                Model Approvals Audit Trail
              </h2>
              <div className="rounded-[20px] bg-deep2 border border-line p-4 overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line text-[10px] text-ink3 uppercase tracking-widest">
                      <th className="py-2 px-3">Timestamp</th>
                      <th className="py-2 px-3">Action</th>
                      <th className="py-2 px-3">Actor</th>
                      <th className="py-2 px-3">Role</th>
                      <th className="py-2 px-3">Model / Version</th>
                      <th className="py-2 px-3">Note</th>
                    </tr>
                  </thead>
                  <tbody className="text-xs divide-y divide-line/40">
                    {approvalsLog.map((log) => (
                      <tr key={log.id} className="hover:bg-panel4/20">
                        <td className="py-2 px-3 text-ink3 font-mono text-[11px]">{String(log.created_at).slice(0, 16)}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            log.action === 'promoted'
                              ? 'bg-accentt/20 text-accentt border border-accentt/30'
                              : log.action === 'approved'
                              ? 'bg-ok/20 text-okt border border-ok/30'
                              : log.action === 'rolled_back'
                              ? 'bg-danger/20 text-dangert border border-danger/30'
                              : 'bg-warn/20 text-warnt border border-warn/30'
                          }`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-semibold text-ink">{log.actor_id}</td>
                        <td className="py-2 px-3 text-ink2">{log.actor_role}</td>
                        <td className="py-2 px-3 font-mono text-ink2">{log.version || log.model || `#${log.model_id}`}</td>
                        <td className="py-2 px-3 text-ink3 max-w-[240px] truncate">{log.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* Prediction Ledger */}
      {tab === 'ledger' && (
        <section id="ledger" className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
              <span className="material-symbols-outlined text-inkb" style={{ fontVariationSettings: "'FILL' 1" }}>analytics</span>
              Prediction Ledger
            </h2>
            <div className="flex bg-panel2 rounded-md p-0.5 border border-line2/30 text-[11px] w-fit">
              {['all', 'production', 'equipment', 'prospectivity', 'scenario'].map((t) => (
                <button
                  key={t}
                  onClick={() => setTaskFilter(t)}
                  className={`px-2.5 py-1 rounded transition-colors capitalize ${
                    taskFilter === t ? 'bg-chipon text-inkb font-bold' : 'text-ink2'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] bg-deep2 border border-line p-5 shadow-2xl overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line">
                  {['Time (UTC)', 'Entity', 'Task', 'Confidence', 'Recommended Action', 'Origin'].map((h) => (
                    <th key={h} className="py-2.5 px-3 text-[10px] text-ink3 uppercase tracking-widest">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[13px] divide-y divide-line/50">
                {filteredLedger.map((row) => (
                  <tr key={row.id} className={`hover:bg-panel4/30 transition-colors ${row.status === 'auto-resolved' ? 'opacity-70' : ''}`}>
                    <td className="py-2.5 px-3 text-ink2 font-mono text-xs">{row.time}</td>
                    <td className="py-2.5 px-4 font-medium text-ink">{row.entityNode}</td>
                    <td className="py-2.5 px-3 text-inkb">{row.predictionType}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-panel2 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${row.confidence >= 80 ? 'bg-danger' : row.confidence >= 50 ? 'bg-warn' : 'bg-ok'}`}
                            style={{ width: `${row.confidence}%` }}
                          ></div>
                        </div>
                        <span
                          className={`font-semibold text-xs ${
                            row.confidence >= 80 ? 'text-dangert' : row.confidence >= 50 ? 'text-warnt' : 'text-okt'
                          }`}
                        >
                          {row.confidence}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-ink2 max-w-[280px] truncate">{row.recommendedAction}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded bg-ink3/30 border border-line3/50 text-inkb text-[10px] font-bold">
                        {row.dataOrigin ?? 'SYNTHETIC'}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filteredLedger.length && !loading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-ink3">
                      No ledger entries match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="mt-4 flex justify-center">
              {hasMore && (
                <button
                  onClick={() => {
                    const next = page + 1;
                    setPage(next);
                    loadLedger(next);
                  }}
                  className="text-[12px] font-bold uppercase tracking-wider text-ink3 hover:text-accentt transition-colors"
                >
                  Load more records…
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Decision Memory */}
      {tab === 'memory' && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-2">
              <span className="material-symbols-outlined text-infot" style={{ fontVariationSettings: "'FILL' 1" }}>history_edu</span>
              Decision Memory &amp; Outcome Feedback Loop
            </h2>
            <button
              onClick={async () => {
                const problem = window.prompt("Operational Problem (e.g. Crusher Surge / Shift S2 Deficit):");
                if (!problem) return;
                const recommendation = window.prompt("Recommendation / Intervention:") || "";
                try {
                  await apiPost('/decisions', { problem, recommendation, status: 'approved' });
                  loadGovernanceData();
                } catch (e: any) {
                  alert(e.message || "Failed to record decision");
                }
              }}
              className="text-xs font-bold text-accentt border border-accentt/40 bg-accentt/10 px-3 py-1.5 rounded-lg hover:bg-accentt/20 transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Record Operational Decision
            </button>
          </div>

          {decisions.length === 0 ? (
            <div className="p-8 text-center rounded-2xl bg-deep2 border border-line text-xs text-ink3">
              No decisions recorded yet. Record an operational decision above or approve a scenario.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {decisions.map((d: any, i: number) => (
                <div key={d.id || i} className="dark-glass rounded-xl p-5 border border-line flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-bold text-ink capitalize">{String(d.decision_type ?? d.event_type ?? 'decision').replace(/_/g, ' ')}</span>
                      <span className="text-[10px] font-mono text-ink3">{String(d.created_at ?? '').slice(0, 16)}</span>
                    </div>
                    <p className="text-xs text-ink2 leading-relaxed">{d.summary ?? d.payload ?? JSON.stringify(d).slice(0, 140)}</p>

                    {/* Outcome feedback stats if recorded */}
                    {d.delta !== null && d.delta !== undefined && (
                      <div className="mt-3 p-2.5 rounded-lg bg-deep2/80 border border-line2/30 grid grid-cols-3 gap-2 text-center text-xs font-mono">
                        <div>
                          <div className="text-[9px] uppercase text-ink3">Predicted</div>
                          <div className="font-bold text-ink">{d.predicted_value} t</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-ink3">Actual</div>
                          <div className="font-bold text-accentt">{d.actual_value} t</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-ink3">Variance / Eff</div>
                          <div className={`font-bold ${d.delta >= 0 ? 'text-okt' : 'text-warnt'}`}>
                            {d.delta > 0 ? `+${d.delta}` : d.delta} t ({Math.round(Number(d.effectiveness || 1) * 100)}%)
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                        d.status === 'executed'
                          ? 'bg-ok/10 text-okt border-ok/30'
                          : d.status === 'approved'
                          ? 'bg-accentt/10 text-accentt border-accentt/30'
                          : 'bg-warn/10 text-warnt border-warn/30'
                      }`}>
                        {d.status ?? 'recorded'}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-ink3/20 border border-line3/50 text-inkb text-[10px] font-bold">
                        {d.data_origin ?? 'SYNTHETIC'}
                      </span>
                    </div>

                    {d.id && d.status !== 'executed' && (
                      <button
                        onClick={async () => {
                          const predStr = window.prompt("Predicted gain/tonnage (t):", "50");
                          if (!predStr) return;
                          const actStr = window.prompt("Actual post-shift outcome realized (t):", "48");
                          if (!actStr) return;
                          try {
                            await apiPost(`/decisions/${d.id}/outcome`, {
                              predicted_value: parseFloat(predStr),
                              actual_value: parseFloat(actStr),
                            });
                            loadGovernanceData();
                          } catch (e: any) {
                            alert(e.message || "Failed to record outcome");
                          }
                        }}
                        className="text-[11px] font-bold text-okt border border-ok/40 bg-ok/10 px-2.5 py-1 rounded-lg hover:bg-ok/20 transition-all flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[13px]">add_task</span>
                        Record Outcome
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
