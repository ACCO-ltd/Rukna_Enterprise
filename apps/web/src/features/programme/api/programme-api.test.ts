import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/features/auth/session/session-store';

import {
  downloadMasterSchedule,
  filenameFromContentDisposition,
} from './programme-api';

const API = 'http://acco.localhost:3001/api/v1';

/** A minimal signed-shaped JWT the session store can decode into a user. */
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

function pdfResponse(contentDisposition?: string, status = 200): Response {
  const headers = new Headers({ 'Content-Type': 'application/pdf' });
  if (contentDisposition) headers.set('Content-Disposition', contentDisposition);
  // A tiny non-empty body so `.blob()` resolves to something.
  return new Response(new Blob(['%PDF-1.7'], { type: 'application/pdf' }), { status, headers });
}

const fetchMock = vi.fn();
let assignedHref: string | null = null;
const clickSpy = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', API);
  vi.stubEnv('NEXT_PUBLIC_API_URL_TEMPLATE', '');

  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);

  // jsdom does not implement the URL object-URL statics — stub just those two, leaving the URL
  // constructor intact (the api-client / tenant helpers build URLs with `new URL`).
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();

  // jsdom's anchor.click would try to navigate; intercept it so we can assert the download.
  clickSpy.mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy);

  // jsdom throws on real navigation — capture the login redirect instead.
  assignedHref = null;
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      pathname: '/projects/proj-1/progress',
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
  sessionStore.setFromAccessToken(fakeJwt());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadMasterSchedule', () => {
  it('fetches the master-schedule.pdf URL with the bearer token and triggers a download', async () => {
    fetchMock.mockResolvedValue(
      pdfResponse('attachment; filename="master-schedule-ACCO-2026-001-2026-09-10.pdf"'),
    );

    await downloadMasterSchedule('proj-1', 'ACCO-2026-001');

    // 1. It hit the correct, project-scoped PDF endpoint.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${API}/projects/proj-1/programme/master-schedule.pdf`);

    // 2. It carried the Authorization header (a plain <a href> could not).
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Authorization')).toBe(`Bearer header.${btoa(
      JSON.stringify({
        sub: 'user-1',
        email: 'pm@acco.com',
        orgId: 'org-1',
        tenantSlug: 'acco',
        roles: ['PM'],
        permissions: ['view:project'],
      }),
    )}.signature`);

    // 3. It read the body as a blob, made an object URL, and clicked a download anchor.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    // 4. It revoked the object URL afterwards (no leaked blob).
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('uses the server filename from Content-Disposition when present', async () => {
    fetchMock.mockResolvedValue(
      pdfResponse('attachment; filename="master-schedule-ACCO-2026-001-2026-09-10.pdf"'),
    );

    // Capture the anchor at click time so we can read its download attribute.
    let downloadName: string | undefined;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    await downloadMasterSchedule('proj-1', 'fallback-code');

    expect(downloadName).toBe('master-schedule-ACCO-2026-001-2026-09-10.pdf');
  });

  it('falls back to a code-based filename when Content-Disposition is not readable', async () => {
    fetchMock.mockResolvedValue(pdfResponse()); // no Content-Disposition header

    let downloadName: string | undefined;
    clickSpy.mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });

    await downloadMasterSchedule('proj-1', 'ACCO-2026-001');

    expect(downloadName).toBe('master-schedule-ACCO-2026-001.pdf');
  });

  it('throws (and does not download) on a non-OK response', async () => {
    fetchMock.mockResolvedValue(pdfResponse(undefined, 500));

    await expect(downloadMasterSchedule('proj-1', 'ACCO-2026-001')).rejects.toThrow();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('tears the session down and redirects to login on a 401', async () => {
    fetchMock.mockResolvedValue(pdfResponse(undefined, 401));

    await expect(downloadMasterSchedule('proj-1', 'ACCO-2026-001')).rejects.toMatchObject({
      status: 401,
    });
    expect(clickSpy).not.toHaveBeenCalled();
    expect(assignedHref).toContain('/login');
  });
});

describe('filenameFromContentDisposition', () => {
  it('reads a plain quoted filename', () => {
    expect(
      filenameFromContentDisposition('attachment; filename="master-schedule-ACCO-1-2026-09-10.pdf"'),
    ).toBe('master-schedule-ACCO-1-2026-09-10.pdf');
  });

  it('reads a bare (unquoted) filename', () => {
    expect(filenameFromContentDisposition('attachment; filename=report.pdf')).toBe('report.pdf');
  });

  it('prefers and decodes an RFC 5987 filename*', () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''master%20schedule.pdf"),
    ).toBe('master schedule.pdf');
  });

  it('returns null for a missing or headerless value', () => {
    expect(filenameFromContentDisposition(null)).toBeNull();
    expect(filenameFromContentDisposition('attachment')).toBeNull();
  });
});
