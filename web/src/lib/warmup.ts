/**
 * warmup.ts — Wakes the Render-hosted API the moment someone lands on the site.
 *
 * Why this exists:
 *   The API runs on a Render instance that spins down after inactivity. The first
 *   request to a sleeping instance triggers a cold boot — container start, then
 *   FastAPI's lifespan (init_db + load_all_models loads 16 joblib artifacts) — which
 *   takes up to ~90s. If the first request is the dashboard's own data fetch, the
 *   user watches a spinner or falls back to synthetic data.
 *
 *   So we start the boot on the landing page instead, and spend the user's browse
 *   time waiting rather than their dashboard time.
 *
 * Probe target:
 *   /health/live is the zero-dependency liveness probe — no DB, no Redis, no auth.
 *   It cannot answer until the lifespan handler has finished, so a 200 from it means
 *   the models are loaded and the app is genuinely ready to serve, not merely that
 *   the container has a socket open.
 *
 * Failure policy:
 *   Entirely best-effort and silent. Every error is swallowed; nothing here is
 *   allowed to surface to the user or block rendering. The worst case is that the
 *   dashboard behaves exactly as it does today.
 */

import { API_ORIGIN } from './api';

/** Render's cold boot is ~90s; budget past it so a slow boot still gets caught. */
const COLD_START_BUDGET_MS = 150_000;
/** Per-attempt ceiling. Render holds the connection open while booting, so aborting
 *  and retrying is how we avoid one request swallowing the whole budget. Aborting
 *  does not cancel the boot — it continues server-side regardless. */
const ATTEMPT_TIMEOUT_MS = 20_000;
/** Gap between attempts. Short: each retry is cheap and the boot is already running. */
const RETRY_DELAY_MS = 3_000;
/** Render spins down after ~15 min idle. Treat a confirmed-warm backend as still warm
 *  for less than that, then re-probe when the tab is focused again. */
const WARM_TTL_MS = 10 * 60_000;

export type WarmupState =
  | 'idle'        // not started (or skipped — local dev / server render)
  | 'warming'     // probe in flight, backend not yet confirmed up
  | 'warm'        // /health/live returned 200; API is ready
  | 'unreachable'; // budget exhausted without a successful probe

let state: WarmupState = 'idle';
let inFlight: Promise<void> | null = null;
let lastWarmAt = 0;
const listeners = new Set<(s: WarmupState) => void>();

function setState(next: WarmupState): void {
  if (state === next) return;
  state = next;
  // forEach rather than for..of: the tsconfig target predates downlevel Set iteration.
  listeners.forEach((fn) => {
    try {
      fn(next);
    } catch {
      // A broken subscriber must not abort the warm-up.
    }
  });
}

/** Current warm-up state. Useful if a screen wants to show "waking backend…". */
export function getWarmupState(): WarmupState {
  return state;
}

/** Subscribe to warm-up state changes. Returns an unsubscribe function. */
export function onWarmupChange(fn: (s: WarmupState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Local dev APIs never sleep — probing them just produces noisy retries when the
 *  backend happens to be stopped, so skip entirely. */
function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One probe attempt. Resolves true only on a 2xx.
 *
 * `credentials: 'omit'` keeps this a simple CORS request with no cookie/auth
 * involvement, and `cache: 'no-store'` stops a previous 200 being replayed from
 * cache — which would report "warm" for an instance that has since slept.
 */
async function probe(path: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_ORIGIN}${path}`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wake the backend and keep probing until it answers or the budget runs out.
 *
 * Idempotent and coalesced: concurrent callers share one in-flight run, and a
 * backend confirmed warm within WARM_TTL_MS resolves immediately without a request.
 */
export function warmBackend(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (!API_ORIGIN || isLocalOrigin(API_ORIGIN)) return Promise.resolve();
  if (inFlight) return inFlight;
  if (state === 'warm' && Date.now() - lastWarmAt < WARM_TTL_MS) return Promise.resolve();

  const run = (async () => {
    setState('warming');
    const deadline = Date.now() + COLD_START_BUDGET_MS;

    while (Date.now() < deadline) {
      if (await probe('/health/live', ATTEMPT_TIMEOUT_MS)) {
        lastWarmAt = Date.now();
        setState('warm');
        // Second stage, fire-and-forget: /health/ready runs `SELECT 1`, which opens a
        // pooled Postgres connection and pays the TLS handshake to Aiven now rather
        // than on the dashboard's first real query. The result is irrelevant — a 503
        // here still means the container is awake, which is what we came for.
        void probe('/health/ready', ATTEMPT_TIMEOUT_MS);
        return;
      }
      if (Date.now() >= deadline) break;
      await sleep(RETRY_DELAY_MS);
    }

    setState('unreachable');
  })();

  inFlight = run.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Start warming now, and re-warm whenever the tab regains focus.
 *
 * The refocus hook matters because a user who leaves the tab open for 15+ minutes
 * comes back to an instance that has gone to sleep again; warmBackend()'s TTL check
 * makes the common case (quick tab switch) a no-op.
 *
 * Returns a cleanup function suitable for returning directly from a useEffect.
 */
export function startWarmupWatcher(): () => void {
  void warmBackend();

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') void warmBackend();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}
