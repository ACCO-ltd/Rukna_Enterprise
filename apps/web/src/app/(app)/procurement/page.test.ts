import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import ProcurementPage from './page';

describe('/procurement', () => {
  it('lands on material requests, the first tab', () => {
    ProcurementPage();
    expect(mocks.redirect).toHaveBeenCalledWith('/procurement/requests');
  });
});
