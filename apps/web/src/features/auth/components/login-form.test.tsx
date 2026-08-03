import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { sessionStore } from '@/features/auth/session/session-store';
import { ApiError } from '@/lib/api-client';
import { loginRequest } from '@/features/auth/api/auth-api';

import { LoginForm } from './login-form';

vi.mock('@/features/auth/api/auth-api', () => ({
  loginRequest: vi.fn(),
  logoutRequest: vi.fn(),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));



function fakeJwt(payload: Record<string, unknown>): string {
  const encoded = btoa(JSON.stringify(payload));
  return `header.${encoded}.signature`;
}

const validPayload = {
  sub: 'user-1',
  email: 'admin@acco.rukna.app',
  orgId: 'org-1',
  tenantSlug: 'acco',
  roles: ['admin'],
  permissions: ['create:purchase-order'],
  lang: 'en',
};

describe('LoginForm', () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    vi.mocked(loginRequest).mockReset();
    sessionStore.clearSession();
    document.cookie = '__auth=; path=/; Max-Age=0';
    document.cookie = 'lang=; path=/; Max-Age=0';
  });

  it('renders the enterprise tenant identity and language controls', () => {
    renderWithProviders(<LoginForm />);

    expect(screen.getByText('ACCO Ltd')).toBeInTheDocument();
    expect(screen.getByText('Rukna ERP Platform')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch language to English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Switch language to Arabic' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('updates the preferred language and refreshes the route', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.click(screen.getByRole('button', { name: 'Switch language to Arabic' }));

    expect(document.cookie).toContain('lang=ar');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('renders labelled email and password fields', () => {
    renderWithProviders(<LoginForm />);

    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput.type).toBe('text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput.type).toBe('password');
  });

  it('does not call loginRequest when form data is invalid', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(loginRequest).not.toHaveBeenCalled();
    expect(sessionStore.getState().isAuthenticated).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it('sets session and redirects to /dashboard on successful login', async () => {
    const user = userEvent.setup();
    vi.mocked(loginRequest).mockResolvedValue({
      accessToken: fakeJwt(validPayload),
    });

    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText('Email address'), 'admin@acco.rukna.app');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(sessionStore.getState().isAuthenticated).toBe(true);
      expect(sessionStore.getState().user?.email).toBe('admin@acco.rukna.app');
      expect(push).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('shows invalid credentials message on 401', async () => {
    const user = userEvent.setup();
    vi.mocked(loginRequest).mockRejectedValue(new ApiError(401, 'Unauthorized'));

    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText('Email address'), 'admin@acco.rukna.app');
    await user.type(screen.getByLabelText('Password'), 'wrongpassword');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    });
    expect(push).not.toHaveBeenCalled();
    expect(sessionStore.getState().isAuthenticated).toBe(false);
  });

  it('shows generic error message on server error', async () => {
    const user = userEvent.setup();
    vi.mocked(loginRequest).mockRejectedValue(new ApiError(500, 'Internal Server Error'));

    renderWithProviders(<LoginForm />);

    await user.type(screen.getByLabelText('Email address'), 'admin@acco.rukna.app');
    await user.type(screen.getByLabelText('Password'), 'password123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong. Please try again.',
      );
    });
    expect(push).not.toHaveBeenCalled();
  });
});
