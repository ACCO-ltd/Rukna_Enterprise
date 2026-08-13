import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { useGatedCommand } from './use-gated-command';

function gate409(id: string): ApiError {
  return new ApiError(409, 'Requires approval', undefined, [], { approvalInstanceId: id });
}

describe('useGatedCommand', () => {
  it('command succeeds → not gated, no instance held', async () => {
    const cmd = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useGatedCommand(cmd));

    let res!: { gated: boolean };
    await act(async () => {
      res = await result.current.run();
    });

    expect(res).toEqual({ gated: false });
    expect(result.current.approvalInstanceId).toBeNull();
  });

  it('409 with details.approvalInstanceId → gated, holds the id', async () => {
    const cmd = vi.fn().mockRejectedValue(gate409('ai-1'));
    const { result } = renderHook(() => useGatedCommand(cmd));

    let res!: { gated: boolean };
    await act(async () => {
      res = await result.current.run();
    });

    expect(res).toEqual({ gated: true });
    expect(result.current.approvalInstanceId).toBe('ai-1');
  });

  it('re-drive after approval → the successful re-run clears the gate', async () => {
    const cmd = vi
      .fn()
      .mockRejectedValueOnce(gate409('ai-1'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useGatedCommand(cmd));

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.approvalInstanceId).toBe('ai-1');

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.approvalInstanceId).toBeNull();
  });

  it('a non-gate error rethrows and surfaces a message (no false gate)', async () => {
    const cmd = vi.fn().mockRejectedValue(new ApiError(400, 'Bad request', undefined, ['Bad request']));
    const { result } = renderHook(() => useGatedCommand(cmd));

    await act(async () => {
      await expect(result.current.run()).rejects.toBeInstanceOf(ApiError);
    });

    expect(result.current.approvalInstanceId).toBeNull();
    expect(result.current.error).toBe('Bad request');
  });
});
