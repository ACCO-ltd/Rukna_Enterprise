import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { DirectionProvider } from '@erp/ui';
import './globals.css';

import { QueryProvider } from '@/providers/query-provider';
import { ToastProvider } from '@/providers/toast-provider';
import { themeInitializationScript } from '@/features/theme/theme-script';
import { ThemeRuntime } from '@/features/theme/theme-runtime';

/**
 * The product's only typeface.
 *
 * The type scale in `globals.css` is authored for Inter — its comments say so, and the
 * negative tracking on `display`/`h1`/`h2` is tuned to Inter's metrics. The face was lost in
 * 4ea90fb and every screen has been rendering in Arial since, at tracking meant for a
 * different font. Loaded variable through `next/font` so it is self-hosted, preloaded, and
 * never causes a layout shift.
 */
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });


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
      className={`${inter.variable} h-full antialiased`}
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
