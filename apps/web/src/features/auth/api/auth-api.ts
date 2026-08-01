import type { TokenPair } from '@erp/types';

import { apiClient } from '@/lib/api-client';

export interface LoginCredentials {
  email: string;
  password: string;
}

export function loginRequest(credentials: LoginCredentials): Promise<TokenPair> {
  return apiClient<TokenPair>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
    skipAuth: true,
  });
}

export function logoutRequest(refreshToken: string): Promise<void> {
  return apiClient<void>('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refreshToken }),
  });
}
