import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { lifecycleErrorKey, toLifecycleError } from './lifecycle-error';

describe('toLifecycleError', () => {
  it('maps 422 to workflow-not-configured', () => {
    // The resolver throws this when a WorkflowRequirementPolicy is REQUIRED but no active
    // binding exists — nothing the user can do about it, so it must not read as retryable.
    const error = new ApiError(
      422,
      "Workflow configuration required: no active binding found for InterimPaymentApplication transition 'DRAFT' → 'PENDING_INTERNAL_APPROVAL'.",
    );

    expect(toLifecycleError(error).kind).toBe('workflow-not-configured');
  });

  it('maps 400 to invalid-transition and keeps the server explanation', () => {
    const error = new ApiError(
      400,
      "Cannot 'submit' an IPA with status 'SUBMITTED'. Expected 'APPROVED_FOR_SUBMISSION'.",
    );

    expect(toLifecycleError(error)).toEqual({
      kind: 'invalid-transition',
      serverMessage:
        "Cannot 'submit' an IPA with status 'SUBMITTED'. Expected 'APPROVED_FOR_SUBMISSION'.",
    });
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not-found'],
    [409, 'conflict'],
  ])('maps %i to %s', (status, kind) => {
    expect(toLifecycleError(new ApiError(status, 'nope')).kind).toBe(kind);
  });

  it('falls back to unknown for an unmapped status', () => {
    expect(toLifecycleError(new ApiError(500, 'Internal error')).kind).toBe('unknown');
  });

  it('treats a 401 as unknown, because the client resolves it before callers see it', () => {
    // api-client refreshes and retries, or ends the session. One reaching here means the
    // redirect is already in flight.
    expect(toLifecycleError(new ApiError(401, 'Session expired')).kind).toBe('unknown');
  });

  it('drops the placeholder message the client uses for an empty error body', () => {
    expect(toLifecycleError(new ApiError(400, 'Request failed')).serverMessage).toBe('');
  });

  it('handles a non-ApiError without throwing', () => {
    expect(toLifecycleError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'unknown',
      serverMessage: '',
    });
    expect(toLifecycleError(undefined).kind).toBe('unknown');
  });
});

describe('lifecycleErrorKey', () => {
  it('namespaces the kind under lifecycle.error', () => {
    expect(lifecycleErrorKey('workflow-not-configured')).toBe(
      'lifecycle.error.workflow-not-configured',
    );
  });
});
