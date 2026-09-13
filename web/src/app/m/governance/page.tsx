'use client';

/**
 * m/governance — segmented control over Data Health / Models / Ledger / Decisions.
 */
import React, { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Card, PageHeader, Pill } from '@/components/mobile/ui';
import { FALLBACK_LEDGER, mapLedger, type PredictionLedgerEntry } from '@/lib/crucible';

interface HealthDomain {
  domain: string;
  rows: number;
  latest: string;
  freshness: string;
}
interface ModelRow {
  task: string;
  model: string;
  status: string;
  metric_roc_auc?: number;
  metric_pr_auc?: number;
}

export default function MobileGovernance() {
  const [tab, setTab] = useState<'health' | 'models' | 'ledger'>('health');
  const [health, setHealth] = useState<HealthDomain[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [ledger, setLedger] = useState<PredictionLedgerEntry[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await apiFetch<any>('/ledger/data-health').catch(() => null);
      const domains: any[] = Array.isArray(h?.domains) ? h.domains : [];
      if (alive && domains.length)
        setHealth(
          domains.map((d) => ({
            domain: d.domain ?? '—',
            rows: Number(d.rows ?? 0),
            latest: String(d.latest ?? '—'),
            freshness: d.freshness ?? 'FRESH',
          }))
        );
      const m = await apiFetch<any>('/governance/model-health').catch(() => null);
      const rows: any[] = Array.isArray(m?.models) ? m.models : [];
      if (alive && rows.length)
        setModels(
          rows
            .filter((r) => r.status === 'champion')
            .map((r) => ({ task: r.task, model: r.model, status: r.status, metric_roc_auc: r.metric_roc_auc, metric_pr_auc: r.metric_pr_auc }))
        );
      const l = await apiFetch<any>('/ledger?limit=12').catch(() => null);
      if (alive && l) setLedger(mapLedger(l).length ? mapLedger(l) : FALLBACK_LEDGER);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="animate-fadeIn">
      <PageHeader kicker="Platform" title="Governance" subtitle="Health · models · ledger" />

      <div className="flex gap-2 mb-4">
        <Pill active={tab === 'health'} onClick={() => setTab('health')}>
          Health
        </Pill>
        <Pill active={tab === 'models'} onClick={() => setTab('models')}>
          Models
        </Pill>
        <Pill active={tab === 'ledger'} onClick={() => setTab('ledger')}>
          Ledger
        </Pill>
      </div>

      {tab === 'health' && (
        <div className="flex flex-col gap-2.5">
          {health.map((d) => (
            <Card key={d.domain} className="!p-3.5 flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-ink">{d.domain}</div>
                <div className="text-[10px] text-ink3">
                  {d.rows.toLocaleString('en-IN')} rows · {d.latest.slice(0, 10)}
                </div>
              </div>
              <span
                className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${
                  d.freshness === 'FRESH'
                    ? 'text-okt border-ok/40 bg-ok/10'
                    : 'text-warnt border-warn/40 bg-warn/10'
                }`}
              >
                {d.freshness}
              </span>
            </Card>
          ))}
          {!health.length && <Card className="text-center text-xs text-ink3">Data health loads with the API on :8000.</Card>}
        </div>
      )}

      {tab === 'models' && (
        <div className="flex flex-col gap-2.5">
          {models.map((m, i) => (
            <Card key={i} className="!p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-ink capitalize">{m.task.replace(/_/g, ' ')}</span>
                <span className="text-[9px] font-bold text-okt bg-ok/10 border border-ok/30 px-2 py-0.5 rounded-full uppercase">
                  Champion
                </span>
              </div>
              <div className="text-[11px] text-inkb font-mono mt-1">{m.model}</div>
              {(m.metric_roc_auc != null || m.metric_pr_auc != null) && (
                <div className="flex gap-4 mt-1 text-[11px] text-ink2">
                  {m.metric_roc_auc != null && <span>ROC-AUC {m.metric_roc_auc}</span>}
                  {m.metric_pr_auc != null && <span>PR-AUC {m.metric_pr_auc}</span>}
                </div>
              )}
            </Card>
          ))}
          {!models.length && <Card className="text-center text-xs text-ink3">Model registry loads with the API.</Card>}
        </div>
      )}

      {tab === 'ledger' && (
        <div className="flex flex-col gap-2">
          {ledger.map((e) => (
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
      )}
    </div>
  );
}
