import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

interface WrapperProps {
  children: ReactNode;
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  messages?: AbstractIntlMessages;
  locale?: 'en' | 'ar';
}

export function renderWithProviders(
  ui: ReactElement,
  { messages = {}, locale = 'en', ...options }: RenderWithProvidersOptions = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
