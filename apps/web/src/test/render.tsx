import { type ReactElement, type ReactNode } from 'react';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import enCommon from '../../messages/en/common.json';
import enAuth from '../../messages/en/auth.json';
import enPlatform from '../../messages/en/platform.json';
import arCommon from '../../messages/ar/common.json';
import arAuth from '../../messages/ar/auth.json';
import arPlatform from '../../messages/ar/platform.json';

/**
 * The REAL message catalogues, loaded the same way `src/i18n/request.ts` loads them.
 *
 * Tests used to hand-write their own message objects, which meant a component could ask
 * for `platform.actions.approve` while the catalogue actually defined
 * `platform.projects.actions.approve`, and the test would still pass — it was asserting
 * against a fiction. That bug shipped and was only caught in browser QA. Using the real
 * files means a misplaced or missing key fails the test.
 */
const MESSAGES = {
  en: { common: enCommon, auth: enAuth, platform: enPlatform },
  ar: { common: arCommon, auth: arAuth, platform: arPlatform },
} as const;

interface WrapperProps {
  children: ReactNode;
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Overrides the real catalogue. Use only when testing i18n behaviour itself. */
  messages?: AbstractIntlMessages;
  locale?: 'en' | 'ar';
}

export function renderWithProviders(
  ui: ReactElement,
  { messages, locale = 'en', ...options }: RenderWithProvidersOptions = {},
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const resolved = messages ?? (MESSAGES[locale] as unknown as AbstractIntlMessages);

  function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider
          locale={locale}
          messages={resolved}
          // Surface a missing key as a test failure instead of silently rendering the
          // dotted path, which is what let the bug above through.
          onError={(error) => {
            throw error;
          }}
        >
          {children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
