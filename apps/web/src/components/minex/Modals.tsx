'use client';

/**
 * Modals — Evidence audit, drill review, AI optimizer, and deploy-success
 * dialogs ported from the Stitch implementation. The AI Optimizer now calls
 * the real /scenarios/run endpoint instead of the Gemini stub.
 */
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost } from '@/lib/api';
import type { RiskVector, ExplorationTarget, ScenarioMetrics, ScenarioIntervention } from '@/lib/minex';
import type { ProductionInsight } from '@/lib/insight';

// ---------------------------------------------------------------- ShortfallModal
export function ShortfallModal({
  insight,
  onClose,
  onSimulateMitigation,
}: {
  insight: ProductionInsight | null;
  onClose: () => void;
  onSimulateMitigation: () => void;
}) {
  if (!insight) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-dark border border-accent/40 rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl relative text-ink flex flex-col gap-5">
        <button onClick={onClose} className="absolute top-5 right-5 text-ink2 hover:text-ink p-1.5 rounded-lg hover:bg-frost/10 transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-bold text-accentt uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">trending_down</span>
            <span>Production Shortfall Analysis</span>
          </div>
          <h2 className="font-['Manrope'] text-2xl font-bold text-ink flex items-center gap-3">
            <span>{insight.stateLabel}</span>
            <span className="text-xs bg-warn/20 text-warnt border border-warn/40 px-2.5 py-0.5 rounded-full">
              {insight.shortfallProbability}% Probability
            </span>
          </h2>
          <p className="text-xs text-ink2 mt-1 font-mono">
            Expected {insight.expected} over {insight.horizonLabel} · {insight.expectedPerShift}/shift
          </p>
        </div>

        {/* Expected vs planned target over the selected horizon */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-deep2 p-3 rounded-xl border border-line">
            <div className="text-[10px] uppercase font-bold text-inkb tracking-wider">Expected</div>
            <div className="text-lg font-bold text-accentt mt-0.5">{insight.expected}</div>
          </div>
          <div className="bg-deep2 p-3 rounded-xl border border-line">
            <div className="text-[10px] uppercase font-bold text-inkb tracking-wider">Planned target</div>
            <div className="text-lg font-bold text-ink mt-0.5">{insight.plannedTarget ?? '—'}</div>
          </div>
          <div className={`p-3 rounded-xl border ${insight.deficit ? 'bg-danger/10 border-danger/40' : 'bg-ok/10 border-ok/40'}`}>
            <div className="text-[10px] uppercase font-bold text-inkb tracking-wider">Projected gap</div>
            <div className={`text-lg font-bold mt-0.5 ${insight.deficit ? 'text-dangert' : 'text-okt'}`}>
              {insight.deficit ? `−${insight.deficit}` : 'On target'}
            </div>
          </div>
        </div>

        <div className="bg-deep2 p-4 rounded-xl border border-line space-y-3">
          <div className="text-xs font-bold text-inkb uppercase tracking-wider">Why this shortfall is flagged</div>
          {insight.drivers.length > 0 ? (
            <ul className="space-y-2">
              {insight.drivers.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-ink">
                  <span className={`material-symbols-outlined ${d.direction === 'negative' ? 'text-dangert' : 'text-okt'}`}>
                    {d.direction === 'negative' ? 'south' : 'north'}
                  </span>
                  {d.label} {d.direction === 'negative' ? '(pulling production down)' : '(supporting production)'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink2">
              No single dominant driver — the forecast model attributes the risk to a combination of
              operating conditions. Run scenarios to test mitigations.
            </p>
          )}
        </div>

        <div className="bg-deep2 p-4 rounded-xl border border-line">
          <div className="text-xs font-bold text-ink2 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm text-warnt">rule</span>
            <span>Synthetic Calibration</span>
          </div>
          <p className="text-xs text-inkb leading-relaxed">
            {insight.simulated
              ? 'Shortfall probability calculated using partially simulated baseline telemetry.'
              : 'Shortfall probability calculated using live baseline telemetry.'}
          </p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-line3 text-xs font-bold text-ink2 hover:text-ink hover:bg-frost/5 transition-colors">
            Dismiss
          </button>
          <button
            onClick={() => {
              onClose();
              onSimulateMitigation();
            }}
            className="px-5 py-2.5 rounded-xl bg-accent text-onaccent text-xs font-bold uppercase tracking-wider hover:bg-accent2 transition-all flex items-center gap-2 shadow-lg shadow-accent/20"
          >
            <span>Run Scenarios</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}
export function EvidenceModal({
  risk,
  onClose,
  onSimulateMitigation,
}: {
  risk: RiskVector | null;
  onClose: () => void;
  onSimulateMitigation: (risk: RiskVector) => void;
}) {
  if (!risk) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-dark border border-accent/40 rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl relative text-ink flex flex-col gap-5">
        <button onClick={onClose} className="absolute top-5 right-5 text-ink2 hover:text-ink p-1.5 rounded-lg hover:bg-frost/10 transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-bold text-accentt uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">verified</span>
            <span>Evidence Audit &amp; Vector Telemetry</span>
          </div>
          <h2 className="font-['Manrope'] text-2xl font-bold text-ink flex items-center gap-3">
            <span>{risk.title}</span>
            <span className="text-xs bg-danger/20 text-dangert border border-danger/40 px-2.5 py-0.5 rounded-full">
              {risk.confidence}% Confidence
            </span>
          </h2>
          <p className="text-xs text-ink2 mt-1 font-mono">
            Vector ID: {risk.id} | Projected Impact: {risk.impact}
          </p>
        </div>

        <div className="bg-deep2 p-4 rounded-xl border border-line space-y-3">
          <div className="text-xs font-bold text-inkb uppercase tracking-wider">Telemetry Observation</div>
          <p className="text-sm text-ink leading-relaxed">{risk.evidence.description}</p>
          <div className="flex items-center gap-2 text-xs text-infot pt-2 border-t border-line">
            <span className="material-symbols-outlined text-sm">sensors</span>
            <span>Source: {risk.evidence.telemetrySource}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-deep2 p-4 rounded-xl border border-line">
            <div className="text-xs font-bold text-ink2 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-accentt">local_shipping</span>
              <span>Affected Units</span>
            </div>
            <ul className="space-y-1 text-xs text-ink">
              {risk.evidence.affectedUnits.map((u, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                  <span className="font-mono">{u}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="bg-deep2 p-4 rounded-xl border border-line">
            <div className="text-xs font-bold text-ink2 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-warnt">rule</span>
              <span>Synthetic Calibration</span>
            </div>
            <p className="text-xs text-inkb leading-relaxed">{risk.evidence.syntheticAssumptions}</p>
          </div>
        </div>

        <div className="bg-ok/10 border border-ok/40 p-4 rounded-xl">
          <div className="text-xs font-bold text-okt uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <span className="material-symbols-outlined text-sm">check_circle</span>
            <span>Recommended Mitigation</span>
          </div>
          <p className="text-xs text-ink leading-relaxed">{risk.evidence.recommendedMitigation}</p>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-line3 text-xs font-bold text-ink2 hover:text-ink hover:bg-frost/5 transition-colors">
            Dismiss
          </button>
          <button
            onClick={() => {
              onClose();
              onSimulateMitigation(risk);
            }}
            className="px-5 py-2.5 rounded-xl bg-accent text-onaccent text-xs font-bold uppercase tracking-wider hover:bg-accent2 transition-all flex items-center gap-2 shadow-lg shadow-accent/20"
          >
            <span>Simulate in Scenario Workspace</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- DrillReviewModal
export function DrillReviewModal({
  target,
  onClose,
}: {
  target: ExplorationTarget | null;
  onClose: () => void;
}) {
  const [aiReport, setAiReport] = useState<string | null>(null);
  if (!target) return null;

  const handleGenerateAIReport = () => {
    setAiReport(
      `Lithological Analysis for ${target.name}: High-grade braunite mineralization identified within the Sausar Group gondite band. Recommend a 5-hole diamond drill program at 200 m line spacing to evaluate the dip plunge toward the south-west. All figures SYNTHETIC — model-assisted interpretation only.`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-dark border border-accent/40 rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl relative text-ink flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 text-ink2 hover:text-ink p-1.5 rounded-lg hover:bg-frost/10 transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-bold text-infot uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">science</span>
            <span>Exploration Review &amp; Assay Correlation</span>
          </div>
          <h2 className="font-['Manrope'] text-2xl font-bold text-ink flex items-center gap-3">
            <span>{target.name} Review Program</span>
            <span className="text-xs bg-warn/20 text-warnt border border-warn/40 px-2.5 py-0.5 rounded-full">
              {target.probability}% Prob.
            </span>
          </h2>
          <p className="text-xs text-ink2 mt-1 font-mono">
            Coordinates: {target.coordinates} | Est. Reserves: {target.estimatedReserveTons}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-deep2 p-3 rounded-xl border border-line">
            <div className="text-[10px] uppercase font-bold text-inkb">Subsurface Confidence</div>
            <div className="text-lg font-bold text-okt mt-0.5">{target.subsurfaceConf}</div>
          </div>
          <div className="bg-deep2 p-3 rounded-xl border border-line">
            <div className="text-[10px] uppercase font-bold text-inkb">Density Score</div>
            <div className="text-lg font-bold text-accentt mt-0.5">{target.densityScore} g/cm³</div>
          </div>
          <div className="bg-deep2 p-3 rounded-xl border border-line">
            <div className="text-[10px] uppercase font-bold text-inkb">Maturity Grade</div>
            <div className="text-lg font-bold text-infot mt-0.5">{target.maturity}</div>
          </div>
        </div>

        <div className="bg-deep2 p-4 rounded-xl border border-line">
          <div className="text-xs font-bold text-ink2 uppercase tracking-wider mb-1">Lithology &amp; Structure Summary</div>
          <p className="text-xs text-ink leading-relaxed">{target.description}</p>
        </div>

        <div className="bg-panel2 p-4 rounded-xl border border-line2/40 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-accentt uppercase">
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              <span>MINEx AI Subsurface Assessment</span>
            </div>
            {!aiReport && (
              <button
                onClick={handleGenerateAIReport}
                className="px-3 py-1 bg-accent text-onaccent text-xs font-bold rounded-lg hover:bg-accent2 transition-all flex items-center gap-1"
              >
                <span>Generate Report</span>
              </button>
            )}
          </div>
          {aiReport && (
            <div className="text-xs text-ink bg-deep2 p-3 rounded-lg border border-line leading-relaxed whitespace-pre-line animate-fadeIn">
              {aiReport}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-line3 text-xs font-bold text-ink2 hover:text-ink hover:bg-frost/5 transition-colors">
            Close Review
          </button>
          <button
            onClick={() => {
              window.alert(`Drill proposal for ${target.name} submitted to the Sausar Operations Board (SIMULATED — synthetic data only).`);
              onClose();
            }}
            className="px-5 py-2.5 rounded-xl bg-ok text-white text-xs font-bold uppercase tracking-wider hover:bg-ok/80 transition-all flex items-center gap-2 shadow-lg"
          >
            <span className="material-symbols-outlined text-sm">check</span>
            <span>Approve Exploratory Borehole</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- AIOptimizerModal
export function AIOptimizerModal({
  isOpen,
  onClose,
  onApplyScenario,
  mineId = 'MINE-A',
}: {
  isOpen: boolean;
  onClose: () => void;
  onApplyScenario: (data: { metrics: ScenarioMetrics; interventions: ScenarioIntervention[] }) => void;
  mineId?: string;
}) {
  const [sector, setSector] = useState('Sector Alpha-4');
  const [bottleneck, setBottleneck] = useState('Haulage congestion & primary crusher moisture variance');
  const [fuelTolerance, setFuelTolerance] = useState('Standard (±10%)');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationResult, setSimulationResult] = useState<any>(null);
  const router = useRouter();

  if (!isOpen) return null;

  const handleRunSimulation = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const tol = fuelTolerance.includes('Aggressive') ? 0.25 : fuelTolerance.includes('Conservation') ? 0.05 : 0.1;
      const data = await apiPost<any>('/scenarios/run', {
        mine_id: mineId,
        interventions: [
          { type: 'fleet_reroute', magnitude: tol, detail: 'Dynamic fleet re-route' },
          { type: 'crusher_speed_trim', magnitude: tol / 2, detail: bottleneck },
        ],
        baseline_date: new Date().toISOString().slice(0, 10),
      });
      setSimulationResult({ ...data, scenarioName: 'Optimized Operational Scenario', confidence: 88 });
    } catch (err: any) {
      setError(err?.message ?? 'Simulation failed — falling back to synthetic heuristics.');
      setSimulationResult({
        scenarioName: 'Heuristic Scenario (offline)',
        confidence: 74,
        keyDriver: 'Local heuristic — API unavailable.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-dark border border-accent/40 rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl relative text-ink flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 text-ink2 hover:text-ink p-1.5 rounded-lg hover:bg-frost/10 transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-bold text-accentt uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">auto_awesome</span>
            <span>MINEx AI Decision Engine</span>
          </div>
          <h2 className="font-['Manrope'] text-2xl font-bold text-ink">Operational Scenario Solver</h2>
          <p className="text-xs text-ink2 mt-1">
            Simulate dynamic fleet dispatch, crusher speed modulation, and mine throughput optimization.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-bold text-ink2 uppercase tracking-wider block mb-1.5">Sector / Pit Zone</label>
            <input
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-ink2 uppercase tracking-wider block mb-1.5">Fuel &amp; Fleet Surge Tolerance</label>
            <select
              value={fuelTolerance}
              onChange={(e) => setFuelTolerance(e.target.value)}
              className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
            >
              <option>Standard (±10%)</option>
              <option>Aggressive Throughput (±25%)</option>
              <option>Conservation (±5%)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-ink2 uppercase tracking-wider block mb-1.5">Operational Constraint / Bottleneck</label>
            <textarea
              rows={2}
              value={bottleneck}
              onChange={(e) => setBottleneck(e.target.value)}
              className="w-full bg-deep2 border border-line rounded-xl px-3.5 py-2 text-xs text-ink focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {error && (
          <div className="text-xs text-warnt bg-warn/10 border border-warn/40 rounded-xl px-3 py-2">{error}</div>
        )}

        <button
          onClick={handleRunSimulation}
          disabled={isLoading}
          className="w-full py-3 bg-accent text-onaccent text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-accent2 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-60"
        >
          {isLoading ? (
            <>
              <span className="w-4 h-4 border-2 border-onaccent border-t-transparent rounded-full animate-spin"></span>
              <span>Running Discrete Simulation...</span>
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-sm">play_arrow</span>
              <span>Solve Optimal Scenario</span>
            </>
          )}
        </button>

        {simulationResult && (
          <div className="bg-deep2 p-4 rounded-xl border border-accent/40 space-y-3 animate-fadeIn">
            <div className="flex justify-between items-center pb-2 border-b border-line">
              <div className="font-['Manrope'] font-bold text-sm text-accentt">{simulationResult.scenarioName}</div>
              <span className="text-xs bg-ok/20 text-okt px-2 py-0.5 rounded font-bold">
                {simulationResult.confidence}% Confidence
              </span>
            </div>
            <div className="text-xs text-ink bg-panel2/50 p-2.5 rounded-lg">
              <span className="font-bold text-okt">Key Driver: </span>
              {simulationResult?.keyDriver ?? 'Fleet reallocation increases utilization, correlating to throughput gain.'}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  onApplyScenario(simulationResult);
                  onClose();
                  router.push('/scenario');
                }}
                className="px-4 py-2 bg-ok text-white text-xs font-bold rounded-lg hover:bg-ok/80 transition-colors"
              >
                Apply to Scenario Workspace
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- DeploySuccessModal
export function DeploySuccessModal({
  isOpen,
  onClose,
  onNavigateToLive,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToLive: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-dark border border-ok/50 rounded-2xl max-w-lg w-full p-6 md:p-8 shadow-2xl relative text-ink flex flex-col items-center text-center gap-4">
        <div className="w-16 h-16 rounded-full bg-ok/20 border border-ok flex items-center justify-center text-okt mb-2 shadow-[0_0_30px_rgba(46,155,118,0.4)]">
          <span className="material-symbols-outlined text-3xl">verified</span>
        </div>

        <h2 className="font-['Manrope'] text-2xl font-bold text-ink">Scenario Dispatched to Operations</h2>

        <p className="text-xs text-ink2 leading-relaxed max-w-sm">
          Intervention instructions dispatched to the operations ledger. Work orders generated for the affected fleet units and the crusher PM window adjustment.
        </p>

        <div className="w-full bg-deep2 p-4 rounded-xl border border-line text-left text-xs font-mono space-y-1.5 text-inkb">
          <div className="flex justify-between">
            <span>Work Order ID:</span>
            <span className="text-accentt">WO-MN-{Math.floor(10000 + Math.random() * 89999)}</span>
          </div>
          <div className="flex justify-between">
            <span>Audit Log Status:</span>
            <span className="text-infot">GOVERNED &amp; SIGNED</span>
          </div>
          <div className="flex justify-between">
            <span>Data Origin:</span>
            <span className="text-warnt">SYNTHETIC (demo)</span>
          </div>
        </div>

        <div className="flex w-full gap-3 mt-4">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-line3 text-xs font-bold text-ink2 hover:text-ink transition-colors">
            Stay in Workspace
          </button>
          <button
            onClick={() => {
              onClose();
              onNavigateToLive();
            }}
            className="flex-1 py-3 rounded-xl bg-ok text-white text-xs font-bold uppercase tracking-wider hover:bg-ok/90 transition-all shadow-lg"
          >
            Monitor Live Telemetry
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- PredictionBrainstormModal
export function PredictionBrainstormModal({
  insight,
  onClose,
  onSimulateMitigation,
}: {
  insight: ProductionInsight | null;
  onClose: () => void;
  onSimulateMitigation: () => void;
}) {
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [brainstormResult, setBrainstormResult] = useState<string | null>(null);

  if (!insight) return null;

  const handleBrainstorm = () => {
    setIsBrainstorming(true);
    // Simulate AI delay
    setTimeout(() => {
      const drivers = insight.drivers.map(d => d.label).join(', ');
      setBrainstormResult(
        `Based on current drivers (${drivers || 'Unknown'}), here are ways to improve production yield:\n\n` +
        `1. Optimize Haulage Routes: Reroute autonomous trucks around congested sectors to maintain continuous feed rate.\n` +
        `2. Adjust Crusher Settings: Increase primary crusher RPM by 5% to handle the current ore hardness profile efficiently.\n` +
        `3. Maintenance Window Shift: Delay the scheduled loader PM by 2 hours to maintain extraction flow during this critical peak.`
      );
      setIsBrainstorming(false);
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="liquid-glass-dark border border-accent/40 rounded-2xl max-w-2xl w-full p-6 md:p-8 shadow-2xl relative text-ink flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-5 right-5 text-ink2 hover:text-ink p-1.5 rounded-lg hover:bg-frost/10 transition-colors">
          <span className="material-symbols-outlined">close</span>
        </button>

        <div>
          <div className="flex items-center gap-2 mb-1 text-xs font-bold text-accentt uppercase tracking-wider">
            <span className="material-symbols-outlined text-sm">psychology</span>
            <span>Prediction Analysis & AI Brainstorming</span>
          </div>
          <h2 className="font-['Manrope'] text-2xl font-bold text-ink">Projected Production Drivers</h2>
        </div>

        <div className="bg-deep2 p-4 rounded-xl border border-line space-y-3">
          <div className="text-xs font-bold text-inkb uppercase tracking-wider">Key Factors Influencing Production</div>
          {insight.drivers.length > 0 ? (
            <ul className="space-y-2">
              {insight.drivers.map((d, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-ink">
                  <span className={`material-symbols-outlined ${d.direction === 'negative' ? 'text-dangert' : 'text-okt'}`}>
                    {d.direction === 'negative' ? 'south' : 'north'}
                  </span>
                  {d.label} {d.direction === 'negative' ? '(reducing yield)' : '(improving yield)'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-ink2">No single dominant driver identified by the model.</p>
          )}
        </div>

        {!brainstormResult ? (
          <button
            onClick={handleBrainstorm}
            disabled={isBrainstorming}
            className="w-full py-3 bg-panel2 border border-accent/40 text-accentt text-xs font-bold uppercase tracking-wider rounded-xl hover:bg-accent/10 transition-all flex items-center justify-center gap-2"
          >
            {isBrainstorming ? (
              <>
                <span className="w-4 h-4 border-2 border-accentt border-t-transparent rounded-full animate-spin"></span>
                <span>AI is analyzing drivers...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">auto_awesome</span>
                <span>Brainstorm Actions to Improve Yield</span>
              </>
            )}
          </button>
        ) : (
          <div className="bg-panel2 p-4 rounded-xl border border-accent/40">
            <div className="flex items-center gap-2 text-xs font-bold text-accentt uppercase mb-2">
              <span className="material-symbols-outlined text-sm">auto_awesome</span>
              <span>AI Recommended Actions</span>
            </div>
            <div className="text-sm text-ink leading-relaxed whitespace-pre-line">
              {brainstormResult}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-line3 text-xs font-bold text-ink2 hover:text-ink hover:bg-frost/5 transition-colors">
            Close
          </button>
          <button
            onClick={() => {
              onClose();
              onSimulateMitigation();
            }}
            className="px-5 py-2.5 rounded-xl bg-accent text-onaccent text-xs font-bold uppercase tracking-wider hover:bg-accent2 transition-all flex items-center gap-2 shadow-lg shadow-accent/20"
          >
            <span>Test in Scenario Workspace</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
}
