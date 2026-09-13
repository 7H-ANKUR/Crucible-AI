'use client';

/**
 * /data-hub — MINEx Data Hub Upload Wizard
 *
 * Multi-step flow:
 *   Step 1: Choose Domain
 *   Step 2: Upload File (drag & drop)
 *   Step 3: Schema Analysis (review & correct column mappings)
 *   Step 4: Validation Report
 *   Step 5: Version Created + Approve CTA
 */
import React, { useState, useRef } from 'react';
import { useMinexAuth } from '@/lib/roles';
import { getToken as getCentralToken } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const DOMAINS = [
  { id: 'production',  label: 'Production',   icon: 'factory',                 desc: 'Shift output, planned vs actual, grade' },
  { id: 'equipment',   label: 'Equipment',    icon: 'precision_manufacturing', desc: 'Telemetry, wear indicators, failure flags' },
  { id: 'exploration', label: 'Exploration',  icon: 'my_location',             desc: 'Grid prospectivity, geochemistry, remote sensing' },
  { id: 'maintenance', label: 'Maintenance',  icon: 'build',                   desc: 'Maintenance events, downtime, cost' },
];

type Step = 'domain' | 'upload' | 'mapping' | 'validation' | 'done';

interface ColumnMapping {
  source_column: string;
  canonical_column: string | null;
  confidence: number;
  requires_review: boolean;
  reason: string;
}

interface UploadResult {
  version_id: number;
  dataset_id: number;
  domain: string;
  version_tag: string;
  parent_version_id?: number | null;
  drive_file_id?: string;
  checksum_sha256?: string;
  file_size_bytes?: number;
  status: string;
  source_columns: string[];
  column_mappings: ColumnMapping[];
  unresolved_count: number;
}

interface ValidationCheck {
  check_id: string;
  name: string;
  category?: string;
  passed: boolean;
  severity: string;
  message: string;
  affected_count: number;
  affected_pct: number;
}

interface ValidationResult {
  version_id: number;
  status: string;
  quality_score: number;
  passed: boolean;
  summary: string;
  row_count: number;
  canonical_drive_file_id?: string;
  canonical_checksum_sha256?: string;
  canonical_row_count?: number;
  checks: ValidationCheck[];
}

