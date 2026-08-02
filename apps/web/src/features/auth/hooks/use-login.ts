'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
import { loginRequest, type LoginCredentials } from '../api/auth-api';
import { decodeJwt } from '../session/decode-jwt';
import { sessionStore } from '../session/session-store';

export function useLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mutation = useMutation({
    mutationFn: (credentials: LoginCredentials) => loginRequest(credentials),
    onSuccess: (tokens) => {
      const payload = decodeJwt(tokens.accessToken);
      if (!payload) {
        sessionStore.clearSession();
        return;
      }

      sessionStore.setSession({
        accessToken: tokens.accessToken,
        user: {
          id: payload.sub,
          email: payload.email,
          orgId: payload.orgId,
          tenantSlug: payload.tenantSlug,
          roles: payload.roles,
          permissions: payload.permissions,
          lang: payload.lang,
        },
      });

      // Indicator cookie so middleware can protect routes.
      // Sprint 2: replace with HttpOnly refresh token cookie set by the API.
      document.cookie = '__auth=1; path=/; SameSite=Lax; Max-Age=604800';

      const next = searchParams.get('next');
      router.push(next && next.startsWith('/') ? next : '/dashboard');
    },
  });

  const errorType =
    mutation.error instanceof ApiError && mutation.error.status === 401
      ? ('credentials' as const)
      : mutation.isError
        ? ('server' as const)
        : null;

  return { ...mutation, errorType };
}
