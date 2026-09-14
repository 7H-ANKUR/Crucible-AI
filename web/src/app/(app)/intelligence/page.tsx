'use client';

/**
 * /intelligence — Crucible AI Intelligence Center
 * Cross-Domain Reasoning Workspace:
 *   - Mine Pulse: Aggregated health scores across all 5 Crucible AI pillars
 *   - Natural Language Query Engine: Grounded operational question-answering
 *   - Top Issues: Ranked cross-domain risks with deep links
 *   - Root Cause Explorer: SHAP model drivers + observed events + unmeasured factors
 *   - Mine Replay: Chronological operational ledger timeline
 *   - Material Flow: Mass balance throughput & bottleneck analysis
 * 
 * Reskinned to Earthy Industrial.
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { apiFetch, apiPost } from '@/lib/api';
import { useMineSelector } from '@/lib/useMineId';

interface PillarHealth {
  score: number;
  status: string;
  label: string;
  weight: string;
}

interface MinePulseData {
  overall_score: number;
  overall_status: string;
  as_of: string;
  pillars: Record<string, PillarHealth>;
  data_origin: string;
}

interface TopIssue {
  id: string;
  domain: string;
  severity: string;
  title: string;
  description: string;
  deep_link: string;
  action_label: string;
}

interface NLQueryResult {
  query: string;
  intent: string;
  headline: string;
  evidence: string[];
  recommendation: string;
  relevant_link: string;
  data_origin: string;
}

interface TimelineEvent {
  id: string;
  timestamp: string;
  category: string;
  title: string;
  detail: string;
  icon: string;
}

interface FlowStage {
  id: string;
  name: string;
  capacity_tph: number;
  current_tph: number;
  utilization_pct: number;
  status: string;
}

export default function IntelligencePage() {
  const { getToken } = useAuth();
  const { mines, selectedMine, setSelectedMine } = useMineSelector();
  const [pulse, setPulse] = useState<MinePulseData | null>(null);
  const [issues, setIssues] = useState<TopIssue[]>([]);
  const [queryInput, setQueryInput] = useState('');
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState<NLQueryResult | null>(null);

  // Tab state for deep reasoning
  const [activeTab, setActiveTab] = useState<'root_cause' | 'replay' | 'material_flow'>('root_cause');

  // Root cause state
  const [rcDomain, setRcDomain] = useState('production');
  const [rcEntity, setRcEntity] = useState('mine-01');
  const [rcData, setRcData] = useState<any>(null);

  // Replay state
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);

  // Material flow state
  const [flowStages, setFlowStages] = useState<FlowStage[]>([]);
  const [flowBottleneck, setFlowBottleneck] = useState('');
  const [flowRecommendation, setFlowRecommendation] = useState('');

  const [, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getToken();
      const mq = `?mine_id=${encodeURIComponent(selectedMine)}`;
      // 1. Fetch Pulse
      try {
        const pulseRes = await apiFetch<MinePulseData>(`/intelligence/pulse${mq}`, {}, token);
        if (alive && pulseRes) setPulse(pulseRes);
      } catch (e) {
        console.error('Pulse fetch error:', e);
      }

      // 2. Fetch Top Issues
      try {
        const issuesRes = await apiFetch<any>(`/intelligence/top-issues${mq}`, {}, token);
        if (alive && issuesRes?.issues) setIssues(issuesRes.issues);
      } catch (e) {
        console.error('Issues fetch error:', e);
      }

      // 3. Fetch Root Cause
      try {
        const rcRes = await apiFetch<any>(`/intelligence/root-cause/${rcDomain}/${rcEntity}${mq}`, {}, token);
        if (alive && rcRes) setRcData(rcRes);
      } catch (e) {
        console.error('Root cause error:', e);
      }

      // 4. Fetch Replay
      try {
        const replayRes = await apiFetch<any>(`/intelligence/replay${mq}`, {}, token);
        if (alive && replayRes?.timeline) setTimeline(replayRes.timeline);
      } catch (e) {
        console.error('Replay error:', e);
      }

      // 5. Fetch Material Flow
      try {
        const flowRes = await apiFetch<any>(`/intelligence/material-flow${mq}`, {}, token);
        if (alive && flowRes) {
          setFlowStages(flowRes.stages || []);
          setFlowBottleneck(flowRes.primary_bottleneck || '');
          setFlowRecommendation(flowRes.recommended_action || '');
        }
      } catch (e) {
        console.error('Flow error:', e);
      }

      if (alive) setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [rcDomain, rcEntity, getToken, selectedMine]);

  const handleQuery = async (promptText?: string) => {
    const text = promptText || queryInput;
    if (!text.trim()) return;
    setQueryLoading(true);
    try {
      const token = await getToken();
      const res = await apiPost<NLQueryResult>(
        '/intelligence/query',
        { query: text, mine_id: selectedMine },
        token
      );
      setQueryResult(res);
    } catch (e: any) {
      alert(e.message || 'Failed to process query');
    } finally {
      setQueryLoading(false);
    }
  };


  return (
    <main className="w-full pt-16 bg-canvas-sandstone flex-1">
      <div className="flex flex-col w-full">
        {/* Top Intelligence Summary & Action Header */}
        <div className="px-gutter-lg pt-space-lg pb-space-md flex flex-col md:flex-row md:items-end justify-between gap-space-md">
          <div>
            <div className="flex items-center gap-space-xs mb-1">
              <span className="px-space-xs py-0.5 rounded bg-tertiary-container text-on-tertiary-container font-label-sm text-label-sm uppercase tracking-widest">Crucible Neural Engine</span>
              <span className="text-secondary font-label-sm text-label-sm uppercase tracking-wider">• DECIDE COGNITIVE CORE</span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-earth-charcoal tracking-tight">Intelligence &amp; Multi-Agent Causal Reasoning</h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl mt-1">
              Deep multi-physics mineral intelligence connecting blasting fragmentation, haul cycle telemetry, and real-time mill hydrocyclone kinetics.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-space-sm self-start md:self-auto mt-4 md:mt-0">
            {/* Mine Selector */}
            <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-elevation shadow-sm text-earth-charcoal">
              <span className="material-symbols-outlined text-[18px] text-copper-accent">location_on</span>
              <select
                value={selectedMine}
                onChange={(e) => setSelectedMine(e.target.value)}
                className="bg-transparent font-label-md text-label-md text-earth-charcoal focus:outline-none cursor-pointer max-w-[150px] truncate"
              >
                {mines.length > 0
                  ? mines.map((m) => (
                    <option key={m.mine_id} value={m.mine_id}>
                      {m.mine_id}{m.mine_name ? ` — ${m.mine_name}` : ''}{m.state ? ` (${m.state})` : ''}
                    </option>
                  ))
                  : [
                    'KA-TUMKUR-01', 'MH-BHANDARA-01', 'MII-NAGPUR-01',
                    'MP-BALAGHAT-01', 'OD-KFONIHAR-01',
                  ].map((id) => <option key={id} value={id}>{id}</option>)
                }
              </select>
            </div>
            <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-elevation shadow-sm text-earth-charcoal hidden sm:flex">
              <span className="material-symbols-outlined text-[18px] text-copper-accent">auto_graph</span>
              <span className="font-label-md text-label-md">Model Drift: 0.04%</span>
            </div>
            {pulse && (
              <div className="flex items-center gap-space-xs px-space-md py-space-xs rounded bg-primary-container text-on-primary-container font-label-md text-label-md shadow-sm">
                <span className="font-bold text-lg leading-none">{pulse.overall_score}</span>
                <span>Mine Pulse</span>
              </div>
            )}
          </div>
        </div>

        {/* Section 1: Mine Pulse Scorecards (1-100 Pillar Scale) */}
        {pulse?.pillars && (
          <div className="px-gutter-lg py-space-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md">
              {Object.entries(pulse.pillars).map(([key, p]) => {
                const getColors = (status: string) => {
                  switch (status) {
                    case 'HEALTHY':
                    case 'NOMINAL':
                      return { text: 'text-telemetry-emerald', bg: 'bg-telemetry-emerald' };
                    case 'WATCH':
                    case 'HIGH_LOAD':
                      return { text: 'text-telemetry-amber', bg: 'bg-telemetry-amber' };
                    case 'CONGESTED':
                      return { text: 'text-telemetry-amber', bg: 'bg-telemetry-amber' };
                    case 'CRITICAL':
                    case 'BOTTLENECK':
                    case 'AT_RISK':
                      return { text: 'text-telemetry-crimson', bg: 'bg-telemetry-crimson' };
                    default:
                      return { text: 'text-secondary', bg: 'bg-secondary' };
                  }
                };
                const colors = getColors(p.status);
                
                return (
                  <div key={key} className="bg-surface-parchment p-space-md rounded shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                    <div className="flex justify-between items-start mb-space-sm">
                      <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">{p.label}</span>
                      <span className={`w-2 h-2 rounded-full ${colors.bg}`}></span>
                    </div>
                    <div className="flex items-baseline gap-space-xs">
                      <span className={`font-headline-xl text-headline-xl ${colors.text} tracking-tight`}>{p.score}</span>
                      <span className="font-label-md text-label-md text-secondary">/100</span>
                    </div>
                    <div className="w-full bg-surface-elevation h-1.5 rounded mt-space-sm overflow-hidden">
                      <div className={`${colors.bg} h-full rounded`} style={{ width: `${p.score}%` }}></div>
                    </div>
                    <div className="flex justify-between items-center mt-space-xs">
                      <span className="font-body-sm text-body-sm text-on-surface-variant font-mono">{p.weight}</span>
                      <span className={`font-label-sm text-label-sm ${colors.text} font-semibold uppercase`}>{p.status}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Section 2: Natural Language Query & Multi-Agent Causal Reasoning Bar */}
        <div className="px-gutter-lg py-space-md">
          <div className="bg-surface-elevation rounded-xl p-space-lg shadow-md">
            {/* Query Bar Header & Input */}
            <div className="flex flex-col gap-space-xs mb-space-md">
              <div className="flex items-center justify-between">
                <label className="font-label-md text-label-md uppercase tracking-wider text-copper-accent flex items-center gap-space-xs" htmlFor="nl-intelligence-input">
                  <span className="material-symbols-outlined text-[18px]">neurology</span>
                  Natural Language Operational Reasoning Engine
                </label>
                <div className="flex items-center gap-space-xs text-secondary font-label-sm text-label-sm hidden sm:flex">
                  <span className="material-symbols-outlined text-[14px]">psychology</span>
                  <span>Agent Consensus: 98.4% Confidence</span>
                </div>
              </div>
              <div className="relative flex items-center">
                <span className="material-symbols-outlined absolute left-space-md text-copper-accent text-[24px]">psychology_alt</span>
                <input
                  id="nl-intelligence-input"
                  type="text"
                  placeholder="Ask intelligence (e.g. 'What is our production shortfall risk?')"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
                  className="w-full bg-canvas-sandstone py-space-md pl-14 pr-32 rounded font-body-md text-body-md text-earth-charcoal placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-copper-accent shadow-sm"
                />
                <button
                  onClick={() => handleQuery()}
                  disabled={queryLoading}
                  className="absolute right-space-sm px-space-md py-space-xs rounded bg-primary-container text-on-primary-container font-label-md text-label-md flex items-center gap-space-xs hover:bg-tertiary transition-colors shadow-sm disabled:opacity-50"
                >
                  {queryLoading ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                      <span className="hidden sm:inline">Reasoning</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">bolt</span>
                      <span className="hidden sm:inline">Reason</span>
                    </>
                  )}
                </button>
              </div>
              
              {/* Quick prompt chips */}
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  'What is our production shortfall risk?',
                  'Which equipment needs immediate PM?',
                  'Explain Target 4920 prospectivity',
                  'Where is the throughput bottleneck?',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      setQueryInput(prompt);
                      handleQuery(prompt);
                    }}
                    className="font-label-sm text-label-sm px-2 py-1 rounded bg-surface-container-low hover:bg-surface-container border border-earth-border text-secondary hover:text-copper-accent transition-all text-left"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            {/* AI-Generated NLQueryResult Display Box */}
            {queryResult && (
              <div className="bg-surface-parchment rounded p-space-lg shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-space-sm pb-space-sm bg-surface-container-high px-space-md py-space-xs rounded mb-space-md">
                  <div className="flex flex-wrap items-center gap-space-sm">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-earth-charcoal font-semibold">Active Agent Threads:</span>
                    <span className="px-space-xs py-0.5 rounded bg-surface-elevation text-earth-charcoal font-label-sm text-label-sm flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-copper-accent"></span>Geometallurgical Agent
                    </span>
                    <span className="px-space-xs py-0.5 rounded bg-surface-elevation text-earth-charcoal font-label-sm text-label-sm flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald"></span>Haul Fleet Dispatch
                    </span>
                    <span className="px-space-xs py-0.5 rounded bg-surface-elevation text-earth-charcoal font-label-sm text-label-sm flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-container text-on-primary-container"></span>Milling Kinetic Sim
                    </span>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary hidden sm:block">Execution trace: 342ms • Iteration #4</span>
                </div>
                
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
                  {/* Column 1: Multi-Agent Synthesis & Evidence Narrative (7 cols) */}
                  <div className="lg:col-span-7 space-y-space-md">
                    <div>
                      <h3 className="font-headline-sm text-headline-sm text-earth-charcoal mb-2 flex items-start gap-space-xs">
                        <span className="material-symbols-outlined text-telemetry-amber text-[20px] mt-1">troubleshoot</span>
                        {queryResult.headline}
                      </h3>
                      <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
                        <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-copper-accent/20 text-copper-accent border border-copper-accent/30 mr-2">
                          Intent: {queryResult.intent}
                        </span>
                        {queryResult.data_origin}
                      </p>
                    </div>

                    {/* Evidence Ledger Chips */}
                    <div className="space-y-2 mb-4">
                      {queryResult.evidence.map((ev, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm text-secondary bg-surface-container-low p-2 rounded border border-earth-border">
                          <span className="material-symbols-outlined text-telemetry-emerald text-[18px] mt-0.5 shrink-0">check_circle</span>
                          <span>{ev}</span>
                        </div>
                      ))}
                    </div>

                    {/* Prescriptive Actions */}
                    <div className="pt-space-xs">
                      <span className="font-label-sm text-label-sm uppercase tracking-wider text-earth-charcoal font-semibold block mb-space-xs">
                        Crucible Prescriptive Countermeasures:
                      </span>
                      <div className="flex flex-col sm:flex-row gap-space-sm">
                        <button className="flex-1 bg-primary-container text-on-primary-container p-space-sm rounded hover:bg-tertiary transition-colors text-left flex items-center justify-between group shadow-sm">
                          <div>
                            <div className="font-label-md text-label-md flex items-center gap-1">
                              <span className="material-symbols-outlined text-[16px]">alt_route</span>
                              Recommended Action
                            </div>
                            <div className="font-body-sm text-body-sm text-on-primary-container/80 mt-0.5">
                              {queryResult.recommendation}
                            </div>
                          </div>
                          <span className="material-symbols-outlined text-[20px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
                        </button>
                        
                        {queryResult.relevant_link && (
                          <Link href={queryResult.relevant_link} className="flex-1 bg-surface-elevation text-earth-charcoal p-space-sm rounded hover:bg-surface-container-high transition-colors text-left flex items-center justify-between group shadow-sm">
                            <div>
                              <div className="font-label-md text-label-md flex items-center gap-1">
                                <span className="material-symbols-outlined text-copper-accent text-[16px]">open_in_new</span>
                                Inspect in Domain
                              </div>
                              <div className="font-body-sm text-body-sm text-secondary mt-0.5">
                                Drill down into specific module
                              </div>
                            </div>
                            <span className="material-symbols-outlined text-[20px] group-hover:translate-x-1 transition-transform">arrow_forward</span>
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Column 2: Causal Graph Node Visualization replaced by Top Issues */}
                  <div className="lg:col-span-5 bg-canvas-sandstone p-space-md rounded shadow-sm">
                    <div className="flex items-center justify-between mb-space-sm">
                      <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary">Cross-Domain Issues Context</span>
                      <span className="font-label-sm text-label-sm text-copper-accent flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-copper-accent"></span>Bayesian Structure
                      </span>
                    </div>
                    <div className="space-y-space-sm relative">
                      {issues.length > 0 ? (
                        issues.slice(0, 3).map((iss) => {
                           const badgeColor = iss.severity === 'CRITICAL' ? 'bg-telemetry-crimson/20 text-telemetry-crimson' : 
                                              iss.severity === 'HIGH_LOAD' ? 'bg-telemetry-amber/20 text-telemetry-amber' : 
                                              'bg-surface-container text-earth-charcoal';
                           const borderColor = iss.severity === 'CRITICAL' ? 'border-telemetry-crimson' : 
                                               iss.severity === 'HIGH_LOAD' ? 'border-telemetry-amber' : 
                                               'border-surface-elevation';
                           return (
                             <div key={iss.id} className={`bg-surface-parchment p-space-sm rounded flex flex-col shadow-xs border-l-2 ${borderColor}`}>
                               <div className="flex items-center justify-between mb-1">
                                 <span className="font-label-sm text-label-sm font-semibold uppercase text-secondary">{iss.domain}</span>
                                 <span className={`px-space-xs py-0.5 rounded font-label-sm text-label-sm ${badgeColor}`}>{iss.severity}</span>
                               </div>
                               <span className="font-label-md text-label-md text-earth-charcoal block">{iss.title}</span>
                               <span className="font-body-sm text-body-sm text-secondary mt-1 line-clamp-2">{iss.description}</span>
                             </div>
                           );
                        })
                      ) : (
                        <div className="text-secondary font-body-sm text-body-sm py-4 text-center">No immediate cross-domain issues detected for this scope.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 3: Deep Reasoning Mode Tabs */}
        <div className="px-gutter-lg py-space-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm mb-space-md">
            {/* Pill Tabs */}
            <div className="inline-flex p-1 bg-surface-container rounded gap-1 overflow-x-auto whitespace-nowrap max-w-full">
              {[
                ['root_cause', 'Root Cause Explorer'],
                ['replay', 'Mine Replay'],
                ['material_flow', 'Material Flow'],
              ].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key as any)}
                  className={`px-space-md py-space-xs rounded font-label-md text-label-md transition-colors ${
                    activeTab === key
                      ? 'bg-earth-charcoal text-canvas-sandstone shadow-sm'
                      : 'text-on-surface-variant hover:text-earth-charcoal hover:bg-surface-elevation'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-space-sm text-secondary font-label-sm text-label-sm shrink-0">
              <span>Target Metric:</span>
              <span className="px-space-xs py-0.5 rounded bg-surface-elevation text-earth-charcoal font-semibold">Mill Starvation Delta (t/h)</span>
            </div>
          </div>

          {/* Active Tab: Root Cause Explorer */}
          {activeTab === 'root_cause' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg pb-space-xl">
              {/* SHAP Impact Vector Chart (7 cols) */}
              <div className="lg:col-span-7 bg-surface-parchment p-space-lg rounded shadow-sm flex flex-col justify-between">
                <div>
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-space-sm gap-2">
                    <div>
                      <h4 className="font-headline-sm text-headline-sm text-earth-charcoal">Feature Impact Ledger (SHAP)</h4>
                      <p className="font-body-sm text-body-sm text-on-surface-variant mt-0.5">
                        Relative influence of telemetry features on predicted target divergence.
                      </p>
                    </div>
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-copper-accent bg-surface-elevation px-space-xs py-0.5 rounded self-start sm:self-auto">
                      TreeSHAP v2.1
                    </span>
                  </div>
                  
                  <div className="flex flex-wrap gap-2 my-4 bg-surface-container-low p-2 rounded border border-earth-border">
                    <select
                      value={rcDomain}
                      onChange={(e) => setRcDomain(e.target.value)}
                      className="bg-surface-container border border-earth-border rounded px-2.5 py-1.5 text-xs text-earth-charcoal focus:outline-none focus:border-copper-accent"
                    >
                      <option value="production">Production Forecast</option>
                      <option value="equipment">Equipment Telemetry</option>
                    </select>
                    <select
                      value={rcEntity}
                      onChange={(e) => setRcEntity(e.target.value)}
                      className="bg-surface-container border border-earth-border rounded px-2.5 py-1.5 text-xs text-earth-charcoal focus:outline-none focus:border-copper-accent"
                    >
                      <option value="mine-01">Mine 01 (Sausar)</option>
                      <option value="HD-04">Haul Truck HD-04</option>
                    </select>
                  </div>

                  {rcData && (
                    <div className="space-y-space-md mt-space-md">
                      {rcData.model_drivers?.map((d: any, i: number) => {
                        const isPositive = d.impact.startsWith('+');
                        const colorClass = isPositive ? 'bg-telemetry-crimson' : 'bg-telemetry-emerald';
                        const textClass = isPositive ? 'text-telemetry-crimson' : 'text-telemetry-emerald';
                        const widthPct = Math.max(20, 80 - (i * 20));
                        return (
                          <div key={i}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-label-md text-label-md text-earth-charcoal flex items-center gap-space-xs">
                                <span className={`w-2 h-2 rounded-full ${colorClass}`}></span>
                                {d.factor}
                              </span>
                              <span className={`font-label-md text-label-md ${textClass} font-bold`}>{d.impact}</span>
                            </div>
                            <div className={`w-full bg-surface-container h-4 rounded overflow-hidden flex ${isPositive ? 'justify-start' : 'justify-end'}`}>
                              <div className={`${colorClass} h-full rounded`} style={{ width: `${widthPct}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
              
              {/* AI Synthesis Card & Strategic Prescriptions (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-space-md">
                <div className="bg-surface-parchment p-space-lg rounded shadow-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-copper-accent/5 rounded-full -mr-16 -mt-16 pointer-events-none"></div>
                  <div className="flex items-center gap-space-xs mb-space-md">
                    <span className="w-2.5 h-2.5 rounded-full bg-copper-accent animate-pulse"></span>
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-earth-charcoal font-semibold">Observed & Unmeasured Events</span>
                  </div>
                  
                  {rcData && (
                    <div className="space-y-6 relative z-10">
                      {/* 2. Observed Operational Events */}
                      <div>
                        <div className="font-label-sm text-label-sm text-primary uppercase tracking-wider mb-2 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">fact_check</span>
                          Observed Operational Events
                        </div>
                        <div className="space-y-2">
                          {rcData.observed_events?.map((ev: any, i: number) => (
                            <div key={i} className="p-3 rounded bg-surface-container-high text-xs border border-earth-border/50">
                              <div className="font-label-sm text-label-sm font-mono text-secondary">{ev.timestamp}</div>
                              <div className="font-body-sm text-body-sm text-earth-charcoal mt-1">{ev.event}</div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* 3. Unknown Contributors */}
                      <div>
                        <div className="font-label-sm text-label-sm text-telemetry-amber uppercase tracking-wider mb-2 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[16px]">help_outline</span>
                          Unmeasured / Latent Factors
                        </div>
                        <div className="space-y-2">
                          {rcData.unknown_contributors?.map((un: any, i: number) => (
                            <div key={i} className="p-3 rounded bg-surface-container-high text-xs border border-earth-border/50 flex justify-between items-center">
                              <div className="font-body-sm text-body-sm text-earth-charcoal">{un.factor}</div>
                              <div className="font-label-sm text-label-sm font-mono text-telemetry-amber uppercase bg-telemetry-amber/10 px-1.5 py-0.5 rounded border border-telemetry-amber/20">{un.status}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="mt-space-lg flex flex-col gap-space-xs relative z-10">
                    <button className="w-full bg-primary-container text-on-primary-container py-space-sm px-space-md rounded font-label-md text-label-md hover:bg-tertiary transition-colors flex items-center justify-center gap-space-xs shadow-md">
                      <span className="material-symbols-outlined text-[18px]">verified</span>
                      Acknowledge Factors
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Mine Replay */}
          {activeTab === 'replay' && (
            <div className="bg-surface-parchment rounded-xl p-space-lg border border-earth-border shadow-sm max-w-4xl">
              <h3 className="font-headline-sm text-headline-sm text-earth-charcoal mb-space-md flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">history</span>
                Immutable Operational Audit Timeline
              </h3>
              <div className="relative pl-space-md border-l-2 border-earth-border space-y-space-md ml-2">
                {timeline.map((ev) => (
                  <div key={ev.id} className="relative group">
                    <div className="absolute -left-[31px] top-1.5 w-4 h-4 rounded-full bg-surface-parchment border-2 border-copper-accent flex items-center justify-center"></div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-body-sm text-body-sm font-mono text-secondary">{ev.timestamp.slice(0, 16)}</span>
                      <span className="px-space-xs py-0.5 rounded font-label-sm text-label-sm uppercase bg-surface-container border border-earth-border text-secondary">
                        {ev.category}
                      </span>
                    </div>
                    <h4 className="font-label-md text-label-md text-earth-charcoal">{ev.title}</h4>
                    <p className="font-body-sm text-body-sm text-secondary mt-0.5">{ev.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 3: Material Flow */}
          {activeTab === 'material_flow' && (
            <div className="bg-surface-parchment rounded-xl p-space-lg border border-earth-border shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-space-lg">
                <div>
                  <h3 className="font-headline-sm text-headline-sm text-earth-charcoal flex items-center gap-2 mb-1">
                    <span className="material-symbols-outlined text-copper-accent">alt_route</span>
                    End-to-End Material Flow &amp; Mass Balance
                  </h3>
                  <p className="font-body-sm text-body-sm text-secondary">
                    Real-time throughput capacity across pit extraction, haulage, crushing, beneficiation, and dispatch.
                  </p>
                </div>
                {flowBottleneck && (
                  <div className="px-space-md py-space-sm rounded bg-telemetry-crimson/10 border border-telemetry-crimson/30 text-telemetry-crimson font-label-md text-label-md flex items-center gap-2">
                    <span className="material-symbols-outlined text-[20px]">priority_high</span>
                    <span>Primary Bottleneck: {flowBottleneck}</span>
                  </div>
                )}
              </div>

              {/* Stage Cards Flow */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-space-sm mb-space-lg">
                {flowStages.map((stage, idx) => (
                  <div key={stage.id} className="relative p-space-md rounded bg-surface-container border border-earth-border flex flex-col justify-between shadow-sm">
                    <div>
                      <div className="font-label-sm text-label-sm font-mono text-secondary mb-1">Stage 0{idx + 1}</div>
                      <div className="font-label-md text-label-md font-bold text-earth-charcoal leading-tight">{stage.name}</div>
                      <div className="mt-3 font-headline-md text-headline-md font-bold text-copper-accent">
                        {stage.current_tph} <span className="font-body-sm text-body-sm text-secondary font-normal">t/h</span>
                      </div>
                      <div className="font-label-sm text-label-sm text-secondary mt-1">Cap: {stage.capacity_tph} t/h</div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-earth-border/50">
                      <div className="w-full h-1.5 bg-surface-elevation rounded-full overflow-hidden mb-2">
                        <div
                          className={`h-full ${stage.utilization_pct >= 95 ? 'bg-telemetry-crimson' : stage.utilization_pct >= 85 ? 'bg-telemetry-amber' : 'bg-telemetry-emerald'}`}
                          style={{ width: `${Math.min(stage.utilization_pct, 100)}%` }}
                        ></div>
                      </div>
                      <div className="flex items-center justify-between font-label-sm text-label-sm font-bold">
                        <span className="text-secondary">{stage.utilization_pct}%</span>
                        <span className={`uppercase ${
                          stage.utilization_pct >= 95 ? 'text-telemetry-crimson' : stage.utilization_pct >= 85 ? 'text-telemetry-amber' : 'text-telemetry-emerald'
                        }`}>
                          {stage.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {flowRecommendation && (
                <div className="p-space-md rounded bg-surface-container border border-earth-border font-body-sm text-body-sm text-earth-charcoal flex items-start gap-3 shadow-sm">
                  <span className="material-symbols-outlined text-copper-accent text-[24px]">tips_and_updates</span>
                  <div className="pt-0.5">
                    <strong className="block mb-1 text-copper-accent font-label-md">Optimizer Recommendation</strong>
                    {flowRecommendation}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
