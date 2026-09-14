'use client';

/**
 * ui.tsx — tiny layout primitives for the mobile route tree.
 * Reskinned to Stitch "Earthy Industrial" design system.
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
    <div className="flex items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        {kicker && (
          <div className="text-[10px] font-bold text-secondary tracking-widest uppercase mb-0.5">{kicker}</div>
        )}
        <h1 className="font-['Space_Grotesk'] text-[28px] font-bold text-earth-charcoal tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-on-surface-variant mt-0.5 leading-snug">{subtitle}</p>}
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
      className={`rounded-xl bg-surface-parchment border border-earth-border p-4 shadow-sm ${onClick ? 'active:bg-surface-container transition-colors cursor-pointer' : ''} ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  accent = '#B46A36', // default copper-accent
  sub,
}: {
  label: string;
  value: string;
  accent?: string;
  sub?: string;
}) {
  return (
    <Card className="!p-4 bg-surface-container-low shadow-sm">
      <div className="text-[10px] font-bold text-secondary uppercase tracking-wider">{label}</div>
      <div className="font-['Space_Grotesk'] text-[24px] font-bold mt-1" style={{ color: accent }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-on-surface-variant mt-1">{sub}</div>}
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
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shadow-sm ${
        active
          ? 'bg-earth-charcoal text-canvas-sandstone font-bold shadow-sm'
          : 'bg-surface-container text-earth-charcoal border border-earth-border active:bg-surface-container-high'
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
      className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${on ? 'bg-primary' : 'bg-surface-container-high border border-earth-border'}`}
    >
      <span
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px]' : 'left-0.5'}`}
      ></span>
    </button>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    critical: 'bg-telemetry-crimson/15 text-telemetry-crimson border-telemetry-crimson/40',
    high: 'bg-telemetry-crimson/15 text-telemetry-crimson border-telemetry-crimson/40',
    warning: 'bg-telemetry-amber/15 text-telemetry-amber border-telemetry-amber/40',
    medium: 'bg-telemetry-amber/15 text-telemetry-amber border-telemetry-amber/40',
    info: 'bg-surface-container text-earth-charcoal border-earth-border',
    low: 'bg-telemetry-emerald/15 text-telemetry-emerald border-telemetry-emerald/40',
  };
  return (
    <span className={`px-2 py-0.5 rounded border text-[9px] font-bold uppercase ${map[severity] ?? map.info}`}>
      {severity}
    </span>
  );
}
