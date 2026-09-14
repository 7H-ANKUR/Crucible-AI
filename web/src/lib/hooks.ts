'use client';

/**
 * hooks.ts — shared data hooks for the mobile route tree.
 * Each wraps apiFetch + the existing lib/crucible.ts mappers, with the same
 * graceful fallbacks the desktop pages use. Desktop pages intentionally keep
 * their own fetch code (zero-regression policy).
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { fleetSummary, mapFleetInsights, type FleetSummary, type Insight, FALLBACK_FLEET_INSIGHTS, FALLBACK_FLEET_SUMMARY } from '@/lib/insight';
import { apiFetch } from '@/lib/api';
import {
  FALLBACK_FORECAST,
  FALLBACK_LEDGER,
  FALLBACK_RISKS,
  FALLBACK_TARGETS,
  mapForecastToBars,
  mapFleet,
  mapLedger,
  mapTargets,
  type AlertItem,
  type FleetMachine,
  type PredictionLedgerEntry,
  type ProductionDataPoint,
  type RiskVector,
  type ExplorationTarget,
} from '@/lib/crucible';

async function safeFetch<T>(path: string, token?: string | null): Promise<T | null> {
  try {
    return await apiFetch<T>(path, {}, token);
  } catch {
    return null;
  }
}

/** P50 + shortfall + forecast bars for one mine. */
export function useForecastSummary(mineId: string) {
  const { getToken } = useAuth();
  const [p50, setP50] = useState<number | null>(null);
  const [shortfallProb, setShortfallProb] = useState<number | null>(null);
  const [bars, setBars] = useState<ProductionDataPoint[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const token = await getToken();
    const [forecast, history] = await Promise.all([
      safeFetch<any>(`/production/${mineId}/forecast`, token),
      safeFetch<any>(`/production/${mineId}/history?limit=12`, token),
    ]);
    const merged = { ...(history ?? {}), forecast: forecast?.forecast, history: history?.history ?? history };
    const mappedBars = mapForecastToBars(merged);
    setBars(mappedBars.length ? mappedBars : FALLBACK_FORECAST);
    const val = Number(forecast?.forecast?.p50);
    if (!Number.isNaN(val) && val > 0) setP50(val);
    const sp = Number(forecast?.shortfall_probability);
    if (!Number.isNaN(sp)) setShortfallProb(Math.round(sp * 100));
    setLoaded(true);
  }, [mineId, getToken]);

  useEffect(() => {
    load();
  }, [load]);

  return { p50, shortfallProb, bars, loaded, reload: load };
}

/** Risk vectors: equipment fleet top risks + synthetic fallbacks. */
export function useRiskVectors(mineId: string) {
  const { getToken } = useAuth();
  const [risks, setRisks] = useState<RiskVector[]>(FALLBACK_RISKS);

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      const fleet = await safeFetch<any>(`/equipment/${mineId}/fleet`, token);
      if (!alive || !fleet) return;
      const top = (fleet?.fleet ?? []).slice(0, 4).map((m: any) => {
        const prob = Number(m.failure_risk_prob) || 0;
        return {
          id: `risk-${m.machine_id}`,
          title: `${m.equipment_type ?? 'Unit'} ${m.machine_id} failure risk`,
          confidence: Math.round(prob * 100),
          impact: prob >= 0.35 ? '-2.1kt/shift' : prob >= 0.2 ? '-1.1kt/shift' : '-0.4kt/shift',
          severity: prob >= 0.35 ? 'high' : prob >= 0.2 ? 'medium' : 'low',
          evidence: {
            description: `Failure model assigns ${prob.toFixed(3)} probability within 24h. Overdue: ${m.maintenance_overdue_days ?? 0} d.`,
            telemetrySource: 'Equipment telemetry — champion logistic model',
            affectedUnits: [m.machine_id],
            syntheticAssumptions: 'All telemetry SYNTHETIC.',
            recommendedMitigation:
              (Number(m.maintenance_overdue_days) || 0) > 15
                ? 'Schedule preventive maintenance next shift.'
                : 'Continue condition monitoring.',
          },
        } as RiskVector;
      });
      if (top.length) {
        setRisks([...top, ...FALLBACK_RISKS].slice(0, 6));
      } else {
        setRisks(FALLBACK_RISKS);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mineId, getToken]);

  return risks;
}

