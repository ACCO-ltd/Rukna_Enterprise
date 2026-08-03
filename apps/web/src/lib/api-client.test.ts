import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/features/auth/session/session-store';

import { ApiError, apiClient, restoreSession } from './api-client';

const API = 'http://acco.localhost:3001/api/v1';

function fakeJwt(overrides: Record<string, unknown> = {}): string {
  const payload = {
    sub: 'user-1',
    email: 'admin@acco.com',
    orgId: 'org-1',
    tenantSlug: 'acco',
    roles: ['ADMIN'],
    permissions: [],
    lang: 'en',
    ...overrides,
  };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status = 200): Response {
  return new Response(null, { status });
}

const fetchMock = vi.fn();
let assignedHref: string | null = null;

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  vi.stubEnv('NEXT_PUBLIC_API_URL_TEMPLATE', '');

  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  // jsdom throws on real navigation — capture the redirect instead.
  assignedHref = null;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/dashboard',
      search: '',
      hostname: 'localhost',
      get href() {
        return assignedHref ?? '';
      },
      set href(value: string) {
        assignedHref = value;
      },
    },
  });

  sessionStore.clearSession();
  document.cookie = '__auth=1; path=/';
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('apiClient — happy path', () => {
  it('attaches the bearer token and returns the parsed body', async () => {
    sessionStore.setFromAccessToken(fakeJwt());
    fetchMock.mockResolvedValue(jsonResponse({ id: 'p1' }));

    const result = await apiClient<{ id: string }>('/projects/p1');

    expect(result).toEqual({ id: 'p1' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/projects/p1`);
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${fakeJwt()}`);
    expect(init.credentials).toBe('include');
  });

  it('appends query params', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await apiClient('/projects', { params: { status: 'ACTIVE' } });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${API}/projects?status=ACTIVE`);
  });

  it('omits the Authorization header when skipAuth is set', async () => {
    sessionStore.setFromAccessToken(fakeJwt());
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: 'x' }));

    await apiClient('/auth/login', { method: 'POST', skipAuth: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });
});

// B6: suspend, resume, logout, remove-member, move-node and delete-node all answer
// 200 with no body. Calling res.json() on those throws.
describe('apiClient — empty response bodies', () => {
  it('resolves undefined for an empty 200 rather than throwing', async () => {
    fetchMock.mockResolvedValue(emptyResponse(200));

    await expect(apiClient('/projects/p1/suspend', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('resolves undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValue(emptyResponse(204));

    await expect(apiClient('/projects/p1/members/u1', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});

describe('apiClient — error envelope', () => {
  it('preserves class-validator message arrays', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: ['code must be shorter than or equal to 30 characters', 'name should not be empty'],
          },
        },
        400,
      ),
    );

    const error = await apiClient('/projects', { method: 'POST' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).messages).toHaveLength(2);
    expect((error as ApiError).message).toContain('name should not be empty');
  });

  it('reads a single-string message and code', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: 'CONFLICT', message: "Project code 'X' already exists" } },
        409,
      ),
    );

    const error = (await apiClient('/projects', { method: 'POST' }).catch(
      (e: unknown) => e,
    )) as ApiError;

    expect(error.status).toBe(409);
    expect(error.code).toBe('CONFLICT');
    expect(error.message).toBe("Project code 'X' already exists");
  });
});

describe('apiClient — token refresh', () => {
  it('refreshes once on 401 and retries the original request', async () => {
    sessionStore.setFromAccessToken(fakeJwt());
    const refreshed = fakeJwt({ email: 'refreshed@acco.com' });

    fetchMock
      .mockResolvedValueOnce(emptyResponse(401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: refreshed }))
      .mockResolvedValueOnce(jsonResponse({ id: 'p1' }));

    const result = await apiClient<{ id: string }>('/projects/p1');

    expect(result).toEqual({ id: 'p1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${API}/auth/refresh`);
    expect(sessionStore.getState().user?.email).toBe('refreshed@acco.com');

    // The retry must carry the NEW token, not the expired one.
    const [, retryInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(new Headers(retryInit.headers).get('Authorization')).toBe(`Bearer ${refreshed}`);
  });

  /**
   * The critical one. The API rotates the refresh token and revokes the entire token
   * family on reuse — so two concurrent refreshes would sign the user out everywhere.
   */
  it('collapses concurrent 401s into a single refresh call', async () => {
    sessionStore.setFromAccessToken(fakeJwt());
    const refreshed = fakeJwt({ email: 'refreshed@acco.com' });

    const firstAttempt = new Set<string>();
    let refreshCalls = 0;

    fetchMock.mockImplementation(async (url: string) => {
      if (url === `${API}/auth/refresh`) {
        refreshCalls += 1;
        // Resolve on a later tick so every caller is genuinely waiting at once.
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse({ accessToken: refreshed });
      }

      if (!firstAttempt.has(url)) {
        firstAttempt.add(url);
        return emptyResponse(401);
      }

      return jsonResponse({ url });
    });

    const endpoints = ['/projects', '/users/u1', '/roles', '/audit-logs', '/permissions', '/organizations/o1'];
    const results = await Promise.all(endpoints.map((e) => apiClient<{ url: string }>(e)));

    expect(refreshCalls).toBe(1);
    expect(results).toHaveLength(6);
    results.forEach((r) => {
      expect(r.url).toContain(API);
    });
  });

  it('ends the session when the refresh itself fails', async () => {
    sessionStore.setFromAccessToken(fakeJwt());

    fetchMock
      .mockResolvedValueOnce(emptyResponse(401))
      .mockResolvedValueOnce(emptyResponse(401));

    await expect(apiClient('/projects')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });

    expect(sessionStore.getState().isAuthenticated).toBe(false);
    expect(document.cookie).not.toContain('__auth=1');
    expect(assignedHref).toBe('/login?next=%2Fdashboard');
  });

  it('does not refresh a second time when the retry is also rejected', async () => {
    sessionStore.setFromAccessToken(fakeJwt());

    fetchMock
      .mockResolvedValueOnce(emptyResponse(401))
      .mockResolvedValueOnce(jsonResponse({ accessToken: fakeJwt() }))
      .mockResolvedValueOnce(emptyResponse(401));

    await expect(apiClient('/projects')).rejects.toBeInstanceOf(ApiError);

    // request, refresh, retry — and no fourth call.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sessionStore.getState().isAuthenticated).toBe(false);
  });

  it('never refreshes for skipAuth requests', async () => {
    fetchMock.mockResolvedValue(emptyResponse(401));

    await expect(apiClient('/auth/login', { method: 'POST', skipAuth: true })).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('restoreSession', () => {
  it('rebuilds the in-memory session from the refresh cookie', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ accessToken: fakeJwt({ lang: 'ar' }) }));

    await restoreSession();

    expect(sessionStore.getState().isAuthenticated).toBe(true);
    expect(sessionStore.getState().user?.lang).toBe('ar');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/auth/refresh`);
    expect(init.credentials).toBe('include');
  });

  it('rejects when there is no valid refresh cookie', async () => {
    fetchMock.mockResolvedValue(emptyResponse(401));

    await expect(restoreSession()).rejects.toBeInstanceOf(ApiError);
    expect(sessionStore.getState().isAuthenticated).toBe(false);
  });
});
