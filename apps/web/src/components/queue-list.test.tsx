import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { QueueList, joinQueueMeta, type QueueListItem } from './queue-list';

const ITEMS: QueueListItem[] = [
  { id: 'a', title: '26 Sep 2026', meta: 'Amina Yusuf · WP-02 Frame' },
  { id: 'b', title: '27 Sep 2026', meta: 'Omar Ali' },
  { id: 'c', title: '28 Sep 2026' },
];

function Harness({ initial = 'a' }: { initial?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return <QueueList items={ITEMS} label="Reports awaiting review" selectedId={selected} onSelect={setSelected} />;
}

describe('QueueList', () => {
  it('renders a listbox of options with the selected one marked', () => {
    renderWithProviders(<Harness />);

    const list = screen.getByRole('listbox', { name: 'Reports awaiting review' });
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    expect(list).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(screen.getByText('Amina Yusuf · WP-02 Frame')).toBeInTheDocument();
  });

  it('moves the selection with ArrowDown / ArrowUp / Home / End', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness />);

    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    // Clamped at the end — no wrap-around.
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('selects the first row on ArrowDown when nothing is selected, and by click', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness initial={null} />);

    screen.getByRole('listbox').focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByText('28 Sep 2026'));
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
  });

  it('is a single tab stop', () => {
    renderWithProviders(<Harness />);
    expect(screen.getByRole('listbox')).toHaveAttribute('tabindex', '0');
    for (const option of screen.getAllByRole('option')) expect(option).not.toHaveAttribute('tabindex');
  });
});

describe('joinQueueMeta', () => {
  it('drops empty parts instead of leaving stray separators', () => {
    expect(joinQueueMeta(['DPR-0415', null, 'Amina', '', undefined, 'WP-02 Frame'])).toBe(
      'DPR-0415 · Amina · WP-02 Frame',
    );
    expect(joinQueueMeta([false, ' '])).toBe('');
  });
});
