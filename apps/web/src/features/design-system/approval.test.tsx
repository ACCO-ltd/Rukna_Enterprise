import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ApprovalChain,
  ApprovalTimeline,
  DecisionPanel,
  SavedViews,
  type ApprovalStep,
} from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

const LABELS = {
  commentLabel: 'Comment',
  commentNote: 'required to return or reject',
  commentPlaceholder: 'Add context…',
  approve: 'Approve',
  return: 'Return for changes',
  reject: 'Reject',
  commentRequired: 'Say what needs to change.',
};

const STEPS: ApprovalStep[] = [
  { id: 'a', title: 'Raised', actor: 'Fadumo Ali', at: '09 Aug', state: 'approved' },
  { id: 'b', title: 'Project manager', actor: 'Ahmed Shirie', at: '09 Aug', state: 'returned', comment: 'Rate is above BOQ.' },
  { id: 'c', title: 'Finance manager', state: 'current', isYou: true },
  { id: 'd', title: 'Finance director', state: 'upcoming', condition: 'Required above 5 000 000 SOS' },
];

describe('DecisionPanel — the comment rule', () => {
  it('approves without a comment', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<DecisionPanel labels={LABELS} onDecide={onDecide} />);

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    // Approving needs no explanation: the decision is the record.
    expect(onDecide).toHaveBeenCalledWith('approve', '');
  });

  it('refuses to reject without a comment, and says why', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<DecisionPanel labels={LABELS} onDecide={onDecide} />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));

    expect(onDecide).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Say what needs to change.');
    expect(screen.getByLabelText(/Comment/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses to return without a comment', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<DecisionPanel labels={LABELS} onDecide={onDecide} />);

    await user.click(screen.getByRole('button', { name: 'Return for changes' }));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('treats whitespace as no comment', async () => {
    // A space bar press is not an explanation, and the person receiving the document cannot
    // act on it. Trimming here rather than in each caller keeps the rule in one place.
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<DecisionPanel labels={LABELS} onDecide={onDecide} />);

    await user.type(screen.getByLabelText(/Comment/), '    ');
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(onDecide).not.toHaveBeenCalled();
  });

  it('passes the trimmed comment through once one is given', async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    render(<DecisionPanel labels={LABELS} onDecide={onDecide} />);

    await user.type(screen.getByLabelText(/Comment/), '  rate exceeds the BOQ  ');
    await user.click(screen.getByRole('button', { name: 'Return for changes' }));

    expect(onDecide).toHaveBeenCalledWith('return', 'rate exceeds the BOQ');
  });

  it('clears the error as soon as the user starts typing', async () => {
    const user = userEvent.setup();
    render(<DecisionPanel labels={LABELS} onDecide={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Comment/), 'x');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables every control while a decision is in flight', () => {
    render(<DecisionPanel labels={LABELS} onDecide={vi.fn()} busy />);
    for (const name of ['Approve', 'Return for changes', 'Reject']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.getByLabelText(/Comment/)).toBeDisabled();
  });
});

describe('ApprovalChain', () => {
  it('shows steps that have not been reached, with the reason they exist', () => {
    render(<ApprovalChain steps={STEPS} label="Approval chain" />);

    // A chain that stops at the current step reads as arbitrary the moment a threshold adds
    // one. The condition is worth more than the step's own label.
    expect(screen.getByText('Finance director')).toBeInTheDocument();
    expect(screen.getByText('Required above 5 000 000 SOS')).toBeInTheDocument();
  });

  it('renders the awaiting-you slot only on the step marked isYou', () => {
    render(
      <ApprovalChain
        steps={STEPS}
        label="Approval chain"
        awaitingYouSlot={<span>Awaiting you</span>}
      />,
    );
    expect(screen.getAllByText('Awaiting you')).toHaveLength(1);
  });

  it('is an ordered list, because the order is the information', () => {
    render(<ApprovalChain steps={STEPS} label="Approval chain" />);
    const nav = screen.getByRole('navigation', { name: 'Approval chain' });
    expect(nav.querySelector('ol')).not.toBeNull();
    expect(nav.querySelectorAll('li')).toHaveLength(4);
  });
});

describe('ApprovalTimeline', () => {
  it('quotes what an approver wrote', () => {
    render(<ApprovalTimeline steps={STEPS} label="History" />);
    // The most re-read text on a returned record: it is what the next approver needs.
    expect(screen.getByText('Rate is above BOQ.')).toBeInTheDocument();
  });

  it('labels an unreached step rather than leaving it blank', () => {
    render(<ApprovalTimeline steps={STEPS} label="History" upcomingLabel="Not yet reached" />);
    expect(screen.getByText('Not yet reached')).toBeInTheDocument();
  });
});

describe('SavedViews', () => {
  const VIEWS = [
    { id: 'a', label: 'Awaiting match', count: 7 },
    { id: 'b', label: 'Ready to post', count: 3 },
    { id: 'c', label: 'All bills', count: 141 },
  ];

  it('marks only the active view selected, and only it is tabbable', () => {
    render(<SavedViews views={VIEWS} activeId="b" onSelect={vi.fn()} label="Views" />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('tabindex', '0');
    // Roving focus: arrows move between tabs, Tab leaves the strip.
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
  });

  it('shows counts, because the count is what makes it a queue', () => {
    render(<SavedViews views={VIEWS} activeId="a" onSelect={vi.fn()} label="Views" />);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('141')).toBeInTheDocument();
  });

  it('renders no count when it is unknown rather than a misleading zero', () => {
    render(
      <SavedViews views={[{ id: 'a', label: 'Loading view' }]} activeId="a" onSelect={vi.fn()} label="Views" />,
    );
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('selects with the arrow keys', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SavedViews views={VIEWS} activeId="a" onSelect={onSelect} label="Views" />);

    screen.getAllByRole('tab')[0]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenCalledWith('b');

    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenCalledWith('c');
  });

  it('wraps around rather than dead-ending at the last view', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<SavedViews views={VIEWS} activeId="c" onSelect={onSelect} label="Views" />);

    screen.getAllByRole('tab')[2]?.focus();
    await user.keyboard('{ArrowRight}');
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('points at the grid it controls', () => {
    render(<SavedViews views={VIEWS} activeId="a" onSelect={vi.fn()} label="Views" controls="bills-table" />);
    // So a view change is announced as a change to this table, not as navigation.
    expect(screen.getAllByRole('tab')[0]).toHaveAttribute('aria-controls', 'bills-table');
  });
});
