'use client';

/**
 * Governance — Trust & Model Governance
 * 100% faithful port of the Stitch reference HTML:
 *   crucible_ai_trust_model_governance/code.html
 *
 * Modules & Tabs:
 *   1. Top Banner: High-Stakes Compliance Header (Safety ISO-13849, ZMK-2024-C, SOC2 Export)
 *   2. Dynamic Tab Bar:
 *      - Data Health (4 domain cards: Production, Equipment, Exploration, Maintenance + Kafka strip)
 *      - Model Health (Champion / Challenger registry with 6 deployments + Concept Drift + Edge Node)
 *      - Approvals & Training (Human Approval Gate cards, Ray Core Trigger form, Training Runs monitor)
 *      - Prediction Ledger (Live streaming inferences ledger with search and CSV export)
 *      - Decision Memory (Reinforcement feedback corpus & superintendent divergence log)
 */

import React, { useState } from 'react';

interface DomainHealth {
  domain: string;
  badge: 'FRESH' | 'AGING' | 'STALE';
  badgeColor: string;
  rowCount: string;
  updated: string;
  origin: string;
  metricLabel: string;
  metricValue: string;
  nullDrift: string;
  pct: number;
}

const DOMAIN_DATA: DomainHealth[] = [
  {
    domain: 'PRODUCTION',
    badge: 'FRESH',
    badgeColor: 'bg-telemetry-emerald/15 text-telemetry-emerald border-telemetry-emerald/30',
    rowCount: '1,402,394',
    updated: '2 mins ago (14:38 UTC)',
    origin: 'LIVE',
    metricLabel: 'Completeness',
    metricValue: '99.8%',
    nullDrift: '0.01%',
    pct: 99.8,
  },
  {
    domain: 'EQUIPMENT',
    badge: 'FRESH',
    badgeColor: 'bg-telemetry-emerald/15 text-telemetry-emerald border-telemetry-emerald/30',
    rowCount: '8,921,450',
    updated: '12 secs ago (14:40 UTC)',
    origin: 'LIVE',
    metricLabel: 'Telemetry Ingestion',
    metricValue: '42 assets @ 50Hz',
    nullDrift: '<0.001%',
    pct: 100,
  },
  {
    domain: 'EXPLORATION',
    badge: 'AGING',
    badgeColor: 'bg-telemetry-amber/15 text-telemetry-amber border-telemetry-amber/30',
    rowCount: '348,120',
    updated: '3 hours ago (11:20 UTC)',
    origin: 'SYNTHETIC + LAB ASSAY',
    metricLabel: 'Core Slices',
    metricValue: 'Hyperspectral 220nm',
    nullDrift: '0.42%',
    pct: 82,
  },
  {
    domain: 'MAINTENANCE',
    badge: 'STALE',
    badgeColor: 'bg-telemetry-crimson/15 text-telemetry-crimson border-telemetry-crimson/30',
    rowCount: '94,820',
    updated: '2 days ago (Oct 22)',
    origin: 'ERP MANUAL LOG',
    metricLabel: 'Connector',
    metricValue: 'SAP ERP Latency Alert',
    nullDrift: '2.14% (Degraded)',
    pct: 45,
  },
];

interface ModelRow {
  task: string;
  modelId: string;
  family: string;
  status: 'Champion' | 'Challenger';
  rocAuc: string;
  prAuc: string;
  mae: string;
  r2: string;
  lift: string;
  split: string;
  leakage: string;
}

const MODEL_REGISTRY: ModelRow[] = [
  {
    task: 'SAG Mill Feed Optimization',
    modelId: 'PINN-Milling-v3.8',
    family: 'Physics-Informed NN',
    status: 'Champion',
    rocAuc: '0.962',
    prAuc: '0.941',
    mae: '0.014 tph',
    r2: '0.988',
    lift: 'Baseline',
    split: '2024-Q1/Q3 Train, Q4 Val',
    leakage: 'PASS (0.00%)',
  },
  {
    task: 'SAG Mill Feed Optimization',
    modelId: 'Crucible-Transformer-v4.2-Surrogate',
    family: 'Self-Attention Grinding Surr.',
    status: 'Challenger',
    rocAuc: '0.984',
    prAuc: '0.972',
    mae: '0.009 tph',
    r2: '0.991',
    lift: '+3.3%',
    split: '2024-Q1/Q3 Train, Q4 Val',
    leakage: 'PASS (0.00%)',
  },
  {
    task: 'Haul Fleet Dispatching',
    modelId: 'MARL-Fleet-v2.1',
    family: 'Multi-Agent RL + GNN',
    status: 'Champion',
    rocAuc: '0.958',
    prAuc: '0.938',
    mae: '1.8s queue',
    r2: '0.974',
    lift: 'Baseline',
    split: '2024-Q2/Q3 Train, Q4 Val',
    leakage: 'PASS (0.00%)',
  },
  {
    task: 'Haul Fleet Dispatching',
    modelId: 'MARL-Fleet-v2.2-Adaptive',
    family: 'Dynamic Route Graph Net',
    status: 'Challenger',
    rocAuc: '0.978',
    prAuc: '0.965',
    mae: '1.2s queue',
    r2: '0.982',
    lift: '+14.2%',
    split: '2024-Q2/Q3 Train, Q4 Val',
    leakage: 'PASS (0.00%)',
  },
  {
    task: 'Crusher Cavity Predictor',
    modelId: 'Random Forest-Crush-v2.1',
    family: 'Ensemble Regressor',
    status: 'Champion',
    rocAuc: '0.949',
    prAuc: '0.932',
    mae: '2.1% vol',
    r2: '0.965',
    lift: 'Baseline',
    split: '2024-Q1/Q2 Train, Q3 Val',
    leakage: 'PASS (0.00%)',
  },
  {
    task: 'Geotech Slope Slip Risk',
    modelId: 'ResNet-Surrogate-v2',
    family: 'Radar InSAR Deep CNN',
    status: 'Champion',
    rocAuc: '0.991',
    prAuc: '0.985',
    mae: '0.4mm slip',
    r2: '0.996',
    lift: '+3.4%',
    split: '2023-2024 Rolling 365d',
    leakage: 'PASS (0.00%)',
  },
];

interface LedgerItem {
  time: string;
  node: string;
  type: string;
  confidence: number;
  action: string;
  status: 'EXECUTING' | 'AUTO-RESOLVED';
}

const PREDICTION_LEDGER: LedgerItem[] = [
  {
    time: '14:41:02',
    node: 'Crusher 1 Hopper',
    type: 'Cavity Underfill <38%',
    confidence: 96.8,
    action: 'Reroute 4 Komatsu trucks to Dump Pocket 1',
    status: 'EXECUTING',
  },
  {
    time: '14:38:45',
    node: 'Hauler HK-402',
    type: 'Hoist Cylinder Cavitation',
    confidence: 91.2,
    action: 'Dispatch Field Mech Charlie; limit bed tilt rate',
    status: 'AUTO-RESOLVED',
  },
  {
    time: '14:32:10',
    node: 'SAG Mill Line 1',
    type: 'Bearing Temp Delta +14°C',
    confidence: 98.4,
    action: 'Activate Surge ROM Bin 2; taper pebble recycle 4%',
    status: 'AUTO-RESOLVED',
  },
  {
    time: '14:15:30',
    node: 'Tailings TSF-2',
    type: 'Pore Pressure Surge (Piezometer 8)',
    confidence: 99.1,
    action: 'Trigger decant pump bypass circuit B',
    status: 'AUTO-RESOLVED',
  },
];

