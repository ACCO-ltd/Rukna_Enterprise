'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';

import { loginRequest, type LoginCredentials } from '../api/auth-api';
import { decodeJwt } from '../session/decode-jwt';
import { sessionStore } from '../session/session-store';

export function useLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return useMutation({
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

      const next = searchParams.get('next');
      router.push(next && next.startsWith('/') ? next : '/dashboard');
    },
  });
}
