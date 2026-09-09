import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { getProjectReadiness, runProjectCommand } from './projects-api';
vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe('Project lifecycle transport', () => {
  it('queries readiness for the requested lifecycle command', async () => {
    await getProjectReadiness('p1', 'close');
    expect(apiClient).toHaveBeenCalledWith('/projects/p1/readiness', {
      params: { command: 'close' },
    });
  });
  it('sends commencement evidence as JSON to the start command', async () => {
    const evidence = {
      actualStartDate: '2026-09-09',
      commencementNote: 'Site access confirmed',
      overrides: [{ condition: 'DELIVERY_TEAM', reason: 'Engineer joins tomorrow' }],
    };
    await runProjectCommand('p1', { command: 'start', evidence });
    expect(apiClient).toHaveBeenCalledWith('/projects/p1/start', {
      method: 'POST',
      body: JSON.stringify(evidence),
    });
  });
  it('sends the required closure summary and date', async () => {
    const evidence = { closureDate: '2026-09-09', closureSummary: 'Handover complete' };
    await runProjectCommand('p1', { command: 'close', evidence });
    expect(apiClient).toHaveBeenCalledWith('/projects/p1/close', {
      method: 'POST',
      body: JSON.stringify(evidence),
    });
  });
});
