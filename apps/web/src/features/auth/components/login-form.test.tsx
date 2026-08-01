import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { sessionStore } from '@/features/auth/session/session-store';

import { LoginForm } from './login-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const messages = {
  auth: {
    login: {
      title: 'Sign in to your account',
      subtitle: 'Rukna ERP Platform',
      emailLabel: 'Email address',
      emailPlaceholder: 'you@company.com',
      passwordLabel: 'Password',
      passwordPlaceholder: 'Enter your password',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      submitButton: 'Sign in',
      submitting: 'Signing in...',
      invalidCredentials: 'Invalid email or password',
    },
  },
};

describe('LoginForm', () => {
  beforeEach(() => {
    push.mockReset();
    sessionStore.clearSession();
  });

  it('renders labelled email and password fields', () => {
    renderWithProviders(<LoginForm />, { messages });

    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderWithProviders(<LoginForm />, { messages });

    const passwordInput = screen.getByLabelText('Password') as HTMLInputElement;
    expect(passwordInput.type).toBe('password');

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(passwordInput.type).toBe('text');

    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(passwordInput.type).toBe('password');
  });

  it('does not submit invalid credentials to the network', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    renderWithProviders(<LoginForm />, { messages });

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sessionStore.getState().isAuthenticated).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
