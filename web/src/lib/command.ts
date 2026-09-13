'use client';

/**
 * command.ts — client for the Command Center and the decision loop.
 *
 * Mirrors the backend contract closely on purpose. Every operational number the
 * API returns carries a `calculation_mode` and, where a judgement is involved,
 * an `evidence_quality`; those travel with the value through to the component
 * that renders it, so the page cannot present a heuristic estimate and a model
 * prediction identically.
 *
 * Nullable numerics are nullable here too. `null` means the platform declined to
 * estimate, and the UI must render that as an absence rather than coercing it to
 * zero — a fabricated zero reads as a measurement.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { apiFetch, apiPost } from '@/lib/api';

export type CalculationMode = 'MODEL_BACKED' | 'HEURISTIC' | 'INSUFFICIENT_DATA';
export type EvidenceQuality = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNAVAILABLE';
export type Severity = 'CRITICAL' | 'DISRUPTION' | 'WATCH' | 'NONE';
export type OperationalState = 'NORMAL' | 'WATCH' | 'DISRUPTION' | 'CRITICAL' | 'UNKNOWN';
export type Horizon = 'NOW' | 'NEXT' | 'NEXT_SHIFT';

export interface Clock {
  mode: 'LIVE' | 'BENCHMARK' | 'UNKNOWN';
  reference_time: string;
  dataset_epoch: string | null;
  wall_clock_lag_days: number;
  caveat: string | null;
}

export interface Signal {
  key: string;
  label: string;
  severity: Severity;
  value: number | null;
  unit: string;
  reason: string;
  source: string;
  scope: string;
  observed_at: string | null;
  threshold: number | null;
  calculation_mode: CalculationMode;
  deep_link: string | null;
  evidence: Record<string, unknown>;
}

export interface AttentionItem {
  key: string;
  title: string;
  severity: Severity;
  summary: string;
  impact_t: number | null;
  impact_basis: string;
  calculation_mode: CalculationMode;
  evidence_quality: EvidenceQuality;
  score: number;
  drivers: Record<string, unknown>[];
  deep_link: string | null;
  incident_type: string;
  signature: string;
}

export interface Recommendation {
  key: string;
  title: string;
  addresses: string;
  action: string;
  reason: string;
  expected_delta_t: number | null;
  calculation_mode: CalculationMode;
  method: string;
  cost_inr: number | null;
  cost_basis: string;
  risk_delta: number;
  evidence_quality: EvidenceQuality;
  feasible: boolean;
  constraint_summary: string;
  tradeoffs: string[];
  horizon: Horizon;
  owner: string;
  approval_roles: string[];
  closes_pct: number | null;
  requires_approval: boolean;
}

export interface ProjectionPoint {
  key: string;
  label: string;
  hours_ahead: number;
  shortfall_t: number;
  recoverable: boolean;
  note: string;
}

export interface Projection {
  mine_id: string;
  available: boolean;
  shortfall_rate_tph: number | null;
  points: ProjectionPoint[];
  assumptions: string[];
  calculation_mode: CalculationMode;
  unavailable_reason: string | null;
}

export interface Stage {
  key: string;
  label: string;
  throughput_t: number | null;
  capacity_t: number | null;
  utilisation_pct: number | null;
  headroom_t: number | null;
  status: 'NOMINAL' | 'CONSTRAINED' | 'SATURATED' | 'UNKNOWN';
  calculation_mode: CalculationMode;
  basis: string;
  unavailable_reason: string | null;
}

export interface Bottleneck {
  stage: string;
  label: string;
  utilisation_pct: number;
  headroom_t: number | null;
  status: string;
  calculation_mode: CalculationMode;
  basis: string;
  reason: string;
}

export interface CommandSummary {
  mine: {
    mine_id: string;
    name: string | null;
    state: string | null;
    district: string | null;
    latitude: number | null;
    longitude: number | null;
    active: boolean;
    resolved_from: string;
  };
  state: {
    state: OperationalState;
    headline: string;
    signals: Signal[];
    unmeasured: string[];
  };
  platform: {
    state: OperationalState;
    headline: string;
    signals: Signal[];
  };
  attention: {
    items: AttentionItem[];
    item_count: number;
    suppressed: number;
    knowledge_gaps: { key: string; label: string; reason: string; deep_link: string | null }[];
  };
  recommendations: {
    recommendations: Recommendation[];
    blocked: Recommendation[];
    note: string | null;
    failed?: boolean;
    baseline_production_t?: number;
    planned_production_t?: number | null;
  };
  do_nothing: Projection;
  bottleneck: Bottleneck | null;
  stages: Stage[];
  clock: Clock;
  evaluated_at: string;
}

export interface MineOption {
  mine_id: string;
  name: string | null;
  state: string | null;
  district: string | null;
  active: boolean;
}

/** Colour role per operational state. Amber and red only where it means something. */
export const STATE_TONE: Record<OperationalState, { bg: string; fg: string; dot: string; label: string }> = {
  NORMAL: { bg: 'bg-emerald-500/10', fg: 'text-emerald-400', dot: 'bg-emerald-400', label: 'Operating normally' },
  WATCH: { bg: 'bg-amber-500/10', fg: 'text-amber-400', dot: 'bg-amber-400', label: 'Watch' },
  DISRUPTION: { bg: 'bg-orange-500/10', fg: 'text-orange-400', dot: 'bg-orange-400', label: 'Disruption' },
  CRITICAL: { bg: 'bg-red-500/10', fg: 'text-red-400', dot: 'bg-red-400', label: 'Critical' },
  UNKNOWN: { bg: 'bg-slate-500/10', fg: 'text-slate-400', dot: 'bg-slate-400', label: 'Not measurable' },
};

