'use client';

/**
 * ML Lab — Crucible AI Autonomous Engine & Distributed PINN Surrogate Cluster
 * 100% faithful port of Stitch reference HTML: crucible_ai_ml_lab/code.html
 *
 * Sections:
 *   1. Top Engine Status & Execution Banner (NVIDIA H100 SXM5 Specs, VRAM, CUDA Streams, P99 Latency)
 *   2. Active Models & Distributed Runs Grid (Run #419 PINN SAG Mill, Run #418 MARL Haul Router, Run #417 Subsurface 3D Autoencoder)
 *   3. Real-Time Inference & Surrogate Execution DAG (5-Node Visual Pipeline)
 *   4. Loss Landscapes & Model Architectures (PINN Loss Manifold & Geophysical EM Inversion)
 *   5. Experiment Tracking & Model Comparison Matrix (Runs #419-#415 with hyperparameters and metrics)
 *   6. Interactive Slide-in Telemetry Drawer (Streaming Terminal, GPU Metrics, Epistemic Uncertainty, Weight Download)
 */

import React, { useState } from 'react';
import { useEngine, useEngineAction, type LabExecution } from '@/lib/lab';

interface RunItem {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  solver: string;
  hyperparams: string;
  notes: string;
  mae: string;
  r2: string;
  latency: string;
  status: 'training' | 'completed' | 'baseline' | 'archived' | 'superseded';
  progress?: number;
  epoch?: string;
  eta?: string;
  loss?: string;
  physicsResidual?: string;
  gain?: string;
}

const RUNS_DATA: RunItem[] = [
  {
    id: '#419',
    title: 'Physics-Informed Neural Net (PINN)',
    subtitle: 'SAG Mill Mill-Grind Kinetics & Hydrocyclone Density',
    type: 'PINN + AdamW',
    solver: 'PINN + AdamW',
    hyperparams: 'LR: 3e-4 | B: 1024',
    notes: 'σ-Tol: 0.05 Mass-Bal',
    mae: '0.014',
    r2: '0.984',
    latency: '38.2 ms',
    status: 'training',
    progress: 84,
    epoch: 'Epoch 420 / 500',
    eta: 'ETA: 14m 20s',
    loss: '0.00142',
    physicsResidual: '0.00018',
  },
  {
    id: '#418',
    title: 'Multi-Agent RL (MARL) Haul Router',
    subtitle: 'Decentralized PPO for 32 Autonomous CAT 797F Fleets',
    type: 'MAPPO + GAE',
    solver: 'MAPPO + GAE',
    hyperparams: 'LR: 1e-4 | Rollout: 4096',
    notes: 'γ: 0.99, λ: 0.95',
    mae: 'N/A',
    r2: 'Policy (0.96)',
    latency: '14.1 ms',
    status: 'completed',
    gain: '+14.2% haul cycle dispatch throughput',
  },
  {
    id: '#417',
    title: 'Subsurface 3D Autoencoder',
    subtitle: 'EM / Gravity Hyperspectral Inversion & Lithology Fusion',
    type: '3D ResNet VAE',
    solver: '3D ResNet VAE',
    hyperparams: 'LR: 5e-4 | B: 512',
    notes: 'KL-Weight: 0.002',
    mae: '0.008',
    r2: '0.991',
    latency: '52.0 ms',
    status: 'baseline',
  },
  {
    id: '#416',
    title: 'Froth Flotation Recovery Surrogate',
    subtitle: 'High-speed Vision Transformer for Bubble Bubble Morphology',
    type: 'ViT-Small (Vision)',
    solver: 'ViT-Small (Vision)',
    hyperparams: 'LR: 2e-4 | B: 128',
    notes: 'Patch: 16x16, Depth: 8',
    mae: '0.021',
    r2: '0.976',
    latency: '22.4 ms',
    status: 'archived',
  },
  {
    id: '#415',
    title: 'Heap Leach Permeability Predictor',
    subtitle: 'GNN for Unsaturated Leaching Solution Percolation',
    type: 'Graph Neural Net (GNN)',
    solver: 'Graph Neural Net (GNN)',
    hyperparams: 'LR: 1e-3 | B: 256',
    notes: 'Edge Dimension: 16',
    mae: '0.038',
    r2: '0.941',
    latency: '68.5 ms',
    status: 'superseded',
  },
];

