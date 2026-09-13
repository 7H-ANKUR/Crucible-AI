'use client';

/**
 * lab.ts — client for the Crucible AI engine, reached through the Crucible AI gateway.
 *
 * Every response carries `engine_available`. The engine is an internal service
 * that can be down while the rest of the platform is fine, so callers render an
 * explicit degraded state rather than an error — the same honesty the platform
 * already applies with `model_backed` on scenario actions.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { apiFetch, apiPost } from '@/lib/api';

/** Envelope returned by every /lab endpoint. */
export interface EngineEnvelope<T> {
  engine_available: boolean;
  data?: T;
  reason?: string;
  degraded?: 'circuit_open' | 'disabled' | 'unreachable' | 'timeout' | 'error' | null;
}

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'lost'
  | string;

export interface LabExecution {
  execution_id: string;
  status: ExecutionStatus;
  dataset_id?: string;
  dataset_path?: string;
  target?: string | null;
  task_type?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

export interface LabDataset {
  dataset_id: string;
  original_filename?: string;
  rows?: number;
  columns?: number;
  uploaded_at?: string;
}

export interface LabNode {
  node_id: string;
  name?: string;
  status: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
}

export interface LabCandidate {
  name?: string;
  estimator?: string;
  score?: number;
  metrics?: Record<string, number>;
}

/** Terminal states — polling stops here. */
export const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'lost']);

export function isTerminal(status: string | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(String(status).toLowerCase());
}

/** Human wording for why the engine is unreachable. */
export function degradedMessage(env: EngineEnvelope<unknown> | null): string {
  if (!env) return 'The ML Lab could not be reached.';
  if (env.reason) return env.reason;
  switch (env.degraded) {
    case 'disabled':
      return 'The ML Lab is switched off in this environment.';
    case 'circuit_open':
      return 'The ML Lab stopped responding. Calls are paused while it recovers.';
    case 'timeout':
      return 'The ML Lab took too long to respond.';
    default:
      return 'The ML Lab is not reachable right now.';
  }
}

/**
 * Fetch one engine endpoint.
 *
 * `refreshMs` re-polls on an interval. Pass `stopWhen` to end polling once a
 * run reaches a terminal state, so a finished page stops making requests.
 */
export function useEngine<T>(
  path: string | null,
  options: {
    refreshMs?: number;
    stopWhen?: (data: T | undefined) => boolean;
  } = {}
) {
  const { refreshMs, stopWhen } = options;
  const { getToken } = useAuth();
  const [envelope, setEnvelope] = useState<EngineEnvelope<T> | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    try {
      const token = await getToken();
      const result = await apiFetch<EngineEnvelope<T>>(`/lab${path}`, {}, token);
      setEnvelope(result);
      setError(null);
    } catch (e) {
      // A gateway-level failure (401, network) is different from the engine
      // being down, and says so.
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [path, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!refreshMs || !path) return;
    if (stopWhen && stopWhen(envelope?.data)) return;
    const id = setInterval(() => void load(), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, path, load, envelope, stopWhen]);

  return {
    envelope,
    data: envelope?.engine_available ? envelope.data : undefined,
    available: envelope?.engine_available ?? null,
    loading,
    error,
    reload: load,
  };
}

/** POST to an engine endpoint through the gateway. */
/**
 * Upload a CSV or XLSX straight to the engine.
 *
 * The Data Hub registers datasets with the platform, not with the engine, so
 * without this the ML Lab had no way to acquire one — the empty state pointed
 * users at a page that could never populate it.
 */
export function useEngineUpload() {
  const { getToken } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File): Promise<EngineEnvelope<{ dataset_id: string; rows?: number }> | null> => {
      setPending(true);
      setError(null);
      try {
        const token = await getToken();
        const form = new FormData();
        form.append('file', file);

        // Not apiPost: that sets a JSON content type, and multipart needs the
        // browser to set its own boundary.
        const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
        const res = await fetch(`${base}/api/v1/lab/datasets/upload`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: form,
        });
        if (!res.ok) {
          setError(
            res.status === 403
              ? 'Your role cannot upload datasets to the engine.'
              : `Upload failed (${res.status}).`
          );
          return null;
        }
        return (await res.json()) as EngineEnvelope<{ dataset_id: string; rows?: number }>;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Upload failed');
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  return { upload, pending, error };
}


export function useEngineAction<T = unknown>() {
  const { getToken } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (path: string, body: unknown = {}): Promise<EngineEnvelope<T> | null> => {
      setPending(true);
      setError(null);
      try {
        const token = await getToken();
        return await apiPost<EngineEnvelope<T>>(`/lab${path}`, body, token);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Request failed';
        setError(
          message.includes('403')
            ? 'Your role cannot start ML Lab runs.'
            : message
        );
        return null;
      } finally {
        setPending(false);
      }
    },
    [getToken]
  );

  return { run, pending, error };
}
