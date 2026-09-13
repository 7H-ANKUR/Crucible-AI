'use client';

/**
 * m/alerts — alert cards with acknowledge.
 */
import React from 'react';
import { useAlertsList } from '@/lib/hooks';
import { Card, PageHeader, SeverityBadge } from '@/components/mobile/ui';
import { apiFetch } from '@/lib/api';

export default function MobileAlerts() {
  const { alerts, loading, reload } = useAlertsList();
  const unack = alerts.filter((a) => !a.acknowledged);

  const acknowledge = async (id: number | string) => {
    try {
      await apiFetch(`/alerts/${id}/acknowledge`, { method: 'POST' });
    } catch {
      /* optimistic */
    }
    setTimeout(reload, 600);
  };

  return (
    <div className="animate-fadeIn">
      <PageHeader
        kicker="Operations"
        title="Alerts"
        subtitle={`${unack.length} unacknowledged of ${alerts.length}`}
      />

      {loading && <Card className="text-center text-xs text-ink3">Loading alerts…</Card>}

      {!loading && !alerts.length && (
        <Card className="text-center py-8">
          <span className="material-symbols-outlined text-okt text-4xl">check_circle</span>
          <p className="mt-2 text-sm font-medium text-ink">All clear</p>
          <p className="mt-1 text-xs text-ink3">Start the API on :8000 for live alerts.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {alerts.map((a) => (
          <Card key={a.id} className={`!p-3.5 ${a.acknowledged ? 'opacity-55' : ''}`}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-bold text-ink capitalize">{a.alert_type.replace(/_/g, ' ')}</span>
              <SeverityBadge severity={a.severity} />
            </div>
            <p className="text-[11px] text-ink2 leading-snug">{a.message}</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[9px] text-ink3 font-mono">
                {a.mine_id} · {a.created_at || '—'}
              </span>
              {!a.acknowledged ? (
                <button
                  onClick={() => acknowledge(a.id)}
                  className="px-3 py-1.5 bg-accent text-onaccent text-[10px] font-bold uppercase rounded-lg active:scale-95 transition-transform"
                >
                  Ack
                </button>
              ) : (
                <span className="text-[9px] font-bold uppercase text-okt">Acked</span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
