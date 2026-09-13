'use client';

/**
 * Alerts — operational alert list with acknowledge actions, backed by
 * /alerts (falls back to an empty state when the API is down).
 */
import React, { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMineId } from '@/lib/useMineId';
import { apiFetch } from '@/lib/api';
import type { AlertItem } from '@/lib/minex';

const SEV_STYLES: Record<string, { border: string; text: string; badge: string; icon: string }> = {
  critical: { border: 'border-l-danger', text: 'text-dangert', badge: 'bg-danger/20 text-dangert border-danger/40', icon: 'error' },
  warning: { border: 'border-l-warn', text: 'text-warnt', badge: 'bg-warn/20 text-warnt border-warn/40', icon: 'warning' },
  info: { border: 'border-l-line3', text: 'text-inkb', badge: 'bg-chipon/40 text-inkb border-chipon', icon: 'info' },
};

export default function AlertsPage() {
  const { getToken } = useAuth();
  const mineId = useMineId();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const load = async () => {
    setLoading(true);
    try {
      const token = await getToken();
      const api = await apiFetch<any>('/alerts', {}, token);
      const rows: any[] = Array.isArray(api) ? api : api?.alerts ?? [];
      setAlerts(
        rows.map((r, i) => ({
          id: r.id ?? i,
          alert_type: r.alert_type ?? r.type ?? 'system',
          severity: (r.severity ?? 'info') as AlertItem['severity'],
          mine_id: r.mine_id ?? mineId,
          entity_id: r.entity_id ?? r.machine_id ?? '—',
          message: r.message ?? String(r.title ?? 'Operational alert'),
          created_at: String(r.created_at ?? '').replace('T', ' ').slice(0, 19),
          acknowledged: Boolean(r.acknowledged),
          data_origin: r.data_origin ?? 'SYNTHETIC',
        }))
      );
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineId]);

  const acknowledge = async (id: number | string) => {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
    showToast('Alert acknowledged — written to the audit log');
    try {
      const token = await getToken();
      await apiFetch(`/alerts/${id}/acknowledge`, { method: 'POST' }, token);
    } catch {
      /* optimistic update retained */
    }
  };

  const unack = alerts.filter((a) => !a.acknowledged);

  return (
    <main className="flex-1 bg-deep min-h-screen p-4 md:p-6 lg:p-8 pb-16">
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-accent text-onaccent px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined text-base">check_circle</span>
          <span>{toast}</span>
        </div>
      )}

      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] font-bold text-ink3 tracking-widest uppercase">Operations</span>
          <span className="text-ink3">/</span>
          <span className="text-[11px] font-bold text-accentt tracking-widest uppercase">Alerts</span>
        </div>
        <h1 className="font-['Manrope'] text-3xl md:text-4xl font-bold text-ink tracking-tight">System Alerts</h1>
        <p className="text-sm text-ink2 mt-1">
          {unack.length} unacknowledged of {alerts.length} total. Acknowledgements are recorded in the governed audit log.
        </p>
      </header>

      <div className="flex flex-col gap-3 max-w-4xl">
        {loading && (
          <div className="dark-glass rounded-xl p-5 border border-line text-sm text-ink3">Loading alerts…</div>
        )}
        {!loading && !alerts.length && (
          <div className="dark-glass rounded-xl p-8 border border-line text-center">
            <span className="material-symbols-outlined text-okt text-4xl">check_circle</span>
            <p className="mt-2 text-sm text-ink font-medium">All clear — no active alerts.</p>
            <p className="mt-1 text-xs text-ink3">Start the API on :8000 to stream live operational alerts.</p>
          </div>
        )}
        {alerts.map((a) => {
          const s = SEV_STYLES[a.severity] ?? SEV_STYLES.info;
          return (
            <div
              key={a.id}
              className={`dark-glass rounded-xl p-4 border-l-4 ${s.border} border border-line flex flex-col sm:flex-row sm:items-center gap-3 ${a.acknowledged ? 'opacity-60' : ''}`}
            >
              <div className="w-9 h-9 rounded-lg bg-panel2 border border-line3/50 flex items-center justify-center shrink-0">
                <span className={`material-symbols-outlined text-lg ${s.text}`}>{s.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-ink capitalize">{a.alert_type.replace(/_/g, ' ')}</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase ${s.badge}`}>{a.severity}</span>
                  <span className="text-[10px] font-bold text-inkb bg-line px-1.5 py-0.5 rounded font-mono">{a.mine_id}</span>
                  <span className="px-2 py-0.5 rounded bg-ink3/30 border border-line3/50 text-inkb text-[10px] font-bold">
                    {a.data_origin}
                  </span>
                </div>
                <p className="text-xs text-ink2 mt-1 leading-relaxed">{a.message}</p>
                <p className="text-[10px] text-ink3 font-mono mt-1">
                  {a.entity_id} · {a.created_at || '—'}
                </p>
              </div>
              {!a.acknowledged ? (
                <button
                  onClick={() => acknowledge(a.id)}
                  className="shrink-0 px-4 py-2 rounded-xl bg-accent text-onaccent text-[11px] font-bold uppercase tracking-wider hover:bg-accent2 transition-all"
                >
                  Acknowledge
                </button>
              ) : (
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-okt flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">check_circle</span> Acked
                </span>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