export default function DataHubPage() {
  useMinexAuth();
  const [step, setStep] = useState<Step>('domain');
  const [domain, setDomain] = useState('');
  const [datasetName, setDatasetName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [editedMappings, setEditedMappings] = useState<Record<string, string>>({});
  const [domainCanonicalCols, setDomainCanonicalCols] = useState<string[]>([]);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [, setApproved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const getAuthHeaders = (): Record<string, string> => {
    const token = getCentralToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return {};
  };

  // ── Step 1: Domain ──────────────────────────────────────────
  const handleDomainSelect = async (d: string) => {
    setDomain(d);
    setDatasetName('');
    setFile(null);
    setError('');

    // Fetch canonical columns for this domain
    try {
      const res = await fetch(`${API}/api/v1/data/domains`);
      if (res.ok) {
        const data = await res.json();
        const cols = data.domains?.[d]?.all_columns?.map((c: any) => c.name) || [];
        setDomainCanonicalCols(cols);
      }
    } catch {
      // Non-critical fallback
    }

    setStep('upload');
  };

  // ── Step 2: Upload ──────────────────────────────────────────
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const handleUpload = async () => {
    if (!file || !datasetName.trim()) {
      setError('Please choose a file and enter a dataset name.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('domain', domain);
      fd.append('name', datasetName);
      fd.append('description', '');
      fd.append('file', file);

      const res = await fetch(`${API}/api/v1/data/upload`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: fd,
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Upload failed'); }
      const data: UploadResult = await res.json();
      setUploadResult(data);
      // Pre-populate editedMappings from auto-map
      const init: Record<string, string> = {};
      data.column_mappings.forEach(m => { if (m.canonical_column) init[m.source_column] = m.canonical_column; });
      setEditedMappings(init);
      setStep('mapping');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 3: Apply mappings + Validate ───────────────────────
  const handleValidate = async () => {
    if (!uploadResult) return;
    setLoading(true);
    setError('');
    try {
      // Save mappings
      const mappings = Object.entries(editedMappings).map(([src, can]) => ({
        source_column: src,
        canonical_column: can || null,
      }));
      const mapRes = await fetch(`${API}/api/v1/data/versions/${uploadResult.version_id}/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ mappings }),
      });
      if (!mapRes.ok) { const e = await mapRes.json(); throw new Error(e.detail || 'Mapping failed'); }

      // Run validation
      const valRes = await fetch(`${API}/api/v1/data/versions/${uploadResult.version_id}/validate`, {
        method: 'POST',
        headers: getAuthHeaders(),
      });
      if (!valRes.ok) { const e = await valRes.json(); throw new Error(e.detail || 'Validation failed'); }
      const valData: ValidationResult = await valRes.json();
      setValidationResult(valData);
      setStep('validation');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 4 → 5: Approve ────────────────────────────────────
  const handleApprove = async () => {
    if (!uploadResult) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/v1/data/versions/${uploadResult.version_id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ note: 'Approved via Data Hub UI' }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Approval failed'); }
      setApproved(true);
      setStep('done');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Progress indicator ──────────────────────────────────────
  const STEPS = ['domain', 'upload', 'mapping', 'validation', 'done'];
  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="flex flex-col gap-6 px-6 py-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="w-11 h-11 rounded-2xl bg-accentt/10 border border-accentt/20 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-accentt text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>cloud_upload</span>
        </div>
        <div>
          <h1 className="font-['Manrope'] text-2xl font-black text-ink tracking-tight">Data Hub</h1>
          <p className="text-xs text-ink2">Upload → Validate → Version → Approve for Training</p>
        </div>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-1">
        {['Domain', 'Upload', 'Mapping', 'Validate', 'Done'].map((label, i) => (
          <React.Fragment key={label}>
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all ${
              i === stepIdx ? 'bg-accentt text-deep' : i < stepIdx ? 'bg-ok/20 text-okt' : 'bg-panel3/50 text-ink3'
            }`}>
              {i < stepIdx && <span className="material-symbols-outlined !text-[14px]">check</span>}
              {label}
            </div>
            {i < 4 && <div className={`flex-1 h-px ${i < stepIdx ? 'bg-ok/40' : 'bg-line2/40'}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-danger/10 border border-danger/30 text-dangert rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <span className="material-symbols-outlined !text-[18px]">error</span>
          {error}
        </div>
      )}

      {/* ── Step 1: Domain ── */}
      {step === 'domain' && (
        <div className="bg-panel2/60 border border-line2/40 rounded-2xl p-6 flex flex-col gap-4">
          <div className="text-xs font-black tracking-widest text-ink3 uppercase">1 — Choose Domain</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DOMAINS.map(d => (
              <button key={d.id} onClick={() => handleDomainSelect(d.id)}
                className="flex items-start gap-3 p-4 rounded-xl bg-panel3/50 border border-line2/40 hover:border-accentt/40 hover:bg-panel3 transition-all text-left group">
                <span className="material-symbols-outlined text-accentt text-xl mt-0.5">{d.icon}</span>
                <div>
                  <div className="font-bold text-sm text-ink group-hover:text-accentt transition-colors">{d.label}</div>
                  <div className="text-[11px] text-ink3 mt-0.5">{d.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 2: Upload ── */}
      {step === 'upload' && (
        <div className="bg-panel2/60 border border-line2/40 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <div className="text-xs font-black tracking-widest text-ink3 uppercase">2 — Upload File</div>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full bg-accentt/10 text-accentt`}>{domain}</span>
            <button onClick={() => setStep('domain')} className="ml-auto text-xs text-ink3 hover:text-ink transition-colors">← Change domain</button>
          </div>

          {/* Dataset name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-ink2">Dataset Name</label>
            <input
              value={datasetName}
              onChange={e => setDatasetName(e.target.value)}
              placeholder="e.g. Nagpur Mine — Aug 2026"
              className="bg-panel3/50 border border-line2/40 rounded-xl px-4 py-2.5 text-sm text-ink placeholder:text-ink3 focus:outline-none focus:border-accentt/50 transition-colors"
            />
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleFileDrop}
            onClick={() => fileRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 py-10 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
              dragging ? 'border-accentt bg-accentt/5' : 'border-line2/60 hover:border-accentt/40 hover:bg-panel3/30'
            }`}
          >
            <span className="material-symbols-outlined text-ink2 text-4xl">{file ? 'description' : 'cloud_upload'}</span>
            {file ? (
              <div className="text-center">
                <div className="text-sm font-bold text-ink">{file.name}</div>
                <div className="text-xs text-ink3">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <div className="text-center">
                <div className="text-sm font-semibold text-ink2">Drop your CSV or XLSX here</div>
                <div className="text-xs text-ink3">or click to browse</div>
              </div>
            )}
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
          </div>

          <button onClick={handleUpload} disabled={loading || !file || !datasetName.trim()}
            className="w-full py-3 rounded-xl bg-accentt text-deep font-bold text-sm hover:bg-accentt/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
            {loading ? <><span className="animate-spin material-symbols-outlined !text-[18px]">refresh</span> Uploading...</>
              : <><span className="material-symbols-outlined !text-[18px]">upload</span> Upload & Auto-Map</>}
          </button>
        </div>
      )}

      {/* ── Step 3: Mapping ── */}
      {step === 'mapping' && uploadResult && (
        <div className="bg-panel2/60 border border-line2/40 rounded-2xl p-6 flex flex-col gap-5">
          <div className="flex items-center gap-2">
            <div className="text-xs font-black tracking-widest text-ink3 uppercase">3 — Schema Mapping</div>
            {uploadResult.unresolved_count > 0 && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-warn/20 text-warnt border border-warn/30">
                {uploadResult.unresolved_count} need review
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            {uploadResult.column_mappings.map(m => {
              // Collect all canonical column names from domain schema and auto-mapping
              const canonicalOptions = Array.from(new Set([
                ...domainCanonicalCols,
                ...(uploadResult.column_mappings.map(x => x.canonical_column).filter(Boolean) as string[])
              ])).sort();
              return (
              <div key={m.source_column} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${
                m.requires_review ? 'border-warn/30 bg-warn/5' : 'border-line2/30 bg-panel3/30'
              }`}>
                <span className="text-xs font-mono text-ink2 w-36 shrink-0 truncate">{m.source_column}</span>
                <span className="material-symbols-outlined text-ink3 !text-[16px]">arrow_forward</span>
                <select
                  value={editedMappings[m.source_column] || ''}
                  onChange={e => setEditedMappings(prev => ({ ...prev, [m.source_column]: e.target.value }))}
                  className="flex-1 bg-panel3 border border-line2/40 rounded-lg px-2 py-1 text-xs text-ink focus:outline-none focus:border-accentt/50"
                >
                  <option value="">— unmatched —</option>
                  {canonicalOptions.map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                  m.confidence >= 0.9 ? 'bg-ok/20 text-okt' :
                  m.confidence >= 0.7 ? 'bg-accentt/10 text-accentt' :
                  'bg-warn/20 text-warnt'
                }`}>{Math.round(m.confidence * 100)}%</span>
              </div>
            );
            })}
          </div>

          <button onClick={handleValidate} disabled={loading}
            className="w-full py-3 rounded-xl bg-accentt text-deep font-bold text-sm hover:bg-accentt/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
            {loading ? <><span className="animate-spin material-symbols-outlined !text-[18px]">refresh</span> Running validation...</>
              : <><span className="material-symbols-outlined !text-[18px]">fact_check</span> Save Mappings & Validate</>}
          </button>
        </div>
      )}

      {/* ── Step 4: Validation ── */}
      {step === 'validation' && validationResult && (
        <div className="bg-panel2/60 border border-line2/40 rounded-2xl p-6 flex flex-col gap-5">
          <div className="text-xs font-black tracking-widest text-ink3 uppercase">4 — Validation Report</div>

          {/* Score card */}
          <div className="flex items-center gap-6 p-4 bg-panel3/50 rounded-xl border border-line2/30">
            <div className="text-center">
              <div className={`text-4xl font-black font-mono ${
                validationResult.quality_score >= 80 ? 'text-okt' :
                validationResult.quality_score >= 50 ? 'text-warnt' : 'text-dangert'
              }`}>{validationResult.quality_score}</div>
              <div className="text-[10px] text-ink3 uppercase tracking-wider">Quality Score</div>
            </div>
            <div className="flex-1">
              <div className={`text-sm font-bold mb-1 ${validationResult.passed ? 'text-okt' : 'text-dangert'}`}>
                {validationResult.passed ? 'PASSED — Ready for approval' : 'FAILED — Fix errors before approving'}
              </div>
              <div className="text-xs text-ink2">{validationResult.summary}</div>
              <div className="text-xs text-ink3 mt-0.5">{validationResult.row_count.toLocaleString()} rows</div>
            </div>
          </div>

          {/* Checks list */}
          <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
            {validationResult.checks.map(c => (
              <div key={c.check_id} className={`flex items-start gap-3 px-4 py-2.5 rounded-xl ${
                !c.passed && c.severity === 'error'   ? 'bg-danger/5  border border-danger/20' :
                !c.passed && c.severity === 'warning' ? 'bg-warn/5    border border-warn/20'   :
                'bg-panel3/30 border border-line2/20'
              }`}>
                <span className={`material-symbols-outlined !text-[16px] mt-0.5 shrink-0 ${
                  c.passed ? 'text-ok' : c.severity === 'error' ? 'text-danger' : 'text-warn'
                }`}>{c.passed ? 'check_circle' : c.severity === 'error' ? 'error' : 'warning'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-ink">{c.name}</div>
                  <div className="text-[11px] text-ink3">{c.message}</div>
                </div>
              </div>
            ))}
          </div>

          {validationResult.passed && (
            <button onClick={handleApprove} disabled={loading}
              className="w-full py-3 rounded-xl bg-ok text-deep font-bold text-sm hover:bg-ok/90 disabled:opacity-40 transition-all flex items-center justify-center gap-2">
              {loading ? <><span className="animate-spin material-symbols-outlined !text-[18px]">refresh</span> Approving...</>
                : <><span className="material-symbols-outlined !text-[18px]">verified</span> Approve for Training</>}
            </button>
          )}
        </div>
      )}

      {/* ── Step 5: Done ── */}
      {step === 'done' && (
        <div className="bg-ok/5 border border-ok/20 rounded-2xl p-8 flex flex-col items-center gap-4 text-center">
          <span className="material-symbols-outlined text-ok text-5xl" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
          <div>
            <div className="text-xl font-black text-ink">Dataset Version Approved</div>
            <div className="text-sm text-ink2 mt-1">
              Version <span className="font-mono font-bold text-accentt">#{uploadResult?.version_id}</span> is now approved for training.
            </div>
            <div className="text-xs text-ink3 mt-2">Go to Governance → Model Approval to trigger a training run once Phase 3 is complete.</div>
          </div>
          <button onClick={() => { setStep('domain'); setDomain(''); setFile(null); setUploadResult(null); setValidationResult(null); setApproved(false); setError(''); }}
            className="px-6 py-2.5 rounded-xl bg-accentt text-deep font-bold text-sm hover:bg-accentt/90 transition-all">
            Upload Another Dataset
          </button>
        </div>
      )}

      {/* SYNTHETIC badge */}
      <div className="flex items-center gap-2 text-xs text-ink3">
        <span className="w-2 h-2 rounded-full bg-accentt/60 animate-pulse shrink-0"></span>
        <span>DEMO MODE — Data Hub is live. Uploaded files stored locally. Training integration available in Phase 3.</span>
      </div>
    </div>
  );
}
