'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';

import { ApiError } from '@/lib/api-client';
import { loginRequest, type LoginCredentials } from '../api/auth-api';
import { setAuthMarker } from '../session/auth-cookies';
import { sessionStore } from '../session/session-store';

export function useLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mutation = useMutation({
    mutationFn: (credentials: LoginCredentials) => loginRequest(credentials),
    onSuccess: ({ accessToken }) => {
      const user = sessionStore.setFromAccessToken(accessToken);
      if (!user) {
        sessionStore.clearSession();
        return;
      }

      // Routing hint for middleware — not a security boundary. See auth-cookies.ts.
      setAuthMarker();


      // Only same-origin relative paths — never redirect to an attacker-supplied URL.
      const next = searchParams.get('next');
      router.push(isSafeRedirect(next) ? next : '/dashboard');
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

/** Rejects protocol-relative (`//evil.com`) and absolute URLs. */
function isSafeRedirect(next: string | null): next is string {
  return Boolean(next) && next!.startsWith('/') && !next!.startsWith('//');
}
