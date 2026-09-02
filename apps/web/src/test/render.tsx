import { type ReactElement, type ReactNode } from 'react';
import { afterEach } from 'vitest';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { sessionStore } from '@/features/auth/session/session-store';
import { ToastProvider } from '@/providers/toast-provider';

// Clear any session seeded via renderWithProviders after each test so permission
// state never leaks between tests.
afterEach(() => {
  sessionStore.clearSession();
});

import enCommon from '../../messages/en/common.json';
import enAuth from '../../messages/en/auth.json';
import enPlatform from '../../messages/en/platform.json';
import enAccounting from '../../messages/en/accounting.json';
import enProcurement from '../../messages/en/procurement.json';
import enCommercial from '../../messages/en/commercial.json';
import enDocuments from '../../messages/en/documents.json';
import enProgress from '../../messages/en/progress.json';
import enProjectTypes from '../../messages/en/project-types.json';

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
  en: {
    common: enCommon,
    auth: enAuth,
    platform: enPlatform,
    accounting: enAccounting,
    procurement: enProcurement,
    commercial: enCommercial,
    documents: enDocuments,
    progress: enProgress,
    projectTypes: enProjectTypes,
  },
} as const;

interface WrapperProps {
  children: ReactNode;
}

interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Overrides the real catalogue. Use only when testing i18n behaviour itself. */
  messages?: AbstractIntlMessages;
  locale?: 'en';
  /**
   * Permission strings to grant for this render. Seeds the session store with a synthetic
   * user holding exactly these permissions; the store is cleared automatically after each
   * test. Omit when the test is verifying the no-permission path.
   */
  permissions?: string[];
  /**
   * Mount the app toast provider around the tree. Needed only for components that raise a
   * toast (a mutation). Off by default because the toast region is a permanent `role="status"`
   * element that collides with loading-state assertions.
   */
  withToast?: boolean;
}

export function renderWithProviders(
  ui: ReactElement,
  { messages, locale = 'en', permissions, withToast = false, ...options }: RenderWithProvidersOptions = {},
): RenderResult {
  if (permissions) {
    sessionStore.setSession({
      accessToken: 'test-token',
      user: {
        id: 'test-user',
        email: 'test@example.com',
        orgId: 'org-1',
        tenantSlug: 'test',
        roles: [],
        permissions,
      },
    });
  }
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
          {/* Opt-in: a component that raises toasts (a mutation) needs the provider mounted
              above it, as `layout.tsx`/`app-shell.tsx` mount it in the app. It is opt-in
              because the toast region is a permanent `role="status"` element, which would
              otherwise collide with the many tests that assert on a loading `role="status"`. */}
          {withToast ? <ToastProvider>{children}</ToastProvider> : children}
        </NextIntlClientProvider>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
