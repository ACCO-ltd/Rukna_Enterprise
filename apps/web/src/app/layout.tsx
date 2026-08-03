import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { DirectionProvider } from '@erp/ui';
import './globals.css';

import { QueryProvider } from '@/providers/query-provider';

const geist = Geist({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Rukna ERP',
  description: 'Enterprise Resource Planning Platform',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className={`${geist.className} h-full antialiased`}>
      <body className="min-h-full">
        <NextIntlClientProvider messages={messages}>
          {/* Radix primitives do not inherit direction from the DOM — without this they
              fall back to a hard-coded "ltr" and render their subtree left-to-right on an
              Arabic page, regardless of <html dir>. */}
          <DirectionProvider dir={dir}>
            <QueryProvider>{children}</QueryProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
