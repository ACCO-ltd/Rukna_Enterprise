import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ViewSwitcher } from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

/**
 * ViewSwitcher — the level-3 local view switch inside a module (ux-doctrine §5). These pin the
 * contract the Progress workspace relies on: a `tablist` of `tab` buttons with a single selected
 * segment, `onValueChange` on click, and roving arrow-key navigation.
 *
 * The `underline` appearance (2026-09-05) changes only the styling and the active-tab glyph — the
 * accessibility model below is identical in both appearances, which is the point of these tests.
 */
const ITEMS = [
  { value: 'reports', label: 'Daily Reports' },
  { value: 'packages', label: 'Work Packages' },
  { value: 'verified', label: 'Verified Progress' },
];

function Harness({ onValueChange }: { onValueChange?: (value: string) => void }) {
  const [value, setValue] = useState('reports');
  return (
    <ViewSwitcher
      items={ITEMS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange?.(next);
      }}
      aria-label="Progress views"
    />
  );
}

describe('ViewSwitcher', () => {
  it('renders a labelled tablist with a tab per item', () => {
    render(<Harness />);

    const list = screen.getByRole('tablist', { name: 'Progress views' });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Work Packages' })).toBeInTheDocument();
  });

  it('marks exactly the current value as selected', () => {
    render(<Harness />);

    expect(screen.getByRole('tab', { name: 'Daily Reports' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Work Packages' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onValueChange with the clicked value', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('tab', { name: 'Verified Progress' }));

    expect(onValueChange).toHaveBeenCalledWith('verified');
    expect(screen.getByRole('tab', { name: 'Verified Progress' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('moves selection with the right arrow key (roving focus)', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    // Only the selected tab is tabbable; focus it, then arrow to the next.
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Daily Reports' })).toHaveFocus();

    await user.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenLastCalledWith('packages');
    expect(screen.getByRole('tab', { name: 'Work Packages' })).toHaveFocus();
  });

  it('wraps from the last tab to the first with the right arrow', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    await user.click(screen.getByRole('tab', { name: 'Verified Progress' }));
    await user.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenLastCalledWith('reports');
  });
});

/**
 * Link mode — when `renderLink` is provided, the switcher is a route nav (deep-linkable), not a
 * tablist. The ARIA changes with the mode: a `<nav>` of anchors, not `tab` buttons, with the
 * consumer marking the active link `aria-current="page"`. Commercial relies on this contract.
 */
const LINK_ITEMS = [
  { value: 'overview', label: 'Overview', href: '/projects/p1/commercial' },
  {
    value: 'contract-security',
    label: 'Contract & Security',
    href: '/projects/p1/commercial/contract-security',
  },
  { value: 'applications', label: 'Applications', href: '/projects/p1/commercial/applications' },
];

function renderLinkSwitcher(value: string) {
  return render(
    <ViewSwitcher
      items={LINK_ITEMS}
      value={value}
      aria-label="Commercial views"
      renderLink={({ href, active, className, children, key }) => (
        <a
          key={key}
          href={href}
          aria-current={active ? 'page' : undefined}
          className={className}
        >
          {children}
        </a>
      )}
    />,
  );
}

/**
 * The underline appearance is what Progress uses. It sits directly beneath the level-2 project
 * tabs, so the glyph on the active tab is doing real work: it is a second, non-colour signal of
 * which view is current. An inactive tab must not carry one, or the row becomes a copy of the
 * level-2 bar above it.
 */
describe('ViewSwitcher — underline appearance', () => {
  const WITH_ICONS = [
    { value: 'overview', label: 'Overview', icon: <svg data-testid="icon-overview" /> },
    { value: 'setup', label: 'Plan & Setup', icon: <svg data-testid="icon-setup" /> },
  ];

  it('keeps the tablist accessibility model of the segmented appearance', () => {
    render(
      <ViewSwitcher
        appearance="underline"
        items={WITH_ICONS}
        value="overview"
        onValueChange={vi.fn()}
        aria-label="Progress views"
      />,
    );

    expect(screen.getByRole('tablist', { name: 'Progress views' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Plan & Setup' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('shows the glyph on the active tab only', () => {
    render(
      <ViewSwitcher
        appearance="underline"
        items={WITH_ICONS}
        value="setup"
        onValueChange={vi.fn()}
        aria-label="Progress views"
      />,
    );

    expect(screen.getByTestId('icon-setup')).toBeInTheDocument();
    expect(screen.queryByTestId('icon-overview')).not.toBeInTheDocument();
  });

  it('never shows a glyph in the segmented appearance', () => {
    render(
      <ViewSwitcher
        items={WITH_ICONS}
        value="setup"
        onValueChange={vi.fn()}
        aria-label="Progress views"
      />,
    );

    expect(screen.queryByTestId('icon-setup')).not.toBeInTheDocument();
  });
});

describe('ViewSwitcher — link mode', () => {
  it('renders a labelled nav of links (not a tablist) with the right hrefs', () => {
    renderLinkSwitcher('overview');

    expect(screen.getByRole('navigation', { name: 'Commercial views' })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial',
    );
    expect(screen.getByRole('link', { name: 'Applications' })).toHaveAttribute(
      'href',
      '/projects/p1/commercial/applications',
    );
  });

  it('marks only the active link with aria-current="page"', () => {
    renderLinkSwitcher('contract-security');

    expect(screen.getByRole('link', { name: 'Contract & Security' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Applications' })).not.toHaveAttribute('aria-current');
  });
});
