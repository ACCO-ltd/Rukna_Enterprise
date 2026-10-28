import type { LoginResponse } from '@erp/types';

import { apiClient } from '@/lib/api-client';

export interface LoginCredentials {
  email: string;
  password: string;
}

/** Public: the organisation the subdomain belongs to, so the login page shows its own name. */
export function getTenantBranding(): Promise<{ name: string | null }> {
  return apiClient<{ name: string | null }>('/auth/branding', { skipAuth: true });
}

export function loginRequest(credentials: LoginCredentials): Promise<LoginResponse> {
  return apiClient<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
    skipAuth: true,
  });
}

/**
 * Revokes the refresh token server-side.
 *
 * Takes no arguments: the refresh token is an HttpOnly cookie the browser attaches
 * automatically, and JavaScript cannot read it. `skipAuth` because the endpoint reads the
 * cookie, not the bearer token — and a 401 here must not trigger the refresh-retry cycle.
 * Returns 200 with an empty body.
 */
export function logoutRequest(): Promise<void> {
  return apiClient<void>('/auth/logout', {
    method: 'POST',
    skipAuth: true,
  });
}
