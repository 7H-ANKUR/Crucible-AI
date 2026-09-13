'use client';

/**
 * ui.tsx — tiny layout primitives for the mobile route tree.
 * Everything is thumb-sized: 44px+ tap targets, compact cards, one accent.
 */
import React from 'react';

export function PageHeader({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        {kicker && (
          <div className="text-[10px] font-bold text-ink3 tracking-widest uppercase mb-0.5">{kicker}</div>
        )}
        <h1 className="font-['Manrope'] text-xl font-bold text-ink tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-ink2 mt-0.5 leading-snug">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl bg-card border border-line p-4 shadow-lg ${onClick ? 'active:scale-[0.98] transition-transform cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  accent = '#FFC56F',
  sub,
}: {
  label: string;
  value: string;
  accent?: string;
  sub?: string;
}) {
  return (
    <Card className="!p-3.5">
      <div className="text-[10px] font-bold text-ink2 uppercase tracking-wider">{label}</div>
      <div className="font-['Space_Grotesk'] text-2xl font-bold mt-1" style={{ color: accent }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink3 mt-0.5">{sub}</div>}
    </Card>
  );
}

export function Pill({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
        active
          ? 'bg-accent text-onaccent font-bold shadow-md'
          : 'bg-panel2 text-ink2 border border-line active:bg-panel4'
      }`}
    >
      {children}
    </button>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      aria-pressed={on}
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-accent3' : 'bg-panel4 border border-line3'}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-btn shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
      ></span>
    </button>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: 'bg-danger/20 text-dangert border-danger/40',
    high: 'bg-danger/20 text-dangert border-danger/40',
    warning: 'bg-warn/20 text-warnt border-warn/40',
    medium: 'bg-warn/20 text-warnt border-warn/40',
    info: 'bg-chipon/40 text-inkb border-chipon',
    low: 'bg-ok/20 text-okt border-ok/40',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase ${map[severity] ?? map.info}`}>
      {severity}
    </span>
  );
}
