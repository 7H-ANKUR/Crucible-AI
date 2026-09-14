'use client';

/**
 * primitives.tsx — the small pieces every Command Center surface reuses.
 * Reskinned to Stitch "Earthy Industrial" design system (light-only).
 */
import React, { useState } from 'react';
import {
  CalculationMode,
  EvidenceQuality,
  MODE_LABEL,
  Severity,
} from '@/lib/command';

/* ------------------------------------------------------------------ chrome */

export function Panel({
  title,
  subtitle,
  action,
  children,
  dense = false,
}: {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  dense?: boolean;
}) {
  return (
    <section className="rounded border border-earth-border bg-surface-parchment shadow-[0_1px_8px_rgba(30,25,21,0.05)] overflow-hidden">
      {title && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-earth-border">
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-secondary">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-on-surface-variant truncate">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={dense ? 'p-0' : 'p-4'}>{children}</div>
    </section>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-secondary mb-2">
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------- provenance */

export function ProvenanceBadge({
  mode,
  detail,
  className = '',
}: {
  mode: CalculationMode;
  detail?: string;
  className?: string;
}) {
  const tone =
    mode === 'MODEL_BACKED'
      ? 'text-primary border-primary/30 bg-primary-fixed/40'
      : mode === 'HEURISTIC'
        ? 'text-telemetry-amber border-telemetry-amber/30 bg-telemetry-amber/10'
        : 'text-secondary border-earth-border bg-surface-container';

  return (
    <span
      title={detail || MODE_LABEL[mode]}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${tone} ${className}`}
    >
      {MODE_LABEL[mode]}
    </span>
  );
}

const EVIDENCE_TONE: Record<EvidenceQuality, string> = {
  HIGH:        'text-telemetry-emerald border-telemetry-emerald/30 bg-telemetry-emerald/10',
  MEDIUM:      'text-telemetry-amber   border-telemetry-amber/30   bg-telemetry-amber/10',
  LOW:         'text-copper-accent     border-copper-accent/30      bg-copper-accent/10',
  UNAVAILABLE: 'text-secondary         border-earth-border          bg-surface-container',
};

export function EvidenceBadge({
  quality,
  reasons = [],
  limiters = [],
}: {
  quality: EvidenceQuality;
  reasons?: string[];
  limiters?: string[];
}) {
  const [open, setOpen] = useState(false);
  const hasDetail = reasons.length > 0 || limiters.length > 0;

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${EVIDENCE_TONE[quality]} ${
          hasDetail ? 'cursor-pointer hover:brightness-95' : 'cursor-default'
        }`}
      >
        {quality === 'UNAVAILABLE' ? 'No evidence' : `${quality} evidence`}
        {hasDetail && <span className="material-symbols-outlined !text-[11px]">info</span>}
      </button>

      {open && hasDetail && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded border border-earth-border bg-surface-parchment p-3 shadow-xl">
          {limiters.length > 0 && (
            <>
              <SectionLabel>What limits this</SectionLabel>
              <ul className="mb-2 space-y-1">
                {limiters.map((l) => (
                  <li key={l} className="text-[11px] leading-snug text-telemetry-amber">
                    {l}
                  </li>
                ))}
              </ul>
            </>
          )}
          {reasons.length > 0 && (
            <>
              <SectionLabel>Measured</SectionLabel>
              <ul className="space-y-1">
                {reasons.map((r) => (
                  <li key={r} className="text-[11px] leading-snug text-on-surface-variant">
                    {r}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- values */

export function Metric({
  label,
  value,
  mode,
  hint,
  tone = 'default',
  size = 'md',
}: {
  label: string;
  value: string;
  mode?: CalculationMode;
  hint?: string;
  tone?: 'default' | 'bad' | 'good' | 'muted';
  size?: 'sm' | 'md' | 'lg';
}) {
  const toneClass = {
    default: 'text-earth-charcoal',
    bad:     'text-telemetry-crimson',
    good:    'text-telemetry-emerald',
    muted:   'text-on-surface-variant',
  }[tone];

  const sizeClass = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' }[size];

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-secondary">
          {label}
        </span>
        {mode && <ProvenanceBadge mode={mode} detail={hint} />}
      </div>
      <div className={`mt-0.5 font-semibold tabular-nums font-['Space_Grotesk'] ${sizeClass} ${toneClass}`}>{value}</div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-on-surface-variant">{hint}</p>}
    </div>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const label = severity === 'NONE' ? 'Nominal' : severity.toLowerCase();
  // Map old SEVERITY_TONE (which uses dark-mode colors) to earthy tones
  const tone =
    severity === 'CRITICAL'   ? 'border-telemetry-crimson/40 bg-telemetry-crimson/10 text-telemetry-crimson' :
    severity === 'DISRUPTION' ? 'border-copper-accent/40 bg-copper-accent/10 text-copper-accent' :
    severity === 'WATCH'      ? 'border-telemetry-amber/40 bg-telemetry-amber/10 text-telemetry-amber' :
    severity === 'NONE'       ? 'border-telemetry-emerald/40 bg-telemetry-emerald/10 text-telemetry-emerald' :
                                'border-earth-border bg-surface-container text-secondary';
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${tone}`}>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ notes */

export function Caveat({
  children,
  icon = 'info',
  tone = 'neutral',
}: {
  children: React.ReactNode;
  icon?: string;
  tone?: 'neutral' | 'warn';
}) {
  const cls =
    tone === 'warn'
      ? 'border-telemetry-amber/30 bg-telemetry-amber/10 text-telemetry-amber'
      : 'border-earth-border bg-surface-container text-on-surface-variant';

  return (
    <div className={`flex gap-2 rounded border px-3 py-2 text-[11px] leading-snug ${cls}`}>
      <span className="material-symbols-outlined !text-[14px] shrink-0 mt-px opacity-70">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-container-high ${className}`} />;
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** Horizontal utilisation bar — earthy colours. */
export function UtilisationBar({ pct, status }: { pct: number | null; status: string }) {
  if (pct === null) {
    return <div className="h-1.5 w-full rounded-full bg-surface-container-high" title="Not measured" />;
  }
  const colour =
    status === 'SATURATED'
      ? 'bg-telemetry-crimson'
      : status === 'CONSTRAINED'
        ? 'bg-telemetry-amber'
        : 'bg-telemetry-emerald';

  return (
    <div className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colour}`}
        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
      />
    </div>
  );
}
