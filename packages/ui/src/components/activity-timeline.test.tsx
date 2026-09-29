import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ActivityTimeline, type ActivityTimelineEntry } from './activity-timeline';
import { ActivityTimeline as FromDocumentBody } from './document-body';

const ENTRIES: ActivityTimelineEntry[] = [
  {
    id: '2',
    actor: 'Abdi Yusuf',
    action: 'executed contract',
    target: 'ACC-HDN-26-0005-C1',
    href: '/projects/p1/commercial',
    at: '15 Sep 2026, 09:12',
    dateTime: '2026-09-15T09:12:00Z',
  },
  { id: '1', actor: 'Hodan Abdi', action: 'created the project', at: '14 Sep 2026, 10:05', code: 'project.create' },
];

describe('ActivityTimeline', () => {
  it('renders one sentence per entry: bold actor, verb, linked target', () => {
    render(<ActivityTimeline entries={ENTRIES} label="Project activity" />);
    const list = screen.getByRole('list', { name: 'Project activity' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent('Abdi Yusuf executed contract ACC-HDN-26-0005-C1');
    expect(within(items[0]!).getByText('Abdi Yusuf')).toHaveClass('font-semibold');
    expect(within(items[0]!).getByRole('link', { name: 'ACC-HDN-26-0005-C1' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial',
    );
  });

  it('shows the caller-formatted time underneath, machine-readable when given', () => {
    const { container } = render(<ActivityTimeline entries={ENTRIES} />);
    const time = container.querySelector('time');
    expect(time).toHaveTextContent('15 Sep 2026, 09:12');
    expect(time).toHaveAttribute('datetime', '2026-09-15T09:12:00Z');
    expect(screen.getByText('14 Sep 2026, 10:05', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('· project.create', { exact: false })).toBeInTheDocument();
  });

  it('draws two-letter initials and a connector between entries but not after the last', () => {
    const { container } = render(<ActivityTimeline entries={ENTRIES} />);
    expect(screen.getByText('AY')).toBeInTheDocument();
    expect(screen.getByText('HA')).toBeInTheDocument();
    const items = container.querySelectorAll('li');
    expect(items[0]!.querySelector('[data-timeline-connector]')).not.toBeNull();
    expect(items[1]!.querySelector('[data-timeline-connector]')).toBeNull();
  });

  it('renders a target without href as emphasised text, not a link', () => {
    render(
      <ActivityTimeline entries={[{ id: '1', actor: 'Abdi Yusuf', action: 'approved', target: 'BILL-7', at: 'now' }]} />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('BILL-7')).toHaveClass('font-medium');
  });

  it('uses renderLink for router links', () => {
    const renderLink = vi.fn(({ href, className, children }) => (
      <a href={href} className={className} data-router="">
        {children}
      </a>
    ));
    render(<ActivityTimeline entries={ENTRIES} renderLink={renderLink} />);
    expect(renderLink).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'ACC-HDN-26-0005-C1' })).toHaveAttribute('data-router');
  });

  it('offers "View all" handled by the caller', async () => {
    const onClick = vi.fn();
    render(<ActivityTimeline entries={ENTRIES} viewAll={{ onClick }} />);
    await userEvent.click(screen.getByRole('button', { name: 'View all' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('"View all" can be a link instead', () => {
    render(<ActivityTimeline entries={ENTRIES} viewAll={{ href: '/activity', label: 'Full history' }} />);
    expect(screen.getByRole('link', { name: 'Full history' })).toHaveAttribute('href', '/activity');
  });

  it('compact tightens the rhythm and shrinks the avatar', () => {
    const { container } = render(<ActivityTimeline entries={ENTRIES} compact />);
    expect(screen.getByText('AY')).toHaveClass('size-6');
    expect(container.querySelector('li')).toHaveClass('pb-3');
  });

  describe('empty', () => {
    it('shows the empty prop', () => {
      render(<ActivityTimeline entries={[]} empty={<p>Nothing has happened yet.</p>} />);
      expect(screen.getByText('Nothing has happened yet.')).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });

    it('shows children', () => {
      render(
        <ActivityTimeline entries={[]}>
          <p>No history.</p>
        </ActivityTimeline>,
      );
      expect(screen.getByText('No history.')).toBeInTheDocument();
    });

    it('falls back to a default line', () => {
      render(<ActivityTimeline entries={[]} />);
      expect(screen.getByText('No activity yet.')).toBeInTheDocument();
    });
  });

  it('is still importable from document-body', () => {
    expect(FromDocumentBody).toBe(ActivityTimeline);
  });
});
