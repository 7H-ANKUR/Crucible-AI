'use client';

/**
 * ML Lab — the Crucible AI engine surfaced inside Crucible AI.
 *
 * Structure mirrors how a run is actually reasoned about:
 *   datasets → launch → runs → the selected run's nodes, model, and diagnosis.
 *
 * The engine is an internal service that can be down while the rest of the
 * platform is healthy, so every panel renders an explicit unavailable state
 * rather than an error or an empty box pretending to be data.
 */
import React, { useMemo, useState } from 'react';
import { Card, PageHeader, Pill } from '@/components/mobile/ui';
import {
  degradedMessage,
  isTerminal,
  useEngine,
  useEngineAction, useEngineUpload,
  type EngineEnvelope,
  type LabCandidate,
  type LabDataset,
  type LabExecution,
  type LabNode,
} from '@/lib/lab';

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  succeeded: 'bg-ok/15 text-ok border-ok/30',
  running: 'bg-accent/15 text-accentt border-accent/30',
  queued: 'bg-panel3 text-ink2 border-line',
  failed: 'bg-bad/15 text-bad border-bad/30',
  cancelled: 'bg-panel3 text-ink3 border-line',
  lost: 'bg-warn/15 text-warn border-warn/30',
};

function StatusChip({ status }: { status?: string }) {
  const key = String(status ?? 'unknown').toLowerCase();
  const tone = STATUS_TONE[key] ?? 'bg-panel3 text-ink2 border-line';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${tone}`}>
      {key}
    </span>
  );
}

/** Shown whenever the engine could not answer. Says what happened and what to do. */
function Unavailable({ envelope }: { envelope: EngineEnvelope<unknown> | null }) {
  return (
    <div className="flex items-start gap-3 rounded-xl bg-warn/10 border border-warn/25 px-4 py-3">
      <span className="material-symbols-outlined !text-[18px] text-warn mt-0.5">cloud_off</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-ink">ML Lab unavailable</p>
        <p className="text-[11px] text-ink2 mt-0.5 leading-snug">{degradedMessage(envelope)}</p>
        <p className="text-[11px] text-ink3 mt-1">
          The rest of Crucible AI is unaffected. Start the engine on port 8100 to restore this page.
        </p>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink3 py-6 text-center">{children}</p>;
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-3 gap-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-ink2">{children}</h2>
      {hint && <span className="text-[10px] text-ink3 shrink-0">{hint}</span>}
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-line/50 last:border-0">
      <span className="text-[11px] text-ink3">{k}</span>
      <span className="text-[11px] font-semibold text-ink text-right tabular-nums">{v}</span>
    </div>
  );
}

function fmt(n: unknown): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return Math.abs(n) >= 1000 ? n.toFixed(0) : n.toFixed(4);
}

// ── page ─────────────────────────────────────────────────────────────────────

type Tab = 'nodes' | 'model' | 'diagnosis';

export default function LabPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('nodes');
  const [datasetId, setDatasetId] = useState('');
  const [target, setTarget] = useState('');
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);

  const status = useEngine<Record<string, unknown>>('/status', { refreshMs: 30_000 });
  const datasets = useEngine<LabDataset[]>('/datasets');
  const runs = useEngine<LabExecution[]>('/pipelines', { refreshMs: 5_000 });
  const action = useEngineAction();
  const uploader = useEngineUpload();
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function onUpload(file: File) {
    setUploadMsg(null);
    const result = await uploader.upload(file);
    if (result?.engine_available && result.data?.dataset_id) {
      const rows = result.data.rows;
      setUploadMsg(
        `Registered ${file.name}${rows ? ` — ${rows.toLocaleString()} rows` : ''}. Select it below.`
      );
      setDatasetId(result.data.dataset_id);
      void datasets.reload();
    } else {
      setUploadMsg(uploader.error ?? 'The engine did not accept the file.');
    }
  }

  const runList = useMemo(() => {
    const raw = runs.data;
    return Array.isArray(raw) ? raw : [];
  }, [runs.data]);

  const current = useMemo(
    () => runList.find((r) => r.execution_id === selected) ?? null,
    [runList, selected]
  );

  // Detail queries only fire once a run is selected, and stop polling once it
  // reaches a terminal state.
  const detailPath = selected ? `/pipelines/${selected}` : null;
  const stopWhenDone = () => isTerminal(current?.status);

  const nodes = useEngine<LabNode[]>(detailPath && `${detailPath}/nodes`, {
    refreshMs: 5_000,
    stopWhen: stopWhenDone,
  });
  const candidates = useEngine<LabCandidate[]>(
    tab === 'model' && detailPath ? `${detailPath}/candidates` : null
  );
  const metrics = useEngine<Record<string, unknown>>(
    tab === 'model' && detailPath ? `${detailPath}/model/metrics` : null
  );
  const rootCause = useEngine<Record<string, unknown>>(
    tab === 'diagnosis' && detailPath ? `${detailPath}/fault/root-cause` : null
  );
  const recoveryPlan = useEngine<Record<string, unknown>>(
    tab === 'diagnosis' && detailPath ? `${detailPath}/recovery/plan` : null
  );

  const engineUp = status.envelope?.engine_available ?? runs.envelope?.engine_available ?? null;

  async function launch() {
    setLaunchMsg(null);
    if (!datasetId.trim()) {
      setLaunchMsg('Choose a dataset first.');
      return;
    }
    const result = await action.run('/pipelines/run', {
      dataset_id: datasetId.trim(),
      target: target.trim() || null,
    });
    if (!result) {
      setLaunchMsg(action.error ?? 'Could not start the run.');
      return;
    }
    if (!result.engine_available) {
      setLaunchMsg(degradedMessage(result));
      return;
    }
    const id = (result.data as { execution_id?: string } | undefined)?.execution_id;
    setLaunchMsg(id ? `Run ${id.slice(0, 8)} queued.` : 'Run queued.');
    setSelected(id ?? null);
    void runs.reload();
  }

  async function heal() {
    if (!selected) return;
    const result = await action.run(`/pipelines/${selected}/self-healing/trigger`);
    setLaunchMsg(
      !result
        ? action.error ?? 'Could not trigger recovery.'
        : result.engine_available
          ? 'Recovery started.'
          : degradedMessage(result)
    );
    void runs.reload();
  }

  return (
    <main className="flex-1 bg-page min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      <PageHeader
        kicker="Crucible AI"
        title="ML Lab"
        subtitle="Automated model building with fault diagnosis and recovery"
        right={
          <div className="flex items-center gap-2 bg-panel2 px-3 py-1.5 rounded-full border border-line">
            <span
              className={`w-2 h-2 rounded-full ${
                engineUp === null ? 'bg-ink3' : engineUp ? 'bg-ok animate-pulse' : 'bg-warn'
              }`}
            />
            <span className="text-[10px] font-bold text-ink2 uppercase tracking-wider">
              {engineUp === null ? 'Checking…' : engineUp ? 'Engine online' : 'Engine offline'}
            </span>
          </div>
        }
      />

      {engineUp === false && (
        <div className="mb-6">
          <Unavailable envelope={status.envelope ?? runs.envelope} />
        </div>
      )}

      {/* ── Launch ─────────────────────────────────────────────────────── */}
      <section className="mb-7">
        <SectionTitle hint="The engine picks the task, features and validation strategy">
          Start a run
        </SectionTitle>
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr_auto] gap-3 items-end">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink3">Dataset</span>
              <select
                id="lab-dataset"
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                className="mt-1 w-full bg-panel2 border border-line rounded-xl px-3 py-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">Select a dataset…</option>
                {(datasets.data ?? []).map((d) => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.original_filename ?? d.dataset_id}
                    {d.rows ? ` · ${d.rows.toLocaleString()} rows` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink3">
                Target column
              </span>
              <input
                id="lab-target"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="auto-detect"
                className="mt-1 w-full bg-panel2 border border-line rounded-xl px-3 py-2 text-xs text-ink placeholder:text-ink3 focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>

            <button
              onClick={() => void launch()}
              disabled={action.pending || engineUp === false}
              className="h-[38px] px-5 rounded-xl bg-btn text-btnt text-xs font-bold shadow-md hover:bg-btn/90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {action.pending ? 'Starting…' : 'Start run'}
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-line/60 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <span className="px-3 py-1.5 rounded-xl border border-line text-[11px] font-semibold text-ink2 hover:text-ink hover:bg-panel2 transition-colors">
                {uploader.pending ? 'Uploading…' : 'Upload CSV / XLSX'}
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                disabled={uploader.pending || engineUp === false}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.target.value = '';
                }}
              />
            </label>
            <span className="text-[10px] text-ink3">
              Registers the file with the engine, which profiles it and picks a validation strategy.
            </span>
          </div>

          {(datasets.data ?? []).length === 0 && datasets.envelope?.engine_available && (
            <p className="text-[11px] text-ink3 mt-3">
              No datasets registered with the engine yet — upload one above. Data Hub
              uploads go to the platform&apos;s own store and do not reach the engine.
            </p>
          )}
          {uploadMsg && <p className="text-[11px] text-accentt mt-2 font-medium">{uploadMsg}</p>}
          {launchMsg && <p className="text-[11px] text-accentt mt-3 font-medium">{launchMsg}</p>}
        </Card>
      </section>

      {/* ── Runs ───────────────────────────────────────────────────────── */}
      <section className="mb-7">
        <SectionTitle hint={runList.length ? `${runList.length} runs · newest first` : undefined}>
          Runs
        </SectionTitle>
        {runs.loading && !runs.envelope ? (
          <Card><Empty>Loading runs…</Empty></Card>
        ) : runs.envelope && !runs.envelope.engine_available ? (
          <Unavailable envelope={runs.envelope} />
        ) : runList.length === 0 ? (
          <Card><Empty>No runs yet. Start one above.</Empty></Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {runList.map((run) => (
              <Card
                key={run.execution_id}
                onClick={() => setSelected(run.execution_id)}
                className={
                  selected === run.execution_id ? '!border-accent ring-1 ring-accent/30' : ''
                }
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono text-[11px] text-ink2 truncate">
                    {run.execution_id.slice(0, 12)}
                  </span>
                  <StatusChip status={run.status} />
                </div>
                <p className="text-xs font-semibold text-ink truncate">
                  {run.dataset_path ?? run.dataset_id ?? 'unknown dataset'}
                </p>
                <p className="text-[11px] text-ink3 mt-0.5">
                  {run.task_type ?? 'task auto-detected'}
                  {run.target ? ` · target ${run.target}` : ''}
                </p>
                {run.error && (
                  <p className="text-[11px] text-bad mt-2 line-clamp-2">{run.error}</p>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ── Selected run ───────────────────────────────────────────────── */}
      {current && (
        <section>
          <SectionTitle hint={current.execution_id}>Run detail</SectionTitle>

          <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
            <Pill active={tab === 'nodes'} onClick={() => setTab('nodes')}>Pipeline</Pill>
            <Pill active={tab === 'model'} onClick={() => setTab('model')}>Model</Pill>
            <Pill active={tab === 'diagnosis'} onClick={() => setTab('diagnosis')}>Diagnosis</Pill>
          </div>

          {tab === 'nodes' && (
            <Card>
              {!nodes.envelope?.engine_available ? (
                <Unavailable envelope={nodes.envelope} />
              ) : (nodes.data ?? []).length === 0 ? (
                <Empty>No pipeline nodes recorded for this run.</Empty>
              ) : (
                <ol className="space-y-2">
                  {(nodes.data ?? []).map((node, i) => (
                    <li
                      key={node.node_id ?? i}
                      className="flex items-center gap-3 py-2 border-b border-line/50 last:border-0"
                    >
                      <span className="font-mono text-[10px] text-ink3 w-6 shrink-0 tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="text-xs font-semibold text-ink flex-1 min-w-0 truncate">
                        {node.name ?? node.node_id}
                      </span>
                      {node.error && (
                        <span className="text-[11px] text-bad truncate max-w-[45%]">{node.error}</span>
                      )}
                      <StatusChip status={node.status} />
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          {tab === 'model' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <SectionTitle hint="ranked by validation score">Candidates considered</SectionTitle>
                {!candidates.envelope?.engine_available ? (
                  <Unavailable envelope={candidates.envelope} />
                ) : (candidates.data ?? []).length === 0 ? (
                  <Empty>No candidates recorded. The run may not have reached training.</Empty>
                ) : (
                  <ol className="space-y-1">
                    {(candidates.data ?? []).map((c, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between gap-3 py-1.5 border-b border-line/50 last:border-0"
                      >
                        <span className="text-xs text-ink truncate">
                          {c.name ?? c.estimator ?? `candidate ${i + 1}`}
                        </span>
                        <span className="text-[11px] font-bold text-ink2 tabular-nums shrink-0">
                          {fmt(c.score)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              <Card>
                <SectionTitle>Validation metrics</SectionTitle>
                {!metrics.envelope?.engine_available ? (
                  <Unavailable envelope={metrics.envelope} />
                ) : !metrics.data || Object.keys(metrics.data).length === 0 ? (
                  <Empty>No metrics yet.</Empty>
                ) : (
                  <div>
                    {Object.entries(metrics.data).map(([k, v]) => (
                      <KV
                        key={k}
                        k={k.replace(/_/g, ' ')}
                        v={typeof v === 'number' ? fmt(v) : String(v)}
                      />
                    ))}
                  </div>
                )}
              </Card>
            </div>
          )}

          {tab === 'diagnosis' && (
            <div className="space-y-4">
              <Card>
                <SectionTitle hint="why the run failed, not just where">Root cause</SectionTitle>
                {!rootCause.envelope?.engine_available ? (
                  <Unavailable envelope={rootCause.envelope} />
                ) : !rootCause.data ? (
                  <Empty>
                    No fault recorded. Diagnosis appears once a run fails.
                  </Empty>
                ) : (
                  <pre className="text-[11px] text-ink2 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-72 overflow-y-auto">
                    {JSON.stringify(rootCause.data, null, 2)}
                  </pre>
                )}
              </Card>

              <Card>
                <SectionTitle hint="read the plan before running it">Recovery plan</SectionTitle>
                {!recoveryPlan.envelope?.engine_available ? (
                  <Unavailable envelope={recoveryPlan.envelope} />
                ) : !recoveryPlan.data ? (
                  <Empty>No recovery plan for this run.</Empty>
                ) : (
                  <>
                    <pre className="text-[11px] text-ink2 whitespace-pre-wrap break-words font-mono leading-relaxed max-h-60 overflow-y-auto">
                      {JSON.stringify(recoveryPlan.data, null, 2)}
                    </pre>
                    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-line">
                      <button
                        onClick={() => void heal()}
                        disabled={action.pending}
                        className="px-4 py-2 rounded-xl bg-btn text-btnt text-xs font-bold shadow-md hover:bg-btn/90 active:scale-95 transition-all disabled:opacity-40"
                      >
                        {action.pending ? 'Running…' : 'Run recovery'}
                      </button>
                      <span className="text-[11px] text-ink3">
                        Runs only when you ask. Nothing here fires automatically.
                      </span>
                    </div>
                  </>
                )}
              </Card>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
