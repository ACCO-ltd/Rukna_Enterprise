import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ReadinessChecklist, readinessCounts, type ReadinessStep } from '@erp/ui';

function step(overrides: Partial<ReadinessStep> & Pick<ReadinessStep, 'key'>): ReadinessStep {
  return { title: overrides.key, state: 'open', ...overrides };
}

const REQUIRED_OPEN: ReadinessStep[] = [
  step({ key: 'client', title: 'Assign an active client', state: 'done', href: '/c' }),
  step({ key: 'boq', title: 'Baseline the BOQ', state: 'done' }),
  step({ key: 'contract', title: 'Execute the contract', owner: 'Commercial team' }),
  step({ key: 'start-date', title: 'Set the start date' }),
  step({ key: 'team', title: 'Assign the team', optional: true, action: <a href="/team">Assign team</a> }),
  step({ key: 'dates', title: 'Set dates', state: 'done' }),
];

describe('readinessCounts', () => {
  it('is required-open while any required step is open, counting waiting steps as open', () => {
    expect(
      readinessCounts([{ state: 'done' }, { state: 'waiting' }, { state: 'open', optional: true }]),
    ).toEqual({ total: 3, done: 1, requiredOpen: 1, optionalOpen: 1, kind: 'required-open' });
  });

  it('is optional-open when only optional steps are open, and all-done when none are', () => {
    expect(readinessCounts([{ state: 'done' }, { state: 'open', optional: true }]).kind).toBe(
      'optional-open',
    );
    expect(readinessCounts([{ state: 'done' }, { state: 'done', optional: true }]).kind).toBe(
      'all-done',
    );
  });
});

describe('ReadinessChecklist', () => {
  it.each([
    [REQUIRED_OPEN, '2 required steps left before you can start.'],
    [
      REQUIRED_OPEN.map((s) => (s.optional ? s : { ...s, state: 'done' as const })),
      'Ready to start. 1 optional step is still open.',
    ],
    [REQUIRED_OPEN.map((s) => ({ ...s, state: 'done' as const })), 'Ready to start. Every step is done.'],
  ])('computes the summary sentence', (steps, sentence) => {
    render(<ReadinessChecklist title="Before you start" steps={steps} />);
    expect(screen.getByText(sentence)).toBeInTheDocument();
  });

  it('exposes progress as text and draws one segment per step', () => {
    render(<ReadinessChecklist title="Before you start" steps={REQUIRED_OPEN} />);
    const bar = screen.getByRole('progressbar', { name: '3 of 6 steps done' });
    expect(bar).toHaveAttribute('aria-valuenow', '3');
    expect(bar.children).toHaveLength(6);
  });

  it('lists open steps first, in sequence order, keeping their sequence numbers', () => {
    render(<ReadinessChecklist title="Before you start" steps={REQUIRED_OPEN} />);
    const openList = screen.getAllByRole('list')[0]!;
    const rows = within(openList).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^3Execute the contract/),
      expect.stringMatching(/^4Set the start date/),
      expect.stringMatching(/^5Assign the teamOptional/),
    ]);
    // Optional is a quiet property with a word, and says what skipping it costs.
    expect(within(rows[2]!).getByText('Can be skipped with a recorded reason')).toBeInTheDocument();
    expect(within(rows[2]!).getByRole('link', { name: 'Assign team' })).toBeInTheDocument();
  });

  it('folds done steps behind a real toggle, collapsed by default', async () => {
    const user = userEvent.setup();
    render(<ReadinessChecklist title="Before you start" steps={REQUIRED_OPEN} />);

    const toggle = screen.getByRole('button', { name: /3 steps done/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Assign an active client')).not.toBeVisible();

    // Keyboard: tab to the toggle and open it with Enter.
    await user.tab();
    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Done rows are one line: the title (a link when there is somewhere to go), no description.
    expect(screen.getByRole('link', { name: 'Assign an active client' })).toHaveAttribute(
      'href',
      '/c',
    );
    expect(screen.getByText('Baseline the BOQ')).toBeVisible();
  });

  it('marks a done step with a check, never with a "Complete" pill', () => {
    render(
      <ReadinessChecklist
        title="Before you start"
        steps={REQUIRED_OPEN.map((s) => ({ ...s, state: 'done' as const }))}
      />,
    );
    expect(screen.queryByText('Complete')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /6 steps done/ })).toBeInTheDocument();
  });

  it('draws a waiting step with what it waits for and no action', () => {
    render(
      <ReadinessChecklist
        title="Before you start"
        steps={[
          step({
            key: 'start-date',
            title: 'Set the start date',
            state: 'waiting',
            waitingFor: 'Execute the contract',
            action: <a href="/x">Open</a>,
          }),
        ]}
      />,
    );
    const row = screen.getByRole('listitem');
    expect(row).toHaveAttribute('data-state', 'waiting');
    expect(within(row).getByText(/Waits for/)).toHaveTextContent('Waits for Execute the contract');
    expect(within(row).queryByRole('link')).not.toBeInTheDocument();
  });
});