export const SEVERITY_TONE: Record<Severity, string> = {
  CRITICAL: 'text-red-400 border-red-500/40 bg-red-500/10',
  DISRUPTION: 'text-orange-400 border-orange-500/40 bg-orange-500/10',
  WATCH: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
  NONE: 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10',
};

export const MODE_LABEL: Record<CalculationMode, string> = {
  MODEL_BACKED: 'Model',
  HEURISTIC: 'Estimate',
  INSUFFICIENT_DATA: 'Not estimated',
};

export const HORIZON_LABEL: Record<Horizon, string> = {
  NOW: 'Now — next 30 minutes',
  NEXT: 'Next — 30 min to 2 hours',
  NEXT_SHIFT: 'Next shift',
};

/** Tonnes, or an explicit absence. Never renders a placeholder number. */
export function tonnes(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined) return '—';
  const n = Math.abs(value) >= 100 ? Math.round(value) : Number(value.toFixed(1));
  return `${signed && value > 0 ? '+' : ''}${n.toLocaleString('en-IN')} t`;
}

export function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Not priced';
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(2)} L`;
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function useToken() {
  const { getToken } = useAuth();
  return getToken;
}

/** Surfaces the API's structured refusal rather than a bare status code. */
function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const detail = parsed.detail ?? parsed;
      if (typeof detail === 'string') return detail;
      if (detail?.message) return detail.message;
    } catch {
      /* fall through */
    }
  }
  return raw;
}

export function useMines() {
  const getToken = useToken();
  const [mines, setMines] = useState<MineOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiFetch<{ mines: MineOption[] }>(
          '/command-center/mines',
          {},
          await getToken()
        );
        if (alive) setMines(r.mines ?? []);
      } catch {
        if (alive) setMines([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [getToken]);

  return { mines, loading };
}

export function useCommandSummary(mineId: string | null, objective = 'BALANCED') {
  const getToken = useToken();
  const [data, setData] = useState<CommandSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!mineId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const r = await apiFetch<CommandSummary>(
          `/command-center/summary?mine_id=${encodeURIComponent(mineId)}&objective=${objective}`,
          {},
          await getToken()
        );
        setData(r);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setLoading(false);
      }
    },
    [mineId, objective, getToken]
  );

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: () => load(true) };
}

export interface ResponsePlan {
  plan_id?: number;
  plan_ref?: string;
  available: boolean;
  reason?: string;
  title: string;
  addresses: string;
  severity: Severity;
  situation: string;
  root_cause: string;
  root_cause_calculation_mode: CalculationMode;
  action_groups: { horizon: Horizon; label: string; actions: Recommendation[] }[];
  actions: Recommendation[];
  not_available: Recommendation[];
  expected: {
    delta_t: number | null;
    residual_gap_t: number | null;
    calculation_mode: CalculationMode;
    note: string;
  };
  do_nothing: Projection;
  comparison: {
    available: boolean;
    horizon_label?: string;
    rows?: {
      label: string;
      key: string;
      shortfall_t: number;
      recovered_t: number;
      cost_inr: number | null;
      risk_delta: number;
      is_baseline: boolean;
    }[];
    note?: string;
  };
  risks: string[];
  evidence_quality: EvidenceQuality;
  calculation_mode: CalculationMode;
  approval_required: string[];
  owners: string[];
  lifecycle_state: string;
  disclaimer: string;
  persisted?: boolean;
  persist_error?: string;
}

export function usePlanActions() {
  const getToken = useToken();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useCallback(
    async (mineId: string, itemKey?: string): Promise<ResponsePlan | null> => {
      setPending(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ mine_id: mineId });
        if (itemKey) qs.set('item_key', itemKey);
        return await apiFetch<ResponsePlan>(
          `/command-center/response-plan?${qs}`,
          {},
          await getToken()
        );
      } catch (e) {
        setError(describeError(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  const file = useCallback(
    async (mineId: string, itemKey?: string): Promise<ResponsePlan | null> => {
      setPending(true);
      setError(null);
      try {
        return await apiPost<ResponsePlan>(
          '/response-plans',
          { mine_id: mineId, item_key: itemKey },
          await getToken()
        );
      } catch (e) {
        setError(describeError(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  const act = useCallback(
    async (planId: number, step: string, body: Record<string, unknown> = {}) => {
      setPending(true);
      setError(null);
      try {
        return await apiPost<Record<string, unknown>>(
          `/response-plans/${planId}/${step}`,
          body,
          await getToken()
        );
      } catch (e) {
        setError(describeError(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  return { preview, file, act, pending, error };
}
