'use client';

/**
 * EnginePanel — Crucible AI engine status and telemetry, for pages that report on
 * platform health rather than operate the Lab.
 *
 * Kept separate from the Lab page because these two answer different questions:
 * the Lab asks "what did my run do", this asks "is the engine healthy and what
 * has it been doing". Both read through the same gateway bridge.
 */
import React from 'react';
import { useEngine, degradedMessage } from '@/lib/lab';

interface BridgeStatus {
  enabled: boolean;
  base_url: string;
  signed: boolean;
  circuit_state: string;
  calls: number;
  failures: number;
  short_circuits: number;
  last_error: string | null;
}

interface StatusResponse {
  engine_available: boolean;
  bridge: BridgeStatus;
  reason: string | null;
}

interface AuditEvent {
  event_id?: string;
  event_type?: string;
  timestamp?: string;
  execution_id?: string;
  message?: string;
}

const CIRCUIT_TONE: Record<string, string> = {
  CLOSED: 'text-ok',
  HALF_OPEN: 'text-warn',
  OPEN: 'text-bad',
  DISABLED: 'text-ink3',
};

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b border-line/40 last:border-0">
      <span className="text-[11px] text-ink3">{k}</span>
      <span className={`text-[11px] font-semibold text-right tabular-nums ${tone ?? 'text-ink'}`}>
        {v}
      </span>
    </div>
  );
}

