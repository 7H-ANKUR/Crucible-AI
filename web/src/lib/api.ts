/**
 * api.ts — Central API client for Crucible AI frontend.
 *
 * Token strategy:
 *   - Production: tokens come from Clerk's useAuth().getToken() injected by
 *     callers at request time. No localStorage persistence.
 *   - Demo mode (NEXT_PUBLIC_DEMO_MODE=true): a server-issued JWT is held in
 *     an in-memory variable only. Never written to localStorage.
 *
 * Security invariant: Bearer tokens are NEVER stored in localStorage.
 * localStorage is an XSS-accessible surface; session-scoped memory is safer.
 */

/**
 * Origin used only when NEXT_PUBLIC_API_URL is unset during local development.
 * Deliberately not used for production builds — see getRawApiUrl().
 */
const DEV_FALLBACK_ORIGIN = 'http://localhost:8000';

/**
 * Resolve the configured API origin, trailing slashes stripped.
 *
 * NEXT_PUBLIC_API_URL is the single source of truth and is inlined by Next at
 * build time:
 *   - production  → web/.env.production (committed, holds the Render URL),
 *     or a Vercel project environment variable, which takes precedence.
 *   - development → web/.env.local (gitignored, usually localhost:8000).
 *
 * The localhost fallback is development-only on purpose. A production bundle that
 * quietly defaults to localhost ships a frontend that can only reach an API on the
 * machine that built it: every visitor's browser tries to call its own port 8000
 * and fails. Throwing here turns that into a build failure, where it is visible,
 * instead of a runtime failure for every user.
 */
function getRawApiUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. A production build must point at the deployed ' +
        'API (e.g. https://crucible-backend-56rm.onrender.com). Set it in the Vercel ' +
        'project environment variables, or in web/.env.production.'
    );
  }

  return DEV_FALLBACK_ORIGIN;
}

function getBaseUrl(): string {
  const raw = getRawApiUrl();
  return raw.endsWith('/api/v1') ? raw : `${raw}/api/v1`;
}
const BASE_URL = getBaseUrl();

/**
 * API origin with any /api/v1 suffix stripped.
 *
 * The health router is mounted at both the root and /api/v1 (see apps/api/main.py),
 * so the warm-up probe in lib/warmup.ts uses the unversioned origin to reach
 * /health/live without depending on the API version prefix.
 */
export const API_ORIGIN = getRawApiUrl().replace(/\/api\/v1$/, '');
const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

// Active auth token (Clerk JWT in prod or demo JWT in demo mode).
// Stored in memory and tab-scoped sessionStorage (cleared on tab close).
let _activeToken: string | null = null;

/**
 * Store the active token (Clerk or demo JWT).
 */
export function setToken(token: string) {
  _activeToken = token;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.setItem('crucible_active_token', token);
    } catch {}
  }
}

/**
 * Retrieve the current active token.
 */
export function getToken(): string | null {
  if (_activeToken) return _activeToken;
  if (typeof window !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('crucible_active_token');
      if (stored) {
        _activeToken = stored;
        return stored;
      }
    } catch {}
  }
  return null;
}

/**
 * Clear the active token.
 */
export function clearToken() {
  _activeToken = null;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem('crucible_active_token');
    } catch {}
  }
}

/**
 * Build auth headers for a request.
 * @param clerkToken - Optional explicit token; otherwise uses the active token.
 */
function makeHeaders(clerkToken?: string | null): HeadersInit {
  const token = clerkToken ?? getToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  clerkToken?: string | null
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...makeHeaders(clerkToken),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, res.statusText, `API ${res.status}: ${text}`);
  }

  return res.json();
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  clerkToken?: string | null
): Promise<T> {
  return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) }, clerkToken);
}

/**
 * Demo-mode login: POST credentials to /auth/token, store JWT in memory only.
 * Only functional when NEXT_PUBLIC_DEMO_MODE=true.
 */
export async function login(username: string, password: string) {
  if (!IS_DEMO_MODE) {
    throw new Error('login() is only available in demo mode. Use Clerk authentication.');
  }
  const form = new URLSearchParams({ username, password });
  const res = await fetch(`${BASE_URL}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (!res.ok) throw new ApiError(res.status, res.statusText, 'Invalid credentials');
  const data = await res.json();
  // Store in memory ONLY — never localStorage
  setToken(data.access_token);
  return data;
}
