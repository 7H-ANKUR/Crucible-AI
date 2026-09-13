'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useMineId } from '@/lib/useMineId';
import { DeploySuccessModal } from '@/components/minex/Modals';
import { apiPost } from '@/lib/api';
import {
  FALLBACK_INTERVENTIONS,
  FALLBACK_METRICS,
  mapScenarioResponse,
  type ScenarioIntervention,
  type ScenarioMetrics,
  type ScenarioControls,
} from '@/lib/minex';

export default function ScenarioPage() {
  const mineId = useMineId();
  const router = useRouter();

  const defaultControls: ScenarioControls = {
    objective: 'BALANCED',
    max_additional_fuel_pct: 14,
    fleet_reallocation: 'MEDIUM',
    maintenance_flexibility: 'LIMITED',
    route_flexibility: 'MEDIUM',
    operating_time_mode: 'CURRENT',
    risk_tolerance: 'BALANCED',
  };

  const [controls, setControls] = useState<ScenarioControls>(defaultControls);
  const [interventions, setInterventions] = useState<ScenarioIntervention[]>(FALLBACK_INTERVENTIONS);
  const [metrics, setMetrics] = useState<ScenarioMetrics>(FALLBACK_METRICS);
  const [isBaseline, setIsBaseline] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isDeployOpen, setIsDeployOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  
  const [lineageInfo, setLineageInfo] = useState({
    calculationMode: 'HEURISTIC',
    dataOrigin: 'NO_DATA',
    disclaimer: '',
  });

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const { getToken } = useAuth();

  const runScenario = useCallback(async (currentControls: ScenarioControls) => {
    setIsRunning(true);
    try {
      const token = await getToken();
      const payload = {
        ...currentControls,
        mine_id: mineId,
      };
      const api = await apiPost<any>('/scenarios/evaluate', payload, token);
      const { metrics: m, interventions: iv } = mapScenarioResponse(api);
      
      setInterventions(iv);
      setMetrics(m);
      setIsBaseline(false);
      setLineageInfo({
        calculationMode: api.calculation_mode,
        dataOrigin: api.data_origin,
        disclaimer: api.disclaimer,
      });
      showToast('Recalculated scenario based on constraints.');
    } catch {
      showToast('API unavailable — showing synthetic baseline scenario');
    } finally {
      setIsRunning(false);
    }
  }, [getToken, mineId]);

  useEffect(() => {
    // Initial run on mount
    runScenario(controls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineId]);

  const handleRevertToBaseline = () => {
    setIsBaseline(true);
    showToast('Reverted to baseline view');
  };
  
  const updateControl = (key: keyof ScenarioControls, value: any) => {
    const next = { ...controls, [key]: value };
    setControls(next);
  };

  const applyPreset = (preset: 'MAX_OUTPUT' | 'COST_SAVER' | 'SAFE_STEADY' | 'BALANCED') => {
    let next: ScenarioControls;
    switch(preset) {
      case 'MAX_OUTPUT':
        next = { objective: 'MAXIMIZE_PRODUCTION', max_additional_fuel_pct: 25, fleet_reallocation: 'HIGH', maintenance_flexibility: 'HIGH', route_flexibility: 'HIGH', operating_time_mode: 'MAX_AVAILABLE', risk_tolerance: 'AGGRESSIVE' };
        break;
      case 'COST_SAVER':
        next = { objective: 'MINIMIZE_COST', max_additional_fuel_pct: 5, fleet_reallocation: 'LOW', maintenance_flexibility: 'PRESERVE', route_flexibility: 'LOW', operating_time_mode: 'CURRENT', risk_tolerance: 'CONSERVATIVE' };
        break;
      case 'SAFE_STEADY':
        next = { objective: 'MINIMIZE_RISK', max_additional_fuel_pct: 10, fleet_reallocation: 'MEDIUM', maintenance_flexibility: 'PRESERVE', route_flexibility: 'LOW', operating_time_mode: 'CURRENT', risk_tolerance: 'CONSERVATIVE' };
        break;
      case 'BALANCED':
      default:
        next = defaultControls;
        break;
    }
    setControls(next);
    runScenario(next);
  };

  return (
    <main id="scenario-view-root" className="flex-1 transition-all duration-300 p-4 md:p-6 lg:p-8 overflow-y-auto w-full bg-page min-h-screen pb-20">
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-accent text-onaccent px-4 py-2.5 rounded-xl shadow-2xl text-xs font-bold flex items-center gap-2 animate-bounce">
          <span className="material-symbols-outlined text-base">info</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <header className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-['Manrope'] text-3xl md:text-4xl font-bold text-ink mb-1">
            Scenario Workspace
          </h1>
          <p className="text-sm md:text-base text-ink2">
            Evaluating operational adjustments for {mineId} — Sector Alpha-4.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => runScenario(controls)}
            className={`bg-panel3 border border-line text-ink text-xs font-bold uppercase tracking-wider px-5 py-3 rounded-[18px] hover:bg-panel4 transition-all flex items-center gap-2 shadow-md`}
          >
            <span className="material-symbols-outlined text-lg">sync</span>
            <span>{isRunning ? 'Updating...' : 'Update Scenario'}</span>
          </button>

          <button
            onClick={() => setIsDeployOpen(true)}
            disabled={isRunning || isBaseline}
            className="bg-accent text-onaccent text-xs font-bold uppercase tracking-wider px-6 py-3 rounded-[18px] hover:bg-accent2 transition-all flex items-center gap-2 shadow-lg shadow-accent/25 active:scale-95 disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-lg">send</span>
            <span>Send for Approval</span>
          </button>
        </div>
      </header>
      
      {/* Presets Bar */}
      <div className="mb-6 flex flex-wrap gap-2">
        <span className="text-xs font-bold text-ink2 flex items-center mr-2">Presets:</span>
        <button onClick={() => applyPreset('MAX_OUTPUT')} className="bg-deep border border-line text-xs font-bold uppercase px-3 py-1.5 rounded-lg hover:border-accent text-ink transition-colors">Maximize Output</button>
        <button onClick={() => applyPreset('COST_SAVER')} className="bg-deep border border-line text-xs font-bold uppercase px-3 py-1.5 rounded-lg hover:border-accent text-ink transition-colors">Cost Saver</button>
        <button onClick={() => applyPreset('SAFE_STEADY')} className="bg-deep border border-line text-xs font-bold uppercase px-3 py-1.5 rounded-lg hover:border-accent text-ink transition-colors">Safe & Steady</button>
        <button onClick={() => applyPreset('BALANCED')} className="bg-deep border border-line text-xs font-bold uppercase px-3 py-1.5 rounded-lg hover:border-accent text-ink transition-colors">Balanced Approach</button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        
        {/* Controls Column */}
        <div className="xl:col-span-1 flex flex-col gap-4">
          <div className="glass-panel p-5 border border-frost/10 rounded-2xl bg-deep2 shadow-xl">
            <h3 className="font-['Manrope'] text-lg font-bold text-accentt mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined">tune</span>
              <span>Operational Controls</span>
            </h3>
            
            <div className="space-y-4">
              {/* Objective */}
              <div>
                <label className="text-xs font-bold text-ink2 mb-1.5 block">Primary Objective</label>
                <select 
                  value={controls.objective}
                  onChange={(e) => updateControl('objective', e.target.value)}
                  className="w-full bg-panel p-2 rounded-lg border border-line text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="MAXIMIZE_PRODUCTION">Maximize Production</option>
                  <option value="BALANCED">Balanced</option>
                  <option value="MINIMIZE_COST">Minimize Cost</option>
                  <option value="MINIMIZE_RISK">Minimize Risk</option>
                </select>
              </div>

              {/* Risk Tolerance */}
              <div>
                <label className="text-xs font-bold text-ink2 mb-0.5 block">Risk Tolerance</label>
                <span className="text-[10px] text-ink3 mb-1.5 block">Willingness to take operational risks</span>
                <div className="flex rounded-lg overflow-hidden border border-line">
                  {['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].map(rt => (
                    <button 
                      key={rt}
                      onClick={() => updateControl('risk_tolerance', rt)}
                      className={`flex-1 text-[10px] font-bold py-1.5 ${controls.risk_tolerance === rt ? 'bg-accent/20 text-accentt' : 'bg-panel text-ink2 hover:bg-panel2'}`}
                    >
                      {rt === 'CONSERVATIVE' ? 'LOW' : rt === 'BALANCED' ? 'MEDIUM' : 'HIGH'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fleet Flex */}
              <div>
                <label className="text-xs font-bold text-ink2 mb-0.5 block">Moving Equipment (Fleet)</label>
                <span className="text-[10px] text-ink3 mb-1.5 block">Shifting trucks/loaders to active faces</span>
                <div className="flex rounded-lg overflow-hidden border border-line">
                  {['LOW', 'MEDIUM', 'HIGH'].map(rt => (
                    <button 
                      key={rt}
                      onClick={() => updateControl('fleet_reallocation', rt)}
                      className={`flex-1 text-[10px] font-bold py-1.5 ${controls.fleet_reallocation === rt ? 'bg-ink/10 text-ink' : 'bg-panel text-ink2 hover:bg-panel2'}`}
                    >
                      {rt}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Maint Flex */}
              <div>
                <label className="text-xs font-bold text-ink2 mb-0.5 block">Delaying Maintenance</label>
                <span className="text-[10px] text-ink3 mb-1.5 block">Postponing non-critical service</span>
                <div className="flex rounded-lg overflow-hidden border border-line">
                  {['PRESERVE', 'LIMITED', 'HIGH'].map(rt => (
                    <button 
                      key={rt}
                      onClick={() => updateControl('maintenance_flexibility', rt)}
                      className={`flex-1 text-[10px] font-bold py-1.5 ${controls.maintenance_flexibility === rt ? 'bg-ink/10 text-ink' : 'bg-panel text-ink2 hover:bg-panel2'}`}
                    >
                      {rt === 'PRESERVE' ? 'NONE' : rt}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Route Flex */}
              <div>
                <label className="text-xs font-bold text-ink2 mb-0.5 block">Changing Haul Routes</label>
                <span className="text-[10px] text-ink3 mb-1.5 block">Allowing alternative pathing</span>
                <div className="flex rounded-lg overflow-hidden border border-line">
                  {['LOW', 'MEDIUM', 'HIGH'].map(rt => (
                    <button 
                      key={rt}
                      onClick={() => updateControl('route_flexibility', rt)}
                      className={`flex-1 text-[10px] font-bold py-1.5 ${controls.route_flexibility === rt ? 'bg-ink/10 text-ink' : 'bg-panel text-ink2 hover:bg-panel2'}`}
                    >
                      {rt}
                    </button>
                  ))}
                </div>
              </div>

              {/* Fuel Slider */}
              <div className="pt-2">
                <div className="flex justify-between items-center text-xs font-bold text-ink2 mb-2">
                  <span>Max Addtl Fuel (%)</span>
                  <span className="text-accentt font-mono">+{controls.max_additional_fuel_pct}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={30}
                  value={controls.max_additional_fuel_pct}
                  onChange={(e) => updateControl('max_additional_fuel_pct', Number(e.target.value))}
                  onMouseUp={() => runScenario(controls)}
                  onTouchEnd={() => runScenario(controls)}
                  className="w-full accent-accent cursor-pointer"
                />
              </div>
            </div>
            
            <button 
              onClick={() => runScenario(controls)}
              className="w-full mt-6 bg-panel3 border border-line text-ink hover:text-accentt text-xs font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">rocket_launch</span>
              Simulate Scenario
            </button>
          </div>
        </div>

        {/* Middle Column */}
        <div className="xl:col-span-2 flex flex-col gap-6">
          <div className="data-table-container p-5 md:p-6 border border-line2/30 shadow-2xl bg-deep2 rounded-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
            
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6 relative z-10">
              <h3 className="font-['Manrope'] text-xl font-bold text-ink flex items-center gap-2">
                <span className="material-symbols-outlined text-accentt">query_stats</span>
                <span>Performance Projection</span>
              </h3>

              <div className="flex gap-2">
                <button
                  onClick={handleRevertToBaseline}
                  className={`px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-1.5 transition-colors ${
                    isBaseline ? 'bg-accent text-onaccent border-accent' : 'bg-panel2 text-ink2 border-line hover:bg-panel3'
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">history</span>
                  View Baseline
                </button>
                <span className={`px-3 py-1 rounded-full border text-xs font-bold flex items-center gap-1 transition-colors ${
                  !isBaseline ? 'bg-ok/20 text-okt border-ok' : 'bg-panel2 text-ink2 border-line'
                }`}>
                  <span className="w-2 h-2 rounded-full bg-current"></span>
                  SCENARIO ACTIVE
                </span>
              </div>
            </div>

            <div className="overflow-x-auto relative z-10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-line2/50">
                    <th className="py-4 px-4 text-xs font-bold uppercase tracking-wider text-ink2 w-1/3">Metric</th>
                    <th className="py-4 px-4 text-xs font-bold uppercase tracking-wider text-ink2 w-1/3">Baseline Current</th>
                    <th className="py-4 px-4 text-xs font-bold uppercase tracking-wider text-accentt w-1/3">Simulated Scenario</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-line2/20">
                  <tr className="hover:bg-panel3/50 transition-colors">
                    <td className="py-4 px-4 font-medium text-ink">Production Output</td>
                    <td className="py-4 px-4 text-ink2 font-mono">{metrics.productionOutput.baseline}</td>
                    <td className="py-4 px-4 text-okt font-bold font-mono flex items-center gap-2">
                      <span>{isBaseline ? metrics.productionOutput.baseline : metrics.productionOutput.scenario}</span>
                      {!isBaseline && metrics.productionOutput.trend === 'up' && <span className="material-symbols-outlined text-[18px]">trending_up</span>}
                      {!isBaseline && metrics.productionOutput.trend === 'down' && <span className="material-symbols-outlined text-[18px] text-warnt">trending_down</span>}
                    </td>
                  </tr>

                  <tr className="hover:bg-panel3/50 transition-colors">
                    <td className="py-4 px-4 font-medium text-ink">Shortfall Risk</td>
                    <td className="py-4 px-4 text-ink2 font-mono">{metrics.riskReduction.baseline}</td>
                    <td className={`py-4 px-4 font-bold font-mono flex items-center gap-2 ${metrics.riskReduction.trend === 'enhanced' ? 'text-okt' : 'text-warnt'}`}>
                      <span>{isBaseline ? metrics.riskReduction.baseline : metrics.riskReduction.scenario}</span>
                      {!isBaseline && metrics.riskReduction.trend === 'enhanced' && <span className="material-symbols-outlined text-[18px]">shield</span>}
                      {!isBaseline && metrics.riskReduction.trend === 'nominal' && <span className="material-symbols-outlined text-[18px]">warning</span>}
                    </td>
                  </tr>

                  <tr className="hover:bg-panel3/50 transition-colors">
                    <td className="py-4 px-4 font-medium text-ink">Net Cost Impact</td>
                    <td className="py-4 px-4 text-ink2 font-mono">{metrics.expectedImpact.baseline}</td>
                    <td className="py-4 px-4 text-ink font-bold font-mono">
                      <div className="flex items-center gap-2">
                        <span>{isBaseline ? metrics.expectedImpact.baseline : metrics.expectedImpact.scenario}</span>
                        {!isBaseline && metrics.expectedImpact.isSynthetic && (
                          <span
                            className="bg-warnt/20 text-warnt border border-warnt/50 text-[9px] uppercase px-1.5 py-0.5 rounded-sm font-bold"
                            title="Synthetic assumption based on historical model"
                          >
                            SYNTH
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>

                  <tr className="hover:bg-panel3/50 transition-colors">
                    <td className="py-4 px-4 font-medium text-ink">Feasibility Rating</td>
                    <td className="py-4 px-4 text-ink2">{metrics.feasibilityRating.baseline}</td>
                    <td className={`py-4 px-4 font-bold flex items-center gap-2 ${metrics.feasibilityRating.hasWarning ? 'text-warnt' : 'text-okt'}`}>
                      <span>{isBaseline ? '100% (Actual)' : metrics.feasibilityRating.scenario}</span>
                      {!isBaseline && metrics.feasibilityRating.hasWarning && <span className="material-symbols-outlined text-[18px]">warning</span>}
                      {!isBaseline && !metrics.feasibilityRating.hasWarning && <span className="material-symbols-outlined text-[18px]">check_circle</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Interventions list */}
          <div className="glass-panel p-5 md:p-6 border border-frost/10 rounded-2xl">
            <h4 className="font-['Manrope'] text-lg font-bold text-ink mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-ink2 text-base">format_list_bulleted</span>
              Proposed Interventions
            </h4>

            {interventions.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-line rounded-xl bg-panel3/50 text-ink3 text-sm">
                No viable interventions found for these constraints.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {interventions.map((item) => {
                  const isAmber = item.tagColor === 'amber';
                  return (
                    <div
                      key={item.id}
                      className={`bg-deep/70 border border-line p-4 rounded-xl flex items-start gap-4 transition-all hover:border-accent/50 group`}
                    >
                      <div className="bg-panel2 p-2.5 rounded-full border border-line3 mt-0.5 shrink-0 group-hover:bg-accent/10 transition-colors">
                        <span className={`material-symbols-outlined text-sm ${isAmber ? 'text-warnt' : 'text-accentt'}`}>
                          {item.icon}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="text-sm md:text-base font-bold text-ink">{item.title}</h5>
                          {item.model_backed && (
                            <span className="text-[9px] font-bold text-accentt bg-accentt/10 border border-accentt/20 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-accentt"></span>
                              MODEL SCORED
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink2 mt-1 leading-relaxed">{item.description}</p>
                        
                        <div className="mt-3 flex items-center gap-4 text-[11px] font-mono font-medium text-ink3">
                          {item.expected_delta_t !== undefined && (
                            <div className="flex items-center gap-1 bg-panel2 px-2 py-1 rounded-md border border-line3">
                              <span className="material-symbols-outlined text-[13px]">trending_up</span>
                              <span className={item.expected_delta_t > 0 ? 'text-okt font-bold' : 'text-warnt font-bold'}>
                                Estimated Impact: {item.expected_delta_t > 0 ? '+' : ''}{item.expected_delta_t} tonnes/shift
                              </span>
                            </div>
                          )}
                          {item.magnitude !== undefined && (
                            <div className="flex items-center gap-1 bg-panel2 px-2 py-1 rounded-md border border-line3">
                              <span className="material-symbols-outlined text-[13px]">bolt</span>
                              Intensity/Effort: {(item.magnitude * 100).toFixed(0)}%
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Rationale & Lineage */}
        <div className="xl:col-span-1 flex flex-col gap-6">
          <div className="glass-panel p-5 lg:p-6 rounded-2xl relative overflow-hidden border border-frost/10 shadow-xl h-full flex flex-col">
            <h3 className="font-['Manrope'] text-lg font-bold text-ink mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-accentt">fact_check</span>
              <span>Evidence & Assurance</span>
            </h3>

            <div className="flex-1 space-y-4">
              <div className="bg-panel3/50 p-4 rounded-xl border-l-4 border-accent border-t border-r border-b border-white/5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink2 block mb-1">Model Confidence</span>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-bold text-ink">{metrics.modelConfidence ?? 0}%</span>
                  <span className="text-[10px] bg-accent/20 text-accentt px-1.5 py-0.5 rounded">High</span>
                </div>
                <div className="w-full bg-deep rounded-full h-1 overflow-hidden">
                  <div
                    className="bg-accent h-1 rounded-full transition-all duration-500"
                    style={{ width: `${metrics.modelConfidence ?? 0}%` }}
                  ></div>
                </div>
              </div>

              <div className="bg-panel3/50 p-4 rounded-xl border-l-4 border-ok border-t border-r border-b border-white/5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink2 block mb-1">Calculation Mode</span>
                <span className="text-xs text-ink leading-relaxed font-bold">
                  {lineageInfo.calculationMode === 'MODEL_BACKED' ? 'Model-Informed (Feature Delta)' : 'Heuristic Rules Engine'}
                </span>
                <p className="text-[10px] text-ink3 mt-1 leading-tight">
                  {lineageInfo.calculationMode === 'MODEL_BACKED' 
                    ? 'Outputs derived by scoring intervention inputs against the champion model.' 
                    : 'Model features unavailable; using deterministic domain heuristics.'}
                </p>
              </div>

              <div className="bg-panel3/50 p-4 rounded-xl border-l-4 border-warnt border-t border-r border-b border-white/5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-ink2 block mb-1">Cost Assurance</span>
                <div className="text-xs text-ink leading-relaxed">
                  Financial impact estimates are synthetic.
                  <p className="text-[10px] text-ink3 mt-1 leading-tight">
                    Requires integration with ERP actuals for certified accuracy.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-white/5 text-[10px] text-ink3 leading-relaxed font-mono">
              <span className="block text-ink font-bold mb-1">SYSTEM ASSURANCE NOTE:</span>
              {lineageInfo.disclaimer || "Scenario outputs are estimates constrained by DGMS safety rules."}
              <br/><br/>
              Data Origin: {lineageInfo.dataOrigin}
            </div>
          </div>
        </div>

      </div>

      <DeploySuccessModal
        isOpen={isDeployOpen}
        onClose={() => setIsDeployOpen(false)}
        onNavigateToLive={() => router.push('/production')}
      />
    </main>
  );
}