export default function GovernancePage() {
  const [activeTab, setActiveTab] = useState<'health' | 'models' | 'approval' | 'ledger' | 'memory'>('approval');
  const [modelFilter, setModelFilter] = useState('');
  const [ledgerFilter, setLedgerFilter] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // Card approval states
  const [card1Status, setCard1Status] = useState<'pending' | 'approving' | 'approved'>('pending');
  const [card2Status, setCard2Status] = useState<'pending' | 'approving' | 'approved'>('pending');

  // Training form trigger
  const [trainingDomain, setTrainingDomain] = useState('sag-mill');
  const [trainingDataset, setTrainingDataset] = useState('DS-2024-0988');
  const [trainingNote, setTrainingNote] = useState('Fine-tuning Pyrite variance physics constraints');
  const [trainingTriggering, setTrainingTriggering] = useState(false);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 4500);
  }

  function handleApprove(card: 1 | 2, modelName: string) {
    if (card === 1) {
      setCard1Status('approving');
      setTimeout(() => {
        setCard1Status('approved');
        showToast(`Dual-Signature Approved: ${modelName} promoted to Staging Champion.`);
      }, 1000);
    } else {
      setCard2Status('approving');
      setTimeout(() => {
        setCard2Status('approved');
        showToast(`Dual-Signature Approved: ${modelName} promoted to Staging Champion.`);
      }, 1000);
    }
  }

  function handleReject(modelName: string) {
    const reason = window.prompt(`Enter rejection notes for model ${modelName} retraining trigger:`);
    if (reason) {
      showToast(`Model ${modelName} rejected. Re-training job dispatched with feedback constraint.`);
    }
  }

  function handleStartTraining(e: React.FormEvent) {
    e.preventDefault();
    setTrainingTriggering(true);
    setTimeout(() => {
      setTrainingTriggering(false);
      showToast('Training job #TR-8842 successfully queued on Ray GPU Cluster.');
    }, 1400);
  }

  function exportCSV() {
    const headers = ['Time,Entity_Node,Prediction_Type,Confidence,Action,Status'];
    const rows = PREDICTION_LEDGER.map(r => `"${r.time}","${r.node}","${r.type}",${r.confidence}%,"${r.action}","${r.status}"`);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `operational_prediction_ledger_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Prediction ledger exported successfully as CSV.');
  }

  const filteredModels = MODEL_REGISTRY.filter(m =>
    m.task.toLowerCase().includes(modelFilter.toLowerCase()) ||
    m.modelId.toLowerCase().includes(modelFilter.toLowerCase()) ||
    m.family.toLowerCase().includes(modelFilter.toLowerCase())
  );

  const filteredLedger = PREDICTION_LEDGER.filter(l =>
    l.node.toLowerCase().includes(ledgerFilter.toLowerCase()) ||
    l.type.toLowerCase().includes(ledgerFilter.toLowerCase()) ||
    l.action.toLowerCase().includes(ledgerFilter.toLowerCase())
  );

  return (
    <div className="bg-canvas-sandstone min-h-screen flex flex-col font-body text-on-surface">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-earth-charcoal text-white px-4 py-3 rounded shadow-2xl font-headline text-xs font-semibold flex items-center gap-2.5 z-50 border border-copper-accent animate-bounce">
          <span className="material-symbols-outlined text-telemetry-emerald text-[18px]">verified</span>
          <span>{toast}</span>
        </div>
      )}

      {/* Top Banner: High-Stakes Compliance Header */}
      <section className="p-6 bg-surface-container-high border-b border-earth-border">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container font-headline text-[11px] font-bold text-copper-accent uppercase tracking-wider border border-earth-border">
                <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald"></span>
                Kansanshi Pit North • Sector 4
              </span>
              <span className="font-headline text-[11px] font-bold text-secondary tracking-widest uppercase">REGULATORY PROTOCOL M-491</span>
            </div>
            <h1 className="font-headline text-2xl md:text-3xl font-bold text-earth-charcoal tracking-tight">Trust &amp; Model Governance</h1>
            <p className="font-body text-xs md:text-sm text-on-surface-variant max-w-2xl">
              Formal assurance infrastructure enforcing machine-learning verifiability, hard safety envelopes, and dual-authorization promotion protocols across active extraction nodes.
            </p>
          </div>

          {/* Compliance KPI Badges */}
          <div className="flex items-stretch gap-3 flex-wrap">
            <div className="bg-surface-parchment p-3 rounded border border-earth-border shadow-sm flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-surface-container flex items-center justify-center text-telemetry-emerald">
                <span className="material-symbols-outlined text-[22px]">verified</span>
              </div>
              <div className="flex flex-col">
                <span className="font-headline text-[10px] font-bold text-secondary uppercase tracking-wider">Safety Standard</span>
                <span className="font-headline text-sm font-bold text-earth-charcoal">ISO-13849 PL-d</span>
                <span className="font-headline text-[11px] text-telemetry-emerald font-semibold">100% Nominal</span>
              </div>
            </div>

            <div className="bg-surface-parchment p-3 rounded border border-earth-border shadow-sm flex items-center gap-3">
              <div className="w-9 h-9 rounded bg-surface-container flex items-center justify-center text-copper-accent">
                <span className="material-symbols-outlined text-[22px]">gavel</span>
              </div>
              <div className="flex flex-col">
                <span className="font-headline text-[10px] font-bold text-secondary uppercase tracking-wider">Mine Code Compliance</span>
                <span className="font-headline text-sm font-bold text-earth-charcoal">ZMK-2024-C</span>
                <span className="font-headline text-[11px] text-telemetry-emerald font-semibold">Audited • 0 Drift</span>
              </div>
            </div>

            <button
              onClick={() => showToast('SOC2 Type II Assurance Packet generated: SOC2-CRUCIBLE-2024.pdf')}
              className="bg-surface-container hover:bg-surface-elevation p-3 rounded border border-earth-border shadow-sm flex flex-col justify-center items-center px-4 text-earth-charcoal transition-all"
            >
              <span className="material-symbols-outlined text-[18px] text-copper-accent">file_download</span>
              <span className="font-headline text-[10px] font-bold uppercase tracking-wider mt-1">Export SOC2</span>
            </button>
          </div>
        </div>
      </section>

      {/* 1. Tab Navigation Bar */}
      <nav aria-label="Governance Modules" className="sticky top-0 z-30 bg-surface-parchment border-b border-earth-border shadow-sm">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-2 overflow-x-auto py-2">
            {/* Tab 1: Data Health */}
            <button
              id="btn-tab-health"
              onClick={() => setActiveTab('health')}
              className={`flex items-center gap-2 px-3 py-2 rounded font-headline text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === 'health'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-earth-charcoal hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">shield</span>
              <span>Data Health</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'health' ? 'bg-[#713707] text-[#FFDBC7]' : 'bg-surface-container-high text-secondary'
              }`}>
                4 Domains
              </span>
            </button>

            {/* Tab 2: Model Health */}
            <button
              id="btn-tab-models"
              onClick={() => setActiveTab('models')}
              className={`flex items-center gap-2 px-3 py-2 rounded font-headline text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === 'models'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-earth-charcoal hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">military_tech</span>
              <span>Model Health</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'models' ? 'bg-[#713707] text-[#FFDBC7]' : 'bg-surface-container-high text-secondary'
              }`}>
                Active Registry
              </span>
            </button>

            {/* Tab 3: Approvals & Training (Active Default) */}
            <button
              id="btn-tab-approval"
              onClick={() => setActiveTab('approval')}
              className={`flex items-center gap-2 px-3 py-2 rounded font-headline text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === 'approval'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-earth-charcoal hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">how_to_reg</span>
              <span>Approvals &amp; Training</span>
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                activeTab === 'approval' ? 'bg-[#713707] text-[#FFDBC7]' : 'bg-surface-container-high text-secondary'
              }`}>
                2 Pending Action
              </span>
            </button>

            {/* Tab 4: Prediction Ledger */}
            <button
              id="btn-tab-ledger"
              onClick={() => setActiveTab('ledger')}
              className={`flex items-center gap-2 px-3 py-2 rounded font-headline text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === 'ledger'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-earth-charcoal hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">history</span>
              <span>Prediction Ledger</span>
            </button>

            {/* Tab 5: Decision Memory */}
            <button
              id="btn-tab-memory"
              onClick={() => setActiveTab('memory')}
              className={`flex items-center gap-2 px-3 py-2 rounded font-headline text-xs font-semibold transition-all whitespace-nowrap ${
                activeTab === 'memory'
                  ? 'bg-primary-container text-white shadow-sm'
                  : 'text-on-surface-variant hover:text-earth-charcoal hover:bg-surface-container'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">psychology</span>
              <span>Decision Memory</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Main Tab Content Canopy */}
      <div className="max-w-7xl mx-auto px-6 py-6 w-full flex-1">
        {/* ================================================================= */}
        {/* TAB 1: DATA HEALTH CENTER                                         */}
        {/* ================================================================= */}
        {activeTab === 'health' && (
          <section className="flex flex-col gap-6" id="tab-health">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-earth-border">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-telemetry-emerald/10 border border-telemetry-emerald/30 flex items-center justify-center text-telemetry-emerald">
                  <span className="material-symbols-outlined text-[24px]">verified_user</span>
                </div>
                <div>
                  <h2 className="font-headline text-xl font-bold text-earth-charcoal">Data Health Center</h2>
                  <p className="font-body text-xs text-on-surface-variant">Real-time ingestion health, schema integrity, and distribution telemetry across live mining nodes.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded bg-telemetry-emerald/10 text-telemetry-emerald font-headline text-xs font-bold border border-telemetry-emerald/20 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-pulse"></span>
                  SYNC STATUS: 100% NOMINAL
                </span>
                <button
                  onClick={() => showToast('Schema audit completed: All 4 data domains strictly aligned.')}
                  className="p-2 rounded bg-surface-parchment hover:bg-surface-container text-earth-charcoal border border-earth-border"
                  title="Run Schema Audit"
                >
                  <span className="material-symbols-outlined text-[18px]">refresh</span>
                </button>
              </div>
            </div>

            {/* 4 Domain Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {DOMAIN_DATA.map(d => (
                <div key={d.domain} className="bg-surface-parchment rounded border border-earth-border p-4 shadow-sm flex flex-col justify-between gap-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-headline text-[11px] font-bold text-secondary uppercase tracking-wider">DOMAIN: {d.domain}</span>
                      <span className={`px-2 py-0.5 rounded font-headline text-[10px] font-bold uppercase tracking-wider border ${d.badgeColor}`}>
                        {d.badge}
                      </span>
                    </div>
                    <div>
                      <div className="font-mono text-2xl font-bold text-earth-charcoal">{d.rowCount}</div>
                      <div className="font-headline text-xs text-secondary font-medium">Total Row Count</div>
                    </div>
                  </div>

                  <div className="space-y-2 border-t border-earth-border/60 pt-3 font-body text-xs">
                    <div className="flex justify-between items-center">
                      <span className="text-secondary">Updated</span>
                      <span className="font-medium text-earth-charcoal">{d.updated}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-secondary">Data Origin</span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-container text-secondary font-mono text-[10px] font-bold uppercase">{d.origin}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-secondary">{d.metricLabel}</span>
                      <span className="font-mono text-xs font-bold text-earth-charcoal">{d.metricValue}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-secondary">Null Drift</span>
                      <span className={`font-mono text-xs font-bold ${d.nullDrift.includes('Degraded') ? 'text-telemetry-crimson' : 'text-telemetry-emerald'}`}>
                        {d.nullDrift}
                      </span>
                    </div>
                  </div>

                  <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        d.pct >= 90 ? 'bg-telemetry-emerald' : d.pct >= 70 ? 'bg-telemetry-amber' : 'bg-telemetry-crimson'
                      }`}
                      style={{ width: `${d.pct}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>

            {/* Ingestion Stream Telemetry Strip */}
            <div className="bg-surface-container p-4 rounded border border-earth-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-copper-accent text-[22px]">hub</span>
                <div>
                  <span className="font-headline text-xs font-bold text-earth-charcoal block">Kafka Pipeline Cluster MINE-INGEST-04</span>
                  <span className="font-body text-xs text-secondary">Throughput: 4,820 events/sec • Backpressure: 0.00% • Buffer health: 100%</span>
                </div>
              </div>
              <button
                onClick={() => showToast('Kafka Cluster MINE-INGEST-04: Partition lag 0ms, consumer group nominal.')}
                className="px-3 py-1.5 rounded bg-surface-parchment border border-earth-border hover:bg-surface-container-high font-headline text-xs font-bold text-earth-charcoal transition-colors"
              >
                View Kafka Offsets
              </button>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* TAB 2: MODEL HEALTH — CHAMPION / CHALLENGER REGISTRY              */}
        {/* ================================================================= */}
        {activeTab === 'models' && (
          <section className="flex flex-col gap-6" id="tab-models">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-earth-border">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-headline text-xl font-bold text-earth-charcoal">Model Health — Champion / Challenger Registry</h2>
                  <span className="px-2 py-0.5 rounded-full bg-surface-container font-headline text-xs font-bold text-copper-accent">6 Active Deployments</span>
                </div>
                <p className="font-body text-xs text-on-surface-variant">Validated machine learning models governing autonomous beneficiation, dispatch, and physical safety.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-surface-parchment rounded px-3 py-1.5 flex items-center gap-2 border border-earth-border text-secondary shadow-sm">
                  <span className="material-symbols-outlined text-[16px]">search</span>
                  <input
                    className="bg-transparent font-body text-xs text-earth-charcoal outline-none placeholder:text-secondary/60 w-44 sm:w-60"
                    placeholder="Filter task, model, split..."
                    type="text"
                    value={modelFilter}
                    onChange={e => setModelFilter(e.target.value)}
                  />
                </div>
                <button
                  onClick={() => setModelFilter('')}
                  className="p-2 rounded bg-surface-parchment hover:bg-surface-container text-earth-charcoal border border-earth-border shadow-sm"
                  title="Clear Filter"
                >
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                </button>
              </div>
            </div>

            {/* Model Registry Table */}
            <div className="bg-surface-parchment rounded border border-earth-border shadow-sm overflow-x-auto">
              <table className="w-full text-left font-body text-xs">
                <thead className="bg-surface-elevation font-headline text-[11px] font-bold text-secondary uppercase tracking-wider border-b border-earth-border">
                  <tr>
                    <th className="py-3 px-4">Task</th>
                    <th className="py-3 px-4">Model ID &amp; Family</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">ROC-AUC</th>
                    <th className="py-3 px-4">PR-AUC</th>
                    <th className="py-3 px-4">MAE</th>
                    <th className="py-3 px-4">R²</th>
                    <th className="py-3 px-4">Lift</th>
                    <th className="py-3 px-4">Split (Temporal)</th>
                    <th className="py-3 px-4 text-center">Leakage Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-earth-border/60">
                  {filteredModels.map((row) => (
                    <tr
                      key={row.modelId}
                      className={`hover:bg-surface-container transition-colors ${
                        row.status === 'Challenger' ? 'bg-surface-container-low/60' : ''
                      }`}
                    >
                      <td className="py-3.5 px-4 font-headline font-semibold text-earth-charcoal">
                        {row.task}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`font-mono font-bold block ${row.status === 'Challenger' ? 'text-copper-accent' : 'text-earth-charcoal'}`}>
                          {row.modelId}
                        </span>
                        <span className="text-[11px] text-secondary">{row.family}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded font-headline text-[10px] font-bold uppercase border ${
                          row.status === 'Champion'
                            ? 'bg-telemetry-emerald/15 text-telemetry-emerald border-telemetry-emerald/30'
                            : 'bg-telemetry-amber/15 text-telemetry-amber border-telemetry-amber/30'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${row.status === 'Champion' ? 'bg-telemetry-emerald' : 'bg-telemetry-amber animate-pulse'}`}></span>
                          {row.status}
                        </span>
                      </td>
                      <td className={`py-3.5 px-4 font-mono font-bold ${row.status === 'Challenger' ? 'text-telemetry-emerald' : 'text-earth-charcoal'}`}>
                        {row.rocAuc}
                      </td>
                      <td className={`py-3.5 px-4 font-mono ${row.status === 'Challenger' ? 'font-bold text-telemetry-emerald' : 'text-earth-charcoal'}`}>
                        {row.prAuc}
                      </td>
                      <td className={`py-3.5 px-4 font-mono ${row.status === 'Challenger' ? 'font-bold text-telemetry-emerald' : 'text-earth-charcoal'}`}>
                        {row.mae}
                      </td>
                      <td className={`py-3.5 px-4 font-mono ${row.status === 'Challenger' ? 'font-bold text-telemetry-emerald' : 'text-earth-charcoal'}`}>
                        {row.r2}
                      </td>
                      <td className={`py-3.5 px-4 font-mono ${row.lift.startsWith('+') ? 'font-bold text-telemetry-emerald' : 'text-secondary'}`}>
                        {row.lift}
                      </td>
                      <td className="py-3.5 px-4 text-secondary">{row.split}</td>
                      <td className="py-3.5 px-4 text-center">
                        <span className="px-2 py-0.5 rounded bg-telemetry-emerald/10 text-telemetry-emerald font-headline text-[10px] font-bold border border-telemetry-emerald/20">
                          {row.leakage}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Concept Drift & Edge Node Bento */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
              {/* Concept Drift Tracking */}
              <div className="bg-surface-parchment rounded border border-earth-border shadow-sm p-4 flex flex-col justify-between gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-copper-accent text-[20px]">ssid_chart</span>
                    <span className="font-headline text-sm font-bold text-earth-charcoal">Concept Drift Tracking</span>
                  </div>
                  <span className="font-headline text-xs font-semibold text-telemetry-emerald">P-VALUE: 0.89</span>
                </div>
                <p className="font-body text-xs text-on-surface-variant">
                  Statistical distribution divergence between real-time ore density feeds and surrogate model training vectors.
                </p>
                <div className="h-28 w-full bg-surface-container-low rounded p-2.5 flex flex-col justify-between border border-earth-border/40">
                  <div className="flex justify-between font-headline text-[11px] text-secondary">
                    <span>Ore Hardness (Bond Work Index)</span>
                    <span className="font-bold text-earth-charcoal">Current: 14.8 kWh/t</span>
                  </div>
                  <svg className="w-full h-16 overflow-visible" viewBox="0 0 200 40">
                    <path d="M0,25 C30,22 50,30 80,15 C110,5 140,28 170,18 L200,20" fill="none" stroke="#2D6A4F" strokeWidth="2" />
                    <path d="M0,25 C30,22 50,30 80,15 C110,5 140,28 170,18 L200,20 L200,40 L0,40 Z" fill="#2D6A4F" fillOpacity="0.08" />
                    <line stroke="#ba1a1a" strokeDasharray="2 2" strokeWidth="1" x1="0" x2="200" y1="8" y2="8" />
                  </svg>
                  <div className="flex justify-between font-headline text-[10px] text-secondary">
                    <span>Safe Threshold (0.15 Drift Max)</span>
                    <span className="text-telemetry-emerald font-bold">0.038 Deviation (Safe)</span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs font-body text-secondary">
                  <span>Drift algorithm: Wasserstein-1D</span>
                  <span className="text-earth-charcoal font-semibold">Updated 3m ago</span>
                </div>
              </div>

              {/* Edge Node Hardware Telemetry */}
              <div className="bg-surface-parchment rounded border border-earth-border shadow-sm overflow-hidden flex flex-col justify-between">
                <div className="relative h-40 w-full overflow-hidden">
                  <img
                    src="https://lh3.googleusercontent.com/aida-public/AB6AXuA7Iw24mT_3kjI2DRoxQmMcaGZ3VNEa8W56u-3fU0cP174dgSFRA2PXFffpJdrz2bfOY-7IqH0E_bS_PcsZoyEFd-xhwKoLIjQmV3alxFhHipYLXF_lT0zBQnIGKhJszrlvyWam3gL_JAK9BxZLZi6HleG7Oc0Yl3iuGtTJeIfI4O0lVhEzeN-xBjr_fIMgpnNOrWIDw9bR6Y_HEXzMXeFOFrnTbH3DBltfm105HTASTMq_9KTz_BJs"
                    alt="Beneficiation facility with SAG grinding mills"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-earth-espresso/80 via-earth-espresso/20 to-transparent" />
                  <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between text-white">
                    <span className="font-headline text-[11px] font-bold uppercase tracking-wider bg-earth-espresso/60 px-2 py-0.5 rounded backdrop-blur-sm">Beneficiation Train 02</span>
                    <span className="font-headline text-[11px] text-telemetry-emerald font-semibold">Telemetry Connected</span>
                  </div>
                </div>
                <div className="p-4 flex flex-col gap-1.5">
                  <span className="font-headline text-sm font-bold text-earth-charcoal">Edge Inferencing Node EN-401</span>
                  <p className="font-body text-xs text-on-surface-variant">
                    NVIDIA Jetson AGX Orin industrial enclosure mounted directly at the trunnion bearing assembly. Hardware-level watchdog guarantees automated fallback to deterministic PID control in &lt; 20ms.
                  </p>
                  <div className="mt-1 flex items-center justify-between font-headline text-[11px] text-secondary bg-surface-container p-2 rounded">
                    <span>Fallback State: Deterministic PID</span>
                    <span className="text-telemetry-emerald font-semibold">Ready</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* TAB 3: MODEL APPROVALS & TRAINING TAB (ACTIVE BY DEFAULT)         */}
        {/* ================================================================= */}
        {activeTab === 'approval' && (
          <section className="flex flex-col gap-8" id="tab-approval">
            {/* Stacked Section C: Human Approval Gate (Challenger Models) */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-telemetry-amber animate-pulse"></span>
                    <h2 className="font-headline text-lg font-bold text-earth-charcoal">Human Approval Gate — Challenger Models</h2>
                  </div>
                  <p className="font-body text-xs text-on-surface-variant">
                    High-stakes decision cards requiring formal cryptographic sign-off before weight promotion to active control loops.
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-telemetry-amber/15 text-telemetry-amber font-headline text-xs font-bold border border-telemetry-amber/30">
                  2 PENDING SUPERINTENDENT ACTION
                </span>
              </div>

              {/* Challenger Cards Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* CARD 1: SAG Mill Surrogate */}
                <div className="bg-surface-parchment rounded border-2 border-copper-accent/70 shadow-md p-5 relative overflow-hidden flex flex-col justify-between gap-4">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-copper-accent to-telemetry-amber"></div>
                  
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 pt-1">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded bg-telemetry-amber/15 text-telemetry-amber font-headline text-[10px] font-bold uppercase border border-telemetry-amber/30">
                          CHALLENGER
                        </span>
                        <span className="px-2 py-0.5 rounded bg-surface-container font-headline text-[10px] font-bold text-secondary uppercase">
                          {card1Status === 'approved' ? 'PROMOTED TO STAGING' : 'AWAITING HUMAN SIGN-OFF'}
                        </span>
                      </div>
                      <h3 className="font-headline text-base font-bold text-earth-charcoal">Crucible-Transformer-v4.2-Surrogate</h3>
                      <p className="font-body text-xs text-on-surface-variant mt-0.5">Target: SAG Mill Feed &amp; Throughput Controller (Mill 01-04)</p>
                    </div>
                    <span className="font-mono text-[11px] text-secondary">GATE ID: PR-2024-0988-SAG</span>
                  </div>

                  {/* Mini-Grid Performance Metrics */}
                  <div className="grid grid-cols-5 gap-2 bg-surface-container p-2.5 rounded border border-earth-border text-center">
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">ROC-AUC</div>
                      <div className="font-mono text-sm font-bold text-telemetry-emerald">0.984</div>
                    </div>
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">PR-AUC</div>
                      <div className="font-mono text-sm font-bold text-earth-charcoal">0.972</div>
                    </div>
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">MAE</div>
                      <div className="font-mono text-sm font-bold text-earth-charcoal">0.009</div>
                    </div>
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">R²</div>
                      <div className="font-mono text-sm font-bold text-earth-charcoal">0.991</div>
                    </div>
                    <div className="bg-telemetry-emerald/10 rounded py-0.5">
                      <div className="font-headline text-[10px] text-telemetry-emerald uppercase font-bold">Lift</div>
                      <div className="font-mono text-sm font-bold text-telemetry-emerald">+3.3%</div>
                    </div>
                  </div>

                  {/* Lineage & Hash Integrity */}
                  <div className="bg-surface-container-low p-3 rounded border border-earth-border space-y-1.5 text-xs font-body">
                    <div className="flex items-center justify-between">
                      <span className="text-secondary font-medium">SHA-256 Checksum:</span>
                      <span className="font-mono text-[11px] text-copper-accent font-semibold">0x88f2ba019ec41103b47...</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-secondary font-medium">Provenance Origin:</span>
                      <span className="font-headline text-[11px] font-semibold text-earth-charcoal">Run #TR-8838-PINN (1.4M cycles)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-secondary font-medium">Governance Gate:</span>
                      <span className="font-headline text-[11px] font-bold text-telemetry-amber uppercase">
                        {card1Status === 'approved' ? 'APPROVED' : 'PENDING SUPERINTENDENT'}
                      </span>
                    </div>
                  </div>

                  {/* Dual Signature Mandate Progress */}
                  <div className="bg-surface-container p-3 rounded border border-earth-border flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-headline text-[11px] font-bold text-secondary uppercase tracking-wider">Dual-Signature Mandate Status</span>
                      <span className="font-headline text-xs font-bold text-copper-accent">
                        {card1Status === 'approved' ? '2 OF 2 SIGNED' : '1 OF 2 SIGNED'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="p-2 rounded bg-surface-parchment border border-earth-border flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-telemetry-emerald text-[18px]">check_circle</span>
                          <div>
                            <div className="font-headline font-bold text-earth-charcoal">Marcus Vance</div>
                            <div className="text-[10px] text-secondary">Operations Supt (10:14 UTC)</div>
                          </div>
                        </div>
                      </div>
                      <div className={`p-2 rounded border border-earth-border flex items-center justify-between ${
                        card1Status === 'approved' ? 'bg-surface-parchment' : 'bg-surface-container-high'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className={`material-symbols-outlined text-[18px] ${
                            card1Status === 'approved' ? 'text-telemetry-emerald' : 'text-telemetry-amber'
                          }`}>
                            {card1Status === 'approved' ? 'check_circle' : 'pending'}
                          </span>
                          <div>
                            <div className="font-headline font-bold text-earth-charcoal">Elena Rostova, Ph.D.</div>
                            <div className={`text-[10px] font-semibold ${
                              card1Status === 'approved' ? 'text-telemetry-emerald' : 'text-telemetry-amber'
                            }`}>
                              {card1Status === 'approved' ? 'Chief Safety Officer SIGNED' : 'Chief Safety Officer PENDING'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Decision Action Buttons */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => handleReject('Crucible-Transformer-v4.2-Surrogate')}
                      className="px-4 py-2 rounded bg-surface-container hover:bg-telemetry-crimson/10 text-telemetry-crimson hover:border-telemetry-crimson/40 border border-earth-border font-headline text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                      Reject &amp; Request Re-Training
                    </button>
                    <button
                      onClick={() => handleApprove(1, 'Crucible-Transformer-v4.2-Surrogate')}
                      disabled={card1Status !== 'pending'}
                      className={`px-5 py-2 rounded font-headline text-xs font-bold transition-all shadow-md flex items-center gap-1.5 text-white ${
                        card1Status === 'approved'
                          ? 'bg-earth-charcoal cursor-default'
                          : card1Status === 'approving'
                          ? 'bg-telemetry-emerald opacity-80'
                          : 'bg-telemetry-emerald hover:bg-telemetry-emerald/90'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[18px] ${card1Status === 'approving' ? 'animate-spin' : ''}`}>
                        {card1Status === 'approved' ? 'verified' : card1Status === 'approving' ? 'sync' : 'how_to_reg'}
                      </span>
                      {card1Status === 'approved'
                        ? 'Approved & Promoted'
                        : card1Status === 'approving'
                        ? 'Validating Enclave HSM...'
                        : 'Approve & Promote Model'}
                    </button>
                  </div>
                </div>

                {/* CARD 2: MARL Fleet Challenger */}
                <div className="bg-surface-parchment rounded border border-earth-border shadow-md p-5 relative overflow-hidden flex flex-col justify-between gap-4">
                  <div className="absolute top-0 left-0 right-0 h-1.5 bg-copper-accent"></div>
                  
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2 pt-1">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded bg-telemetry-amber/15 text-telemetry-amber font-headline text-[10px] font-bold uppercase border border-telemetry-amber/30">
                          CHALLENGER
                        </span>
                        <span className="px-2 py-0.5 rounded bg-surface-container font-headline text-[10px] font-bold text-secondary uppercase">
                          {card2Status === 'approved' ? 'PROMOTED TO STAGING' : 'AWAITING HUMAN SIGN-OFF'}
                        </span>
                      </div>
                      <h3 className="font-headline text-base font-bold text-earth-charcoal">MARL-Fleet-v2.2-Adaptive</h3>
                      <p className="font-body text-xs text-on-surface-variant mt-0.5">Target: Haul Fleet Dynamic Routing (48 Heavy Haul Units)</p>
                    </div>
                    <span className="font-mono text-[11px] text-secondary">GATE ID: PR-2024-1002-HLR</span>
                  </div>

                  {/* Mini-Grid Performance Metrics */}
                  <div className="grid grid-cols-5 gap-2 bg-surface-container p-2.5 rounded border border-earth-border text-center">
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">ROC-AUC</div>
                      <div className="font-mono text-sm font-bold text-telemetry-emerald">0.978</div>
                    </div>
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">PR-AUC</div>
                      <div className="font-mono text-sm font-bold text-earth-charcoal">0.965</div>
                    </div>
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">MAE</div>
                      <div className="font-mono text-sm font-bold text-earth-charcoal">1.2s queue</div>
                    </div>
                    <div>
                      <div className="font-headline text-[10px] text-secondary uppercase">R²</div>
                      <div className="font-mono text-sm font-bold text-earth-charcoal">0.982</div>
                    </div>
                    <div className="bg-telemetry-emerald/10 rounded py-0.5">
                      <div className="font-headline text-[10px] text-telemetry-emerald uppercase font-bold">Lift</div>
                      <div className="font-mono text-sm font-bold text-telemetry-emerald">+14.2%</div>
                    </div>
                  </div>

                  {/* Lineage & Hash Integrity */}
                  <div className="bg-surface-container-low p-3 rounded border border-earth-border space-y-1.5 text-xs font-body">
                    <div className="flex items-center justify-between">
                      <span className="text-secondary font-medium">SHA-256 Checksum:</span>
                      <span className="font-mono text-[11px] text-copper-accent font-semibold">0x3e88cca0172...</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-secondary font-medium">Provenance Origin:</span>
                      <span className="font-headline text-[11px] font-semibold text-earth-charcoal">Run #TR-8835 (Pit Ramp 4 Telemetry)</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-secondary font-medium">Governance Gate:</span>
                      <span className="font-headline text-[11px] font-bold text-telemetry-amber uppercase">
                        {card2Status === 'approved' ? 'APPROVED' : 'PENDING SAFETY OFFICER'}
                      </span>
                    </div>
                  </div>

                  {/* Dual Signature Mandate Progress */}
                  <div className="bg-surface-container p-3 rounded border border-earth-border flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="font-headline text-[11px] font-bold text-secondary uppercase tracking-wider">Dual-Signature Mandate Status</span>
                      <span className="font-headline text-xs font-bold text-copper-accent">
                        {card2Status === 'approved' ? '2 OF 2 SIGNED' : '0 OF 2 SIGNED'}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className={`p-2 rounded border border-earth-border flex items-center justify-between ${
                        card2Status === 'approved' ? 'bg-surface-parchment' : 'bg-surface-container-high'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className={`material-symbols-outlined text-[18px] ${
                            card2Status === 'approved' ? 'text-telemetry-emerald' : 'text-secondary'
                          }`}>
                            {card2Status === 'approved' ? 'check_circle' : 'pending'}
                          </span>
                          <div>
                            <div className="font-headline font-bold text-earth-charcoal">K. Nyirenda</div>
                            <div className={`text-[10px] ${card2Status === 'approved' ? 'text-telemetry-emerald font-semibold' : 'text-secondary'}`}>
                              {card2Status === 'approved' ? 'Mine Dispatch Supt SIGNED' : 'Mine Dispatch Supt PENDING'}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className={`p-2 rounded border border-earth-border flex items-center justify-between ${
                        card2Status === 'approved' ? 'bg-surface-parchment' : 'bg-surface-container-high'
                      }`}>
                        <div className="flex items-center gap-1.5">
                          <span className={`material-symbols-outlined text-[18px] ${
                            card2Status === 'approved' ? 'text-telemetry-emerald' : 'text-secondary'
                          }`}>
                            {card2Status === 'approved' ? 'check_circle' : 'pending'}
                          </span>
                          <div>
                            <div className="font-headline font-bold text-earth-charcoal">Elena Rostova, Ph.D.</div>
                            <div className={`text-[10px] ${card2Status === 'approved' ? 'text-telemetry-emerald font-semibold' : 'text-secondary'}`}>
                              {card2Status === 'approved' ? 'Safety Officer SIGNED' : 'Safety Officer PENDING'}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Decision Action Buttons */}
                  <div className="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={() => handleReject('MARL-Fleet-v2.2-Adaptive')}
                      className="px-4 py-2 rounded bg-surface-container hover:bg-telemetry-crimson/10 text-telemetry-crimson hover:border-telemetry-crimson/40 border border-earth-border font-headline text-xs font-bold transition-all flex items-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-[16px]">close</span>
                      Reject
                    </button>
                    <button
                      onClick={() => handleApprove(2, 'MARL-Fleet-v2.2-Adaptive')}
                      disabled={card2Status !== 'pending'}
                      className={`px-5 py-2 rounded font-headline text-xs font-bold transition-all shadow-md flex items-center gap-1.5 text-white ${
                        card2Status === 'approved'
                          ? 'bg-earth-charcoal cursor-default'
                          : card2Status === 'approving'
                          ? 'bg-telemetry-emerald opacity-80'
                          : 'bg-telemetry-emerald hover:bg-telemetry-emerald/90'
                      }`}
                    >
                      <span className={`material-symbols-outlined text-[18px] ${card2Status === 'approving' ? 'animate-spin' : ''}`}>
                        {card2Status === 'approved' ? 'verified' : card2Status === 'approving' ? 'sync' : 'how_to_reg'}
                      </span>
                      {card2Status === 'approved'
                        ? 'Approved & Promoted'
                        : card2Status === 'approving'
                        ? 'Validating Enclave HSM...'
                        : 'Approve & Promote'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Stacked Section A: Trigger Training Run Form */}
            <div className="bg-surface-parchment rounded border border-earth-border p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-earth-border/60 pb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[22px]">play_circle</span>
                  <h3 className="font-headline text-base font-bold text-earth-charcoal">Trigger Training Run</h3>
                </div>
                <span className="font-headline text-[11px] text-secondary uppercase font-bold">Ray Core Compute Cluster: 64 GPUs Available</span>
              </div>
              <form className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end" onSubmit={handleStartTraining}>
                {/* Input 1: Target Domain */}
                <div className="space-y-1">
                  <label className="font-headline text-xs font-semibold text-secondary uppercase tracking-wider block">Target Domain</label>
                  <select
                    className="w-full bg-surface-container border border-earth-border rounded px-3 py-2 font-headline text-xs font-semibold text-earth-charcoal outline-none focus:border-copper-accent"
                    value={trainingDomain}
                    onChange={e => setTrainingDomain(e.target.value)}
                  >
                    <option value="sag-mill">Production / SAG Mill Feed</option>
                    <option value="haul-routing">Haul Fleet Routing</option>
                    <option value="scada">Processing Plant SCADA</option>
                    <option value="geotech">Geotechnical Slope Stability</option>
                  </select>
                </div>
                {/* Input 2: Dataset Version ID */}
                <div className="space-y-1">
                  <label className="font-headline text-xs font-semibold text-secondary uppercase tracking-wider block">Dataset Version ID</label>
                  <input
                    className="w-full bg-surface-container border border-earth-border rounded px-3 py-2 font-mono text-xs font-bold text-earth-charcoal outline-none focus:border-copper-accent"
                    type="text"
                    value={trainingDataset}
                    onChange={e => setTrainingDataset(e.target.value)}
                  />
                </div>
                {/* Input 3: Execution Note */}
                <div className="space-y-1">
                  <label className="font-headline text-xs font-semibold text-secondary uppercase tracking-wider block">Execution Note</label>
                  <input
                    className="w-full bg-surface-container border border-earth-border rounded px-3 py-2 font-body text-xs text-earth-charcoal outline-none focus:border-copper-accent"
                    type="text"
                    value={trainingNote}
                    onChange={e => setTrainingNote(e.target.value)}
                  />
                </div>
                {/* Submit Action Button */}
                <div>
                  <button
                    id="btn-start-run"
                    type="submit"
                    disabled={trainingTriggering}
                    className="w-full bg-primary-container hover:bg-primary text-white font-headline text-xs font-bold py-2.5 px-4 rounded shadow transition-all flex items-center justify-center gap-2"
                  >
                    <span className={`material-symbols-outlined text-[18px] ${trainingTriggering ? 'animate-spin' : ''}`}>
                      {trainingTriggering ? 'sync' : 'rocket_launch'}
                    </span>
                    <span>{trainingTriggering ? 'Dispatching Ray Cluster...' : 'Start Training Run'}</span>
                  </button>
                </div>
              </form>
            </div>

            {/* Stacked Section B: Recent Training Runs Monitor Table */}
            <div className="bg-surface-parchment rounded border border-earth-border shadow-sm flex flex-col">
              <div className="px-5 py-3.5 border-b border-earth-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-copper-accent text-[20px]">science</span>
                  <h3 className="font-headline text-sm font-bold text-earth-charcoal">Recent Training Runs Monitor</h3>
                </div>
                <span className="font-mono text-xs text-secondary">3 active jobs monitored</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left font-body text-xs">
                  <thead className="bg-surface-elevation font-headline text-[11px] font-bold text-secondary uppercase tracking-wider border-b border-earth-border">
                    <tr>
                      <th className="py-2.5 px-4">Run Tag</th>
                      <th className="py-2.5 px-4">Domain</th>
                      <th className="py-2.5 px-4">Status &amp; Progress</th>
                      <th className="py-2.5 px-4">Triggered By</th>
                      <th className="py-2.5 px-4">Triggered At</th>
                      <th className="py-2.5 px-4 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-earth-border/60">
                    <tr className="hover:bg-surface-container transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-copper-accent">#TR-8841-B</td>
                      <td className="py-3 px-4 font-headline font-semibold text-earth-charcoal">Production / SAG Mill</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-primary-container/15 text-copper-accent font-headline text-[10px] font-bold uppercase">RUNNING 64%</span>
                          <div className="w-24 bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                            <div className="bg-copper-accent h-full rounded-full animate-pulse" style={{ width: '64%' }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center font-headline text-[9px] font-bold text-earth-charcoal">LR</span>
                          <span>Dr. Lucas Ramos</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-secondary">Today, 14:10 UTC</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => showToast('Opening TensorBoard link: tensorboard.cluster.local:6006/run/TR-8841-B')}
                          className="font-headline text-[11px] font-bold text-copper-accent hover:underline"
                        >
                          TensorBoard
                        </button>
                      </td>
                    </tr>
                    <tr className="hover:bg-surface-container transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-earth-charcoal">#TR-8840-A</td>
                      <td className="py-3 px-4 font-headline font-semibold text-earth-charcoal">Haul Fleet Dispatch</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-telemetry-emerald/15 text-telemetry-emerald font-headline text-[10px] font-bold uppercase border border-telemetry-emerald/30">
                          COMPLETED (ROC: 0.978)
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center font-headline text-[9px] font-bold text-earth-charcoal">MV</span>
                          <span>Marcus Vance</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-secondary">Today, 09:12 UTC</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => showToast('Fetching model checkpoint artifacts: s3://crucible-models/TR-8840-A.tar.gz')}
                          className="font-headline text-[11px] font-bold text-secondary hover:underline"
                        >
                          Artifacts
                        </button>
                      </td>
                    </tr>
                    <tr className="hover:bg-surface-container transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-earth-charcoal">#TR-8839-C</td>
                      <td className="py-3 px-4 font-headline font-semibold text-earth-charcoal">Geotech Radar InSAR</td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-telemetry-crimson/15 text-telemetry-crimson font-headline text-[10px] font-bold uppercase border border-telemetry-crimson/30">
                          FAILED (CUDA OOM)
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-secondary/20 flex items-center justify-center font-headline text-[9px] font-bold text-earth-charcoal">KN</span>
                          <span>K. Nyirenda</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-secondary">Yesterday, 22:45 UTC</td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => showToast('Log excerpt: RuntimeError: CUDA out of memory on worker node-04 (GPU 3).')}
                          className="font-headline text-[11px] font-bold text-telemetry-crimson hover:underline"
                        >
                          View Crash Log
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* TAB 4: PREDICTION LEDGER TAB                                      */}
        {/* ================================================================= */}
        {activeTab === 'ledger' && (
          <section className="flex flex-col gap-6" id="tab-ledger">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-earth-border">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-headline text-xl font-bold text-earth-charcoal">Operational Prediction Ledger</h2>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-telemetry-emerald/15 text-telemetry-emerald font-headline text-[10px] font-bold uppercase border border-telemetry-emerald/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald animate-ping"></span> Live Streaming
                  </span>
                </div>
                <p className="font-body text-xs text-on-surface-variant">Tamper-proof real-time register of mill, fleet, and crusher automated inferences.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="bg-surface-parchment rounded px-3 py-1.5 flex items-center gap-2 border border-earth-border text-secondary shadow-sm">
                  <span className="material-symbols-outlined text-[16px]">search</span>
                  <input
                    className="bg-transparent font-body text-xs text-earth-charcoal outline-none placeholder:text-secondary/60 w-48"
                    placeholder="Filter node, trigger..."
                    type="text"
                    value={ledgerFilter}
                    onChange={e => setLedgerFilter(e.target.value)}
                  />
                </div>
                <button
                  onClick={exportCSV}
                  className="px-3 py-1.5 rounded bg-surface-container hover:bg-surface-container-high border border-earth-border text-earth-charcoal font-headline text-xs font-bold flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">file_download</span>
                  Export Ledger (CSV)
                </button>
              </div>
            </div>

            {/* Predictions Table */}
            <div className="bg-surface-parchment rounded border border-earth-border shadow-sm overflow-x-auto">
              <table className="w-full text-left font-body text-xs">
                <thead className="bg-surface-elevation font-headline text-[11px] font-bold text-secondary uppercase tracking-wider border-b border-earth-border">
                  <tr>
                    <th className="py-3 px-4">Time (UTC)</th>
                    <th className="py-3 px-4">Entity / Node</th>
                    <th className="py-3 px-4">Prediction Type</th>
                    <th className="py-3 px-4">Confidence Score</th>
                    <th className="py-3 px-4">Recommended Action</th>
                    <th className="py-3 px-4">Execution Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-earth-border/60 font-body">
                  {filteredLedger.map((row, idx) => (
                    <tr key={idx} className="hover:bg-surface-container transition-colors">
                      <td className="py-3 px-4 font-mono text-secondary whitespace-nowrap">{row.time}</td>
                      <td className="py-3 px-4 font-headline font-semibold text-earth-charcoal">{row.node}</td>
                      <td className="py-3 px-4 font-medium text-earth-charcoal">{row.type}</td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-telemetry-emerald">{row.confidence}%</span>
                          <div className="w-20 bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                            <div className="bg-telemetry-emerald h-full rounded-full" style={{ width: `${row.confidence}%` }}></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-on-surface-variant">{row.action}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-0.5 rounded font-headline text-[10px] font-bold uppercase border ${
                          row.status === 'EXECUTING'
                            ? 'bg-copper-accent/15 text-copper-accent border-copper-accent/30 animate-pulse'
                            : 'bg-telemetry-emerald/15 text-telemetry-emerald border-telemetry-emerald/30'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* TAB 5: DECISION MEMORY TAB                                        */}
        {/* ================================================================= */}
        {activeTab === 'memory' && (
          <section className="flex flex-col gap-6" id="tab-memory">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-earth-border">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-headline text-xl font-bold text-earth-charcoal">Decision Memory &amp; Manager Override Log</h2>
                  <span className="px-2 py-0.5 rounded bg-surface-container font-headline text-xs font-bold text-copper-accent">Reinforcement Corpus</span>
                </div>
                <p className="font-body text-xs text-on-surface-variant">Continuous feedback loops recording where human superintendent domain expertise diverged or enhanced AI setpoints.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-secondary">Root Merkle: 0x88f2ba019ec41103</span>
              </div>
            </div>

            {/* Memory Entries */}
            <div className="flex flex-col gap-4">
              {/* Log Entry 1 */}
              <div className="bg-surface-parchment rounded border border-earth-border p-4 shadow-sm flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-earth-border/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-copper-accent">DEC-2024-8841</span>
                    <span className="text-secondary text-xs">• 2024-10-24 11:15 UTC</span>
                    <span className="px-2 py-0.5 rounded bg-telemetry-emerald/10 text-telemetry-emerald font-headline text-[10px] font-bold border border-telemetry-emerald/20">
                      ENCLAVE SIGNATURE VERIFIED
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-headline font-semibold text-earth-charcoal">
                    <span className="material-symbols-outlined text-[16px] text-secondary">account_circle</span>
                    Marcus Vance (Operations Superintendent)
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-body">
                  <div className="p-3 rounded bg-surface-container space-y-1">
                    <span className="font-headline text-[11px] font-bold text-secondary uppercase">AI Agent Proposal</span>
                    <p className="text-earth-charcoal">
                      MARL-Fleet recommended rerouting 6 haul trucks to South Pit Ramp B due to wet road grade estimation (+8m truck cycle delay).
                    </p>
                  </div>
                  <div className="p-3 rounded bg-surface-container-high border-l-2 border-copper-accent space-y-1">
                    <span className="font-headline text-[11px] font-bold text-copper-accent uppercase">Human Manager Action &amp; Divergence</span>
                    <p className="text-earth-charcoal font-medium">
                      Authorized immediate gravel grader pass &amp; bypass via Bench 1380 cut-through.
                    </p>
                    <div className="text-[11px] text-telemetry-emerald font-bold pt-1">
                      Outcome: 100% Crusher Starvation averted. Net site savings: $64,200.
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-headline text-secondary">
                  <span>Reinforcement Corpus Token: <code className="font-mono text-earth-charcoal">FB-TOKEN-99214</code></span>
                  <span className="text-telemetry-emerald font-bold">+0.042 Weight Calibration Fed to Challenger v2.2</span>
                </div>
              </div>

              {/* Log Entry 2 */}
              <div className="bg-surface-parchment rounded border border-earth-border p-4 shadow-sm flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-earth-border/60 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-copper-accent">DEC-2024-8839</span>
                    <span className="text-secondary text-xs">• 2024-10-24 07:42 UTC</span>
                    <span className="px-2 py-0.5 rounded bg-telemetry-emerald/10 text-telemetry-emerald font-headline text-[10px] font-bold border border-telemetry-emerald/20">
                      ENCLAVE SIGNATURE VERIFIED
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs font-headline font-semibold text-earth-charcoal">
                    <span className="material-symbols-outlined text-[16px] text-secondary">account_circle</span>
                    Elena Rostova, Ph.D. (Chief Geotechnical Officer)
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-body">
                  <div className="p-3 rounded bg-surface-container space-y-1">
                    <span className="font-headline text-[11px] font-bold text-secondary uppercase">AI Agent Proposal</span>
                    <p className="text-earth-charcoal">
                      ResNet-Surrogate flagged minor micro-seismic slope slip probability (3.4%) at Sector 4 East Wall and requested immediate bench evacuation.
                    </p>
                  </div>
                  <div className="p-3 rounded bg-surface-container-high border-l-2 border-copper-accent space-y-1">
                    <span className="font-headline text-[11px] font-bold text-copper-accent uppercase">Human Manager Action &amp; Divergence</span>
                    <p className="text-earth-charcoal font-medium">
                      Verified false-positive triggered by blast vibration harmonics on Prism 41B. Maintained drilling operations with continuous radar scan.
                    </p>
                    <div className="text-[11px] text-telemetry-emerald font-bold pt-1">
                      Outcome: Zero false-alarm shutdown downtime. 4 hours production preserved.
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] font-headline text-secondary">
                  <span>Reinforcement Corpus Token: <code className="font-mono text-earth-charcoal">FB-TOKEN-99180</code></span>
                  <span className="text-telemetry-emerald font-bold">+0.019 Blast-Harmonic Filter tuned in ResNet-Surrogate</span>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
