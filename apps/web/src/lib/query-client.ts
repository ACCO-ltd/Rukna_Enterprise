import { QueryClient } from '@tanstack/react-query';

export function makeQueryClient(
  options: {
    /** Tests turn retries off so a failure surfaces at once. */
    retry?: boolean;
  } = {},
): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: options.retry === false ? false : 1,
      },
      ...(options.retry === false ? { mutations: { retry: false } } : {}),
    },
  });
}
