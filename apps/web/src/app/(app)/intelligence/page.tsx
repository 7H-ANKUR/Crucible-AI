'use client';

/**
 * /intelligence — MINEx Intelligence Center
 * Cross-Domain Reasoning Workspace:
 *   - Mine Pulse: Aggregated health scores across all 5 MINEx pillars
 *   - Natural Language Query Engine: Grounded operational question-answering
 *   - Top Issues: Ranked cross-domain risks with deep links
 *   - Root Cause Explorer: SHAP model drivers + observed events + unmeasured factors
 *   - Mine Replay: Chronological operational ledger timeline
 *   - Material Flow: Mass balance throughput & bottleneck analysis
 */
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { apiFetch, apiPost } from '@/lib/api';

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
      // 1. Fetch Pulse
      try {
        const pulseRes = await apiFetch<MinePulseData>('/intelligence/pulse', {}, token);
        if (alive && pulseRes) setPulse(pulseRes);
      } catch (e) {
        console.error('Pulse fetch error:', e);
      }

      // 2. Fetch Top Issues
      try {
        const issuesRes = await apiFetch<any>('/intelligence/top-issues', {}, token);
        if (alive && issuesRes?.issues) setIssues(issuesRes.issues);
      } catch (e) {
        console.error('Issues fetch error:', e);
      }

      // 3. Fetch Root Cause
      try {
        const rcRes = await apiFetch<any>(`/intelligence/root-cause/${rcDomain}/${rcEntity}`, {}, token);
        if (alive && rcRes) setRcData(rcRes);
      } catch (e) {
        console.error('Root cause error:', e);
      }

      // 4. Fetch Replay
      try {
        const replayRes = await apiFetch<any>('/intelligence/replay', {}, token);
        if (alive && replayRes?.timeline) setTimeline(replayRes.timeline);
      } catch (e) {
        console.error('Replay error:', e);
      }

      // 5. Fetch Material Flow
      try {
        const flowRes = await apiFetch<any>('/intelligence/material-flow', {}, token);
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
  }, [rcDomain, rcEntity, getToken]);

  const handleQuery = async (promptText?: string) => {
    const text = promptText || queryInput;
    if (!text.trim()) return;
    setQueryLoading(true);
    try {
      const token = await getToken();
      const res = await apiPost<NLQueryResult>('/intelligence/query', { query: text }, token);
      setQueryResult(res);
    } catch (e: any) {
      alert(e.message || 'Failed to process query');
    } finally {
      setQueryLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'HEALTHY':
      case 'NOMINAL':
        return 'bg-ok/20 text-okt border-ok/30';
      case 'WATCH':
      case 'HIGH_LOAD':
        return 'bg-warn/20 text-warnt border-warn/30';
      case 'CONGESTED':
        return 'bg-warn/25 text-warnt border-warn/40';
      case 'CRITICAL':
      case 'BOTTLENECK':
      case 'AT_RISK':
        return 'bg-danger/20 text-dangert border-danger/30';
      default:
        return 'bg-panel3 text-ink2 border-line';
    }
  };

  return (
    <main className="flex-1 bg-deep min-h-screen p-4 md:p-6 lg:p-8 pb-20">
      {/* Demo Mode / Synthetic Benchmark Banner */}
      <div className="mb-6 p-3 rounded-xl bg-accentt/10 border border-accentt/25 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-ink">
          <span className="w-2.5 h-2.5 rounded-full bg-accentt animate-pulse"></span>
          <span className="font-bold uppercase tracking-wider text-accentt">Synthetic Operational Benchmark</span>
          <span className="text-ink3 hidden sm:inline">· Real ML inference pipelines operating on Indian mineral baseline (21.95°N, 79.25°E)</span>
        </div>
        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-panel3 border border-line text-ink2">
          DGMS BENCHMARK
        </span>
      </div>

      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-ink3 tracking-widest uppercase">Platform</span>
            <span className="text-ink3">/</span>
            <span className="text-[11px] font-bold text-accentt tracking-widest uppercase">Intelligence Center</span>
          </div>
          <h1 className="font-['Manrope'] text-3xl md:text-4xl font-bold text-ink tracking-tight">
            Cross-Domain Operations Intelligence
          </h1>
          <p className="text-sm text-ink2 mt-1 max-w-2xl">
            Unified reasoning workspace connecting production variances, fleet health, exploration targets, and throughput flow.
          </p>
        </div>

        {pulse && (
          <div className="liquid-glass-dark rounded-2xl p-4 border border-line flex items-center gap-4 shrink-0 shadow-lg">
            <div className="relative flex items-center justify-center w-14 h-14 rounded-xl bg-panel3 border border-line2/40">
              <span className="font-['Space_Grotesk'] text-2xl font-bold text-accentt">
                {pulse.overall_score}
              </span>
            </div>
            <div>
              <div className="text-[10px] font-bold text-ink3 uppercase tracking-wider">Unified Mine Pulse</div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusBadge(pulse.overall_status)}`}>
                  {pulse.overall_status}
                </span>
                <span className="text-[11px] font-mono text-ink2">Overall</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Pillar Breakdown Grid */}
      {pulse?.pillars && (
        <section className="mb-8 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(pulse.pillars).map(([key, p]) => (
            <div key={key} className="liquid-glass-dark rounded-xl p-3.5 border border-line flex flex-col justify-between">
              <div>
                <div className="text-[10px] font-bold text-ink3 uppercase tracking-wider">{p.label}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-['Space_Grotesk'] text-2xl font-bold text-ink">{p.score}</span>
                  <span className="text-[10px] text-ink3">/100</span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px]">
                <span className={`px-1.5 py-0.2 rounded font-bold uppercase border ${getStatusBadge(p.status)}`}>
                  {p.status}
                </span>
                <span className="text-ink3 font-mono">{p.weight}</span>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Natural Language Query Box */}
      <section className="mb-8 liquid-glass-dark rounded-2xl p-6 border border-line shadow-xl">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-accentt">chat_bubble</span>
          Ask MINEx Intelligence (Natural Language Reasoning)
        </h2>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            placeholder="Ask a question (e.g. 'What is our production shortfall risk?' or 'Which truck is most likely to fail?')"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQuery()}
            className="flex-1 bg-deep2 border border-line rounded-xl px-4 py-3 text-sm text-ink placeholder-ink3 focus:outline-none focus:border-accentt transition-all shadow-inner"
          />
          <button
            onClick={() => handleQuery()}
            disabled={queryLoading}
            className="py-3 px-6 rounded-xl bg-accentt text-inkb text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-all shadow-md shrink-0"
          >
            {queryLoading ? (
              <>
                <span className="material-symbols-outlined text-[16px] animate-spin">sync</span>
                Reasoning...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-[16px]">psychology</span>
                Ask Intelligence
              </>
            )}
          </button>
        </div>

        {/* Quick prompt chips */}
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
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
              className="px-2.5 py-1 rounded-lg bg-panel3 hover:bg-panel4 border border-line2/40 text-ink2 hover:text-accentt transition-all"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Query Result Card */}
        {queryResult && (
          <div className="mt-5 p-5 rounded-xl bg-deep2/90 border border-accentt/30 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-accentt/20 text-accentt border border-accentt/30">
                Intent: {queryResult.intent}
              </span>
              <span className="text-[10px] font-mono text-ink3">{queryResult.data_origin}</span>
            </div>
            <h3 className="font-semibold text-sm text-ink mb-3">{queryResult.headline}</h3>

            <div className="space-y-1.5 mb-4">
              {queryResult.evidence.map((ev, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs text-ink2">
                  <span className="material-symbols-outlined text-okt text-[14px] mt-0.5">check_circle</span>
                  <span>{ev}</span>
                </div>
              ))}
            </div>

            <div className="pt-3 border-t border-line flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-ink">
                <strong>Recommended Action:</strong> <span className="text-accentt">{queryResult.recommendation}</span>
              </div>
              {queryResult.relevant_link && (
                <Link
                  href={queryResult.relevant_link}
                  className="text-xs font-bold text-inkb bg-accentt px-3 py-1.5 rounded-lg hover:opacity-90 transition-all flex items-center gap-1 shrink-0"
                >
                  Inspect in Domain
                  <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                </Link>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Top Cross-Domain Issues */}
      <section className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-dangert">warning</span>
          Top Cross-Domain Operational Risks (Prioritized)
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {issues.map((iss) => (
            <div key={iss.id} className="liquid-glass-dark rounded-xl p-5 border border-line flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getStatusBadge(iss.severity)}`}>
                    {iss.severity} · {iss.domain}
                  </span>
                  <span className="text-[10px] font-mono text-ink3">ID: {iss.id}</span>
                </div>
                <h3 className="text-sm font-bold text-ink mb-1">{iss.title}</h3>
                <p className="text-xs text-ink2 leading-relaxed">{iss.description}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-line flex justify-end">
                <Link
                  href={iss.deep_link}
                  className="text-xs font-bold text-accentt hover:underline flex items-center gap-1"
                >
                  {iss.action_label}
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Deep Reasoning Tabs */}
      <section>
        <div className="flex flex-wrap gap-1.5 mb-4 text-xs font-semibold">
          {[
            ['root_cause', 'Root Cause Explorer', 'account_tree'],
            ['replay', 'Mine Replay Timeline', 'history'],
            ['material_flow', 'Material Flow & Bottlenecks', 'alt_route'],
          ].map(([key, label, icon]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1.5 border ${
                activeTab === key
                  ? 'bg-chipon text-inkb font-bold border-chipon shadow-sm'
                  : 'border-line text-ink2 hover:text-ink hover:bg-frost/5'
              }`}
            >
              <span className="material-symbols-outlined !text-[15px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Tab 1: Root Cause Explorer */}
        {activeTab === 'root_cause' && (
          <div className="liquid-glass-dark rounded-2xl p-6 border border-line">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <span className="material-symbols-outlined text-accentt">manage_search</span>
                  Multi-Factor Root Cause Analysis
                </h3>
                <p className="text-xs text-ink3 mt-0.5">
                  Combines model SHAP attributions, real operational events, and unmeasured factors.
                </p>
              </div>
              <div className="flex gap-2">
                <select
                  value={rcDomain}
                  onChange={(e) => setRcDomain(e.target.value)}
                  className="bg-deep2 border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink"
                >
                  <option value="production">Production Forecast</option>
                  <option value="equipment">Equipment Telemetry</option>
                </select>
                <select
                  value={rcEntity}
                  onChange={(e) => setRcEntity(e.target.value)}
                  className="bg-deep2 border border-line rounded-lg px-2.5 py-1.5 text-xs text-ink"
                >
                  <option value="mine-01">Mine 01 (Sausar)</option>
                  <option value="HD-04">Haul Truck HD-04</option>
                </select>
              </div>
            </div>

            {rcData && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. Model SHAP Drivers */}
                <div className="p-4 rounded-xl bg-deep2/80 border border-line2/30">
                  <div className="text-[10px] font-bold text-accentt uppercase tracking-wider mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">psychology</span>
                    Model Drivers (SHAP)
                  </div>
                  <div className="space-y-2">
                    {rcData.model_drivers?.map((d: any, i: number) => (
                      <div key={i} className="p-2 rounded bg-panel3/70 flex items-center justify-between text-xs">
                        <span className="text-ink">{d.factor}</span>
                        <span className="font-mono font-bold text-accentt">{d.impact}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. Observed Operational Events */}
                <div className="p-4 rounded-xl bg-deep2/80 border border-line2/30">
                  <div className="text-[10px] font-bold text-infot uppercase tracking-wider mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">fact_check</span>
                    Observed Operational Events
                  </div>
                  <div className="space-y-2">
                    {rcData.observed_events?.map((ev: any, i: number) => (
                      <div key={i} className="p-2 rounded bg-panel3/70 text-xs">
                        <div className="text-[10px] font-mono text-ink3">{ev.timestamp}</div>
                        <div className="text-ink mt-0.5">{ev.event}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Unknown Contributors */}
                <div className="p-4 rounded-xl bg-deep2/80 border border-line2/30">
                  <div className="text-[10px] font-bold text-warnt uppercase tracking-wider mb-2 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">help_outline</span>
                    Unmeasured / Latent Factors
                  </div>
                  <div className="space-y-2">
                    {rcData.unknown_contributors?.map((un: any, i: number) => (
                      <div key={i} className="p-2 rounded bg-panel3/70 text-xs">
                        <div className="text-ink">{un.factor}</div>
                        <div className="text-[10px] font-mono text-warnt uppercase mt-0.5">{un.status}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Mine Replay */}
        {activeTab === 'replay' && (
          <div className="liquid-glass-dark rounded-2xl p-6 border border-line">
            <h3 className="text-sm font-bold text-ink mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-infot">history</span>
              Immutable Operational Audit Timeline
            </h3>
            <div className="relative pl-6 border-l border-line2/50 space-y-6">
              {timeline.map((ev) => (
                <div key={ev.id} className="relative group">
                  <div className="absolute -left-[31px] top-1 w-4 h-4 rounded-full bg-deep2 border-2 border-accentt flex items-center justify-center"></div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-ink3">{ev.timestamp.slice(0, 16)}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-panel3 border border-line text-ink2">
                      {ev.category}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-ink mt-0.5">{ev.title}</h4>
                  <p className="text-xs text-ink2 mt-0.5">{ev.detail}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Material Flow */}
        {activeTab === 'material_flow' && (
          <div className="liquid-glass-dark rounded-2xl p-6 border border-line">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
              <div>
                <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                  <span className="material-symbols-outlined text-accentt">alt_route</span>
                  End-to-End Material Flow &amp; Mass Balance
                </h3>
                <p className="text-xs text-ink3 mt-0.5">
                  Real-time throughput capacity across pit extraction, haulage, crushing, beneficiation, and dispatch.
                </p>
              </div>
              {flowBottleneck && (
                <div className="p-2 rounded-lg bg-danger/10 border border-danger/30 text-dangert text-xs font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[15px]">priority_high</span>
                  <span>Primary Bottleneck: {flowBottleneck}</span>
                </div>
              )}
            </div>

            {/* Stage Cards Flow */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {flowStages.map((stage, idx) => (
                <div key={stage.id} className="relative p-3.5 rounded-xl bg-deep2/90 border border-line2/30 flex flex-col justify-between">
                  <div>
                    <div className="text-[10px] font-mono text-ink3">Stage 0{idx + 1}</div>
                    <div className="text-xs font-bold text-ink mt-0.5">{stage.name}</div>
                    <div className="mt-2 font-['Space_Grotesk'] text-lg font-bold text-accentt">
                      {stage.current_tph} <span className="text-[10px] text-ink3">t/h</span>
                    </div>
                    <div className="text-[10px] text-ink3">Cap: {stage.capacity_tph} t/h</div>
                  </div>

                  <div className="mt-3">
                    <div className="w-full h-1.5 bg-panel3 rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full ${stage.utilization_pct >= 95 ? 'bg-danger' : stage.utilization_pct >= 85 ? 'bg-warn' : 'bg-ok'}`}
                        style={{ width: `${Math.min(stage.utilization_pct, 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex items-center justify-between text-[9px] font-bold">
                      <span className="text-ink2">{stage.utilization_pct}%</span>
                      <span className={`px-1 py-0.2 rounded uppercase ${getStatusBadge(stage.status)}`}>
                        {stage.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {flowRecommendation && (
              <div className="p-4 rounded-xl bg-deep2/80 border border-line2/30 text-xs text-ink flex items-start gap-2">
                <span className="material-symbols-outlined text-accentt text-[16px] mt-0.5">tips_and_updates</span>
                <div>
                  <strong>Optimizer Recommendation:</strong> {flowRecommendation}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
