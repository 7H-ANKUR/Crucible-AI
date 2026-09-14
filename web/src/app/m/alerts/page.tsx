'use client';

/**
 * m/alerts — alert cards with acknowledge.
 * Reskinned to Earthy Industrial.
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

      {loading && (
        <Card className="text-center text-xs text-secondary bg-surface-parchment border-earth-border shadow-sm">
          Loading alerts…
        </Card>
      )}

      {!loading && !alerts.length && (
        <Card className="text-center py-8 bg-surface-parchment border-earth-border shadow-sm">
          <span className="material-symbols-outlined text-telemetry-emerald text-4xl">check_circle</span>
          <p className="mt-2 text-sm font-medium text-earth-charcoal">All clear</p>
          <p className="mt-1 text-xs text-secondary">Start the API on :8000 for live alerts.</p>
        </Card>
      )}

      <div className="flex flex-col gap-2.5">
        {alerts.map((a) => (
          <Card key={a.id} className={`!p-3.5 bg-surface-parchment border-earth-border shadow-sm ${a.acknowledged ? 'opacity-55' : ''}`}>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-sm font-bold text-earth-charcoal capitalize">{a.alert_type.replace(/_/g, ' ')}</span>
              <SeverityBadge severity={a.severity} />
            </div>
            <p className="text-[11px] text-secondary leading-snug">{a.message}</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-[9px] text-secondary font-mono">
                {a.mine_id} · {a.created_at || '—'}
              </span>
              {!a.acknowledged ? (
                <button
                  onClick={() => acknowledge(a.id)}
                  className="px-3 py-1.5 bg-earth-charcoal text-canvas-sandstone text-[10px] font-bold uppercase rounded-lg active:scale-95 transition-transform shadow-sm"
                >
                  Ack
                </button>
              ) : (
                <span className="text-[9px] font-bold uppercase text-telemetry-emerald flex items-center gap-1">
                  <span className="material-symbols-outlined !text-[12px]">check_circle</span>
                  Acked
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
