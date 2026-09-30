import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMonthlyPL } from '@/features/accounting/api/accounting-api';
import { sessionStore } from '@/features/auth/session/session-store';
import { getBillMatch } from '@/features/procurement/api/procurement-api';
import { getProgrammeBaseline } from '@/features/progress/api/progress-api';
import { getApprovalStep } from '@/features/workflows/api/workflows-api';

/**
 * NestJS sends a handler's `null` as a 200 with an EMPTY body, which `apiClient` reads as
 * `undefined` — and TanStack Query fails any query whose data is `undefined`. Every endpoint
 * documented to answer `null` must hand its query `null`, not `undefined`. (This is what broke
 * Progress → Plan & setup on every project without an approved baseline.)
 */

const API = 'http://acco.localhost:3001/api/v1';
const fetchMock = vi.fn();

function fakeJwt(): string {
  const payload = {
    sub: 'user-1',
    email: 'pm@acco.com',
    orgId: 'org-1',
    tenantSlug: 'acco',
    roles: ['PM'],
    permissions: ['view:project'],
  };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  vi.stubEnv('NEXT_PUBLIC_API_URL_TEMPLATE', '');
  fetchMock.mockReset();
  // A fresh Response per call — a body can be read only once.
  fetchMock.mockImplementation(async () => new Response('', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  sessionStore.clearSession();
  sessionStore.setFromAccessToken(fakeJwt());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('endpoints that answer null as an empty body', () => {
  it.each([
    ['getProgrammeBaseline', () => getProgrammeBaseline('proj-1')],
    ['getBillMatch', () => getBillMatch('bill-1')],
    ['getMonthlyPL', () => getMonthlyPL('fy-1')],
    ['getApprovalStep', () => getApprovalStep('wf-1')],
  ])('%s resolves to null, never undefined', async (_name, call) => {
    await expect(call()).resolves.toBeNull();
    // It reached the network — the null came from the empty body, not an early return.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
