'use client';

/**
 * /data-hub — Crucible AI Lakehouse Ingest Pipeline & Schema Intelligence
 * 100% faithful port of Stitch reference HTML: crucible_ai_data_hub/code.html
 *
 * Provides:
 *   - 5-step Lakehouse Ingest Pipeline Stepper (Domain, Upload, Schema Mapping, Quality Gates, Lakehouse Commit)
 *   - Domain Context & Source Ingestion Header
 *   - AI Neural Schema Matcher (CoreScan-v4.1) with confidence scores, auto-mapping, manual resolution
 *   - Live Profiling Stats Bento Card (Completeness, Null Density, P80 Particle Histogram, Anomaly Sentry)
 *   - Pre-Ingest Quality Gate Checklist
 *   - Geologic Sample Core Reference
 *   - Interactive Validation & Pipeline Commit Execution
 */

import React, { useState, useRef } from 'react';
import { useCrucibleAuth } from '@/lib/roles';

// ── Types ──────────────────────────────────────────────────────────────────
type StepId = 1 | 2 | 3 | 4 | 5;

interface SchemaColumn {
  id: string;
  sourceCol: string;
  sourceIcon: string;
  canonicalField: string;
  targetType: string;
  confidence: number;
  status: 'auto' | 'review' | 'manual';
  options?: string[];
}

// ── Initial Schema Mappings ─────────────────────────────────────────────────
const INITIAL_COLUMNS: SchemaColumn[] = [
  {
    id: 'col-1',
    sourceCol: 'raw_ts_utc',
    sourceIcon: 'schedule',
    canonicalField: 'timestamp_utc',
    targetType: 'DateTime (ISO)',
    confidence: 99.8,
    status: 'auto',
  },
  {
    id: 'col-2',
    sourceCol: 'eq_id_tag',
    sourceIcon: 'tag',
    canonicalField: 'asset_identifier',
    targetType: 'String (UUID)',
    confidence: 98.4,
    status: 'auto',
  },
  {
    id: 'col-3',
    sourceCol: 'p80_frag_cm',
    sourceIcon: 'scatter_plot',
    canonicalField: 'blast_p80_fragmentation',
    targetType: 'Float64',
    confidence: 94.1,
    status: 'review',
    options: [
      'blast_p80_fragmentation',
      'rock_grain_density_index',
      'muckpile_displacement_ratio',
    ],
  },
  {
    id: 'col-4',
    sourceCol: 'haul_tonnes_wet',
    sourceIcon: 'scale',
    canonicalField: 'payload_tonnes_gross',
    targetType: 'Float64',
    confidence: 96.5,
    status: 'auto',
  },
  {
    id: 'col-5',
    sourceCol: 'chute_flow_rate',
    sourceIcon: 'waterfall_chart',
    canonicalField: 'crusher_throughput_tph',
    targetType: 'Float32',
    confidence: 91.0,
    status: 'auto',
  },
];

const EXTENDED_COLUMNS: SchemaColumn[] = [
  { id: 'col-6', sourceCol: 'powder_factor_kg_t', sourceIcon: 'science', canonicalField: 'blast_powder_factor', targetType: 'Float32', confidence: 97.2, status: 'auto' },
  { id: 'col-7', sourceCol: 'burden_spacing_ratio', sourceIcon: 'straighten', canonicalField: 'blast_burden_spacing', targetType: 'Float32', confidence: 95.8, status: 'auto' },
  { id: 'col-8', sourceCol: 'subdrill_depth_m', sourceIcon: 'vertical_align_bottom', canonicalField: 'blast_subdrill_meters', targetType: 'Float32', confidence: 99.1, status: 'auto' },
  { id: 'col-9', sourceCol: 'vibe_ppv_mm_s', sourceIcon: 'vibration', canonicalField: 'seismic_ppv_peak', targetType: 'Float64', confidence: 98.6, status: 'auto' },
  { id: 'col-10', sourceCol: 'moisture_pct', sourceIcon: 'opacity', canonicalField: 'ore_moisture_percentage', targetType: 'Float32', confidence: 96.0, status: 'auto' },
  { id: 'col-11', sourceCol: 'cu_grade_head_pct', sourceIcon: 'diamond', canonicalField: 'ore_copper_grade_pct', targetType: 'Float32', confidence: 99.4, status: 'auto' },
  { id: 'col-12', sourceCol: 'pit_bench_rl_m', sourceIcon: 'layers', canonicalField: 'spatial_bench_elevation', targetType: 'Float32', confidence: 97.5, status: 'auto' },
  { id: 'col-13', sourceCol: 'flotation_recovery_pct', sourceIcon: 'bubble_chart', canonicalField: 'mill_flot_recovery', targetType: 'Float32', confidence: 94.8, status: 'auto' },
  { id: 'col-14', sourceCol: 'sag_kw_draw', sourceIcon: 'bolt', canonicalField: 'sag_power_consumption_kw', targetType: 'Float64', confidence: 99.2, status: 'auto' },
  { id: 'col-15', sourceCol: 'operator_badge_id', sourceIcon: 'badge', canonicalField: 'telemetry_operator_id', targetType: 'String', confidence: 98.0, status: 'auto' },
  { id: 'col-16', sourceCol: 'cycle_haul_time_sec', sourceIcon: 'timer', canonicalField: 'fleet_cycle_time_sec', targetType: 'Int32', confidence: 98.9, status: 'auto' },
  { id: 'col-17', sourceCol: 'ambient_temp_c', sourceIcon: 'thermostat', canonicalField: 'weather_ambient_celsius', targetType: 'Float32', confidence: 96.7, status: 'auto' },
  { id: 'col-18', sourceCol: 'wind_speed_kmh', sourceIcon: 'air', canonicalField: 'weather_wind_speed_kmh', targetType: 'Float32', confidence: 95.1, status: 'auto' },
];

