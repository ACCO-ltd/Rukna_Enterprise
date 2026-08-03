import { clearAuthMarker } from '@/features/auth/session/auth-cookies';
import { sessionStore } from '@/features/auth/session/session-store';

import { getApiBaseUrl } from './tenant';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
  /** Skip the Authorization header and the refresh-retry cycle (login, refresh itself). */
  skipAuth?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    /**
     * class-validator returns `error.message` as an ARRAY of strings for 400s
     * (one per failed constraint). Preserved here so forms can list them individually;
     * `message` holds them joined for single-line display.
     */
    public readonly messages: string[] = [],
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ─── Refresh coordination ──────────────────────────────────────────────────────

/**
 * Single-flight guard.
 *
 * A dashboard can fire several queries at once; when the access token expires they all
 * return 401 together. Without this guard each one would call /auth/refresh, and because
 * the API rotates the refresh token and treats a reused token as an attack, the second
 * call would revoke the ENTIRE token family and sign the user out of every session.
 *
 * So: at most one refresh is ever in flight, and every waiting request awaits the same
 * promise.
 */
let refreshInFlight: Promise<string> | null = null;

function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function performRefresh(): Promise<string> {
  const res = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    throw new ApiError(res.status, 'Session expired', 'SESSION_EXPIRED');
  }

  const body = (await res.json()) as { accessToken?: string };
  if (!body.accessToken || !sessionStore.setFromAccessToken(body.accessToken)) {
    throw new ApiError(500, 'Malformed refresh response', 'SESSION_EXPIRED');
  }

  return body.accessToken;
}

/**
 * Re-establishes the session from the HttpOnly refresh cookie.
 * Used by AuthGate on mount, since the access token lives in memory and does not survive
 * a page reload. Shares the single-flight guard with the 401 retry path.
 */
export function restoreSession(): Promise<string> {
  return refreshAccessToken();
}

/**
 * Tears down the session and sends the user to login.
 *
 * Uses `window.location` rather than the Next router on purpose: a full document load is
 * the only way to guarantee every in-memory token, query cache entry and component state
 * is dropped. A soft navigation would leave cached financial data from the previous
 * session in memory.
 */
export function endSession(): void {
  sessionStore.clearSession();
  clearAuthMarker();

  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;

  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `/login?next=${next}`;
}

// ─── Request pipeline ──────────────────────────────────────────────────────────

export async function apiClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, skipAuth, ...fetchOptions } = options;

  let res = await executeRequest(endpoint, params, fetchOptions, skipAuth);

  if (res.status === 401 && !skipAuth) {
    try {
      await refreshAccessToken();
    } catch {
      endSession();
      throw new ApiError(401, 'Session expired', 'SESSION_EXPIRED');
    }

    // Retry once with the new token. A second 401 means the token is valid but this
    // user genuinely cannot perform the request — no point refreshing again.
    res = await executeRequest(endpoint, params, fetchOptions, skipAuth);

    if (res.status === 401) {
      endSession();
      throw new ApiError(401, 'Session expired', 'SESSION_EXPIRED');
    }
  }

  if (!res.ok) {
    throw await toApiError(res);
  }

  return parseBody<T>(res);
}

async function executeRequest(
  endpoint: string,
  params: Record<string, string> | undefined,
  fetchOptions: RequestInit,
  skipAuth: boolean | undefined,
): Promise<Response> {
  const url = new URL(`${getApiBaseUrl()}${endpoint}`);

  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      url.searchParams.set(k, v);
    });
  }

  const headers = new Headers(fetchOptions.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (!skipAuth) {
    const token = sessionStore.getState().accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url.toString(), {
    ...fetchOptions,
    headers,
    credentials: 'include',
  });
}

/**
 * Several endpoints return 200 with an EMPTY body — suspend, resume, logout, remove
 * member, move node, delete node (see B6 in docs/backend-requests/frontend-blockers.md).
 * Calling res.json() on those throws, so the body is read as text and only parsed when
 * there is something to parse.
 */
async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string | string[]; code?: string; details?: Record<string, unknown> };
  };

  const messages = normalizeMessages(body.error?.message);
  const message = messages.length > 0 ? messages.join('\n') : 'Request failed';

  return new ApiError(res.status, message, body.error?.code, messages, body.error?.details);
}

function normalizeMessages(message: string | string[] | undefined): string[] {
  if (Array.isArray(message)) return message.filter((m): m is string => typeof m === 'string');
  if (typeof message === 'string' && message.length > 0) return [message];
  return [];
}
