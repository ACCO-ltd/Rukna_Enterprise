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
    permissions: [],
    lang: 'en',
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
  document.body.style.overflow = '';
});

describe('AppShell — navigation', () => {
  it('renders only the live destinations', () => {
    renderShell();

    const nav = screen.getAllByRole('navigation', { name: 'Main navigation' })[0]!;
    const links = Array.from(nav.querySelectorAll('a')).map((a) => a.textContent);

    expect(links).toEqual(['Dashboard', 'Projects', 'Clients']);
  });

  it('marks the current route with aria-current', () => {
    pathname = '/projects/abc123';
    renderShell();

    expect(screen.getAllByRole('link', { name: 'Projects' })[0]).toHaveAttribute(
      'aria-current',
      'page',
    );
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
    await user.click(within(dialog).getByRole('link', { name: 'Projects' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('AppShell — header', () => {
  it('shows the tenant and the signed-in user', () => {
    sessionStore.setFromAccessToken(fakeJwt());
    renderShell();

    expect(screen.getByText('acco')).toBeInTheDocument();
    expect(screen.getByText('admin@acco.com')).toBeInTheDocument();
  });

  it('renders without a session rather than crashing', () => {
    renderShell();

    expect(screen.getByText('Rukna ERP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('offers the language toggle with the active locale pressed', () => {
    renderShell();

    expect(screen.getByRole('button', { name: 'Switch language to English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('clears the session and leaves for /login on sign out', async () => {
    const user = userEvent.setup();
    sessionStore.setFromAccessToken(fakeJwt());
    document.cookie = '__auth=1; path=/';

    // jsdom throws on real navigation — capture the destination instead.
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
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => {
      expect(assignedHref).toBe('/login');
    });
    expect(sessionStore.getState().isAuthenticated).toBe(false);
    expect(document.cookie).not.toContain('__auth=1');
  });
});
