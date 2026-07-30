'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { loginRequest, type LoginCredentials } from '../api/auth-api';

export function useLogin() {
  const router = useRouter();

  return useMutation({
    mutationFn: (credentials: LoginCredentials) => loginRequest(credentials),
    onSuccess: (data) => {
      document.cookie = `accessToken=${data.accessToken}; path=/; samesite=lax`;
      document.cookie = `refreshToken=${data.refreshToken}; path=/; samesite=lax`;
      router.push('/dashboard');
    },
  });
}
