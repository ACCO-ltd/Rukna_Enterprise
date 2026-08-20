import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { sessionStore } from '@/features/auth/session/session-store';

import { AppShell } from './app-shell';

const refresh = vi.fn();
let pathname = '/dashboard';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/features/auth/api/auth-api', () => ({
  loginRequest: vi.fn(),
  logoutRequest: vi.fn().mockResolvedValue(undefined),
}));

// next/link renders a real anchor, and jsdom cannot perform a navigation. Suppress the
// document load while still invoking the component's own onClick, which is what closes
// the drawer.
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    onClick,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));


function fakeJwt(): string {
  const payload = {
    sub: 'user-1',
    email: 'admin@acco.com',
    orgId: 'org-1',
    tenantSlug: 'acco',
    roles: ['ADMIN'],
    // Covers every sidebar domain: portfolio, accounting, procurement, administration.
    permissions: [
      'view:project',
      'view:client',
      'view:receipt',
      'view:accounting',
      'view:procurement',
      'manage:user',
    ],
  };
  return `header.${btoa(JSON.stringify(payload))}.signature`;
}

function renderShell() {
  return renderWithProviders(
    <AppShell>
      <p>Page content</p>
    </AppShell>,
    {},
  );
}

beforeEach(() => {
  pathname = '/dashboard';
  refresh.mockReset();
  sessionStore.clearSession();
  sessionStore.setFromAccessToken(fakeJwt());
  window.localStorage.removeItem('rukna.sidebar.collapsed');
  window.localStorage.removeItem('rukna.theme.preference');
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('--sidebar-width');
  document.body.style.overflow = '';
});

describe('AppShell — navigation', () => {
  it('collapses the desktop sidebar and persists the compact preference', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(window.localStorage.getItem('rukna.sidebar.collapsed')).toBe('true');
    expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('5rem');
  });

  it('renders the live destinations across all visible domains', () => {
    renderShell();

    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!;
    const links = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent?.trim());

    // Standalone: Dashboard
    expect(links).toContain('Dashboard');

    // Projects domain items
    expect(links).toContain('Projects');
    expect(links).toContain('Clients');

    // Accounting domain items
    expect(links).toContain('Receipts');
    expect(links).toContain('Journals');

    // Contracts is no longer a standalone sidebar destination.
    expect(links).not.toContain('Contracts');
  });

  it('marks the current route with aria-current on the nav item', () => {
    pathname = '/projects/abc123';
    renderShell();

    // The domain header link (/projects) and the item link (/projects) are both rendered.
    // Only the item carries aria-current; the domain header is always a navigation affordance.
    const projectLinks = screen.getAllByRole('link', { name: 'Projects' });
    const activeItem = projectLinks.find((el) => el.getAttribute('aria-current') === 'page');
    expect(activeItem).toBeDefined();

    // Dashboard item is NOT active on a projects route.
    expect(screen.getAllByRole('link', { name: 'Dashboard' })[0]).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('exposes a skip link to the main landmark', () => {
    renderShell();

    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
  });
});

describe('AppShell — mobile drawer', () => {
  it('is closed until the menu button is pressed', () => {
    renderShell();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens, locks body scroll, and closes on Escape', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));

    expect(screen.getByRole('dialog', { name: 'Main navigation' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getAllByText('Projects').length).toBeGreaterThan(0);
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.body.style.overflow).toBe('');
  });

  it('closes via the close button', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await user.click(screen.getByRole('button', { name: 'Close navigation menu' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('closes when a destination inside it is chosen', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }));

    const dialog = screen.getByRole('dialog');
    // The domain header link navigates and calls onNavigate, which closes the drawer.
    // Pick the first link named 'Projects' (the domain header) to trigger this.
    await user.click(within(dialog).getAllByRole('link', { name: 'Projects' })[0]!);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('AppShell — header', () => {
  it('applies and persists an explicit color theme from the account menu', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(await screen.findByText('Dark'));

    expect(window.localStorage.getItem('rukna.theme.preference')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('shows the brand and tenant slug in the sidebar', () => {
    sessionStore.setFromAccessToken(fakeJwt());
    renderShell();

    expect(screen.getByText('Rukna ERP')).toBeInTheDocument();
    // The tenant slug appears in both the sidebar brand header and the user footer.
    expect(screen.getAllByText('acco').length).toBeGreaterThanOrEqual(1);
  });

  it('renders without a session rather than crashing', () => {
    sessionStore.clearSession();
    renderShell();

    // Brand always present; no crash when no user is signed in.
    expect(screen.getByText('Rukna ERP')).toBeInTheDocument();
    // Avatar button still renders (shows "??" initials).
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument();
  });

  it('shows the signed-in email in the sidebar footer and in the account menu', async () => {
    const user = userEvent.setup();
    sessionStore.setFromAccessToken(fakeJwt());
    renderShell();

    // The sidebar user footer surfaces the email directly — no menu interaction needed.
    expect(screen.getAllByText('admin@acco.com').length).toBeGreaterThanOrEqual(1);

    // Opening the account menu also shows sign-out.
    await user.click(screen.getByRole('button', { name: 'Account menu' }));

    await waitFor(() => {
      expect(screen.getByText('Sign out')).toBeInTheDocument();
    });
  });

  it('clears the session and leaves for /login on sign out', async () => {
    const user = userEvent.setup();
    sessionStore.setFromAccessToken(fakeJwt());
    document.cookie = '__auth=1; path=/';

    let assignedHref: string | null = null;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        pathname: '/dashboard',
        search: '',
        hostname: 'localhost',
        get href() {
          return assignedHref ?? '';
        },
        set href(value: string) {
          assignedHref = value;
        },
      },
    });

    renderShell();

    // Open the user menu first, then click sign out.
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await waitFor(() => expect(screen.getByText('Sign out')).toBeInTheDocument());
    await user.click(screen.getByText('Sign out'));

    await waitFor(() => {
      expect(assignedHref).toBe('/login');
    });
    expect(sessionStore.getState().isAuthenticated).toBe(false);
    expect(document.cookie).not.toContain('__auth=1');
  });
});
