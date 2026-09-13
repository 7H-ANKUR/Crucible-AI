'use client';

/**
 * routing.ts — client for the dynamic routing and production optimisation API.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { apiFetch, apiPost } from '@/lib/api';

export interface LatLon {
  lat: number;
  lon: number;
  label?: string;
}

export interface FactorContribution {
  factor: string;
  label: string;
  intensity: number;
  points: number;
  share_pct: number;
}

export interface RoutePayload {
  label: string;
  distance_km: number;
  estimated_time_min: number;
  risk_score: number;
  safety_score: number;
  risk_band: string;
  risk_tone: string;
  dominant_factor: string | null;
  risk_breakdown: Record<string, FactorContribution>;
  path: LatLon[];
  geojson: unknown;
  diagnostics: { nodes_expanded: number; total_cost: number; cells: number };
}

export interface Advisory {
  factor: string | null;
  label: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  intensity: number;
}

export interface Explanation {
  summary: string;
  risk_band: string;
  risk_tone: string;
  dominant_factor: string | null;
  breakdown: FactorContribution[];
  comparison_to_shortest: {
    distance_delta_pct: number | null;
    risk_delta_pct: number | null;
    distance_delta_km: number;
    risk_delta_points: number;
  } | null;
  advisories: Advisory[];
}

export interface OptimizeResponse {
  mine_id: string;
  vehicle_type: string;
  conditions: Record<string, unknown>;
  route: RoutePayload;
  alternative_routes: RoutePayload[];
  shortest_route: RoutePayload | null;
  explanation: Explanation;
  waypoints: LatLon[];
  grid: { bounds: Bounds; cells: number; radius_km: number; cell_size_km: number };
  weights: Record<string, number>;
}

export interface Bounds {
  lat_min: number;
  lat_max: number;
  lon_min: number;
  lon_max: number;
}

export interface HeatCell {
  lat: number;
  lon: number;
  risk: number;
  band: string;
  tone: string;
  dominant: string;
  blocked: boolean;
}

export interface HeatmapResponse {
  layer: string;
  label: string;
  rows: number;
  cols: number;
  bounds: Bounds;
  cell_size_km: number;
  cells: HeatCell[];
}

export interface SuggestedPoints {
  mine_id: string;
  points: Record<'extraction' | 'stockpile' | 'dispatch', LatLon & { risk: number }>;
  bounds: Bounds;
  reroute_divergence_pct: number | null;
}

export interface ProductionResponse {
  forecast: {
    daily_t: number;
    weekly_t: number;
    monthly_t: number;
    target_monthly_t: number;
    variance_t: number;
    variance_pct: number;
    status: string;
    binding_constraint: string;
    capacities_tpd: Record<string, number>;
    cycle: Record<string, number>;
  };
  haulage: Record<string, number | string>;
  root_cause: {
    shortfall_t: number;
    shortfall_pct?: number;
    binding_constraint?: string;
    contributors: Array<{
      cause: string;
      label: string;
      recoverable_t: number;
      contribution_pct: number;
      closes_shortfall_pct: number;
    }>;
    note?: string;
    method?: string;
  };
  recommended_actions: Array<{
    action: string;
    detail: string;
    impact_t: number;
    priority: 'high' | 'medium' | 'low';
  }>;
  inputs: Record<string, number>;
}

export interface CompareResponse {
  before: { conditions: Record<string, unknown>; route: RoutePayload };
  after: { conditions: Record<string, unknown>; route: RoutePayload };
  original_route_under_new_conditions: RoutePayload | null;
  route_changed: boolean;
  path_overlap_pct: number;
  risk_delta: number;
  distance_delta_km: number;
  narrative: string;
}

export const RISK_TONES: Record<string, string> = {
  Safe: '#22c55e',
  'Low Risk': '#84cc16',
  Moderate: '#f59e0b',
  'High Risk': '#f97316',
  Critical: '#ef4444',
};

export const LAYERS: Array<{ key: string; label: string }> = [
  { key: 'overall', label: 'Overall risk' },
  { key: 'flood', label: 'Flood' },
  { key: 'slope', label: 'Slope' },
  { key: 'road', label: 'Road condition' },
  { key: 'mining', label: 'Mining activity' },
  { key: 'traffic', label: 'Traffic' },
  { key: 'weather', label: 'Weather' },
];

/** Colour for a 0..100 risk score, matching the backend's banding. */
export function riskColour(score: number): string {
  if (score <= 20) return RISK_TONES.Safe;
  if (score <= 40) return RISK_TONES['Low Risk'];
  if (score <= 60) return RISK_TONES.Moderate;
  if (score <= 80) return RISK_TONES['High Risk'];
  return RISK_TONES.Critical;
}

function useToken() {
  const { getToken } = useAuth();
  return getToken;
}

/** POST helper that surfaces the API's own error detail rather than a status code. */
async function post<T>(path: string, body: unknown, token: string | null): Promise<T> {
  try {
    return await apiPost<T>(path, body, token);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // The gateway returns {"detail": {...}} for routing refusals — those carry
    // the operational reason (blocked zone, outside the area) worth showing.
    // [\s\S] rather than the `s` flag — the project's tsconfig target predates it.
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        const detail = parsed.detail ?? parsed;
        throw new Error(typeof detail === 'string' ? detail : detail.message ?? raw);
      } catch {
        /* fall through to the raw message */
      }
    }
    throw e;
  }
}

export function useSuggestedPoints(mineId: string) {
  const getToken = useToken();
  const [data, setData] = useState<SuggestedPoints | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const result = await apiFetch<SuggestedPoints>(`/routing/points/${mineId}`, {}, token);
        if (alive) setData(result);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mineId, getToken]);

  return { points: data, loading };
}

export function useRouting() {
  const getToken = useToken();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optimize = useCallback(
    async (body: Record<string, unknown>): Promise<OptimizeResponse | null> => {
      setPending(true);
      setError(null);
      try {
        return await post<OptimizeResponse>('/routing/optimize', body, await getToken());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Route planning failed');
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  const compare = useCallback(
    async (body: Record<string, unknown>): Promise<CompareResponse | null> => {
      setPending(true);
      setError(null);
      try {
        return await post<CompareResponse>('/routing/compare-conditions', body, await getToken());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Comparison failed');
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  const production = useCallback(
    async (body: Record<string, unknown>): Promise<ProductionResponse | null> => {
      try {
        return await post<ProductionResponse>('/routing/production/forecast', body, await getToken());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Production forecast failed');
        return null;
      }
    },
    [getToken]
  );

  const simulateWhatIf = useCallback(
    async (body: Record<string, unknown>) => {
      try {
        return await post<Record<string, any>>('/routing/production/simulate', body, await getToken());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Simulation failed');
        return null;
      }
    },
    [getToken]
  );

  const heatmap = useCallback(
    async (params: Record<string, string | number>): Promise<HeatmapResponse | null> => {
      try {
        const qs = new URLSearchParams(
          Object.entries(params).map(([k, v]) => [k, String(v)])
        ).toString();
        return await apiFetch<HeatmapResponse>(`/routing/heatmap?${qs}`, {}, await getToken());
      } catch {
        return null;
      }
    },
    [getToken]
  );

  return { optimize, compare, production, simulateWhatIf, heatmap, pending, error };
}
