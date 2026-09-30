import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderWithProviders } from '@/test/render';

/**
 * A policy's governance history on the shared ActivityTimeline: one sentence per entry — who
 * did what to the policy, with the reason where one was given — and the time under it.
 */

const hookMocks = vi.hoisted(() => ({ useApprovalPolicyHistory: vi.fn() }));
vi.mock('../hooks/use-approval-policies', () => hookMocks);

import { PolicyHistoryTimeline } from './policy-history-timeline';

function query(data: unknown, over: Record<string, unknown> = {}) {
  return { data, isPending: false, isError: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PolicyHistoryTimeline', () => {
  it('reads each entry as who did what, with the reason, and a time', () => {
    hookMocks.useApprovalPolicyHistory.mockReturnValue(
      query([
        {
          id: 'h1',
          action: 'APPROVAL_POLICY_ACTIVE',
          reason: null,
          createdAt: '2026-09-20T08:00:00.000Z',
          userId: 'u1',
          actorName: 'Hodan Abdi',
        },
        {
          id: 'h2',
          action: 'APPROVAL_POLICY_IN_REVIEW',
          reason: 'Thresholds agreed with finance',
          createdAt: '2026-09-19T08:00:00.000Z',
          userId: 'u2',
        },
      ]),
    );

    renderWithProviders(<PolicyHistoryTimeline policyId="p1" />);

    const items = within(screen.getByRole('list', { name: 'Policy history' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Hodan Abdi activated the policy');
    expect(items[0]!.querySelector('time')).toHaveAttribute('dateTime', '2026-09-20T08:00:00.000Z');
    // An older API without actor names still renders a readable sentence, never a raw id.
    expect(items[1]).toHaveTextContent(
      'Unknown user submitted the policy for review — Thresholds agreed with finance',
    );
    expect(screen.queryByText('u2')).not.toBeInTheDocument();
  });

  it('says so when there is no history', () => {
    hookMocks.useApprovalPolicyHistory.mockReturnValue(query([]));
    renderWithProviders(<PolicyHistoryTimeline policyId="p1" />);
    expect(screen.getByText('No governance history has been recorded for this policy.')).toBeInTheDocument();
  });
});
