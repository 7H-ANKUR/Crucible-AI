'use client';

/**
 * m/ — mobile home: role greeting + live KPIs + quick links.
 * Reskinned to Earthy Industrial.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCrucibleAuth, ROLE_LABEL, pagesForRole } from '@/lib/roles';
import { useMineId } from '@/lib/useMineId';
import { useAlertsList, useForecastSummary, useFleet } from '@/lib/hooks';
import { Card, StatCard } from '@/components/mobile/ui';
import { formatTonnes } from '@/lib/crucible';

export default function MobileHome() {
  const { role, isSignedIn, name } = useCrucibleAuth();
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
        <div className="text-[10px] font-bold text-copper-accent uppercase tracking-widest">Crucible AI Mobile</div>
        <h1 className="font-['Space_Grotesk'] text-lg font-bold text-earth-charcoal leading-tight">{greeting}</h1>
        <p className="text-xs text-secondary">{mineId} · live operational summary</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="P50 Forecast"
          value={p50 != null ? formatTonnes(p50) : loaded ? 'N/A' : '...'}
          accent="#b85a2c"
          sub="next shift"
        />
        <StatCard
          label="Shortfall Risk"
          value={shortfallProb != null ? `${shortfallProb}%` : loaded ? 'N/A' : '...'}
          accent={shortfallProb != null && shortfallProb >= 50 ? '#c0392b' : shortfallProb != null && shortfallProb >= 30 ? '#b8860b' : '#2E9B76'}
          sub="calibrated model"
        />
        <StatCard label="Fleet At Risk" value={String(atRisk)} accent="#b8860b" sub={`${fleet.length} units total`} />
        <StatCard label="Open Alerts" value={String(unread)} accent={unread ? '#c0392b' : '#2E9B76'} sub={`${alerts.length} total`} />
      </div>

      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mt-5 mb-2">Departments</div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ...pagesForRole(role).map((p) => ({
            href: '/m' + p.href,
            icon: p.icon,
            label: p.label,
            tint: 'text-copper-accent',
          })),
          { href: '/m/alerts', icon: 'notifications_active', label: 'Alerts', tint: 'text-telemetry-crimson' },
        ].map((q) => (
          <Link key={q.href} href={q.href}>
            <Card className="!p-3.5 flex items-center gap-3 bg-surface-parchment border-earth-border shadow-sm active:border-copper-accent/50 transition-colors">
              <div className="w-9 h-9 rounded-xl bg-surface-container-low border border-earth-border grid place-items-center shrink-0">
                <span className={`material-symbols-outlined !text-[20px] ${q.tint}`}>{q.icon}</span>
              </div>
              <span className="text-sm font-bold text-earth-charcoal">{q.label}</span>
            </Card>
          </Link>
        ))}
      </div>

      <p className="text-[10px] text-secondary mt-5 leading-relaxed">
        All figures SYNTHETIC (demo). Prospectivity scores are model outputs — not reserve claims.
      </p>
    </div>
  );
}
