'use client';

/**
 * m/scenario — intervention toggles, run, stacked baseline-vs-scenario metrics.
 * Reskinned to Earthy Industrial.
 */
import React, { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useMineId } from '@/lib/useMineId';
import { apiPost } from '@/lib/api';
import { Card, PageHeader, Toggle } from '@/components/mobile/ui';
import { FALLBACK_INTERVENTIONS, FALLBACK_METRICS, mapScenarioResponse, type ScenarioIntervention, type ScenarioMetrics } from '@/lib/crucible';

export default function MobileScenario() {
  const mineId = useMineId();
  const [interventions, setInterventions] = useState<ScenarioIntervention[]>(FALLBACK_INTERVENTIONS);
  const [metrics, setMetrics] = useState<ScenarioMetrics>(FALLBACK_METRICS);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const { getToken } = useAuth();

  const showToast = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 2500);
  };

  const run = async (list: ScenarioIntervention[]) => {
    setRunning(true);
    try {
      const token = await getToken();
      const api = await apiPost<any>('/scenarios/run', {
        mine_id: mineId,
        interventions: list
          .filter((i) => i.status === 'active')
          .map((i) => ({ type: i.id.replace('int-', 'int_') + '_reroute', magnitude: 0.1, detail: i.description })),
        baseline_date: new Date().toISOString().slice(0, 10),
      }, token);
      const { metrics: m } = mapScenarioResponse(api);
      setMetrics(m);
      setIsBaseline(false);
      showToast('Scenario simulated');
    } catch {
      showToast('API unavailable — showing synthetic baseline');
    } finally {
      setRunning(false);
    }
  };

  const [isBaseline, setIsBaseline] = useState(false);

  const toggle = (id: string) => {
    const next = interventions.map((i) =>
      i.id === id ? { ...i, status: i.status === 'active' ? ('disabled' as const) : ('active' as const) } : i
    );
    setInterventions(next);
    run(next);
  };

  return (
    <div className="animate-fadeIn pb-2">
      <PageHeader kicker="Planning" title="Scenarios" subtitle={`${mineId} · Sector Alpha-4`} />

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => {
            setIsBaseline(true);
            setMetrics(FALLBACK_METRICS);
            showToast('Reverted to baseline');
          }}
          className="flex-1 py-2.5 rounded-xl bg-surface-container border border-earth-border text-xs font-bold uppercase text-earth-charcoal active:scale-95 transition-transform"
        >
          Baseline
        </button>
        <button
          onClick={() => run(interventions)}
          disabled={running}
          className="flex-1 py-2.5 rounded-xl bg-copper-accent text-canvas-sandstone text-xs font-bold uppercase active:scale-95 transition-transform disabled:opacity-60 shadow-sm"
        >
          {running ? 'Running…' : 'Run scenario'}
        </button>
      </div>

      {/* Metrics stacked */}
      <Card className="mb-4 !p-0 overflow-hidden bg-surface-parchment border-earth-border shadow-sm">
        {[
          ['Production', metrics.productionOutput.baseline, metrics.productionOutput.scenario, metrics.productionOutput.trend === 'up'],
          ['Risk', metrics.riskReduction.baseline, metrics.riskReduction.scenario, metrics.riskReduction.trend === 'enhanced'],
          ['Impact (INR)', metrics.expectedImpact.baseline, metrics.expectedImpact.scenario, true],
          ['Feasibility', metrics.feasibilityRating.baseline, metrics.feasibilityRating.scenario, false],
        ].map(([label, baseline, scenario, up], i) => (
          <div key={i} className={`p-3.5 ${i > 0 ? 'border-t border-earth-border' : ''}`}>
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-secondary mb-1">
              <span>{label}</span>
              {up && !isBaseline && <span className="material-symbols-outlined !text-[14px] text-telemetry-emerald">trending_up</span>}
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-secondary font-mono text-xs">{baseline}</span>
              <span className="material-symbols-outlined !text-[14px] text-secondary">arrow_forward</span>
              <span className="font-bold text-telemetry-emerald font-mono text-xs">
                {isBaseline ? baseline : scenario}
                {!isBaseline && label === 'Impact (INR)' && (
                  <span className="ml-1.5 bg-surface-container-high text-earth-charcoal text-[8px] uppercase px-1.5 py-0.5 rounded border border-earth-border">Synthetic</span>
                )}
              </span>
            </div>
          </div>
        ))}
      </Card>

      {/* Interventions */}
      <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-2">Interventions</div>
      <div className="flex flex-col gap-2.5">
        {interventions.map((item) => {
          const active = item.status === 'active';
          return (
            <Card key={item.id} className={`!p-3.5 flex items-start gap-3 bg-surface-parchment border-earth-border shadow-sm ${!active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-earth-charcoal">{item.title}</span>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${active ? 'bg-surface-container-high text-copper-accent border-copper-accent/30' : 'bg-surface-container text-secondary border-earth-border'}`}>
                    {active ? 'ON' : 'MUTED'}
                  </span>
                </div>
                <p className="text-[11px] text-secondary mt-0.5 leading-snug">{item.description}</p>
              </div>
              <Toggle on={active} onChange={() => toggle(item.id)} />
            </Card>
          );
        })}
      </div>

      {toast && (
        <div className="fixed bottom-[76px] left-1/2 -translate-x-1/2 z-50 bg-copper-accent text-canvas-sandstone px-4 py-2 rounded-xl text-xs font-bold shadow-lg animate-fadeIn">
          {toast}
        </div>
      )}
    </div>
  );
}
