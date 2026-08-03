'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { logoutRequest } from '../api/auth-api';
import { clearAuthMarker } from '../session/auth-cookies';
import { sessionStore } from '../session/session-store';

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: logoutRequest,
    // onSettled, not onSuccess: if the revoke call fails (offline, server down) the user
    // still expects to be signed out locally. The server-side token expires on its own.
    onSettled: () => {
      sessionStore.clearSession();
      clearAuthMarker();
      queryClient.clear();

      // Full document load — guarantees no cached financial data from this session
      // survives into the next one.
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    },
  });
}
