import type { Metadata } from 'next';
import { Inter, IBM_Plex_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { DirectionProvider } from '@erp/ui';
import './globals.css';

import { QueryProvider } from '@/providers/query-provider';
import { ToastProvider } from '@/providers/toast-provider';
import { themeInitializationScript } from '@/features/theme/theme-script';
import { ThemeRuntime } from '@/features/theme/theme-runtime';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
});

export const metadata: Metadata = {
  title: 'Rukna ERP',
  description: 'Enterprise Resource Planning Platform',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html
      lang={locale}
      dir={dir}
      suppressHydrationWarning
      className={`${inter.variable} ${plexArabic.variable} h-full antialiased`}
    >
      <head>
        <meta name="theme-color" content="#f4f6f8" />
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body className="min-h-full">
        <ThemeRuntime />
        <NextIntlClientProvider messages={messages}>
          {/* Radix primitives do not inherit direction from the DOM — without this they
              fall back to a hard-coded "ltr" and render their subtree left-to-right on an
              Arabic page, regardless of <html dir>. */}
          <DirectionProvider dir={dir}>
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