export default function LabPage() {
  const [activeRunTitle, setActiveRunTitle] = useState<string>('Run #419: PINN SAG Mill Grind Kinetics');
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Real backend engine hooks
  const engineRuns = useEngine<LabExecution[]>('/pipelines', { refreshMs: 8_000 });
  const engineAction = useEngineAction();

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }

  function openDrawer(runTitle: string) {
    setActiveRunTitle(runTitle);
    setIsDrawerOpen(true);
  }

  async function handleLaunchRun() {
    showToast('Crucible PINN Job #420 Queued on Kansanshi Cluster (Rank 0-2). Allocating 3x H100...');
    try {
      const res = await engineAction.run('/pipelines/run', {
        dataset_id: 'kansanshi-blast-v4',
        target: 'pinn_grind_kinetics',
      });
      if (res?.data) {
        showToast(`Dispatched cluster job ID: ${(res.data as any).execution_id?.slice(0, 8)}`);
      }
    } catch {
      // Offline fallback already toasted
    }
  }

  function handleDeployCheckpoint() {
    showToast('Checkpoint v4.2-b418 pushed to Kansanshi Primary Crusher Edge Ingestion endpoint.');
  }

  function handleEvalLoss() {
    showToast('Computing 2D slice of loss landscape using filter-normalized random directions (Hessian Eig: 1.28)...');
  }

  function handlePromoteChallenger() {
    showToast('Run #418 promoted to Kansanshi Live Challenger! PPO policy active.');
  }

  return (
    <div className="bg-canvas-sandstone min-h-screen text-on-surface">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none transition-all">
          <div className="pointer-events-auto bg-earth-charcoal text-canvas-sandstone px-4 py-3 rounded-lg shadow-2xl flex items-center gap-2 font-label-md text-label-md border border-copper-accent/40 animate-in fade-in slide-in-from-bottom-2">
            <span className="material-symbols-outlined text-copper-accent text-[20px]">science</span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <main className="w-full bg-canvas-sandstone flex-1 pb-16">
        <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1720px] mx-auto w-full">
          
          {/* ────────────────────────────────────────────────────────────────
              1. Top Engine Status & Execution Banner
              ──────────────────────────────────────────────────────────────── */}
          <section className="bg-surface-parchment rounded-xl p-6 shadow-sm relative overflow-hidden border border-earth-border/40">
            {/* Background Ambient Glow & Neural Circuit Accent */}
            <div className="absolute -right-16 -top-16 w-96 h-96 rounded-full bg-gradient-to-bl from-copper-accent/10 via-primary/5 to-transparent pointer-events-none blur-3xl" />
            
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 relative z-10">
              {/* Engine Meta & Active Model Specification */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-0.5 rounded bg-earth-espresso text-canvas-sandstone font-label-sm text-xs uppercase tracking-wider">
                    Production Engine Cluster
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-telemetry-emerald/15 text-telemetry-emerald font-label-sm text-xs uppercase font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald animate-pulse" />
                    ONLINE • LATENCY 38ms
                  </span>
                  <span className="font-label-sm text-xs text-secondary uppercase tracking-wider">
                    Target: Kansanshi Pit North Core
                  </span>
                </div>
                
                <div className="flex items-baseline gap-4 flex-wrap pt-0.5">
                  <h1 className="font-headline-lg text-2xl sm:text-3xl text-earth-charcoal tracking-tight font-bold">
                    CRUCIBLE-SURROGATE-PINN v4.2
                  </h1>
                  <div className="flex items-center gap-2 text-secondary font-label-md text-xs sm:text-sm">
                    <span className="flex items-center gap-1 text-copper-accent font-semibold">
                      <span className="material-symbols-outlined text-[16px]">developer_board</span>
                      3x NVIDIA H100 SXM5 80GB
                    </span>
                    <span>•</span>
                    <span>Epistemic Uncertainty Filter: Nominal</span>
                    <span>•</span>
                    <span className="text-earth-charcoal font-semibold">184 Req/s</span>
                  </div>
                </div>
              </div>

              {/* Quick Operational Actions */}
              <div className="flex items-center gap-2.5 flex-wrap self-start xl:self-auto pt-2 xl:pt-0">
                <button
                  onClick={handleEvalLoss}
                  className="px-3.5 py-2 rounded bg-surface-elevation hover:bg-surface-container-high text-earth-charcoal font-label-md text-xs sm:text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px] text-copper-accent">stacked_line_chart</span>
                  Loss Landscape
                </button>
                <button
                  onClick={handleDeployCheckpoint}
                  className="px-3.5 py-2 rounded bg-surface-elevation hover:bg-surface-container-high text-earth-charcoal font-label-md text-xs sm:text-sm transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px] text-earth-charcoal">cloud_upload</span>
                  Deploy Checkpoint
                </button>
                <button
                  onClick={handleLaunchRun}
                  className="px-4 py-2 rounded bg-primary-container hover:bg-primary text-on-primary font-label-md text-xs sm:text-sm transition-colors flex items-center gap-1.5 shadow-md font-semibold"
                >
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                  Launch Training Run
                </button>
              </div>
            </div>

            {/* Quick Metrics Strip */}
            <div className="mt-4 pt-4 border-t border-earth-border/40 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 bg-surface-container/60 p-3 rounded-lg">
              <div className="space-y-0.5">
                <span className="font-label-sm text-[10px] text-secondary uppercase">Cluster VRAM</span>
                <p className="font-headline-sm text-base text-earth-charcoal font-semibold">
                  172.8 / 240 GB <span className="font-label-sm text-xs text-copper-accent font-normal">(72%)</span>
                </p>
              </div>
              <div className="space-y-0.5">
                <span className="font-label-sm text-[10px] text-secondary uppercase">CUDA Streams</span>
                <p className="font-headline-sm text-base text-earth-charcoal font-semibold">16 Active Synced</p>
              </div>
              <div className="space-y-0.5">
                <span className="font-label-sm text-[10px] text-secondary uppercase">Inference P99</span>
                <p className="font-headline-sm text-base text-earth-charcoal font-semibold">41.2 ms</p>
              </div>
              <div className="space-y-0.5">
                <span className="font-label-sm text-[10px] text-secondary uppercase">Surrogate Fidelity</span>
                <p className="font-headline-sm text-base text-telemetry-emerald font-semibold">99.18% R²</p>
              </div>
              <div className="space-y-0.5">
                <span className="font-label-sm text-[10px] text-secondary uppercase">Active Gradient Worker</span>
                <p className="font-headline-sm text-base text-earth-charcoal font-semibold">Rank 0 - Rank 2</p>
              </div>
              <div className="space-y-0.5">
                <span className="font-label-sm text-[10px] text-secondary uppercase">Safety Enforcer</span>
                <p className="font-headline-sm text-base text-telemetry-emerald flex items-center gap-1 font-semibold">
                  <span className="material-symbols-outlined text-[16px]">verified</span> Mass Balance OK
                </p>
              </div>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────────────────
              2. Active Models & Distributed Runs Grid
              ──────────────────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h2 className="font-headline-md text-lg sm:text-xl text-earth-charcoal font-bold">
                  Active Models & Distributed Runs
                </h2>
                <span className="px-2.5 py-0.5 rounded-full bg-surface-container text-secondary font-label-sm text-xs">
                  {engineRuns.data?.length ? `${engineRuns.data.length} Engine Jobs` : '3 Pipeline Jobs'}
                </span>
              </div>
              <span className="font-label-sm text-xs text-secondary uppercase tracking-wider">Sync interval: 500ms</span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Run #419 PINN SAG Mill */}
              <div className="bg-surface-parchment rounded-xl p-5 shadow-sm flex flex-col justify-between relative overflow-hidden border border-earth-border/40">
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-telemetry-amber" />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-surface-container text-earth-charcoal font-label-sm text-xs font-semibold">
                      RUN #419
                    </span>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-telemetry-amber/20 text-telemetry-amber font-label-sm text-xs uppercase font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-telemetry-amber animate-ping" />
                      Training (84%)
                    </span>
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-base text-earth-charcoal font-bold">Physics-Informed Neural Net (PINN)</h3>
                    <p className="font-body-sm text-xs text-secondary">SAG Mill Mill-Grind Kinetics & Hydrocyclone Density</p>
                  </div>
                  {/* Progress Bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between font-label-sm text-xs text-secondary">
                      <span>Epoch 420 / 500</span>
                      <span className="text-earth-charcoal font-semibold">ETA: 14m 20s</span>
                    </div>
                    <div className="w-full h-2 rounded bg-surface-container overflow-hidden">
                      <div className="h-full bg-copper-accent transition-all duration-500" style={{ width: '84%' }} />
                    </div>
                  </div>
                  {/* Loss Metrics */}
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 bg-surface-container/60 rounded">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Val Loss (MSE)</span>
                      <p className="font-headline-sm text-sm text-earth-charcoal font-mono font-semibold">0.00142</p>
                    </div>
                    <div className="p-2 bg-surface-container/60 rounded">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Physics Residual</span>
                      <p className="font-headline-sm text-sm text-copper-accent font-mono font-semibold">0.00018</p>
                    </div>
                  </div>
                  {/* Mini-Chart */}
                  <div className="space-y-1 pt-1">
                    <span className="font-label-sm text-[10px] text-secondary uppercase">Real-Time Loss Convergence</span>
                    <div className="h-16 w-full bg-surface-container rounded p-1 flex items-end">
                      <svg className="w-full h-full text-copper-accent overflow-visible" viewBox="0 0 300 60">
                        <line stroke="currentColor" strokeDasharray="2 2" strokeOpacity="0.15" x1="0" x2="300" y1="15" y2="15" />
                        <line stroke="currentColor" strokeDasharray="2 2" strokeOpacity="0.15" x1="0" x2="300" y1="40" y2="40" />
                        <path d="M0,52 Q40,48 80,35 T160,22 T240,16 T300,12" fill="none" stroke="currentColor" strokeWidth="2" />
                        <path d="M0,58 Q50,50 100,28 T200,18 T300,10" fill="none" stroke="#2D6A4F" strokeDasharray="3 2" strokeWidth="1.5" />
                        <circle cx="300" cy="12" fill="currentColor" r="3" />
                      </svg>
                    </div>
                    <div className="flex justify-between font-label-sm text-[10px] text-secondary">
                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-copper-accent" /> Total Loss</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-telemetry-emerald" /> Mass Balance Constraint</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-earth-border/40 flex items-center justify-between">
                  <span className="font-label-sm text-xs text-secondary">Checkpointed 2m ago</span>
                  <button
                    onClick={() => openDrawer('Run #419: PINN SAG Mill Grind Kinetics')}
                    className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-elevation text-earth-charcoal font-label-sm text-xs transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">insights</span> Inspect Gradients
                  </button>
                </div>
              </div>

              {/* Run #418 MARL Haul Router */}
              <div className="bg-surface-parchment rounded-xl p-5 shadow-sm flex flex-col justify-between relative overflow-hidden border border-earth-border/40">
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-telemetry-emerald" />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-surface-container text-earth-charcoal font-label-sm text-xs font-semibold">
                      RUN #418
                    </span>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-telemetry-emerald/20 text-telemetry-emerald font-label-sm text-xs uppercase font-semibold">
                      <span className="material-symbols-outlined text-[14px]">check_circle</span>
                      Completed
                    </span>
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-base text-earth-charcoal font-bold">Multi-Agent RL (MARL) Haul Router</h3>
                    <p className="font-body-sm text-xs text-secondary">Decentralized PPO for 32 Autonomous CAT 797F Fleets</p>
                  </div>
                  <div className="p-3 bg-surface-container/60 rounded space-y-1">
                    <span className="font-label-sm text-[10px] text-secondary uppercase">Optimized Reward Delta</span>
                    <div className="flex items-baseline gap-2">
                      <span className="font-headline-md text-xl text-telemetry-emerald font-bold">+14.2%</span>
                      <span className="font-body-sm text-xs text-secondary">haul cycle dispatch throughput</span>
                    </div>
                    <p className="font-body-sm text-xs text-on-surface-variant">Queue time at primary crusher reduced by 4.8 min/cycle under wet conditions.</p>
                  </div>
                  {/* Agent Metrics */}
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <div className="p-2 bg-surface-container/60 rounded text-center">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Policy Entropy</span>
                      <p className="font-headline-sm text-sm text-earth-charcoal font-mono font-semibold">0.082</p>
                    </div>
                    <div className="p-2 bg-surface-container/60 rounded text-center">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Mean Rwd</span>
                      <p className="font-headline-sm text-sm text-telemetry-emerald font-mono font-semibold">+842.1</p>
                    </div>
                    <div className="p-2 bg-surface-container/60 rounded text-center">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Collision Pr.</span>
                      <p className="font-headline-sm text-sm text-earth-charcoal font-mono font-semibold">&lt;0.0001%</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-earth-border/40 flex items-center justify-between">
                  <span className="font-label-sm text-xs text-secondary font-mono">0x9f1a...4bc2</span>
                  <button
                    onClick={handlePromoteChallenger}
                    className="px-3 py-1.5 rounded bg-primary-container hover:bg-primary text-on-primary font-label-sm text-xs transition-colors flex items-center gap-1 shadow-sm font-semibold"
                  >
                    <span className="material-symbols-outlined text-[16px]">verified</span>
                    Promote to Challenger
                  </button>
                </div>
              </div>

              {/* Run #417 Hyperspectral Autoencoder */}
              <div className="bg-surface-parchment rounded-xl p-5 shadow-sm flex flex-col justify-between relative overflow-hidden border border-earth-border/40">
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-copper-accent" />
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-surface-container text-earth-charcoal font-label-sm text-xs font-semibold">
                      RUN #417
                    </span>
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container text-secondary font-label-sm text-xs uppercase font-semibold">
                      <span className="material-symbols-outlined text-[14px]">archive</span>
                      Benchmarked
                    </span>
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-base text-earth-charcoal font-bold">Subsurface 3D Autoencoder</h3>
                    <p className="font-body-sm text-xs text-secondary">EM / Gravity Hyperspectral Inversion & Lithology Fusion</p>
                  </div>
                  <div className="p-3 bg-surface-container/60 rounded space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Target Lithology F1-Score</span>
                      <span className="font-label-md text-copper-accent font-bold text-sm">0.942</span>
                    </div>
                    <div className="w-full h-1.5 rounded bg-surface-elevation overflow-hidden">
                      <div className="h-full bg-copper-accent" style={{ width: '94.2%' }} />
                    </div>
                    <p className="font-body-sm text-xs text-on-surface-variant">Validated against 48 diamond core sample assays in Sector 4 North bench.</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="p-2 bg-surface-container/60 rounded">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Latent Space Dim</span>
                      <p className="font-headline-sm text-sm text-earth-charcoal font-mono font-semibold">128 Voxel-Z</p>
                    </div>
                    <div className="p-2 bg-surface-container/60 rounded">
                      <span className="font-label-sm text-[10px] text-secondary uppercase">Inversion Error</span>
                      <p className="font-headline-sm text-sm text-earth-charcoal font-mono font-semibold">±1.4% Vol</p>
                    </div>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-earth-border/40 flex items-center justify-between">
                  <span className="font-label-sm text-xs text-secondary">Active Baseline in Pit North</span>
                  <button
                    onClick={() => openDrawer('Run #417: Subsurface 3D Autoencoder')}
                    className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-elevation text-earth-charcoal font-label-sm text-xs transition-colors flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[16px]">visibility</span> View Latents
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────────────────
              3. Interactive Real-Time Execution DAG
              ──────────────────────────────────────────────────────────────── */}
          <section className="bg-surface-parchment rounded-xl p-6 shadow-sm space-y-4 border border-earth-border/40">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <span className="font-label-sm text-xs text-copper-accent uppercase tracking-wider font-semibold">
                  Crucible Graph Executor
                </span>
                <h2 className="font-headline-md text-lg sm:text-xl text-earth-charcoal font-bold">
                  Real-Time Inference & Surrogate Execution DAG
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded bg-surface-container text-secondary font-label-sm text-xs flex items-center gap-1">
                  <span className="material-symbols-outlined text-[14px]">account_tree</span>
                  Deterministic Node Pipeline
                </span>
                <span className="px-2.5 py-1 rounded bg-telemetry-emerald/15 text-telemetry-emerald font-label-sm text-xs flex items-center gap-1 font-semibold">
                  <span className="material-symbols-outlined text-[14px]">bolt</span>
                  100% Throughput
                </span>
              </div>
            </div>

            {/* High Density Interactive DAG */}
            <div className="p-4 bg-surface-container rounded-lg overflow-x-auto border border-earth-border/30">
              <div className="min-w-[960px] flex items-center justify-between relative py-2">
                {/* Connecting Flow Track */}
                <div className="absolute left-8 right-8 top-1/2 -translate-y-1/2 h-1 bg-surface-elevation -z-0" />
                <div className="absolute left-8 right-1/2 top-1/2 -translate-y-1/2 h-1 bg-gradient-to-r from-copper-accent via-ore-gold to-telemetry-emerald -z-0" />

                {/* Node 1 */}
                <div className="relative z-10 bg-surface-parchment rounded-lg p-3 shadow-sm w-48 transition-all hover:scale-105 cursor-pointer border border-earth-border/40">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-sm text-[10px] text-secondary uppercase">Node 01</span>
                    <span className="w-2 h-2 rounded-full bg-telemetry-emerald" />
                  </div>
                  <p className="font-headline-sm text-sm text-earth-charcoal font-bold leading-tight">Telemetry Ingestion</p>
                  <p className="font-body-sm text-[11px] text-secondary">IoT sensors, SCADA 50Hz</p>
                  <div className="mt-2 pt-1.5 border-t border-earth-border/30 flex justify-between font-label-sm text-[10px]">
                    <span className="text-secondary">4.2 kmsg/s</span>
                    <span className="text-telemetry-emerald font-bold">3.1 ms</span>
                  </div>
                </div>

                <span className="material-symbols-outlined text-copper-accent relative z-10">arrow_forward</span>

                {/* Node 2 */}
                <div className="relative z-10 bg-surface-parchment rounded-lg p-3 shadow-sm w-48 transition-all hover:scale-105 cursor-pointer border border-earth-border/40">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-sm text-[10px] text-secondary uppercase">Node 02</span>
                    <span className="w-2 h-2 rounded-full bg-telemetry-emerald" />
                  </div>
                  <p className="font-headline-sm text-sm text-earth-charcoal font-bold leading-tight">Geochem Normalizer</p>
                  <p className="font-body-sm text-[11px] text-secondary">XRF assays & Rock hardness</p>
                  <div className="mt-2 pt-1.5 border-t border-earth-border/30 flex justify-between font-label-sm text-[10px]">
                    <span className="text-secondary">Batch 256</span>
                    <span className="text-telemetry-emerald font-bold">6.4 ms</span>
                  </div>
                </div>

                <span className="material-symbols-outlined text-copper-accent relative z-10">arrow_forward</span>

                {/* Node 3 */}
                <div className="relative z-10 bg-surface-parchment rounded-lg p-3 shadow-sm w-52 transition-all hover:scale-105 cursor-pointer border border-primary-container/40 ring-1 ring-primary-container/20">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-sm text-[10px] text-copper-accent uppercase font-bold">Constraint Boundary</span>
                    <span className="w-2 h-2 rounded-full bg-telemetry-emerald animate-pulse" />
                  </div>
                  <p className="font-headline-sm text-sm text-earth-charcoal font-bold leading-tight">Physics Filter (PINN)</p>
                  <p className="font-body-sm text-[11px] text-secondary">Thermodynamic & Mass laws</p>
                  <div className="mt-2 pt-1.5 border-t border-earth-border/30 flex justify-between font-label-sm text-[10px]">
                    <span className="text-secondary">ΔEnergy = 0</span>
                    <span className="text-telemetry-emerald font-bold">8.9 ms</span>
                  </div>
                </div>

                <span className="material-symbols-outlined text-copper-accent relative z-10">arrow_forward</span>

                {/* Node 4 */}
                <div className="relative z-10 bg-surface-parchment rounded-lg p-3 shadow-sm w-52 transition-all hover:scale-105 cursor-pointer border border-earth-border/40">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-sm text-[10px] text-secondary uppercase">Surrogate Core</span>
                    <span className="w-2 h-2 rounded-full bg-telemetry-emerald" />
                  </div>
                  <p className="font-headline-sm text-sm text-earth-charcoal font-bold leading-tight">Bayesian Ensemble</p>
                  <p className="font-body-sm text-[11px] text-secondary">5x MC-Dropout Passes</p>
                  <div className="mt-2 pt-1.5 border-t border-earth-border/30 flex justify-between font-label-sm text-[10px]">
                    <span className="text-secondary">±0.04 CI</span>
                    <span className="text-telemetry-emerald font-bold">14.2 ms</span>
                  </div>
                </div>

                <span className="material-symbols-outlined text-telemetry-emerald relative z-10">arrow_forward</span>

                {/* Node 5 */}
                <div className="relative z-10 bg-earth-espresso text-canvas-sandstone rounded-lg p-3 shadow-md w-48 transition-all hover:scale-105 cursor-pointer border border-copper-accent/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-label-sm text-[10px] text-copper-accent uppercase font-bold">Endpoint</span>
                    <span className="w-2 h-2 rounded-full bg-telemetry-emerald" />
                  </div>
                  <p className="font-headline-sm text-sm text-canvas-sandstone font-bold leading-tight">Control Dispatch</p>
                  <p className="font-body-sm text-[11px] text-stone-300">Actuator targets sent</p>
                  <div className="mt-2 pt-1.5 border-t border-white/10 flex justify-between font-label-sm text-[10px]">
                    <span className="text-stone-300">Kansanshi PLC</span>
                    <span className="text-copper-accent font-bold">5.4 ms</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ────────────────────────────────────────────────────────────────
              4. Visual Richness: Loss Landscapes & Model Architectures
              ──────────────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Visual 1: Neural Circuit & Loss Subsurface */}
            <div className="lg:col-span-5 bg-surface-parchment rounded-xl p-5 shadow-sm flex flex-col justify-between border border-earth-border/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-label-sm text-[10px] text-copper-accent uppercase font-semibold">Topological Geometry</span>
                  <h3 className="font-headline-sm text-sm sm:text-base text-earth-charcoal font-bold">PINN Loss Manifold & Neural Pathways</h3>
                </div>
                <span className="px-2 py-0.5 rounded bg-surface-container text-secondary font-label-sm text-xs font-mono">
                  Hessian Eig: 1.28
                </span>
              </div>
              <div className="relative rounded-lg overflow-hidden h-64 bg-earth-espresso shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="w-full h-full object-cover opacity-90 transition-transform duration-700 hover:scale-105"
                  alt="Neural network pathways across bedrock"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuD6r6ucGE4mIp5cd3mRjzvaW6rnmGi1hEcpJ6bOtnKqR-t_BZHIdFG04oX13QQbdYWB9tmmkG5iNMrEzWrIHt-vJXSRbbpmacwOkHW-vnxBw6pQglr67uwoXaaD0118o_qvhWPkgAtY_yCmBiLoSv1s1n9Fv9ky9fyTnQd1uoRJ0bJ_s62zAZyrId2Ft4edn4hOm6zcv18egJrLpt9-opLH-fRYbsenQuFD7_FCjw--CIDMltVzAfJe"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-earth-espresso via-transparent to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 flex justify-between items-end text-canvas-sandstone">
                  <div>
                    <p className="font-label-sm text-[10px] text-copper-accent uppercase font-semibold">Global Minima Basin</p>
                    <p className="font-headline-sm text-xs sm:text-sm text-canvas-sandstone font-bold">Φ(x) Convergence Confirmed</p>
                  </div>
                  <span className="px-2 py-1 rounded bg-earth-charcoal/80 text-telemetry-emerald font-label-sm text-xs font-semibold">
                    Zero Gradient Explode
                  </span>
                </div>
              </div>
              <div className="mt-3 flex justify-between items-center text-secondary font-label-sm text-xs">
                <span>Stochastic Sharpness-Aware Minimization (SAM)</span>
                <span className="text-earth-charcoal font-semibold font-mono">Radius ρ = 0.05</span>
              </div>
            </div>

            {/* Visual 2: Geological Subsurface & Ground Truth Density */}
            <div className="lg:col-span-7 bg-surface-parchment rounded-xl p-5 shadow-sm flex flex-col justify-between border border-earth-border/40">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-label-sm text-[10px] text-copper-accent uppercase font-semibold">Ground Truth Grounding</span>
                  <h3 className="font-headline-sm text-sm sm:text-base text-earth-charcoal font-bold">Geophysical EM Inversion vs. Micro-Core Assays</h3>
                </div>
                <button
                  onClick={() => showToast('Toggled Bench 14 highwall strata density overlay')}
                  className="px-2.5 py-1 rounded bg-surface-container hover:bg-surface-elevation text-earth-charcoal font-label-sm text-xs flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">layers</span> Toggle Strata
                </button>
              </div>
              <div className="relative rounded-lg overflow-hidden h-64 bg-earth-espresso shadow-inner">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="w-full h-full object-cover opacity-90 transition-transform duration-700 hover:scale-105"
                  alt="Cross-section 3D geological model"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuDRYcfCuTk4a1e_vviyMmh8U3GLNo-jDbJu-xtDLdFD1xWbYX8Y6mVQpZ6KhScq5W8-EKWNyNt116ws6z5S9njYOipW5ptFhkBMn2IiCuQZaLwi6a_a6UBiRrSIsu1nGVm_oLQoHkWBKh6AzRMCF46O7GXuxbka1xaqUtGK-rH7ZFtGnT_d-HMBeAjPWfx31fCv1HFOReqYiuYafecqGhvvhBWc_Rhkt2TJxMXOfYsBj0G5PAFA0q4D"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-earth-espresso/90 via-transparent to-transparent" />
                <div className="absolute top-3 left-3 flex gap-2">
                  <span className="px-2 py-0.5 rounded bg-earth-charcoal/80 text-canvas-sandstone font-label-sm text-xs">Bench 14 - East Wall</span>
                  <span className="px-2 py-0.5 rounded bg-telemetry-emerald/90 text-canvas-sandstone font-label-sm text-xs font-semibold">Assay Corr: 98.4%</span>
                </div>
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-canvas-sandstone">
                  <div className="space-y-0.5">
                    <span className="font-label-sm text-[10px] text-copper-accent uppercase font-semibold">Sulfide Recovery Estimation</span>
                    <p className="font-headline-sm text-xs sm:text-sm text-canvas-sandstone font-bold font-mono">1.84% Cu ± 0.08%</p>
                  </div>
                  <div className="text-right">
                    <span className="font-label-sm text-[10px] text-surface-dim uppercase">Lithology Class</span>
                    <p className="font-label-lg text-xs sm:text-sm font-semibold text-canvas-sandstone">Quartz-Mica Schist</p>
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="p-2 bg-surface-container/60 rounded">
                  <span className="font-label-sm text-[10px] text-secondary uppercase">Borehole Matches</span>
                  <p className="font-headline-sm text-sm text-earth-charcoal font-semibold">142 Holes</p>
                </div>
                <div className="p-2 bg-surface-container/60 rounded">
                  <span className="font-label-sm text-[10px] text-secondary uppercase">Surrogate Latency</span>
                  <p className="font-headline-sm text-sm text-earth-charcoal font-semibold">12 ms / bench</p>
                </div>
                <div className="p-2 bg-surface-container/60 rounded">
                  <span className="font-label-sm text-[10px] text-secondary uppercase">Drift Alert</span>
                  <p className="font-headline-sm text-sm text-telemetry-emerald font-semibold">None (0.02 KS)</p>
                </div>
              </div>
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────────────
              5. Experiment Tracking & Model Comparison Matrix
              ──────────────────────────────────────────────────────────────── */}
          <section className="bg-surface-parchment rounded-xl p-6 shadow-sm space-y-4 border border-earth-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-label-sm text-xs text-copper-accent uppercase tracking-wider font-semibold">
                  Experiment Registry
                </span>
                <h2 className="font-headline-md text-lg sm:text-xl text-earth-charcoal font-bold">
                  Hyperparameter Ledgers & Benchmark Runs
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-surface-container px-3 py-1 rounded">
                  <span className="material-symbols-outlined text-[16px] text-secondary">filter_list</span>
                  <span className="font-label-sm text-xs text-earth-charcoal">Filter: All Solvers</span>
                </div>
                <button
                  onClick={() => showToast('Exported benchmark runs (.csv)')}
                  className="px-3 py-1 rounded bg-surface-elevation hover:bg-surface-container-high text-earth-charcoal font-label-sm text-xs transition-colors flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-[16px]">file_download</span>
                  Export CSV
                </button>
              </div>
            </div>

            {/* High Density Scientific Ledger Table */}
            <div className="overflow-x-auto rounded-lg bg-surface-container border border-earth-border/30">
              <table className="w-full text-left font-body-md text-xs sm:text-sm">
                <thead>
                  <tr className="bg-surface-elevation text-secondary font-label-sm text-[11px] uppercase tracking-wider">
                    <th className="py-3 px-4">Run ID • Model Target</th>
                    <th className="py-3 px-4">Type / Solver</th>
                    <th className="py-3 px-4">Hyperparameters (LR, Batch, Uncertainty)</th>
                    <th className="py-3 px-4">Metrics (MAE, R²)</th>
                    <th className="py-3 px-4">Inference Latency</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-earth-border/20 text-earth-charcoal">
                  {RUNS_DATA.map((run, idx) => (
                    <tr
                      key={run.id}
                      className={`transition-colors hover:bg-surface-container-high ${
                        idx % 2 === 0 ? 'bg-surface-parchment' : 'bg-canvas-sandstone'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-headline-sm text-sm text-earth-charcoal font-bold flex items-center gap-1.5">
                          {run.id}
                          {run.status === 'training' && <span className="w-2 h-2 rounded-full bg-telemetry-amber animate-pulse" />}
                        </div>
                        <div className="font-body-sm text-xs text-secondary">{run.subtitle}</div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded bg-surface-container text-earth-charcoal font-label-sm text-xs font-mono">
                          {run.solver}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-label-sm text-xs font-mono">
                        <div>{run.hyperparams}</div>
                        <div className="text-secondary">{run.notes}</div>
                      </td>
                      <td className="py-3 px-4 font-label-sm text-xs">
                        <div className="font-semibold text-earth-charcoal font-mono">{run.mae !== 'N/A' ? `MAE: ${run.mae}` : run.gain}</div>
                        <div className="text-telemetry-emerald font-mono">{run.r2}</div>
                      </td>
                      <td className="py-3 px-4 font-label-sm text-xs text-earth-charcoal font-mono">
                        {run.latency}
                      </td>
                      <td className="py-3 px-4">
                        {run.status === 'training' ? (
                          <span className="px-2 py-0.5 rounded bg-telemetry-amber/20 text-telemetry-amber font-label-sm text-xs uppercase font-semibold">
                            Training (84%)
                          </span>
                        ) : run.status === 'completed' ? (
                          <span className="px-2 py-0.5 rounded bg-telemetry-emerald/20 text-telemetry-emerald font-label-sm text-xs uppercase font-semibold">
                            Completed
                          </span>
                        ) : run.status === 'baseline' ? (
                          <span className="px-2 py-0.5 rounded bg-surface-elevation text-secondary font-label-sm text-xs uppercase font-semibold">
                            Baseline
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-surface-elevation text-secondary font-label-sm text-xs uppercase font-semibold">
                            {run.status}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => openDrawer(`${run.id}: ${run.title}`)}
                          className="px-2.5 py-1 rounded bg-surface-elevation hover:bg-copper-accent hover:text-canvas-sandstone text-earth-charcoal font-label-sm text-xs transition-colors"
                        >
                          Logs & State
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>
      </main>

      {/* ────────────────────────────────────────────────────────────────
          6. Slide-in Drawer: Experiment Logs & Telemetry
          ──────────────────────────────────────────────────────────────── */}
      <div
        className={`fixed inset-y-0 right-0 w-full sm:w-[540px] bg-surface-parchment shadow-2xl transition-transform duration-300 ease-in-out z-50 flex flex-col border-l border-earth-border ${
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Drawer Header */}
        <div className="p-4 bg-surface-elevation flex items-center justify-between border-b border-earth-border/40">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-copper-accent text-[22px]">terminal</span>
            <div>
              <h3 className="font-headline-sm text-sm sm:text-base text-earth-charcoal font-bold">{activeRunTitle}</h3>
              <p className="font-label-sm text-xs text-secondary">Kansanshi Cluster Execution Stream</p>
            </div>
          </div>
          <button
            onClick={() => setIsDrawerOpen(false)}
            className="w-8 h-8 rounded bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-earth-charcoal"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {/* Hardware Telemetry Stack */}
          <div className="bg-surface-container rounded-lg p-3 space-y-1 border border-earth-border/40">
            <span className="font-label-sm text-xs text-copper-accent uppercase tracking-wider font-semibold">Allocated Acceleration</span>
            <div className="grid grid-cols-2 gap-2 font-label-sm text-xs text-earth-charcoal font-mono">
              <div>Device: <span className="font-semibold">GPU 0 (H100)</span></div>
              <div>Temp: <span className="text-telemetry-emerald font-semibold">54°C (Liquid)</span></div>
              <div>Power: <span className="font-semibold">412W / 700W</span></div>
              <div>Clock: <span className="font-semibold">1,980 MHz Boost</span></div>
            </div>
          </div>

          {/* Real-Time Stream Terminal Output */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-xs text-secondary uppercase">Live Inference Stream Log</span>
              <span className="font-label-sm text-xs text-telemetry-emerald flex items-center gap-1 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-telemetry-emerald animate-pulse" />
                Syncing
              </span>
            </div>
            <div className="bg-earth-espresso text-canvas-sandstone p-3 rounded-lg font-mono text-[11px] leading-relaxed overflow-x-auto space-y-1 h-80 shadow-inner">
              <p className="text-secondary">[14:02:18.012] <span className="text-copper-accent">[INFO]</span> Initializing PINN boundary condition enforcement...</p>
              <p className="text-secondary">[14:02:18.421] <span className="text-copper-accent">[INFO]</span> Mass-balance residual loss lambda set to 0.450.</p>
              <p className="text-secondary">[14:02:19.110] <span className="text-telemetry-emerald">[CUDA]</span> DistributedDataParallel across 3 ranks initialized.</p>
              <p className="text-secondary">[14:02:22.880] <span className="text-surface-dim">[EPOCH 418]</span> train_loss: 0.00154 | val_loss: 0.00148 | phys_res: 0.00021</p>
              <p className="text-secondary">[14:02:25.104] <span className="text-surface-dim">[EPOCH 419]</span> train_loss: 0.00149 | val_loss: 0.00144 | phys_res: 0.00019</p>
              <p className="text-secondary">[14:02:27.340] <span className="text-surface-dim">[EPOCH 420]</span> train_loss: 0.00145 | val_loss: 0.00142 | phys_res: 0.00018</p>
              <p className="text-secondary">[14:02:27.350] <span className="text-telemetry-emerald">[CHECKPOINT]</span> Model state dict saved to s3://crucible-weights/pinn-sag-420.pt</p>
              <p className="text-secondary">[14:02:27.420] <span className="text-copper-accent">[INFERENCE]</span> Batch 420 passed to surrogate endpoint. Latency 37.8ms.</p>
              <p className="text-secondary">[14:02:28.001] <span className="text-telemetry-emerald">[NOMINAL]</span> SAG Mill speed setpoint calculated: 11.24 RPM (Confidence 99.4%)</p>
              <p className="text-secondary animate-pulse text-copper-accent">&gt; awaiting incoming SCADA telemetry packet...</p>
            </div>
          </div>

          {/* Epistemic Uncertainty & Drift Metrics */}
          <div className="p-3 bg-surface-container rounded-lg space-y-2 border border-earth-border/40">
            <span className="font-label-sm text-xs text-secondary uppercase font-semibold">Epistemic Uncertainty Bounds</span>
            <div className="space-y-1">
              <div className="flex justify-between font-label-sm text-xs">
                <span className="text-earth-charcoal">Grindability Index (±0.04 kWh/t)</span>
                <span className="text-telemetry-emerald font-semibold">Pass</span>
              </div>
              <div className="w-full h-1.5 rounded bg-surface-elevation overflow-hidden">
                <div className="h-full bg-telemetry-emerald" style={{ width: '88%' }} />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between font-label-sm text-xs">
                <span className="text-earth-charcoal">Slurry Viscosity (±0.08 Pa·s)</span>
                <span className="text-telemetry-emerald font-semibold">Pass</span>
              </div>
              <div className="w-full h-1.5 rounded bg-surface-elevation overflow-hidden">
                <div className="h-full bg-telemetry-emerald" style={{ width: '92%' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Drawer Footer */}
        <div className="p-4 bg-surface-elevation flex items-center justify-between border-t border-earth-border/40">
          <button
            onClick={() => showToast('Model checkpoint weights downloaded (.pt)')}
            className="px-3.5 py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-earth-charcoal font-label-sm text-xs flex items-center gap-1 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            Download Weights (.pt)
          </button>
          <button
            onClick={() => {
              setIsDrawerOpen(false);
              showToast('Halt command dispatched to cluster coordinator.');
            }}
            className="px-3.5 py-1.5 rounded bg-telemetry-crimson hover:opacity-90 text-on-primary font-label-sm text-xs flex items-center gap-1 transition-colors font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">stop</span>
            Halt Execution
          </button>
        </div>
      </div>
    </div>
  );
}
