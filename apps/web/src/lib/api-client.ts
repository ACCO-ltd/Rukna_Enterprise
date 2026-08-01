import { sessionStore } from '@/features/auth/session/session-store';

const API_BASE_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
  skipAuth?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiClient<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, skipAuth, ...fetchOptions } = options;
  const url = new URL(`${API_BASE_URL}${endpoint}`);

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

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !skipAuth) {
    sessionStore.clearSession();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?next=${next}`;
    }
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string };
    };
    throw new ApiError(res.status, body.error?.message ?? 'Request failed', body.error?.code);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
