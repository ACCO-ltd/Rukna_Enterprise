import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { DirectionProvider } from '@erp/ui';
import './globals.css';

import { QueryProvider } from '@/providers/query-provider';
import { ToastProvider } from '@/providers/toast-provider';
import { themeInitializationScript } from '@/features/theme/theme-script';
import { ThemeRuntime } from '@/features/theme/theme-runtime';


export const metadata: Metadata = {
  title: 'Rukna ERP',
  description: 'Enterprise Resource Planning Platform',
};

/**
 * The app is per-tenant and auth-gated — every route is request-specific, so nothing is
 * statically prerendered. This used to be implied by the layout reading the language cookie;
 * with the system now English-only that read is gone, so the intent is made explicit here.
 */
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();

  return (
    <html
      lang="en"
      dir="ltr"
      suppressHydrationWarning
      className="h-full antialiased"
    >
      <head>
        <meta name="theme-color" content="#f4f6f8" />
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body className="min-h-full">
        <ThemeRuntime />
        <NextIntlClientProvider messages={messages}>
          {/* Radix primitives read direction from context, not the DOM; the app is LTR-only. */}
          <DirectionProvider dir="ltr">
            {/* Above QueryProvider: a mutation is what raises a toast, so the provider it
                calls has to already be mounted around it. */}
            <ToastProvider>
              <QueryProvider>{children}</QueryProvider>
            </ToastProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
