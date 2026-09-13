'use client';

/**
 * primitives.tsx — the small pieces every Command Center surface reuses.
 *
 * These exist so that provenance is impossible to omit. A number rendered
 * through `<Metric>` carries its calculation mode; a judgement rendered through
 * `<EvidenceBadge>` carries the factors behind it. A page cannot accidentally
 * present a heuristic estimate with the same authority as a model prediction,
 * because the component that draws it needs to be told which it is.
 *
 * Visual language is industrial control room: dense, quiet, and monochrome until
 * something is actually wrong. Colour is a signal, not decoration.
 */
import React, { useState } from 'react';
import {
  CalculationMode,
  EvidenceQuality,
  MODE_LABEL,
  Severity,
  SEVERITY_TONE,
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
    <section className="rounded-xl border border-line2/60 bg-panel2/60 backdrop-blur-sm overflow-hidden">
      {title && (
        <header className="flex items-start justify-between gap-3 px-4 pt-3 pb-2 border-b border-line2/40">
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink2">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-ink2/70 truncate">{subtitle}</p>}
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
    <h3 className="text-[10px] font-bold uppercase tracking-[0.16em] text-ink2/70 mb-2">
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------- provenance */

/**
 * Says how a number was produced. Deliberately understated — it should be
 * checkable at a glance and ignorable when it is not in question.
 */
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
      ? 'text-sky-400 border-sky-500/30 bg-sky-500/5'
      : mode === 'HEURISTIC'
        ? 'text-amber-400/90 border-amber-500/25 bg-amber-500/5'
        : 'text-slate-400 border-slate-500/30 bg-slate-500/5';

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
  HIGH: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/5',
  MEDIUM: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
  LOW: 'text-orange-400 border-orange-500/30 bg-orange-500/5',
  UNAVAILABLE: 'text-slate-400 border-slate-500/30 bg-slate-500/5',
};

/**
 * Evidence quality, expandable into the factors behind it.
 *
 * This replaced a confidence percentage. A grade that can show its reasons is
 * more useful than a number that cannot, and it does not imply a calibration
 * that was never performed.
 */
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
          hasDetail ? 'cursor-pointer hover:brightness-125' : 'cursor-default'
        }`}
      >
        {quality === 'UNAVAILABLE' ? 'No evidence' : `${quality} evidence`}
        {hasDetail && <span className="material-symbols-outlined !text-[11px]">info</span>}
      </button>

      {open && hasDetail && (
        <div className="absolute right-0 z-30 mt-1 w-72 rounded-lg border border-line2 bg-panel3 p-3 shadow-2xl">
          {limiters.length > 0 && (
            <>
              <SectionLabel>What limits this</SectionLabel>
              <ul className="mb-2 space-y-1">
                {limiters.map((l) => (
                  <li key={l} className="text-[11px] leading-snug text-amber-300/90">
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
                  <li key={r} className="text-[11px] leading-snug text-ink2">
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

/**
 * A number with its unit and provenance, or a stated absence.
 *
 * `value === null` renders "Not available" plus the reason. It never falls back
 * to zero: a fabricated zero reads as a measurement, and in an operational
 * context that is worse than a blank.
 */
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
    default: 'text-ink',
    bad: 'text-orange-400',
    good: 'text-emerald-400',
    muted: 'text-ink2',
  }[tone];

  const sizeClass = { sm: 'text-base', md: 'text-xl', lg: 'text-3xl' }[size];

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink2/70">
          {label}
        </span>
        {mode && <ProvenanceBadge mode={mode} detail={hint} />}
      </div>
      <div className={`mt-0.5 font-semibold tabular-nums ${sizeClass} ${toneClass}`}>{value}</div>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-ink2/60">{hint}</p>}
    </div>
  );
}

export function SeverityChip({ severity }: { severity: Severity }) {
  const label = severity === 'NONE' ? 'Nominal' : severity.toLowerCase();
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-px text-[9px] font-bold uppercase tracking-wider ${SEVERITY_TONE[severity]}`}
    >
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ notes */

/**
 * A stated limitation. Used wherever the platform is declining to answer, so
 * that gaps read as deliberate rather than as something failing to load.
 */
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
      ? 'border-amber-500/25 bg-amber-500/5 text-amber-200/80'
      : 'border-line2/50 bg-panel3/40 text-ink2/80';

  return (
    <div className={`flex gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug ${cls}`}>
      <span className="material-symbols-outlined !text-[14px] shrink-0 mt-px opacity-70">
        {icon}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Skeletons, not spinners — a spinner over a stale operational number is worse
 *  than an obvious placeholder, because it looks like the number is current. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-panel4/60 ${className}`} />;
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

/** Horizontal utilisation bar. Colour only past the thresholds that matter. */
export function UtilisationBar({ pct, status }: { pct: number | null; status: string }) {
  if (pct === null) {
    return <div className="h-1.5 w-full rounded-full bg-panel4/50" title="Not measured" />;
  }
  const colour =
    status === 'SATURATED'
      ? 'bg-red-400'
      : status === 'CONSTRAINED'
        ? 'bg-amber-400'
        : 'bg-emerald-400/70';

  return (
    <div className="h-1.5 w-full rounded-full bg-panel4/50 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colour}`}
        style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
      />
    </div>
  );
}
