import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/contracts/new` is retired (P3 Slice B). It only forwards legacy links: `?projectId` → the
 * project's workspace create page; otherwise → Projects, because a contract cannot be created
 * without a project. These pin both branches.
 *
 * The real `redirect()` throws to halt rendering; the mock reproduces that so a `?projectId`
 * redirect does not fall through to the projectless one.
 */

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import LegacyNewContractPage from './page';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('LegacyNewContractPage redirect', () => {
  it('forwards to the project workspace create page when a projectId is present', async () => {
    await expect(
      LegacyNewContractPage({ searchParams: Promise.resolve({ projectId: 'p-77' }) }),
    ).rejects.toThrow('NEXT_REDIRECT:/projects/p-77/commercial/contract/new');

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith('/projects/p-77/commercial/contract/new');
  });

  it('sends the user to Projects when no projectId is present', async () => {
    await expect(
      LegacyNewContractPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_REDIRECT:/projects');

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.redirect).toHaveBeenCalledWith('/projects');
  });
});
