'use client';

import React, { useMemo, useState } from 'react';
import { useMineId } from '@/lib/useMineId';
import { useFleetInsights } from '@/lib/hooks';
import { relTime, type Insight, type Severity } from '@/lib/insight';

type SevFilter = 'all' | 'attention' | 'medium' | 'low';
const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, healthy: 4 };

function primaryRisk(i: Insight): string {
  return i.issue ?? i.reasons[0]?.label ?? 'Under assessment';
}
function primaryWhy(i: Insight): string {
  return i.reasons[0]?.text ?? 'Awaiting telemetry';
}
function actionLabel(i: Insight): string {
  return i.action?.label ?? 'Monitor';
}

export default function EquipmentPage() {
  const mineId = useMineId();
  const { insights, summary, loading } = useFleetInsights(mineId);
  const [filter, setFilter] = useState<SevFilter>('all');
  const [search, setSearch] = useState('');

  const sorted = useMemo(
    () => [...insights].sort((a, b) => sevRank[a.severity] - sevRank[b.severity]),
    [insights]
  );
  
  const filtered = useMemo(() => {
    let result = sorted;
    if (filter === 'attention') {
      result = result.filter((i) => i.severity === 'critical' || i.severity === 'high');
    } else if (filter === 'medium') {
      result = result.filter((i) => i.severity === 'medium');
    } else if (filter === 'low') {
      result = result.filter((i) => i.severity === 'low' || i.severity === 'healthy');
    }
    
    if (search.trim()) {
      const lower = search.toLowerCase();
      result = result.filter(i => 
        i.id.toLowerCase().includes(lower) || 
        i.equipment_type.toLowerCase().includes(lower) ||
        (i.issue && i.issue.toLowerCase().includes(lower))
      );
    }
    return result;
  }, [sorted, filter, search]);

  const activeUnits = insights.length > 0 ? insights.length : 42;
  const needsAttentionCount = summary.critical + summary.high;

  return (
    <main className="w-full bg-canvas-sandstone flex-1 pb-16">
      <div className="flex flex-col w-full">
        {/* Sub-Header / Fleet Health Pulse Strip */}
        <div className="px-space-lg py-space-md bg-surface-parchment shadow-sm">
          <div className="flex flex-col xl:flex-row items-start xl:items-center justify-between gap-space-md">
            {/* Title & Live Stamp */}
            <div className="flex items-center gap-space-md">
              <div className="w-10 h-10 rounded bg-primary-container text-on-primary-container flex items-center justify-center shadow-sm">
                <span className="material-symbols-outlined text-[24px]">precision_manufacturing</span>
              </div>
              <div>
                <div className="flex items-center gap-space-xs">
                  <span className="font-headline-md text-headline-md text-earth-charcoal tracking-tight">Equipment Health Matrix</span>
                  <span className="px-space-xs py-0.5 rounded bg-surface-container-high text-copper-accent font-label-sm text-label-sm uppercase font-semibold">
                    {mineId === 'Kansanshi' ? 'Kansanshi Pit North' : mineId}
                  </span>
                </div>
                <p className="font-body-sm text-body-sm text-secondary mt-0.5">Real-time vibration, thermal telemetry, and failure prevention models across active extraction assets.</p>
              </div>
            </div>
            {/* Quick Metrics Ribbon */}
            <div className="flex flex-wrap items-center gap-space-sm w-full xl:w-auto">
              {/* Fleet Health Index */}
              <div className="px-space-md py-space-xs bg-surface-container rounded shadow-sm flex items-center gap-space-sm min-w-[150px]">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Fleet Health</span>
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">88.4%</span>
                    <span className="font-label-sm text-label-sm text-telemetry-emerald font-semibold">NOMINAL</span>
                  </div>
                </div>
                <div className="w-8 h-8 ml-auto flex items-center justify-center text-telemetry-emerald">
                  <svg className="w-7 h-7 -rotate-90" viewBox="0 0 36 36">
                    <path className="text-surface-variant" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3.5"></path>
                    <path className="text-telemetry-emerald" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeDasharray="88.4, 100" strokeLinecap="round" strokeWidth="3.5"></path>
                  </svg>
                </div>
              </div>
              {/* Total Assets */}
              <div className="px-space-md py-space-xs bg-surface-container rounded shadow-sm flex items-center gap-space-sm min-w-[170px]">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Active Units</span>
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">{activeUnits}</span>
                    <span className="font-body-sm text-body-sm text-secondary">/ {activeUnits + 3} Ready</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 ml-auto text-copper-accent">
                  <span className="material-symbols-outlined text-[20px]">directions_boat</span>
                </div>
              </div>
              {/* MTBS */}
              <div className="px-space-md py-space-xs bg-surface-container rounded shadow-sm flex items-center gap-space-sm min-w-[140px]">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">MTBS Fleet</span>
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">184</span>
                    <span className="font-label-sm text-label-sm text-secondary">hrs</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[20px] text-copper-accent ml-auto">timer</span>
              </div>
              {/* Flagged Critical */}
              <div className="px-space-md py-space-xs bg-error-container text-on-error-container rounded shadow-sm flex items-center gap-space-sm min-w-[150px]">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm text-telemetry-crimson uppercase tracking-wider font-semibold">Flagged Alerts</span>
                  <div className="flex items-baseline gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-telemetry-crimson font-bold">{needsAttentionCount} Units</span>
                    <span className="font-label-sm text-label-sm text-telemetry-crimson">Action Req.</span>
                  </div>
                </div>
                <span className="material-symbols-outlined text-[22px] text-telemetry-crimson ml-auto animate-pulse">crisis_alert</span>
              </div>
            </div>
          </div>
          {/* Asset Class Distribution Bar */}
          <div className="mt-space-sm pt-space-xs flex flex-wrap items-center gap-x-space-md gap-y-1 text-secondary font-label-sm text-label-sm px-space-lg bg-surface-parchment pb-space-sm">
            <span className="text-earth-charcoal font-semibold">Deployments:</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-copper-accent"></span> 18 Haul Trucks</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-ore-gold"></span> 6 Shovels & Excavators</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary-container"></span> 4 Blast Drills</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-tertiary"></span> 2 Primary Crushers</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-secondary"></span> 12 Auxiliaries (Dozers/Graders)</span>
          </div>
        </div>

        {/* Main Work Area */}
        <div className="p-space-lg space-y-space-lg">
          {/* Filters & Search Command Strip */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-space-md bg-surface-parchment p-space-sm rounded shadow-sm">
            {/* Filter Segmented Control */}
            <div className="inline-flex p-1 bg-surface-container rounded gap-1 overflow-x-auto">
              <button 
                onClick={() => setFilter('all')}
                className={`px-space-md py-space-xs rounded font-label-md text-label-md transition-all shadow-sm flex items-center gap-1.5 ${filter === 'all' ? 'bg-earth-charcoal text-canvas-sandstone' : 'text-earth-charcoal hover:bg-surface-container-high'}`}
              >
                <span>All Units</span>
                <span className={`px-1.5 py-0.5 rounded font-label-sm text-label-sm ${filter === 'all' ? 'bg-surface-container-high/30' : 'bg-surface-container-high text-secondary'}`}>{activeUnits}</span>
              </button>
              <button 
                onClick={() => setFilter('attention')}
                className={`px-space-md py-space-xs rounded font-label-md text-label-md transition-all flex items-center gap-1.5 ${filter === 'attention' ? 'bg-earth-charcoal text-canvas-sandstone shadow-sm' : 'text-earth-charcoal hover:bg-surface-container-high'}`}
              >
                <span className="w-2 h-2 rounded-full bg-telemetry-crimson"></span>
                <span>Needs Attention</span>
                <span className="px-1.5 py-0.5 rounded bg-error-container text-telemetry-crimson font-label-sm text-label-sm font-bold">{needsAttentionCount}</span>
              </button>
              <button 
                onClick={() => setFilter('medium')}
                className={`px-space-md py-space-xs rounded font-label-md text-label-md transition-all flex items-center gap-1.5 ${filter === 'medium' ? 'bg-earth-charcoal text-canvas-sandstone shadow-sm' : 'text-earth-charcoal hover:bg-surface-container-high'}`}
              >
                <span className="w-2 h-2 rounded-full bg-telemetry-amber"></span>
                <span>Medium Risk</span>
                <span className={`px-1.5 py-0.5 rounded font-label-sm text-label-sm ${filter === 'medium' ? 'bg-surface-container-high/30' : 'bg-surface-container-high text-secondary'}`}>{summary.medium}</span>
              </button>
              <button 
                onClick={() => setFilter('low')}
                className={`px-space-md py-space-xs rounded font-label-md text-label-md transition-all flex items-center gap-1.5 ${filter === 'low' ? 'bg-earth-charcoal text-canvas-sandstone shadow-sm' : 'text-earth-charcoal hover:bg-surface-container-high'}`}
              >
                <span className="w-2 h-2 rounded-full bg-telemetry-emerald"></span>
                <span>Low / Nominal</span>
                <span className={`px-1.5 py-0.5 rounded font-label-sm text-label-sm ${filter === 'low' ? 'bg-surface-container-high/30' : 'bg-surface-container-high text-secondary'}`}>{summary.low}</span>
              </button>
            </div>
            {/* Search & Equipment Class Dropdown */}
            <div className="flex items-center gap-space-sm">
              <div className="relative flex-1 md:w-64">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-secondary">search</span>
                <input 
                  type="text" 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 bg-canvas-sandstone rounded font-body-sm text-body-sm text-earth-charcoal placeholder:text-secondary outline-none focus:bg-surface-container-lowest shadow-sm" 
                  placeholder="Search ID, model, bench..." 
                />
              </div>
              <button className="px-space-md py-1.5 rounded bg-surface-container hover:bg-surface-container-high font-label-md text-label-md text-earth-charcoal flex items-center gap-1 shadow-sm">
                <span className="material-symbols-outlined text-[16px]">tune</span>
                <span>Parameters</span>
              </button>
            </div>
          </div>

          {/* Section: Needs Immediate Attention (Insight Bento Cards) */}
          <div>
            <div className="flex items-center justify-between mb-space-sm">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-telemetry-crimson text-[20px]">notification_important</span>
                <h2 className="font-headline-sm text-headline-sm text-earth-charcoal tracking-tight">Active Diagnostics Requiring Dispatch</h2>
              </div>
              <span className="font-label-sm text-label-sm text-secondary uppercase tracking-wider">Predictive Telemetry Model v3.9</span>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
              {/* We map the top 3 insights here to cards that look like Stitch */}
              {sorted.filter((i) => i.severity === 'critical' || i.severity === 'high').slice(0, 3).map((insight) => (
                <div key={insight.id} className="bg-surface-parchment rounded shadow-md flex flex-col justify-between overflow-hidden relative group">
                  <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${insight.severity === 'critical' ? 'bg-telemetry-crimson' : 'bg-telemetry-amber'}`}></div>
                  <div className="p-space-md pl-space-lg space-y-space-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className={`px-2 py-0.5 rounded ${insight.severity === 'critical' ? 'bg-error-container text-telemetry-crimson' : 'bg-surface-container-high text-telemetry-amber'} font-label-sm text-label-sm uppercase font-bold tracking-wider`}>
                          {insight.severity === 'critical' ? 'Critical Failure Imminent' : 'High Risk Vector'}
                        </span>
                        <h3 className="font-headline-sm text-headline-sm text-earth-charcoal font-bold mt-1">{insight.id} - {insight.equipment_type}</h3>
                        <span className="font-body-sm text-body-sm text-secondary">Zone: {(insight as any).location || 'Pit North Bench'}</span>
                      </div>
                      <div className="text-right">
                        <span className={`font-headline-sm text-headline-sm ${insight.severity === 'critical' ? 'text-telemetry-crimson' : 'text-telemetry-amber'} font-bold block`}>
                          {insight.timeframe || 'Immediate'}
                        </span>
                        <span className="font-label-sm text-label-sm text-secondary uppercase">Est. MTTF</span>
                      </div>
                    </div>
                    
                    <div className="p-space-sm bg-surface-container rounded mt-2">
                      <div className="flex items-center justify-between text-earth-charcoal font-label-md text-label-md">
                        <span className="font-semibold truncate mr-2">{primaryRisk(insight)}</span>
                        <span className={`${insight.severity === 'critical' ? 'text-telemetry-crimson' : 'text-telemetry-amber'} font-bold whitespace-nowrap`}>
                          Action Req
                        </span>
                      </div>
                      <p className="font-body-sm text-body-sm text-secondary mt-1">{primaryWhy(insight)}</p>
                    </div>
                    
                    <div className="space-y-1 mt-2">
                      <div className="flex justify-between font-label-sm text-label-sm text-secondary">
                        <span>TELEMETRY (PAST 6 HRS)</span>
                        <span className={`${insight.severity === 'critical' ? 'text-telemetry-crimson' : 'text-telemetry-amber'} font-mono font-semibold`}>
                          Anomaly Detected
                        </span>
                      </div>
                      <svg className="w-full h-10 bg-surface-container rounded p-1" viewBox="0 0 300 40">
                        <path d={insight.severity === 'critical' ? "M 0,10 Q 30,12 60,11 T 120,15 T 180,24 T 240,32 L 300,38" : "M 0,28 Q 50,26 100,24 T 180,18 T 240,12 L 300,6"} fill="none" stroke={insight.severity === 'critical' ? '#ba1a1a' : '#C47C17'} strokeLinecap="round" strokeWidth="2.5"></path>
                        <line stroke="#d8c2b6" strokeDasharray="3,3" strokeWidth="1" x1="0" x2="300" y1="20" y2="20"></line>
                        <circle cx="300" cy={insight.severity === 'critical' ? '38' : '6'} fill={insight.severity === 'critical' ? '#ba1a1a' : '#C47C17'} r="3"></circle>
                      </svg>
                    </div>
                    
                    <div className="relative h-28 w-full rounded overflow-hidden shadow-inner mt-2">
                      <img className="w-full h-full object-cover" alt="Equipment" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC2CzNW77dhBMj4lEzjnHKypdHK7fAI8DxvhG0yW99FRfpJRsZTahRkr4cXAGTd8QNSSNA7A3JBFjMUHwlh1wXAKbvZr79QoeJrv94OxandJKoULiKDWiXgF49IpJhE6lT73mKOiVn3O2g-56g0WpAMDnJhhDO7uXdYDJhCGyY4KKytbRe_sEcFRlwVw1SGCjnbg4OijnntHm30PXdJo7J93cs5VSS8oX5Wg4TYlyz6p7MmtY2TR0b0" />
                      <div className="absolute inset-0 bg-gradient-to-t from-earth-espresso/80 via-transparent to-transparent flex items-end p-2 justify-between">
                        <span className="font-label-sm text-label-sm text-canvas-sandstone font-medium">Sensor Feed Active</span>
                        <span className="px-1.5 py-0.5 rounded bg-earth-espresso/90 text-primary-fixed font-label-sm text-label-sm font-mono">OP: System</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-space-md pt-0 pl-space-lg flex items-center gap-space-xs mt-2">
                    <button className="flex-1 py-space-xs px-space-sm rounded bg-primary-container text-on-primary-container font-label-md text-label-md hover:bg-tertiary transition-colors shadow-sm flex items-center justify-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">{insight.severity === 'critical' ? 'engineering' : 'schedule'}</span>
                      <span className="truncate">{actionLabel(insight)}</span>
                    </button>
                    <button className="py-space-xs px-space-sm rounded bg-surface-container text-earth-charcoal font-label-md text-label-md hover:bg-surface-container-high transition-colors flex items-center justify-center" title="Inspect machine sensor feed">
                      <span className="material-symbols-outlined text-[18px]">query_stats</span>
                    </button>
                  </div>
                </div>
              ))}
              
              {/* Fallback if no critical issues */}
              {sorted.filter((i) => i.severity === 'critical' || i.severity === 'high').length === 0 && !loading && (
                <div className="lg:col-span-3 bg-surface-parchment rounded shadow-md flex flex-col items-center justify-center p-12 text-center border-dashed border-2 border-surface-container-high">
                  <span className="material-symbols-outlined text-telemetry-emerald text-[48px] mb-4">check_circle</span>
                  <h3 className="font-headline-sm text-headline-sm text-earth-charcoal font-bold">No Active Diagnostics Requiring Dispatch</h3>
                  <p className="font-body-sm text-body-sm text-secondary mt-2">Fleet health is nominal across all domains.</p>
                </div>
              )}
            </div>
          </div>

          {/* Section: Fleet Telemetry Status Matrix / Table */}
          <div className="bg-surface-parchment rounded shadow-sm overflow-hidden mt-6">
            <div className="p-space-md flex flex-col md:flex-row items-start md:items-center justify-between gap-space-sm bg-surface-container-high">
              <div>
                <h2 className="font-headline-sm text-headline-sm text-earth-charcoal tracking-tight">Active Telemetry Fleet Stream</h2>
                <span className="font-body-sm text-body-sm text-secondary">Showing {filtered.length} priority units across active mining pits</span>
              </div>
              <div className="flex items-center gap-space-xs text-secondary font-label-sm text-label-sm">
                <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-ping"></span>
                <span>Sampling Interval: 2.0s</span>
                <button className="ml-space-sm px-space-xs py-1 rounded bg-surface-container text-earth-charcoal hover:bg-surface-container-lowest font-label-sm text-label-sm flex items-center gap-1 shadow-sm">
                  <span className="material-symbols-outlined text-[14px]">download</span>
                  <span>Export CSV</span>
                </button>
              </div>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-surface-elevation text-secondary font-label-sm text-label-sm uppercase tracking-wider">
                    <th className="py-3 px-space-md">Asset ID / Model</th>
                    <th className="py-3 px-space-md">Class / Role</th>
                    <th className="py-3 px-space-md">Operator / Pit Location</th>
                    <th className="py-3 px-space-md">Hydraulic & Engine</th>
                    <th className="py-3 px-space-md">Heartbeat</th>
                    <th className="py-3 px-space-md">Vibration / Thermal Index</th>
                    <th className="py-3 px-space-md text-right">Action Protocol</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-earth-border font-body-sm text-body-sm text-earth-charcoal">
                  {filtered.map(m => (
                    <tr key={m.id} className={`hover:bg-surface-container transition-colors ${m.severity === 'critical' ? 'bg-surface-container-low' : 'bg-surface-parchment'}`}>
                      <td className="py-3 px-space-md">
                        <div className="flex items-center gap-space-xs">
                          <span className={`w-2 h-2 rounded-full ${m.severity === 'critical' ? 'bg-telemetry-crimson animate-pulse' : m.severity === 'high' || m.severity === 'medium' ? 'bg-telemetry-amber' : 'bg-telemetry-emerald'}`}></span>
                          <div>
                            <span className="font-headline-sm text-headline-sm text-earth-charcoal font-bold block leading-none">{m.id}</span>
                            <span className="font-label-sm text-label-sm text-secondary">{m.equipment_type}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-space-md font-label-md text-label-md text-secondary">
                        <span className="truncate max-w-[120px] block">{m.impact ?? 'General Operations'}</span>
                      </td>
                      <td className="py-3 px-space-md">
                        <span className="text-earth-charcoal font-medium block">{m.state === 'action_required' ? 'Requires Attention' : 'Active'}</span>
                        <span className="font-label-sm text-label-sm text-secondary truncate max-w-[150px] block">{(m as any).location ?? 'Pit Area'}</span>
                      </td>
                      <td className="py-3 px-space-md">
                        {m.severity === 'critical' ? (
                          <span className="px-2 py-0.5 rounded bg-error-container text-telemetry-crimson font-label-sm text-label-sm font-bold truncate max-w-[150px] block">{primaryRisk(m)}</span>
                        ) : m.severity === 'high' || m.severity === 'medium' ? (
                          <span className="px-2 py-0.5 rounded bg-surface-container-high text-telemetry-amber font-label-sm text-label-sm font-bold truncate max-w-[150px] block">{primaryRisk(m)}</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-surface-container text-telemetry-emerald font-label-sm text-label-sm font-semibold">Nominal</span>
                        )}
                      </td>
                      <td className="py-3 px-space-md">
                        <span className="font-label-sm text-label-sm text-telemetry-emerald flex items-center gap-1 font-mono">
                          <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald"></span> {relTime(m.freshness.lastUpdate)}
                        </span>
                      </td>
                      <td className="py-3 px-space-md font-mono text-earth-charcoal font-medium">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-surface-container-high h-2 rounded overflow-hidden">
                            <div className={`h-full ${m.severity === 'critical' ? 'bg-telemetry-crimson' : m.severity === 'high' || m.severity === 'medium' ? 'bg-telemetry-amber' : 'bg-telemetry-emerald'}`} style={{ width: m.severity === 'critical' ? '92%' : m.severity === 'high' ? '74%' : m.severity === 'medium' ? '48%' : '22%' }}></div>
                          </div>
                          <span className={`${m.severity === 'critical' ? 'text-telemetry-crimson font-bold' : m.severity === 'high' || m.severity === 'medium' ? 'text-telemetry-amber font-bold' : 'text-secondary'}`}>
                            {m.severity === 'critical' ? '9.4' : m.severity === 'high' ? '5.8' : m.severity === 'medium' ? '3.1' : '1.2'} mm/s
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-space-md text-right">
                        {m.severity === 'critical' || m.severity === 'high' ? (
                          <button className="px-3 py-1 rounded bg-primary-container text-on-primary-container font-label-sm text-label-sm hover:bg-tertiary shadow-sm transition-colors max-w-[120px] truncate">
                            {actionLabel(m)}
                          </button>
                        ) : (
                          <button className="px-3 py-1 rounded bg-surface-container text-earth-charcoal hover:bg-surface-container-high font-label-sm text-label-sm shadow-sm transition-colors">
                            Telemetry Details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && !loading && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-sm font-semibold text-secondary">
                        No equipment matches your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-space-sm bg-surface-elevation flex items-center justify-between font-label-sm text-label-sm text-secondary">
              <span>Displaying Kansanshi Northern Sector Pit Feed</span>
              <div className="flex items-center gap-1">
                <button className="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high">Prev</button>
                <span className="px-2 font-bold text-earth-charcoal">1 / 4</span>
                <button className="px-2 py-0.5 rounded bg-surface-container hover:bg-surface-container-high">Next</button>
              </div>
            </div>
          </div>

          {/* Quick Actions & Maintenance Bay Scheduling Strip */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md mt-6">
            {/* Scheduling Action Staging */}
            <div className="lg:col-span-2 bg-surface-parchment rounded p-space-md shadow-sm space-y-space-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-space-xs">
                  <span className="material-symbols-outlined text-copper-accent text-[22px]">garage</span>
                  <h3 className="font-headline-sm text-headline-sm text-earth-charcoal">Heavy Workshop Bay Availability & Staging</h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-surface-container font-label-sm text-label-sm text-copper-accent font-semibold uppercase">Zambia Central Yard</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm mt-4">
                {/* Bay 1 */}
                <div className="p-space-sm bg-surface-container rounded flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center">
                      <span className="font-label-md text-label-md text-earth-charcoal font-bold">Bay 01 (Heavy Haul)</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-telemetry-emerald font-label-sm text-label-sm font-semibold">AVAILABLE</span>
                    </div>
                    <p className="font-body-sm text-body-sm text-secondary mt-1">Ready for hydraulic cylinder teardown. Hoist crane rated 50T cleared.</p>
                  </div>
                  <button className="mt-space-sm w-full py-1.5 rounded bg-primary-container text-on-primary-container font-label-sm text-label-sm font-semibold hover:bg-tertiary shadow-sm transition-colors">
                    Reserve Bay
                  </button>
                </div>
                {/* Bay 2 */}
                <div className="p-space-sm bg-surface-container rounded flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center">
                      <span className="font-label-md text-label-md text-earth-charcoal font-bold">Bay 02 (Shovel/Drill)</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-secondary font-label-sm text-label-sm">OCCUPIED</span>
                    </div>
                    <p className="font-body-sm text-body-sm text-secondary mt-1">Routine 500h service in progress. Est completion: 1h 40m.</p>
                  </div>
                  <div className="mt-space-sm w-full py-1.5 rounded bg-surface-container-high text-secondary font-label-sm text-label-sm text-center font-medium">
                    Occupied (Clears 15:30)
                  </div>
                </div>
                {/* Bay 3 (Quick-Lube Pad) */}
                <div className="p-space-sm bg-surface-container rounded flex flex-col justify-between">
                  <div>
                    <div className="flex justify-between items-center">
                      <span className="font-label-md text-label-md text-earth-charcoal font-bold">Quick-Lube Mobile Unit 3</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-container-high text-telemetry-emerald font-label-sm text-label-sm font-semibold">READY</span>
                    </div>
                    <p className="font-body-sm text-body-sm text-secondary mt-1">Mobile truck en route to Bench 12. Ideal for bearing regrease.</p>
                  </div>
                  <button className="mt-space-sm w-full py-1.5 rounded bg-earth-charcoal text-canvas-sandstone font-label-sm text-label-sm font-semibold hover:bg-earth-espresso shadow-sm transition-colors">
                    Reroute to Field
                  </button>
                </div>
              </div>
            </div>
            
            {/* Parts & Stock Warehouse Telemetry */}
            <div className="bg-surface-parchment rounded p-space-md shadow-sm space-y-space-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-space-xs">
                    <span className="material-symbols-outlined text-copper-accent text-[20px]">inventory_2</span>
                    <h3 className="font-headline-sm text-headline-sm text-earth-charcoal">Critical Spares Inventory</h3>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary">Solwezi Depot</span>
                </div>
                <div className="space-y-space-xs mt-space-sm">
                  <div className="flex items-center justify-between p-2 bg-surface-container rounded">
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-earth-charcoal font-semibold truncate max-w-[150px]">CAT 793F Seal Kit</span>
                      <span className="font-body-sm text-body-sm text-secondary">SKU: 382-9912A</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-surface-container-high text-telemetry-emerald font-label-sm text-label-sm font-bold">4 in Stock</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-surface-container rounded">
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-earth-charcoal font-semibold truncate max-w-[150px]">Mobilith SHC 460 Grease</span>
                      <span className="font-body-sm text-body-sm text-secondary">Drum 200L</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-surface-container-high text-telemetry-emerald font-label-sm text-label-sm font-bold">12 Drums</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-surface-container rounded">
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-earth-charcoal font-semibold truncate max-w-[150px]">Metso Concave Ring Segments</span>
                      <span className="font-body-sm text-body-sm text-secondary">Manganese Alloy #4</span>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-error-container text-telemetry-crimson font-label-sm text-label-sm font-bold">1 Unit (Low)</span>
                  </div>
                </div>
              </div>
              <button className="w-full mt-4 py-space-xs rounded bg-surface-container hover:bg-surface-container-high text-earth-charcoal font-label-md text-label-md flex items-center justify-center gap-1 shadow-sm transition-colors">
                <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                <span>Open Logistics Manifest</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
