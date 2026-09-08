import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { AdminShell } from './admin-shell';

let pathname = '/admin/users';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function renderShell(permissions: string[] = []) {
  return renderWithProviders(
    <AdminShell>
      <p>Screen content</p>
    </AdminShell>,
    { permissions },
  );
}

function tabNames(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Administration sections' });
  return Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim() ?? '');
}

beforeEach(() => {
  pathname = '/admin/users';
});

describe('AdminShell', () => {
  it('renders the six administration screens as one tab row, in IA order', () => {
    renderShell(['manage:district', 'manage:project-type']);

    expect(tabNames()).toEqual([
      'Users',
      'Roles',
      'Districts',
      'Project subtypes',
      'Workflows',
      'Audit logs',
    ]);
  });

  it('owns the h1 so each screen inside it can be an h2', () => {
    renderShell();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Administration');
  });

  it('hides the tabs whose permission the user does not hold', () => {
    // The gate is the nav item's own — there is no second permission list to keep in sync.
    renderShell([]);

    expect(tabNames()).toEqual(['Users', 'Roles', 'Workflows', 'Audit logs']);
  });

  it('marks the active tab, and only that one', () => {
    pathname = '/admin/audit-logs';
    renderShell();

    const current = screen
      .getAllByRole('link')
      .filter((el) => el.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Audit logs');
  });

  it('says where you are once, without a breadcrumb repeating the h1 and the lit tab', () => {
    // "Dashboard > Administration > Roles" named the sidebar row, this h1 and the lit tab over
    // again, and its middle crumb pointed at /admin, which redirects to the first tab.
    pathname = '/admin/roles';
    renderShell();

    expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
  });

  it('offers the same destinations as a picker on a narrow screen', () => {
    // Below md the row becomes the picker the project workspaces already use, rather than
    // scrolling sideways and leaving the later tabs off-screen with nothing saying so.
    renderShell();

    expect(screen.getByRole('combobox', { name: 'Administration sections' })).toBeInTheDocument();
  });

  it('gets out of the way on a deep route, which brings its own workspace chrome', () => {
    // The governance builder has its own header and its own tab bar. Two stacked tab bars is
    // not a hierarchy anyone can read.
    pathname = '/admin/workflows/PURCHASE_ORDER_APPROVAL';
    renderShell();

    expect(screen.queryByRole('navigation', { name: 'Administration sections' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.getByText('Screen content')).toBeInTheDocument();
  });
});
