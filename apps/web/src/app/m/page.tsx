'use client';

/**
 * m/ — mobile home: role greeting + live KPIs + quick links.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMinexAuth, ROLE_LABEL, pagesForRole } from '@/lib/roles';
import { useMineId } from '@/lib/useMineId';
import { useAlertsList, useForecastSummary, useFleet } from '@/lib/hooks';
import { Card, StatCard } from '@/components/mobile/ui';
import { formatTonnes } from '@/lib/minex';

export default function MobileHome() {
  const { role, isSignedIn, name } = useMinexAuth();
  const mineId = useMineId();
  const { p50, shortfallProb, loaded } = useForecastSummary(mineId);
  const { alerts } = useAlertsList();
  const { fleet } = useFleet(mineId);
  const [atRisk, setAtRisk] = useState(0);

  useEffect(() => {
    setAtRisk(fleet.filter((m) => m.risk_level !== 'LOW').length);
  }, [fleet]);

  const unread = alerts.filter((a) => !a.acknowledged).length;

  const greeting = isSignedIn
    ? `${ROLE_LABEL[role ?? 'management']}${name ? ' · ' + name : ''}`
    : 'Guest view — sign in for your department';

  return (
    <div className="animate-fadeIn">
      <div className="mb-4">
        <div className="text-[10px] font-bold text-accentt uppercase tracking-widest">MINEx Mobile</div>
        <h1 className="font-['Manrope'] text-lg font-bold text-ink leading-tight">{greeting}</h1>
        <p className="text-xs text-ink2">{mineId} · live operational summary</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="P50 Forecast"
          value={p50 != null ? formatTonnes(p50) : loaded ? 'N/A' : '...'}
          accent="#FFC56F"
          sub="next shift"
        />
        <StatCard
          label="Shortfall Risk"
          value={shortfallProb != null ? `${shortfallProb}%` : loaded ? 'N/A' : '...'}
          accent={shortfallProb != null && shortfallProb >= 50 ? '#D9574F' : shortfallProb != null && shortfallProb >= 30 ? '#D99523' : '#2E9B76'}
          sub="calibrated model"
        />
        <StatCard label="Fleet At Risk" value={String(atRisk)} accent="#D99523" sub={`${fleet.length} units total`} />
        <StatCard label="Open Alerts" value={String(unread)} accent={unread ? '#D9574F' : '#2E9B76'} sub={`${alerts.length} total`} />
      </div>

      <div className="text-[10px] font-bold text-ink3 uppercase tracking-widest mt-5 mb-2">Departments</div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ...pagesForRole(role).map((p) => ({
            href: '/m' + p.href,
            icon: p.icon,
            label: p.label,
            tint: 'text-accentt',
          })),
          { href: '/m/alerts', icon: 'notifications_active', label: 'Alerts', tint: 'text-dangert' },
        ].map((q) => (
          <Link key={q.href} href={q.href}>
            <Card className="!p-3.5 flex items-center gap-3 active:border-accent/50">
              <div className="w-9 h-9 rounded-xl bg-panel2 border border-line grid place-items-center shrink-0">
                <span className={`material-symbols-outlined !text-[20px] ${q.tint}`}>{q.icon}</span>
              </div>
              <span className="text-sm font-bold text-ink">{q.label}</span>
            </Card>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-ink3 mt-5 leading-relaxed">
        All figures SYNTHETIC (demo). Prospectivity scores are model outputs — not reserve claims.
      </p>
    </div>
  );
}
