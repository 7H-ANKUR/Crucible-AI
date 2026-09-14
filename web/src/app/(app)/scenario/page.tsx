'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { useMineId } from '@/lib/useMineId';
import { DeploySuccessModal } from '@/components/crucible/Modals';
import { apiPost } from '@/lib/api';
import {
  FALLBACK_INTERVENTIONS,
  FALLBACK_METRICS,
  mapScenarioResponse,
  type ScenarioIntervention,
  type ScenarioMetrics,
  type ScenarioControls,
} from '@/lib/crucible';

export default function ScenarioPage() {
  const mineId = useMineId();
  const router = useRouter();

  const defaultControls: ScenarioControls = {
    objective: 'BALANCED',
    max_additional_fuel_pct: 14,
    fleet_reallocation: 'MEDIUM',
    maintenance_flexibility: 'LOW',
    route_flexibility: 'MEDIUM',
    operating_time_flexibility: 'NONE',
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
        next = { objective: 'MAXIMIZE_PRODUCTION', max_additional_fuel_pct: 25, fleet_reallocation: 'HIGH', maintenance_flexibility: 'HIGH', route_flexibility: 'HIGH', operating_time_flexibility: 'HIGH', risk_tolerance: 'AGGRESSIVE' };
        break;
      case 'COST_SAVER':
        next = { objective: 'MINIMIZE_COST', max_additional_fuel_pct: 5, fleet_reallocation: 'LOW', maintenance_flexibility: 'NONE', route_flexibility: 'LOW', operating_time_flexibility: 'NONE', risk_tolerance: 'CONSERVATIVE' };
        break;
      case 'SAFE_STEADY':
        next = { objective: 'MINIMIZE_RISK', max_additional_fuel_pct: 10, fleet_reallocation: 'MEDIUM', maintenance_flexibility: 'NONE', route_flexibility: 'LOW', operating_time_flexibility: 'NONE', risk_tolerance: 'CONSERVATIVE' };
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
    <main id="scenario-view-root" className="w-full bg-canvas-sandstone flex-1 flex flex-col min-h-[calc(100vh-64px)]">
      {/* Top Command Action Bar */}
      <section className="w-full px-space-lg py-space-md bg-surface-container-high flex flex-wrap items-center justify-between gap-space-md shadow-sm border-b border-earth-border flex-shrink-0 z-20">
        <div className="flex flex-wrap items-center gap-space-md">
          <div className="flex flex-col">
            <div className="flex items-center gap-space-xs">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-copper-accent">Discrete Event Simulator</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-telemetry-emerald"></span>
              <span className="font-label-sm text-label-sm text-secondary">RUN ID #{mineId?.slice(0,4) || '8841'}-B</span>
            </div>
            <h1 className="font-headline-md text-headline-md text-earth-charcoal tracking-tight">Shift B Bottleneck Mitigation Sim</h1>
          </div>
          <div className="hidden xl:flex items-center gap-space-xs bg-surface-parchment px-space-xs py-space-xs rounded-lg shadow-sm border border-earth-border">
            <span className="font-label-sm text-label-sm text-secondary px-space-xs uppercase">Presets</span>
            <button 
              className={`preset-btn px-space-sm py-1 rounded font-label-md text-label-md transition-all ${controls.objective === 'MAXIMIZE_PRODUCTION' ? 'bg-earth-espresso text-canvas-sandstone shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-earth-charcoal'}`}
              onClick={() => applyPreset('MAX_OUTPUT')}
            >Maximize Output</button>
            <button 
              className={`preset-btn px-space-sm py-1 rounded font-label-md text-label-md transition-all ${controls.objective === 'MINIMIZE_COST' ? 'bg-earth-espresso text-canvas-sandstone shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-earth-charcoal'}`}
              onClick={() => applyPreset('COST_SAVER')}
            >Cost Saver</button>
            <button 
              className={`preset-btn px-space-sm py-1 rounded font-label-md text-label-md transition-all ${controls.objective === 'MINIMIZE_RISK' ? 'bg-earth-espresso text-canvas-sandstone shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-earth-charcoal'}`}
              onClick={() => applyPreset('SAFE_STEADY')}
            >Safe & Steady</button>
            <button 
              className={`preset-btn px-space-sm py-1 rounded font-label-md text-label-md transition-all ${controls.objective === 'BALANCED' ? 'bg-earth-espresso text-canvas-sandstone shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-highest hover:text-earth-charcoal'}`}
              onClick={() => applyPreset('BALANCED')}
            >Balanced Approach</button>
          </div>
        </div>
        <div className="flex items-center gap-space-sm">
          <div className="hidden sm:flex flex-col text-right">
            <span className="font-label-sm text-label-sm text-secondary">PROJECTED GAIN</span>
            <span className="font-headline-sm text-headline-sm text-telemetry-emerald font-bold">{isBaseline ? '$0' : metrics.expectedImpact.scenario}</span>
          </div>
          <button 
            className="px-space-md py-2.5 rounded-lg bg-primary-container text-on-primary-container hover:bg-primary font-label-md text-label-md shadow-md hover:shadow-lg transition-all flex items-center gap-space-xs group disabled:opacity-50" 
            onClick={() => setIsDeployOpen(true)}
            disabled={isRunning || isBaseline}
          >
            <span className="material-symbols-outlined text-[18px] group-hover:translate-x-0.5 transition-transform">send_and_archive</span>
            <span>Send for Approval</span>
          </button>
        </div>
      </section>

      {/* Main 3-Pane Bento Grid Workspace */}
      <div className="flex-1 w-full p-space-md lg:p-space-lg grid grid-cols-1 lg:grid-cols-12 gap-space-md lg:gap-space-lg">
        
        {/* LEFT PANEL: Operational Controls (4 Cols) */}
        <section className="lg:col-span-4 flex flex-col gap-space-md">
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex flex-col gap-space-md">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-copper-accent text-[20px]">tune</span>
                <h2 className="font-headline-sm text-headline-sm text-earth-charcoal">Operational Controls</h2>
              </div>
              <span className="font-label-sm text-label-sm px-space-xs py-0.5 rounded bg-surface-container-high text-secondary border border-earth-border/50">ACTIVE CONSTRAINTS: 6</span>
            </div>
            
            {/* Objective Selection */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Optimization Objective</label>
              <div className="relative">
                <select 
                  className="w-full bg-canvas-sandstone text-earth-charcoal font-body-md text-body-md px-space-sm py-2.5 rounded-lg shadow-sm border border-earth-border focus:outline-none focus:ring-2 focus:ring-copper-accent cursor-pointer appearance-none"
                  value={controls.objective}
                  onChange={(e) => updateControl('objective', e.target.value)}
                >
                  <option value="MAXIMIZE_PRODUCTION">Maximize Crusher Ore Run Rate</option>
                  <option value="BALANCED">Mitigate Mill Starvation (High Priority)</option>
                  <option value="MINIMIZE_COST">Minimize Haul Fleet Carbon & Fuel</option>
                  <option value="MINIMIZE_RISK">Stabilize Copper Grade Variance (±0.04% Cu)</option>
                </select>
                <span className="material-symbols-outlined pointer-events-none absolute right-3 top-3 text-secondary text-[18px]">expand_more</span>
              </div>
            </div>
            
            {/* Discrete Toggles */}
            <div className="flex flex-col gap-space-sm">
              {/* Risk Tolerance */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm uppercase text-secondary">Risk Tolerance</span>
                  <span className="font-label-sm text-label-sm text-copper-accent font-semibold">{controls.risk_tolerance === 'CONSERVATIVE' ? 'Conservative (Low)' : controls.risk_tolerance === 'BALANCED' ? 'Balanced (Medium)' : 'Aggressive (High)'}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-surface-container-high p-1 rounded-lg border border-earth-border/50 shadow-inner">
                  {['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].map(rt => (
                    <button 
                      key={rt}
                      className={`py-1.5 text-center font-label-md text-label-md rounded transition-colors ${controls.risk_tolerance === rt ? 'bg-earth-espresso text-canvas-sandstone shadow-sm' : 'text-secondary hover:text-earth-charcoal'}`}
                      onClick={() => updateControl('risk_tolerance', rt)}
                    >
                      {rt === 'CONSERVATIVE' ? 'Conservative' : rt === 'BALANCED' ? 'Balanced' : 'Aggressive'}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Fleet Flexibility */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm uppercase text-secondary">Fleet Flexibility</span>
                  <span className="font-label-sm text-label-sm text-secondary">Hauler Re-dispatch</span>
                </div>
                <div className="grid grid-cols-3 gap-1 bg-surface-container-high p-1 rounded-lg border border-earth-border/50 shadow-inner">
                  {['NONE', 'MEDIUM', 'HIGH'].map(rt => (
                    <button 
                      key={rt}
                      className={`py-1.5 text-center font-label-md text-label-md rounded transition-colors ${controls.fleet_reallocation === rt ? 'bg-earth-espresso text-canvas-sandstone shadow-sm' : 'text-secondary hover:text-earth-charcoal'}`}
                      onClick={() => updateControl('fleet_reallocation', rt)}
                    >
                      {rt === 'NONE' ? 'Locked' : rt === 'MEDIUM' ? 'Dynamic' : 'Full Realloc'}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Maintenance Flexibility */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm uppercase text-secondary">Maintenance Flexibility</span>
                  <span className={`font-label-sm text-label-sm font-semibold ${controls.maintenance_flexibility !== 'NONE' ? 'text-telemetry-amber' : 'text-secondary'}`}>
                    {controls.maintenance_flexibility !== 'NONE' ? 'Window Extended' : 'Strict Schedule'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 bg-surface-container-high p-1 rounded-lg border border-earth-border/50 shadow-inner">
                  {['NONE', 'HIGH'].map(rt => (
                    <button 
                      key={rt}
                      className={`py-1.5 text-center font-label-md text-label-md rounded transition-colors ${
                        (rt === 'NONE' ? controls.maintenance_flexibility === 'NONE' : controls.maintenance_flexibility !== 'NONE')
                          ? 'bg-earth-espresso text-canvas-sandstone shadow-sm'
                          : 'text-secondary hover:text-earth-charcoal'
                      }`}
                      onClick={() => updateControl('maintenance_flexibility', rt === 'NONE' ? 'NONE' : 'HIGH')}
                    >
                      {rt === 'NONE' ? 'Strict PM' : 'Deferrable (+4h)'}
                    </button>
                  ))}
                </div>
              </div>
              
              {/* Route Flexibility */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center">
                  <span className="font-label-sm text-label-sm uppercase text-secondary">Route Flexibility</span>
                  <span className={`font-label-sm text-label-sm font-semibold ${controls.route_flexibility !== 'NONE' ? 'text-telemetry-emerald' : 'text-secondary'}`}>
                    {controls.route_flexibility !== 'NONE' ? 'Gradient 12% Allowed' : 'Standard Grades'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1 bg-surface-container-high p-1 rounded-lg border border-earth-border/50 shadow-inner">
                  {['NONE', 'HIGH'].map(rt => (
                    <button 
                      key={rt}
                      className={`py-1.5 text-center font-label-md text-label-md rounded transition-colors ${
                        (rt === 'NONE' ? controls.route_flexibility === 'NONE' : controls.route_flexibility !== 'NONE')
                          ? 'bg-earth-espresso text-canvas-sandstone shadow-sm'
                          : 'text-secondary hover:text-earth-charcoal'
                      }`}
                      onClick={() => updateControl('route_flexibility', rt === 'NONE' ? 'NONE' : 'HIGH')}
                    >
                      {rt === 'NONE' ? 'Standard Haul' : 'Bypass Ramps'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Range Slider */}
            <div className="flex flex-col gap-2 pt-space-xs bg-surface-container-low border border-earth-border/50 p-space-sm rounded-lg shadow-inner">
              <div className="flex justify-between items-center">
                <span className="font-label-sm text-label-sm uppercase text-secondary">Max Additional Fuel</span>
                <span className="font-headline-sm text-headline-sm text-earth-charcoal font-semibold">+{controls.max_additional_fuel_pct}% <span className="font-body-sm text-body-sm text-secondary">(+{(controls.max_additional_fuel_pct * 30).toFixed(0)}L/hr)</span></span>
              </div>
              <input 
                type="range" 
                min="0" max="30" 
                className="w-full accent-copper-accent bg-surface-elevation h-2 rounded-lg cursor-pointer border border-earth-border/50" 
                value={controls.max_additional_fuel_pct}
                onChange={(e) => updateControl('max_additional_fuel_pct', Number(e.target.value))}
                onMouseUp={() => runScenario(controls)}
                onTouchEnd={() => runScenario(controls)}
              />
              <div className="flex justify-between text-secondary font-label-sm text-label-sm">
                <span>0% (Eco-cap)</span>
                <span>+15% (Nominal)</span>
                <span>+30% (Surge)</span>
              </div>
            </div>
            
            {/* Primary Action Simulate Button */}
            <button 
              className="mt-space-xs w-full py-3 rounded-lg bg-primary-container hover:bg-primary text-on-primary-container font-headline-sm text-headline-sm tracking-wide shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-space-sm relative overflow-hidden disabled:opacity-80" 
              onClick={() => runScenario(controls)}
              disabled={isRunning}
            >
              <span className={`material-symbols-outlined text-[20px] ${isRunning ? 'animate-spin' : ''}`}>{isRunning ? 'autorenew' : 'play_circle'}</span>
              <span>{isRunning ? 'Simulating Feasibility...' : 'Simulate Scenario'}</span>
            </button>
            
            {/* Context Micro Data */}
            <div className="flex items-center justify-between text-secondary font-label-sm text-label-sm px-space-xs mt-1">
              <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">memory</span> Surrogate PINN v2.4</span>
              <span>Latency: ~410ms</span>
            </div>
          </div>
          
          {/* Quick Telemetry Insight Banner */}
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex items-start gap-space-sm">
            <div className="p-2 rounded bg-surface-container-high border border-earth-border/50 text-copper-accent shadow-inner">
              <span className="material-symbols-outlined text-[22px]">analytics</span>
            </div>
            <div className="flex flex-col">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Geotechnical Real-Time</span>
              <span className="font-headline-sm text-headline-sm text-earth-charcoal">Pit Ramp 04 Ground Saturation: 8.2%</span>
              <p className="font-body-sm text-body-sm text-secondary mt-1">Bypass ramps maintain a safety factor of 1.48, well above the 1.30 regulatory minimum.</p>
            </div>
          </div>
        </section>

        {/* CENTER PANEL: Performance Projection & Interventions (5 Cols) */}
        <section className="lg:col-span-5 flex flex-col gap-space-md">
          {/* Comparison Table Card */}
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex flex-col gap-space-md">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-copper-accent text-[20px]">stacked_line_chart</span>
                <h2 className="font-headline-sm text-headline-sm text-earth-charcoal">Shift Performance Delta</h2>
              </div>
              <button 
                className={`px-space-sm py-1 rounded font-label-md text-label-md flex items-center gap-1 transition-colors border ${isBaseline ? 'bg-earth-espresso text-canvas-sandstone border-earth-espresso shadow-sm' : 'bg-surface-container-high hover:bg-surface-elevation text-earth-charcoal border-earth-border shadow-inner'}`} 
                onClick={handleRevertToBaseline}
              >
                <span className="material-symbols-outlined text-[16px]">{isBaseline ? 'check' : 'visibility'}</span>
                <span>{isBaseline ? 'Baseline Pinned' : 'View Baseline'}</span>
              </button>
            </div>
            
            {/* Metric Table */}
            <div className="overflow-hidden rounded-lg shadow-sm bg-canvas-sandstone border border-earth-border">
              <table className="w-full text-left font-body-md text-body-md border-collapse">
                <thead>
                  <tr className="bg-surface-elevation text-secondary font-label-sm text-label-sm uppercase tracking-wider border-b border-earth-border/50">
                    <th className="py-2.5 px-space-md">Metric</th>
                    <th className="py-2.5 px-space-sm text-right">Baseline Current</th>
                    <th className="py-2.5 px-space-sm text-right bg-surface-container-high border-x border-earth-border/50 text-earth-charcoal font-bold">Simulated Shift</th>
                    <th className="py-2.5 px-space-md text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-container">
                  <tr className="hover:bg-surface-container-low transition-colors">
                    <td className="py-3 px-space-md flex items-center gap-1.5 font-headline-sm text-headline-sm text-earth-charcoal">
                      <span className="material-symbols-outlined text-secondary text-[16px]">mountain_flag</span>
                      <span>Tonnes Mined</span>
                    </td>
                    <td className="py-3 px-space-sm text-right text-secondary">{metrics.productionOutput.baseline}</td>
                    <td className="py-3 px-space-sm text-right font-headline-sm text-headline-sm text-earth-charcoal font-semibold bg-surface-container-low border-x border-earth-border/30">
                      {isBaseline ? metrics.productionOutput.baseline : metrics.productionOutput.scenario}
                    </td>
                    <td className={`py-3 px-space-md text-right font-headline-sm text-headline-sm font-semibold ${isBaseline ? 'text-secondary' : metrics.productionOutput.trend === 'up' ? 'text-telemetry-emerald' : 'text-telemetry-amber'}`}>
                      {isBaseline ? '0%' : metrics.productionOutput.trend === 'up' ? '+9.2%' : '-2.1%'}
                    </td>
                  </tr>
                  
                  <tr className="hover:bg-surface-container-low transition-colors">
                    <td className="py-3 px-space-md flex items-center gap-1.5 font-headline-sm text-headline-sm text-earth-charcoal">
                      <span className="material-symbols-outlined text-copper-accent text-[16px]">cyclone</span>
                      <span>SAG Mill Feed</span>
                    </td>
                    <td className="py-3 px-space-sm text-right text-secondary">3,100 tph</td>
                    <td className="py-3 px-space-sm text-right font-headline-sm text-headline-sm text-earth-charcoal font-semibold bg-surface-container-low border-x border-earth-border/30">
                      {isBaseline ? '3,100 tph' : '3,450 tph'}
                    </td>
                    <td className={`py-3 px-space-md text-right font-headline-sm text-headline-sm font-semibold ${isBaseline ? 'text-secondary' : metrics.productionOutput.trend === 'up' ? 'text-telemetry-emerald' : 'text-telemetry-amber'}`}>
                      {isBaseline ? '0%' : metrics.productionOutput.trend === 'up' ? '+11.3%' : '-1.5%'}
                    </td>
                  </tr>
                  
                  <tr className="hover:bg-surface-container-low transition-colors">
                    <td className="py-3 px-space-md flex items-center gap-1.5 font-headline-sm text-headline-sm text-earth-charcoal">
                      <span className="material-symbols-outlined text-secondary text-[16px]">payments</span>
                      <span>Unit Cost</span>
                    </td>
                    <td className="py-3 px-space-sm text-right text-secondary">$4.12 /t</td>
                    <td className="py-3 px-space-sm text-right font-headline-sm text-headline-sm text-earth-charcoal font-semibold bg-surface-container-low border-x border-earth-border/30">
                      {isBaseline ? '$4.12 /t' : controls.objective === 'MINIMIZE_COST' ? '$3.60 /t' : '$3.88 /t'}
                    </td>
                    <td className={`py-3 px-space-md text-right font-headline-sm text-headline-sm font-semibold ${isBaseline ? 'text-secondary' : controls.objective === 'MINIMIZE_COST' ? 'text-telemetry-emerald' : 'text-telemetry-emerald'}`}>
                      {isBaseline ? '0%' : controls.objective === 'MINIMIZE_COST' ? '-12.6%' : '-5.8%'}
                    </td>
                  </tr>
                  
                  <tr className="hover:bg-surface-container-low transition-colors bg-surface-container-low border-t-2 border-earth-border/50">
                    <td className="py-3 px-space-md flex items-center gap-1.5 font-headline-sm text-headline-sm text-earth-espresso font-bold">
                      <span className="material-symbols-outlined text-ore-gold text-[16px]">price_check</span>
                      <span>Estimated Net Gain</span>
                    </td>
                    <td className="py-3 px-space-sm text-right text-secondary">$0 (Ref)</td>
                    <td className="py-3 px-space-sm text-right font-headline-md text-headline-md text-telemetry-emerald font-bold bg-surface-elevation border-x border-earth-border/50 shadow-inner">
                      {isBaseline ? '$0' : metrics.expectedImpact.scenario}
                    </td>
                    <td className={`py-3 px-space-md text-right font-label-md text-label-md font-bold ${isBaseline ? 'text-secondary' : 'text-telemetry-emerald'}`}>
                      {isBaseline ? 'BASELINE' : 'OPTIMAL'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            
            {/* Inline Visual Comparison Sparklines / Mini Bar */}
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex justify-between items-center text-secondary font-label-sm text-label-sm">
                <span>SAG FEED SATURATION CURVE (8H SHIFT)</span>
                <span className="text-telemetry-emerald font-semibold">98.6% Capacity Target</span>
              </div>
              <div className="w-full h-12 bg-canvas-sandstone rounded-lg p-2 flex items-end gap-1 shadow-inner border border-earth-border/50">
                <div className={`flex-1 bg-outline-variant h-[60%] rounded-sm transition-all ${!isBaseline ? 'opacity-70' : ''}`} title="08:00 - Baseline"></div>
                <div className={`flex-1 bg-outline-variant h-[55%] rounded-sm transition-all ${!isBaseline ? 'opacity-70' : ''}`} title="09:00 - Bottleneck"></div>
                <div className={`flex-1 rounded-sm transition-all ${!isBaseline ? 'bg-copper-accent h-[88%]' : 'bg-outline-variant h-[50%]'}`} title="10:00 - Intervention Active"></div>
                <div className={`flex-1 rounded-sm transition-all ${!isBaseline ? 'bg-primary-container h-[92%]' : 'bg-outline-variant h-[45%]'}`} title="11:00 - Surge"></div>
                <div className={`flex-1 rounded-sm transition-all ${!isBaseline ? 'bg-copper-accent h-[95%]' : 'bg-outline-variant h-[55%]'}`} title="12:00 - Steady State"></div>
                <div className={`flex-1 rounded-sm transition-all ${!isBaseline ? 'bg-copper-accent h-[91%]' : 'bg-outline-variant h-[50%]'}`} title="13:00 - Steady State"></div>
                <div className={`flex-1 rounded-sm transition-all ${!isBaseline ? 'bg-primary h-[97%]' : 'bg-outline-variant h-[55%]'}`} title="14:00 - Max Mill Rate"></div>
                <div className={`flex-1 rounded-sm transition-all ${!isBaseline ? 'bg-copper-accent h-[94%]' : 'bg-outline-variant h-[48%]'}`} title="15:00 - Shift Handover"></div>
              </div>
            </div>
          </div>
          
          {/* Proposed Interventions List */}
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex flex-col gap-space-sm flex-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-copper-accent text-[20px]">checklist</span>
                <h3 className="font-headline-sm text-headline-sm text-earth-charcoal">Prescribed Tactical Interventions</h3>
              </div>
              <span className="font-label-sm text-label-sm text-secondary">{interventions.length} Machine Executable</span>
            </div>
            
            {interventions.length === 0 ? (
              <div className="flex-1 flex items-center justify-center p-8 text-center border border-dashed border-earth-border rounded-xl bg-surface-container-low text-secondary text-sm shadow-inner">
                No viable interventions found for these constraints.
              </div>
            ) : (
              <div className="flex flex-col gap-space-sm">
                {interventions.map((item, i) => {
                  const isAmber = item.tagColor === 'amber';
                  return (
                    <div key={item.id} className="p-space-sm rounded-lg bg-canvas-sandstone shadow-sm border border-earth-border/50 flex items-start gap-space-sm hover:translate-x-1 transition-transform group hover:border-copper-accent/30">
                      <div className="w-7 h-7 rounded-full bg-primary text-on-primary font-headline-sm text-headline-sm flex items-center justify-center shrink-0 shadow-sm">{i + 1}</div>
                      <div className="flex flex-col flex-1">
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="font-headline-sm text-headline-sm text-earth-charcoal">{item.title}</span>
                          <div className="flex items-center gap-1.5">
                            {item.expected_delta_t !== undefined && (
                              <span className={`font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-container-high border border-earth-border/50 shadow-inner ${item.expected_delta_t > 0 ? 'text-telemetry-emerald' : 'text-telemetry-amber'} font-semibold`}>
                                {item.expected_delta_t > 0 ? '+' : ''}{item.expected_delta_t} Tonnes
                              </span>
                            )}
                            <span className={`font-label-sm text-label-sm px-2 py-0.5 rounded bg-surface-elevation border border-earth-border/50 ${isAmber ? 'text-telemetry-amber' : 'text-secondary'} font-semibold`}>
                              {item.magnitude !== undefined ? `${(item.magnitude * 100).toFixed(0)}% Impact` : 'Mod Effort'}
                            </span>
                          </div>
                        </div>
                        <p className="font-body-sm text-body-sm text-secondary mt-1 leading-relaxed">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANEL: Evidence & Assurance (3 Cols) */}
        <section className="lg:col-span-3 flex flex-col gap-space-md">
          {/* Model Confidence Bento Card */}
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex flex-col items-center text-center gap-space-sm">
            <div className="w-full flex items-center justify-between">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Model Reliability</span>
              <span className="material-symbols-outlined text-copper-accent text-[18px]">verified</span>
            </div>
            
            {/* Radial Gauge Visual (SVG) */}
            <div className="relative w-36 h-36 flex items-center justify-center my-1">
              <svg className="w-full h-full transform -rotate-90 filter drop-shadow-sm" viewBox="0 0 100 100">
                <circle className="text-surface-elevation" cx="50" cy="50" fill="transparent" r="40" stroke="currentColor" strokeWidth="8"></circle>
                <circle 
                  className="text-copper-accent transition-all duration-1000 ease-out" 
                  cx="50" cy="50" fill="transparent" r="40" stroke="currentColor" 
                  strokeDasharray="251.2" strokeDashoffset={251.2 - (251.2 * (metrics.modelConfidence ?? 0) / 100)} 
                  strokeLinecap="round" strokeWidth="8"
                ></circle>
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="font-headline-xl text-headline-xl text-earth-charcoal leading-none">{metrics.modelConfidence ?? 0}%</span>
                <span className="font-label-sm text-label-sm text-secondary mt-1 uppercase">Bayesian</span>
              </div>
            </div>
            
            <div className="w-full p-space-xs rounded bg-surface-container-low border border-earth-border/50 shadow-inner flex flex-col gap-1">
              <div className="flex justify-between font-label-sm text-label-sm text-secondary">
                <span>Epistemic Uncertainty</span>
                <span className="text-earth-charcoal font-semibold">±2.1%</span>
              </div>
              <div className="flex justify-between font-label-sm text-label-sm text-secondary">
                <span>Historical Convergence</span>
                <span className="text-telemetry-emerald font-semibold">99.1% High</span>
              </div>
            </div>
            
            {/* Calculation Mode Indicator Badge */}
            <div className="w-full py-2 px-space-sm rounded-lg bg-surface-container-high border border-earth-border/50 shadow-inner flex items-center justify-center gap-space-xs mt-1">
              <span className="w-2 h-2 rounded-full bg-telemetry-emerald"></span>
              <span className="font-label-sm text-label-sm uppercase text-earth-charcoal font-bold tracking-wider truncate" title={lineageInfo.calculationMode === 'MODEL_BACKED' ? 'Model-Backed (Surrogate PINN)' : 'Heuristic Rules Engine'}>
                {lineageInfo.calculationMode === 'MODEL_BACKED' ? 'Model-Backed (Surrogate PINN)' : 'Heuristic Rules Engine'}
              </span>
            </div>
          </div>
          
          {/* Field Evidence Graphic Card */}
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex flex-col gap-space-sm">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Physical Constraints Map</span>
            <div className="relative w-full h-36 rounded-lg overflow-hidden shadow-sm border border-earth-border/50">
              <img className="w-full h-full object-cover" alt="Kansanshi Pit" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDLr-IbeT9jTsupJh-2Pren4PrnEx93yQ779ARKHoG89GFWxL44fSUNl-Xc9Ygj7mssNF55Aooh7qWvoAXtY3CsT1bMNXnEQE6hjHM4I_JRmcITR25zftN9eMjIfF_Hp_GKxrhtk6njKs5neyhJYYaaapjAwPyLwGLqPSxhizqz6_nx-78l7LdLD_4cAuzeHP0cq4mscJB8BUi5-_guGinYYv-Qww6_9-657yJRMRAwo5GPcv8ppHch"/>
              <div className="absolute inset-0 bg-gradient-to-t from-earth-espresso/80 via-earth-espresso/20 to-transparent p-space-sm flex flex-col justify-end">
                <span className="font-label-md text-label-md text-canvas-sandstone font-bold">Kansanshi Bench 12 - South Chute</span>
                <span className="font-label-sm text-label-sm text-on-primary-container">Haul Gradient 8.4% Nominal</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-secondary font-label-sm text-label-sm px-1">
              <span>Bench Traffic: Light (3/h)</span>
              <span className="text-copper-accent font-semibold">Weather: Dry / 29°C</span>
            </div>
          </div>
          
          {/* Cost Assurance & Audit Trail Disclaimer */}
          <div className="bg-surface-parchment p-space-md rounded-xl shadow-sm border border-earth-border flex flex-col gap-space-sm flex-1">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-secondary text-[20px]">policy</span>
              <h4 className="font-headline-sm text-headline-sm text-earth-charcoal">Assurance & Governance</h4>
            </div>
            <p className="font-body-sm text-body-sm text-secondary leading-relaxed">
              Simulated trajectory is bound by the <strong className="text-earth-charcoal">Kansanshi Mining Standard Operating Procedure v4.8</strong>. Mechanical safety tolerances on CAT 793F fleet and SAG bearing thermal margins are verified against ISO-13849 telemetry compliance rules.
              {lineageInfo.disclaimer && <span className="block mt-1 italic">{lineageInfo.disclaimer}</span>}
            </p>
            <div className="pt-space-xs border-t-0 flex flex-col gap-1.5 mt-auto">
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-secondary">Audit Hash:</span>
                <span className="font-mono text-earth-charcoal bg-surface-container-high border border-earth-border/50 px-1.5 py-0.5 rounded text-[11px] shadow-inner">0x7c9a...e31b</span>
              </div>
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-secondary">Dispatched Agent:</span>
                <span className="text-earth-charcoal font-semibold">Crucible-SIM-Core</span>
              </div>
              <div className="flex items-center justify-between font-label-sm text-label-sm">
                <span className="text-secondary">Data Origin:</span>
                <span className="text-earth-charcoal font-semibold">{lineageInfo.dataOrigin}</span>
              </div>
              <div className="flex items-center gap-1 text-telemetry-emerald font-label-sm text-label-sm mt-1 bg-telemetry-emerald/10 border border-telemetry-emerald/20 px-2 py-1 rounded">
                <span className="material-symbols-outlined text-[16px]">task_alt</span>
                <span>Pre-authorization Safety Checks Passed</span>
              </div>
            </div>
          </div>
        </section>

      </div>

      <DeploySuccessModal
        isOpen={isDeployOpen}
        onClose={() => setIsDeployOpen(false)}
        onNavigateToLive={() => router.push('/production')}
      />

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-earth-charcoal text-surface-parchment px-4 py-2.5 rounded-lg shadow-xl text-sm font-medium flex items-center gap-2 border border-earth-border/40 animate-fade-in">
          <span className="material-symbols-outlined text-[18px] text-copper-accent">info</span>
          {toastMessage}
        </div>
      )}
    </main>
  );
}