/** Engine connection health plus bridge counters. */
export function EngineStatusPanel() {
  const { envelope, loading } = useEngine<never>('/status', { refreshMs: 30_000 });

  // /status returns its own shape rather than the standard envelope data field.
  const payload = envelope as unknown as StatusResponse | null;
  const bridge = payload?.bridge;
  const up = payload?.engine_available ?? null;

  return (
    <div className="glass-panel p-6 border border-frost/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-['Manrope'] text-lg font-bold text-accentt flex items-center gap-2">
          <span className="material-symbols-outlined">experiment</span>
          ML Engine
        </h3>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
            up === null
              ? 'bg-panel3 text-ink3 border-line'
              : up
                ? 'bg-ok/15 text-ok border-ok/30'
                : 'bg-warn/15 text-warn border-warn/30'
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${up ? 'bg-ok animate-pulse' : 'bg-current'}`} />
          {loading && up === null ? 'checking' : up ? 'online' : 'offline'}
        </span>
      </div>

      {up === false && payload?.reason && (
        <p className="text-[11px] text-warnt bg-warn/10 border border-warn/25 rounded-lg px-3 py-2 mb-3 leading-snug">
          {payload.reason}
        </p>
      )}

      {bridge ? (
        <div>
          <Row k="Endpoint" v={<span className="font-mono">{bridge.base_url}</span>} />
          <Row
            k="Request signing"
            v={bridge.signed ? 'enabled' : 'not configured'}
            tone={bridge.signed ? 'text-ok' : 'text-warn'}
          />
          <Row
            k="Circuit"
            v={bridge.circuit_state}
            tone={CIRCUIT_TONE[bridge.circuit_state] ?? 'text-ink'}
          />
          <Row k="Calls" v={bridge.calls.toLocaleString()} />
          <Row
            k="Failures"
            v={bridge.failures.toLocaleString()}
            tone={bridge.failures > 0 ? 'text-warn' : 'text-ink'}
          />
          <Row k="Paused calls" v={bridge.short_circuits.toLocaleString()} />
          {bridge.last_error && (
            <p className="text-[10px] text-ink3 mt-3 font-mono break-words leading-relaxed">
              {bridge.last_error}
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink3 py-4 text-center">
          {loading ? 'Checking engine…' : degradedMessage(envelope)}
        </p>
      )}
    </div>
  );
}

/** Recent engine audit events. */
export function EngineAuditPanel({ limit = 25 }: { limit?: number }) {
  const { data, envelope, loading } = useEngine<AuditEvent[] | { events?: AuditEvent[] }>(
    `/audit/events?limit=${limit}`
  );

  const events: AuditEvent[] = Array.isArray(data)
    ? data
    : Array.isArray((data as { events?: AuditEvent[] })?.events)
      ? ((data as { events?: AuditEvent[] }).events as AuditEvent[])
      : [];

  return (
    <div className="glass-panel p-6 border border-frost/10">
      <h3 className="font-['Manrope'] text-lg font-bold text-accentt flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined">receipt_long</span>
        Engine Audit Log
      </h3>

      {loading && !envelope ? (
        <p className="text-xs text-ink3 py-4 text-center">Loading…</p>
      ) : !envelope?.engine_available ? (
        <p className="text-xs text-ink3 py-4 text-center">{degradedMessage(envelope)}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-ink3 py-4 text-center">No engine events recorded yet.</p>
      ) : (
        <ul className="space-y-0 max-h-80 overflow-y-auto">
          {events.map((e, i) => (
            <li
              key={e.event_id ?? i}
              className="flex items-start gap-3 py-2 border-b border-line/40 last:border-0"
            >
              <span className="text-[10px] font-mono text-ink3 shrink-0 w-[68px] tabular-nums">
                {e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '—'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold text-ink truncate">
                  {e.event_type ?? 'event'}
                </p>
                {e.message && (
                  <p className="text-[10px] text-ink3 truncate leading-snug">{e.message}</p>
                )}
              </div>
              {e.execution_id && (
                <span className="text-[10px] font-mono text-ink3 shrink-0">
                  {e.execution_id.slice(0, 8)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Artifact integrity — SHA-256 manifest verification from the engine. */
export function EngineIntegrityPanel() {
  const { data, envelope, loading } = useEngine<
    Array<{ artifact_id?: string; path?: string; verified?: boolean; status?: string }>
  >('/integrity/artifacts');

  const rows = Array.isArray(data) ? data : [];
  const failing = rows.filter((r) => r.verified === false || r.status === 'ALTERED');

  return (
    <div className="glass-panel p-6 border border-frost/10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-['Manrope'] text-lg font-bold text-accentt flex items-center gap-2">
          <span className="material-symbols-outlined">fingerprint</span>
          Artifact Integrity
        </h3>
        {rows.length > 0 && (
          <span
            className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${
              failing.length
                ? 'bg-bad/15 text-bad border-bad/30'
                : 'bg-ok/15 text-ok border-ok/30'
            }`}
          >
            {failing.length ? `${failing.length} altered` : `${rows.length} verified`}
          </span>
        )}
      </div>

      {loading && !envelope ? (
        <p className="text-xs text-ink3 py-4 text-center">Loading…</p>
      ) : !envelope?.engine_available ? (
        <p className="text-xs text-ink3 py-4 text-center">{degradedMessage(envelope)}</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-ink3 py-4 text-center">
          No engine artifacts recorded yet. They appear after a Lab run trains a model.
        </p>
      ) : (
        <ul className="space-y-0 max-h-72 overflow-y-auto">
          {rows.map((r, i) => {
            const bad = r.verified === false || r.status === 'ALTERED';
            return (
              <li
                key={r.artifact_id ?? i}
                className="flex items-center gap-3 py-2 border-b border-line/40 last:border-0"
              >
                <span
                  className={`material-symbols-outlined !text-[16px] shrink-0 ${
                    bad ? 'text-bad' : 'text-ok'
                  }`}
                >
                  {bad ? 'error' : 'verified'}
                </span>
                <span className="text-[11px] text-ink truncate flex-1 font-mono">
                  {r.path ?? r.artifact_id}
                </span>
                <span className={`text-[10px] font-bold shrink-0 ${bad ? 'text-bad' : 'text-ink3'}`}>
                  {r.status ?? (bad ? 'ALTERED' : 'OK')}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