export default function DataHubPage() {
  useCrucibleAuth();

  // Wizard state
  const [currentStep, setCurrentStep] = useState<StepId>(3);
  const [selectedDomain, setSelectedDomain] = useState<string>('production');
  const [columns, setColumns] = useState<SchemaColumn[]>(INITIAL_COLUMNS);
  const [showFullMatrix, setShowFullMatrix] = useState<boolean>(false);
  const [isReindexing, setIsReindexing] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [imputationApplied, setImputationApplied] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // File upload drag & drop
  const [fileName, setFileName] = useState<string>('kansanshi_shift_blast_fragmentation_2025_03.parquet');
  const [fileSize, setFileSize] = useState<string>('24.8 MB');
  const [rowCount, setRowCount] = useState<string>('142,500');
  const [dragging, setDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  }

  // Trigger file selection
  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setFileSize(`${(file.size / (1024 * 1024)).toFixed(1)} MB`);
      setRowCount('128,400');
      showToast(`Loaded source: ${file.name}`);
      setCurrentStep(3);
    }
  }

  // Drag and drop handlers
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setFileName(file.name);
      setFileSize(`${(file.size / (1024 * 1024)).toFixed(1)} MB`);
      setRowCount('128,400');
      showToast(`Ingested file: ${file.name}`);
      setCurrentStep(3);
    }
  }

  // Change mapping
  function updateMapping(id: string, newField: string) {
    setColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, canonicalField: newField, status: 'auto', confidence: 98.9 } : c))
    );
    showToast(`Updated canonical field to ${newField}`);
  }

  // Re-index AI model
  function handleReindex() {
    setIsReindexing(true);
    setTimeout(() => {
      setIsReindexing(false);
      setColumns((prev) =>
        prev.map((c) => ({
          ...c,
          confidence: Math.min(99.9, Number((c.confidence + 1.2).toFixed(1))),
          status: 'auto',
        }))
      );
      showToast('CoreScan-v4.1 re-index complete: 5/5 auto-mapped (98.4% confidence)');
    }, 1200);
  }

  // Run validation checks
  function handleValidate() {
    setIsValidating(true);
    setTimeout(() => {
      setIsValidating(false);
      setCurrentStep(4);
      showToast('Pre-ingest quality checks passed. Ready to commit.');
    }, 1400);
  }

  // Final Lakehouse commit
  function handleCommit() {
    setCurrentStep(5);
    showToast('Dataset committed to Apache Iceberg lakehouse table!');
  }

  // Download Schema JSON
  function handleDownloadReport() {
    const report = {
      pipeline_id: 'INGEST-KN-2025-0892',
      source_file: fileName,
      file_size: fileSize,
      rows: rowCount,
      target_domain: selectedDomain,
      columns: [...columns, ...(showFullMatrix ? EXTENDED_COLUMNS : [])],
      quality_score: 99.4,
      checks: [
        { test: 'Schema Structural Test', result: 'PASSED', format: 'Parquet-v2' },
        { test: 'Kansanshi Geofence Boundary', result: 'PASSED', crs: 'EPSG:32735' },
        { test: 'Unit Normalization Standard', result: 'PASSED', standard: 'Metric (SI)' },
      ],
      imputation_applied: imputationApplied,
      timestamp_utc: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crucible_schema_report_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Downloaded schema report (.json)');
  }

  const allColumns = showFullMatrix ? [...columns, ...EXTENDED_COLUMNS] : columns;

  return (
    <div className="bg-canvas-sandstone min-h-screen text-on-surface">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".parquet,.csv,.json,.las,.xlsx"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 pointer-events-none transition-all">
          <div className="pointer-events-auto bg-earth-charcoal text-canvas-sandstone px-4 py-3 rounded-lg shadow-2xl flex items-center gap-2 font-label-md text-label-md border border-copper-accent/30 animate-in fade-in slide-in-from-bottom-2">
            <span className="material-symbols-outlined text-copper-accent text-[20px]">check_circle</span>
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <main className="w-full bg-canvas-sandstone flex-1 pb-16">
        <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1560px] mx-auto w-full">
          
          {/* ────────────────────────────────────────────────────────────────
              Top Wizard Stepper Track
              ──────────────────────────────────────────────────────────────── */}
          <div className="bg-surface-parchment rounded-xl shadow-sm p-4 border border-earth-border/40">
            <div className="flex items-center justify-between gap-2 overflow-x-auto">
              {/* Step 1: Domain Selection */}
              <button
                onClick={() => setCurrentStep(1)}
                className="flex items-center gap-3 min-w-max text-left hover:opacity-80 transition-opacity"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-on-primary shadow-sm ${
                  currentStep >= 1 ? 'bg-telemetry-emerald' : 'bg-surface-container text-secondary'
                }`}>
                  <span className="material-symbols-outlined text-[18px]">check</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-sm text-[10px] text-secondary uppercase tracking-widest">Step 01</span>
                  <span className="font-label-md text-xs sm:text-sm text-earth-charcoal font-semibold">Domain Selection</span>
                </div>
              </button>

              <div className={`flex-1 h-0.5 mx-2 min-w-[28px] ${currentStep >= 2 ? 'bg-telemetry-emerald/40' : 'bg-surface-elevation'}`} />

              {/* Step 2: Upload Source File */}
              <button
                onClick={() => setCurrentStep(2)}
                className="flex items-center gap-3 min-w-max text-left hover:opacity-80 transition-opacity"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-on-primary shadow-sm ${
                  currentStep >= 2 ? 'bg-telemetry-emerald' : 'bg-surface-container text-secondary'
                }`}>
                  <span className="material-symbols-outlined text-[18px]">check</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-sm text-[10px] text-secondary uppercase tracking-widest">Step 02</span>
                  <span className="font-label-md text-xs sm:text-sm text-earth-charcoal font-semibold">Upload Source File</span>
                </div>
              </button>

              <div className={`flex-1 h-0.5 mx-2 min-w-[28px] ${currentStep >= 3 ? 'bg-primary-container' : 'bg-surface-elevation'}`} />

              {/* Step 3: Mapping & Schema Analysis (Active Copper Step) */}
              <button
                onClick={() => setCurrentStep(3)}
                className={`flex items-center gap-3 min-w-max text-left px-3 py-1.5 rounded-lg shadow-sm transition-all ${
                  currentStep === 3
                    ? 'bg-surface-container-high ring-1 ring-primary-container/40'
                    : currentStep > 3
                    ? 'bg-surface-container-low'
                    : 'opacity-70'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-on-primary font-headline-sm text-sm shadow-md ${
                  currentStep === 3
                    ? 'bg-primary-container'
                    : currentStep > 3
                    ? 'bg-telemetry-emerald'
                    : 'bg-surface-container text-secondary'
                }`}>
                  {currentStep > 3 ? (
                    <span className="material-symbols-outlined text-[18px]">check</span>
                  ) : (
                    <span>3</span>
                  )}
                </div>
                <div className="flex flex-col">
                  <div className="flex items-center gap-1.5">
                    <span className="font-label-sm text-[10px] text-copper-accent uppercase tracking-widest font-bold">
                      {currentStep === 3 ? 'Active Phase' : 'Phase 03'}
                    </span>
                    {currentStep === 3 && <span className="w-1.5 h-1.5 rounded-full bg-copper-accent animate-ping" />}
                  </div>
                  <span className="font-label-md text-xs sm:text-sm text-earth-charcoal font-bold">
                    Mapping & Schema Analysis
                  </span>
                </div>
              </button>

              <div className={`flex-1 h-0.5 mx-2 min-w-[28px] ${currentStep >= 4 ? 'bg-primary-container' : 'bg-surface-elevation'}`} />

              {/* Step 4: Validation & Quality Gates */}
              <button
                onClick={() => setCurrentStep(4)}
                className={`flex items-center gap-3 min-w-max text-left transition-all ${
                  currentStep === 4 ? 'bg-surface-container-high px-3 py-1.5 rounded-lg shadow-sm' : currentStep > 4 ? '' : 'opacity-60'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-label-md text-xs ${
                  currentStep > 4
                    ? 'bg-telemetry-emerald text-on-primary'
                    : currentStep === 4
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-surface-container text-secondary'
                }`}>
                  {currentStep > 4 ? <span className="material-symbols-outlined text-[18px]">check</span> : <span>4</span>}
                </div>
                <div className="flex flex-col">
                  <span className="font-label-sm text-[10px] text-secondary uppercase tracking-widest">Step 04</span>
                  <span className="font-label-md text-xs sm:text-sm text-earth-charcoal">Validation & Quality Gates</span>
                </div>
              </button>

              <div className={`flex-1 h-0.5 mx-2 min-w-[28px] ${currentStep >= 5 ? 'bg-telemetry-emerald' : 'bg-surface-elevation'}`} />

              {/* Step 5: Commit to Lakehouse */}
              <button
                onClick={() => setCurrentStep(5)}
                className={`flex items-center gap-3 min-w-max text-left transition-all ${
                  currentStep === 5 ? 'bg-surface-container-high px-3 py-1.5 rounded-lg shadow-sm' : 'opacity-60'
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-label-md text-xs ${
                  currentStep === 5 ? 'bg-telemetry-emerald text-on-primary' : 'bg-surface-container text-secondary'
                }`}>
                  <span>5</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-label-sm text-[10px] text-secondary uppercase tracking-widest">Step 05</span>
                  <span className="font-label-md text-xs sm:text-sm text-earth-charcoal">Commit to Lakehouse</span>
                </div>
              </button>
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────────────
              Domain Context & File Ingest Header Card
              ──────────────────────────────────────────────────────────────── */}
          <div className="bg-surface-parchment rounded-xl p-6 shadow-sm border border-earth-border/40">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              {/* Left: Domain Selector & Details */}
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 bg-primary-container/15 text-primary-container font-label-sm text-xs rounded uppercase tracking-wider font-semibold">
                    Crucible Lakehouse Ingest Pipeline
                  </span>
                  <span className="font-body-sm text-xs text-secondary font-mono">ID: INGEST-KN-2025-0892</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="font-label-sm text-xs text-secondary uppercase tracking-wider mr-1">
                    Target Domain:
                  </span>
                  {[
                    { id: 'production', label: 'Production & Blast Telemetry', icon: 'flare' },
                    { id: 'equipment', label: 'Equipment Telemetry', icon: 'construction' },
                    { id: 'exploration', label: 'Exploration GIS', icon: 'explore' },
                    { id: 'scada', label: 'Process Plant SCADA', icon: 'precision_manufacturing' },
                  ].map((dom) => {
                    const active = selectedDomain === dom.id;
                    return (
                      <button
                        key={dom.id}
                        onClick={() => {
                          setSelectedDomain(dom.id);
                          showToast(`Domain switched to: ${dom.label}`);
                        }}
                        className={`px-3 py-1.5 rounded font-label-md text-xs transition-colors flex items-center gap-1.5 ${
                          active
                            ? 'bg-earth-charcoal text-canvas-sandstone shadow-sm'
                            : 'bg-surface-container hover:bg-surface-container-high text-earth-charcoal'
                        }`}
                      >
                        {dom.icon && (
                          <span
                            className={`material-symbols-outlined text-[15px] ${
                              active ? 'text-copper-accent' : 'text-secondary'
                            }`}
                          >
                            {dom.icon}
                          </span>
                        )}
                        {dom.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right: Ingested File Details Pill */}
              <div className="bg-surface-container-low rounded-lg p-4 flex items-center gap-4 shadow-sm border border-earth-border/40">
                <div className="w-12 h-12 rounded-lg bg-surface-elevation flex items-center justify-center text-primary-container shadow-inner">
                  <span className="material-symbols-outlined text-[28px]">dataset</span>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-label-md text-xs sm:text-sm text-earth-charcoal font-bold truncate max-w-[280px]">
                      {fileName}
                    </span>
                    <span className="px-1.5 py-0.5 bg-telemetry-emerald/15 text-telemetry-emerald rounded font-label-sm text-[10px] font-semibold uppercase">
                      PARQUET v2
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-secondary font-body-sm text-xs mt-1">
                    <span>
                      Size: <strong className="text-earth-charcoal font-medium">{fileSize}</strong>
                    </span>
                    <span className="inline-block w-1 h-1 rounded-full bg-secondary" />
                    <span>
                      Payload: <strong className="text-earth-charcoal font-medium">{rowCount} rows</strong>
                    </span>
                    <span className="inline-block w-1 h-1 rounded-full bg-secondary" />
                    <span>
                      Cols: <strong className="text-earth-charcoal font-medium">{showFullMatrix ? 18 : 5} metrics</strong>
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="ml-auto p-2 rounded bg-surface-container hover:bg-surface-container-high text-earth-charcoal transition-colors"
                  title="Upload / Replace File"
                >
                  <span className="material-symbols-outlined text-[20px]">upload_file</span>
                </button>
              </div>
            </div>
          </div>

          {/* ────────────────────────────────────────────────────────────────
              Conditional Step Views: Step 1 (Domain), Step 2 (Upload), Step 4 (Quality), Step 5 (Commit)
              ──────────────────────────────────────────────────────────────── */}
          {currentStep === 1 && (
            <div className="bg-surface-parchment rounded-xl p-8 border border-earth-border/40 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-headline-sm text-xl text-earth-charcoal">Step 01 — Target Mine Domain Selection</h2>
                  <p className="text-sm text-secondary mt-1">Select the operational domain for automated lakehouse partitioning and schema validation.</p>
                </div>
                <span className="px-3 py-1 rounded bg-copper-accent/15 text-copper-accent font-label-sm text-xs font-bold uppercase">Kansanshi Pit North</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { id: 'production', title: 'Production & Blast', icon: 'flare', desc: 'Fragment size (P80), powder factor, burden spacing, and muckpile distribution.', records: '1.2M rows' },
                  { id: 'equipment', title: 'Equipment Telemetry', icon: 'construction', desc: 'Komatsu 930E haul trucks, CAT shovels, hydraulic temps, bearing vibration.', records: '4.8M rows' },
                  { id: 'exploration', title: 'Exploration GIS', icon: 'explore', desc: 'Hyperspectral core logs, borehole geochemistry, assays, and geological faulting.', records: '640k rows' },
                  { id: 'scada', title: 'Process Plant SCADA', icon: 'precision_manufacturing', desc: 'SAG mill power, cyclone pressure, flotation recovery, tailings density.', records: '8.1M rows' },
                ].map(d => (
                  <div
                    key={d.id}
                    onClick={() => { setSelectedDomain(d.id); setCurrentStep(2); showToast(`Selected domain: ${d.title}`); }}
                    className={`p-5 rounded-xl border cursor-pointer transition-all ${
                      selectedDomain === d.id
                        ? 'border-primary-container bg-surface-container ring-2 ring-primary-container/20'
                        : 'border-earth-border/60 bg-surface-container-low hover:bg-surface-container'
                    }`}
                  >
                    <span className="material-symbols-outlined text-copper-accent text-3xl mb-2">{d.icon}</span>
                    <h3 className="font-headline-sm text-base text-earth-charcoal font-bold">{d.title}</h3>
                    <p className="text-xs text-secondary mt-1.5 leading-relaxed">{d.desc}</p>
                    <div className="mt-4 pt-3 border-t border-earth-border/40 flex items-center justify-between text-[11px] text-secondary">
                      <span>Partition: <code>/raw/{d.id}/</code></span>
                      <span className="font-bold text-copper-accent">{d.records}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`bg-surface-parchment rounded-xl p-10 border-2 border-dashed transition-all text-center shadow-sm ${
                dragging ? 'border-primary-container bg-primary-container/5' : 'border-earth-border'
              }`}
            >
              <div className="max-w-md mx-auto space-y-4">
                <div className="w-16 h-16 mx-auto rounded-full bg-surface-container flex items-center justify-center text-primary-container">
                  <span className="material-symbols-outlined text-4xl">cloud_upload</span>
                </div>
                <h2 className="font-headline-sm text-xl text-earth-charcoal font-bold">Upload Source Mining Telemetry</h2>
                <p className="text-sm text-secondary">
                  Drag and drop your Parquet, CSV, or LAS files here, or browse local disk. AI schema inspection triggers automatically upon drop.
                </p>
                <div className="pt-2 flex items-center justify-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-6 py-2.5 rounded bg-primary-container hover:bg-tertiary text-on-primary font-label-md text-sm font-semibold shadow-sm transition-all"
                  >
                    Browse Files
                  </button>
                  <button
                    onClick={() => { setCurrentStep(3); showToast('Using sample Kansanshi Parquet dataset'); }}
                    className="px-6 py-2.5 rounded bg-surface-container hover:bg-surface-container-high text-earth-charcoal font-label-md text-sm transition-colors"
                  >
                    Load Sample Blast Parquet
                  </button>
                </div>
                <p className="text-[11px] text-secondary pt-2">Supported formats: Apache Parquet (v1/v2), CSV, GeoJSON, LAS v2/v3, Arrow IPC</p>
              </div>
            </div>
          )}

          {/* ────────────────────────────────────────────────────────────────
              Main Workspace Split: Table (8 cols) + Profiling/Quality Hub (4 cols)
              Shown on Step 3, Step 4, Step 5
              ──────────────────────────────────────────────────────────────── */}
          {(currentStep >= 3 || currentStep <= 5) && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
              
              {/* ────────────────────────────────────────────────────────────
                  AI Schema Auto-Mapping Table Card (XL: 8-cols)
                  ──────────────────────────────────────────────────────────── */}
              <div className="xl:col-span-8 bg-surface-parchment rounded-xl shadow-sm overflow-hidden flex flex-col border border-earth-border/40">
                
                {/* Table Control Header */}
                <div className="px-6 py-4 bg-surface-container-high flex flex-wrap items-center justify-between gap-3 border-b border-earth-border/40">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-primary-container" />
                    <h2 className="font-headline-sm text-base sm:text-lg text-earth-charcoal tracking-tight font-bold">
                      AI Neural Schema Matcher
                    </h2>
                    <span className="px-2 py-0.5 rounded bg-surface-elevation text-secondary font-label-sm text-[11px] uppercase font-semibold">
                      Model: CoreScan-v4.1
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-body-sm text-xs text-secondary mr-1">
                      {columns.filter((c) => c.status === 'auto').length} of {columns.length} auto-locked (96.2% avg confidence)
                    </span>
                    <button
                      onClick={handleReindex}
                      disabled={isReindexing}
                      className="px-3 py-1.5 bg-surface-elevation hover:bg-surface-container text-earth-charcoal rounded font-label-md text-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <span className={`material-symbols-outlined text-[16px] ${isReindexing ? 'animate-spin' : ''}`}>
                        {isReindexing ? 'refresh' : 'auto_fix_high'}
                      </span>
                      {isReindexing ? 'Re-indexing...' : 'Re-index AI'}
                    </button>
                  </div>
                </div>

                {/* Schema Mapping Data Ledger */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-surface-elevation text-earth-charcoal font-label-sm text-xs uppercase tracking-wider">
                        <th className="py-3 px-4">Raw Source Column</th>
                        <th className="py-3 px-2 text-center w-8" />
                        <th className="py-3 px-4">Canonical Lakehouse Field</th>
                        <th className="py-3 px-4">Target Type</th>
                        <th className="py-3 px-4">Match Confidence</th>
                        <th className="py-3 px-4 text-right">Mapping Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-earth-border/30 text-earth-charcoal font-body-sm text-sm">
                      {allColumns.map((col, idx) => {
                        const isEven = idx % 2 === 0;
                        return (
                          <tr
                            key={col.id}
                            className={`transition-colors ${
                              isEven ? 'bg-surface-parchment' : 'bg-canvas-sandstone'
                            } hover:bg-surface-container`}
                          >
                            {/* Raw Source Column */}
                            <td className="py-3.5 px-4 font-mono text-earth-espresso font-medium text-xs sm:text-sm">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`material-symbols-outlined text-[16px] ${
                                    col.status === 'review' ? 'text-telemetry-amber' : 'text-secondary'
                                  }`}
                                >
                                  {col.sourceIcon}
                                </span>
                                {col.sourceCol}
                              </div>
                            </td>

                            {/* Arrow indicator */}
                            <td className="py-3.5 px-2 text-center text-outline">
                              <span
                                className={`material-symbols-outlined text-[16px] ${
                                  col.status === 'review' ? 'text-telemetry-amber' : 'text-outline'
                                }`}
                              >
                                east
                              </span>
                            </td>

                            {/* Canonical Lakehouse Field */}
                            <td className="py-3.5 px-4">
                              {col.options ? (
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-telemetry-amber shrink-0" />
                                  <select
                                    value={col.canonicalField}
                                    onChange={(e) => updateMapping(col.id, e.target.value)}
                                    className="bg-surface-elevation text-earth-charcoal font-semibold text-xs px-2.5 py-1 rounded outline-none cursor-pointer border border-earth-border/60 hover:bg-surface-container"
                                  >
                                    {col.options.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 font-semibold text-earth-charcoal text-xs sm:text-sm">
                                  <span className="w-2 h-2 rounded-full bg-telemetry-emerald shrink-0" />
                                  {col.canonicalField}
                                </div>
                              )}
                            </td>

                            {/* Target Type */}
                            <td className="py-3.5 px-4">
                              <span className="px-2 py-0.5 rounded bg-surface-container font-mono text-xs font-semibold text-secondary">
                                {col.targetType}
                              </span>
                            </td>

                            {/* Match Confidence */}
                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2">
                                <div className="w-20 bg-surface-elevation h-1.5 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      col.confidence >= 95 ? 'bg-telemetry-emerald' : 'bg-telemetry-amber'
                                    }`}
                                    style={{ width: `${col.confidence}%` }}
                                  />
                                </div>
                                <span
                                  className={`font-label-sm text-xs font-semibold ${
                                    col.confidence >= 95 ? 'text-telemetry-emerald' : 'text-telemetry-amber'
                                  }`}
                                >
                                  {col.confidence}%
                                </span>
                              </div>
                            </td>

                            {/* Mapping Status */}
                            <td className="py-3.5 px-4 text-right">
                              {col.status === 'review' ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-telemetry-amber/20 text-telemetry-amber font-label-sm text-xs font-semibold">
                                  <span className="material-symbols-outlined text-[14px]">tune</span> Review Needed
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-telemetry-emerald/15 text-telemetry-emerald font-label-sm text-xs font-semibold">
                                  <span className="material-symbols-outlined text-[14px]">lock</span> Auto-Mapped
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Table Sub-Bar: Unmapped/Ignored Counter & Actions */}
                <div className="p-4 bg-surface-container-high flex flex-wrap items-center justify-between gap-2 border-t border-earth-border/40">
                  <div className="flex items-center gap-2 text-secondary font-body-sm text-xs sm:text-sm">
                    <span className="material-symbols-outlined text-[18px]">info</span>
                    <span>
                      {showFullMatrix
                        ? 'All 18 canonical Lakehouse attributes mapped and validated.'
                        : '13 additional columns automatically assigned via Kansanshi Blast Ontology ruleset.'}
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setShowFullMatrix((prev) => !prev);
                      showToast(showFullMatrix ? 'Collapsed to primary metrics' : 'Expanded full 18-attribute matrix');
                    }}
                    className="font-label-md text-xs sm:text-sm text-primary-container font-semibold hover:underline flex items-center gap-1"
                  >
                    {showFullMatrix ? 'Show primary 5 metrics' : 'View full 18-attribute matrix'}
                    <span className="material-symbols-outlined text-[16px]">
                      {showFullMatrix ? 'unfold_less' : 'open_in_new'}
                    </span>
                  </button>
                </div>
              </div>

              {/* ────────────────────────────────────────────────────────────
                  Right Column: Profiling & Quality Gates (XL: 4-cols)
                  ──────────────────────────────────────────────────────────── */}
              <div className="xl:col-span-4 space-y-4">
                
                {/* Live Profiling Stats Bento Card */}
                <div className="bg-surface-parchment rounded-xl p-5 shadow-sm space-y-4 border border-earth-border/40">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-copper-accent text-[20px]">analytics</span>
                      <h3 className="font-headline-sm text-base text-earth-charcoal font-bold">Data Profiling Audit</h3>
                    </div>
                    <span className="font-label-sm text-[11px] px-2 py-0.5 rounded bg-telemetry-emerald/20 text-telemetry-emerald font-semibold uppercase">
                      Nominal Gate
                    </span>
                  </div>

                  {/* Micro Metric Bento */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-surface-container-low p-3.5 rounded-lg border border-earth-border/30">
                      <div className="font-label-sm text-[10px] text-secondary uppercase tracking-wider">Completeness</div>
                      <div className="font-headline-md text-xl sm:text-2xl text-earth-charcoal font-bold mt-1">99.4%</div>
                      <div className="w-full bg-surface-elevation h-1 rounded mt-2 overflow-hidden">
                        <div className="bg-telemetry-emerald h-1 rounded" style={{ width: '99.4%' }} />
                      </div>
                    </div>
                    <div className="bg-surface-container-low p-3.5 rounded-lg border border-earth-border/30">
                      <div className="font-label-sm text-[10px] text-secondary uppercase tracking-wider">Null Density</div>
                      <div className="font-headline-md text-xl sm:text-2xl text-earth-charcoal font-bold mt-1">0.02%</div>
                      <div className="w-full bg-surface-elevation h-1 rounded mt-2 overflow-hidden">
                        <div className="bg-telemetry-emerald h-1 rounded" style={{ width: '2%' }} />
                      </div>
                    </div>
                  </div>

                  {/* Inline Distribution Sparkline Visualizer */}
                  <div className="bg-surface-container-low p-3.5 rounded-lg space-y-2 border border-earth-border/30">
                    <div className="flex justify-between items-center text-secondary font-label-sm text-xs">
                      <span className="font-semibold text-earth-charcoal">Fragmentation Particle Distribution (P80)</span>
                      <span className="text-earth-charcoal font-mono">μ = 24.3 cm</span>
                    </div>

                    {/* Custom Inline SVG Distribution Histogram */}
                    <svg className="w-full h-16 text-primary-container" fill="none" viewBox="0 0 280 60">
                      <rect fill="currentColor" fillOpacity="0.25" height="12" rx="1" width="16" x="0" y="48" />
                      <rect fill="currentColor" fillOpacity="0.35" height="20" rx="1" width="16" x="20" y="40" />
                      <rect fill="currentColor" fillOpacity="0.45" height="28" rx="1" width="16" x="40" y="32" />
                      <rect fill="currentColor" fillOpacity="0.6" height="38" rx="1" width="16" x="60" y="22" />
                      <rect fill="currentColor" fillOpacity="0.8" height="46" rx="1" width="16" x="80" y="14" />
                      <rect fill="currentColor" fillOpacity="1" height="56" rx="1" width="16" x="100" y="4" />
                      <rect fill="currentColor" fillOpacity="0.85" height="50" rx="1" width="16" x="120" y="10" />
                      <rect fill="currentColor" fillOpacity="0.65" height="40" rx="1" width="16" x="140" y="20" />
                      <rect fill="currentColor" fillOpacity="0.5" height="30" rx="1" width="16" x="160" y="30" />
                      <rect fill="currentColor" fillOpacity="0.4" height="22" rx="1" width="16" x="180" y="38" />
                      <rect fill="currentColor" fillOpacity="0.3" height="15" rx="1" width="16" x="200" y="45" />
                      <rect fill="currentColor" fillOpacity="0.2" height="10" rx="1" width="16" x="220" y="50" />
                      <rect fill="currentColor" fillOpacity="0.2" height="8" rx="1" width="16" x="240" y="52" />
                      <rect fill="#A63A2A" fillOpacity="0.85" height="14" rx="1" width="16" x="260" y="46" />
                    </svg>

                    <div className="flex justify-between items-center text-[10px] text-secondary font-mono">
                      <span>0 cm</span>
                      <span>15 cm</span>
                      <span>30 cm</span>
                      <span className="text-telemetry-crimson font-bold">Outliers (&gt;55cm)</span>
                    </div>
                  </div>

                  {/* Anomaly Notification Card */}
                  <div className="bg-surface-container p-3.5 rounded-lg flex items-start gap-3 border border-earth-border/40">
                    <span className="material-symbols-outlined text-telemetry-crimson text-[20px] shrink-0 mt-0.5">
                      warning
                    </span>
                    <div className="space-y-1 text-xs leading-relaxed">
                      <div className="font-label-md text-earth-charcoal font-bold flex items-center justify-between">
                        <span>3 Out-of-Bound Sensor Outliers</span>
                        {imputationApplied && (
                          <span className="text-[10px] text-telemetry-emerald bg-telemetry-emerald/10 px-1.5 py-0.5 rounded font-bold">
                            Imputed
                          </span>
                        )}
                      </div>
                      <p className="font-body-sm text-secondary">
                        Rows #14,022, #55,108, and #98,340 recorded fragmentation values exceeding the physical blast face maximum envelope (58.4 cm).
                      </p>
                      <button
                        onClick={() => {
                          setImputationApplied(true);
                          showToast('Applied median spline auto-imputation to rows #14,022, #55,108, #98,340');
                        }}
                        disabled={imputationApplied}
                        className="mt-1 text-copper-accent font-semibold text-xs hover:underline flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <span className="material-symbols-outlined text-[14px]">auto_fix_normal</span>
                        {imputationApplied ? 'Auto-Imputation Applied' : 'Apply AI Auto-Imputation'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Validation Quality Checklist */}
                <div className="bg-surface-parchment rounded-xl p-5 shadow-sm space-y-3 border border-earth-border/40">
                  <div className="flex items-center justify-between pb-1">
                    <h4 className="font-headline-sm text-sm sm:text-base text-earth-charcoal font-bold">Pre-Ingest Checks</h4>
                    <span className="font-label-sm text-xs text-copper-accent font-bold uppercase tracking-wider">
                      3 of 3 Passed
                    </span>
                  </div>
                  <div className="space-y-2">
                    {/* Passed item 1 */}
                    <div className="p-3 rounded bg-surface-container-low flex items-center justify-between border border-earth-border/30">
                      <div className="flex items-center gap-2.5">
                        <span className="material-symbols-outlined text-telemetry-emerald text-[18px]">verified</span>
                        <span className="font-body-sm text-xs sm:text-sm text-earth-charcoal font-medium">
                          Passed Schema Structural Test
                        </span>
                      </div>
                      <span className="font-label-sm text-xs text-secondary font-mono">Parquet-v2</span>
                    </div>
                    {/* Passed item 2 */}
                    <div className="p-3 rounded bg-surface-container-low flex items-center justify-between border border-earth-border/30">
                      <div className="flex items-center gap-2.5">
                        <span className="material-symbols-outlined text-telemetry-emerald text-[18px]">verified</span>
                        <span className="font-body-sm text-xs sm:text-sm text-earth-charcoal font-medium">
                          Kansanshi Geofence Boundary
                        </span>
                      </div>
                      <span className="font-label-sm text-xs text-secondary font-mono">EPSG:32735</span>
                    </div>
                    {/* Passed item 3 */}
                    <div className="p-3 rounded bg-surface-container-low flex items-center justify-between border border-earth-border/30">
                      <div className="flex items-center gap-2.5">
                        <span className="material-symbols-outlined text-telemetry-emerald text-[18px]">verified</span>
                        <span className="font-body-sm text-xs sm:text-sm text-earth-charcoal font-medium">
                          Unit Normalization Standard
                        </span>
                      </div>
                      <span className="font-label-sm text-xs text-secondary font-mono">Metric (SI)</span>
                    </div>
                  </div>
                </div>

                {/* Contextual Geologic Sample Imagery Card */}
                <div className="bg-surface-parchment rounded-xl overflow-hidden shadow-sm border border-earth-border/40">
                  <div className="relative h-32 w-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      className="w-full h-full object-cover"
                      alt="Close up photograph of geological rock fragmentation core sample"
                      src="https://lh3.googleusercontent.com/aida-public/AB6AXuAsSMWXGix3w32miYgW_ni0WbLWKtP6MCKqfD_xdVJtmX8zSQV3V98SCX0gO4suo0kd_KHMGaGopk0MAnCSrJiWDspch_jIEYdjsnspW7V639uVS-oPQkWye0hlZdMLDU4B6X3T1CilScXPsSPhi3JpPmKaLUleYgeO-D0mqRKyrxz6fV83t1kXdUBxrjWcBtbH-KCYjIXrMi40NSh2mMZZlJwdbUBOk8cYNbvObLi3ebFAEbDwagyy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-earth-charcoal/90 via-earth-charcoal/40 to-transparent flex flex-col justify-end p-3">
                      <span className="font-label-sm text-[10px] text-tertiary-fixed uppercase font-semibold">
                        Active Pit Domain Reference
                      </span>
                      <span className="font-headline-sm text-xs sm:text-sm text-canvas-sandstone font-bold">
                        Bench 14 - Sulphide Ore Zone
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* ────────────────────────────────────────────────────────────────
              Wizard Sticky Bottom Execution Bar
              ──────────────────────────────────────────────────────────────── */}
          <div className="bg-surface-parchment rounded-xl p-4 shadow-md flex flex-col sm:flex-row items-center justify-between gap-4 border border-earth-border/40">
            {/* Back / Diagnostic Buttons */}
            <div className="flex items-center gap-2.5 w-full sm:w-auto">
              <button
                onClick={() => {
                  if (currentStep > 1) {
                    setCurrentStep((prev) => (prev - 1) as StepId);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                className="px-4 py-2.5 rounded bg-surface-container hover:bg-surface-container-high text-earth-charcoal font-label-md text-xs sm:text-sm transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                Back: Change File
              </button>

              <button
                onClick={handleDownloadReport}
                className="px-4 py-2.5 rounded bg-surface-elevation hover:bg-surface-container text-earth-charcoal font-label-md text-xs sm:text-sm transition-colors flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                Download Schema Report (.json)
              </button>
            </div>

            {/* Right Primary Progression CTA */}
            <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
              <div className="hidden md:flex flex-col text-right">
                <span className="font-label-sm text-xs text-secondary uppercase font-semibold">
                  {currentStep === 4 ? 'Ready for Step 5' : currentStep === 5 ? 'Pipeline Complete' : 'Ready for Step 4'}
                </span>
                <span className="font-body-sm text-xs text-earth-charcoal">
                  {rowCount} records queued for pipeline ingestion
                </span>
              </div>

              {currentStep <= 3 && (
                <button
                  onClick={handleValidate}
                  disabled={isValidating}
                  className="w-full sm:w-auto px-6 py-3 rounded bg-primary-container hover:bg-tertiary text-on-primary font-label-lg text-sm font-semibold transition-all shadow-md flex items-center justify-center gap-2 group disabled:opacity-80"
                >
                  {isValidating ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                      <span>Executing Crucible Quality Gates...</span>
                    </>
                  ) : (
                    <>
                      <span>Validate & Run Quality Checks</span>
                      <span className="material-symbols-outlined text-[18px] group-hover:translate-x-1 transition-transform">
                        arrow_forward
                      </span>
                    </>
                  )}
                </button>
              )}

              {currentStep === 4 && (
                <button
                  onClick={handleCommit}
                  className="w-full sm:w-auto px-6 py-3 rounded bg-telemetry-emerald hover:opacity-90 text-on-primary font-label-lg text-sm font-semibold transition-all shadow-md flex items-center justify-center gap-2 group"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>Commit to Lakehouse</span>
                </button>
              )}

              {currentStep === 5 && (
                <button
                  onClick={() => {
                    setCurrentStep(3);
                    showToast('Ready for subsequent ingestion batch');
                  }}
                  className="w-full sm:w-auto px-6 py-3 rounded bg-earth-charcoal text-canvas-sandstone font-label-lg text-sm font-semibold transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-[18px]">restart_alt</span>
                  <span>Ingest Another Dataset</span>
                </button>
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}