export function useLedgerList(limit = 12) {
  const { getToken } = useAuth();
  const [entries, setEntries] = useState<PredictionLedgerEntry[]>(FALLBACK_LEDGER);
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      const api = await safeFetch<any>(`/ledger?limit=${limit}`, token);
      if (alive && api) setEntries(mapLedger(api));
    })();
    return () => {
      alive = false;
    };
  }, [limit, getToken]);
  return entries;
}

export function useFleet(mineId: string) {
  const { getToken } = useAuth();
  const [fleet, setFleet] = useState<FleetMachine[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      const api = await safeFetch<any>(`/equipment/${mineId}/fleet`, token);
      if (alive) setFleet(mapFleet(api));
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [mineId, getToken]);
  return { fleet, loading };
}

export function useAlertsList() {
  const { getToken } = useAuth();
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const token = await getToken();
    const api = await safeFetch<any>('/alerts', token);
    const rows: any[] = Array.isArray(api) ? api : api?.alerts ?? [];
    setAlerts(
      rows.map((r, i) => ({
        id: r.id ?? i,
        alert_type: r.alert_type ?? 'system',
        severity: (r.severity ?? 'info') as AlertItem['severity'],
        mine_id: r.mine_id ?? '—',
        entity_id: r.entity_id ?? '—',
        message: r.message ?? 'Operational alert',
        created_at: String(r.created_at ?? '').replace('T', ' ').slice(0, 19),
        acknowledged: Boolean(r.acknowledged),
        data_origin: r.data_origin ?? 'SYNTHETIC',
      }))
    );
    setLoading(false);
  }, [getToken]);

  useEffect(() => {
    load();
  }, [load]);

  return { alerts, loading, reload: load };
}

export function useTargetList() {
  const { getToken } = useAuth();
  const [targets, setTargets] = useState<ExplorationTarget[]>(FALLBACK_TARGETS);
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      const api = await safeFetch<any>('/exploration/targets?limit=12', token);
      if (!alive || !api) return;
      const mapped = mapTargets(api);
      if (mapped.length) setTargets(mapped);
    })();
    return () => {
      alive = false;
    };
  }, [getToken]);
  return targets;
}

/** Unacknowledged alert count for tab badges / home KPI. */
export function useAlertCount() {
  const [count, setCount] = useState(0);
  const { alerts } = useAlertsList();
  useEffect(() => {
    setCount(alerts.filter((a) => !a.acknowledged).length);
  }, [alerts]);
  return count;
}

/** Fleet insights (conclusion-first) from the evidence-based fleet endpoint. */
export function useFleetInsights(mineId: string) {
  const { getToken } = useAuth();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [summary, setSummary] = useState<FleetSummary>({ critical: 0, high: 0, medium: 0, low: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = await getToken();
        const api = await apiFetch<any>(`/equipment/${mineId}/fleet`, {}, token);
        if (!alive) return;
        
        const mapped = mapFleetInsights(api);
        if (mapped.length > 0) {
          setInsights(mapped);
          setSummary(fleetSummary(api));
        } else {
          // If the backend returns empty or is unreachable, use fallbacks
          setInsights(FALLBACK_FLEET_INSIGHTS);
          setSummary(FALLBACK_FLEET_SUMMARY);
        }
      } catch {
        if (alive) {
          setInsights(FALLBACK_FLEET_INSIGHTS);
          setSummary(FALLBACK_FLEET_SUMMARY);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [mineId, getToken]);

  return { insights, summary, loading };
}
