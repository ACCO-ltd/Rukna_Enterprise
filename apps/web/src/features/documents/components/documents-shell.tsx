'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FolderOpen, Paperclip } from 'lucide-react';
import { cn } from '@erp/ui';

/**
 * The project Documents workspace shell.
 *
 * Two views, and deliberately no Overview. The register already carries its own summary band, its
 * own filters and its own attention states; a third screen that restated them would be a dashboard
 * built from habit rather than from evidence that anyone needed one. If usage later shows the
 * register cannot answer a question people keep asking, that is when an Overview earns its place.
 *
 * The two views answer genuinely different questions and are not two filters of one list:
 *
 *   Register            what controlled documents is this project accountable for?
 *   Linked Attachments  what evidence exists across the project, and which record owns it?
 *
 * Copying attachments into the register would collapse both into a file manager and make
 * "controlled document" mean nothing.
 */
const VIEWS = [
  { key: 'register', segment: '', icon: FolderOpen },
  { key: 'attachments', segment: 'attachments', icon: Paperclip },
] as const;

export function DocumentsShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const t = useTranslations('documents');
  const pathname = usePathname();
  const base = `/projects/${projectId}/documents`;

  // The detail route lives under the register but is not one of the tabs. It keeps Register
  // marked current so the reader still knows which half of Documents they are in.
  const onAttachments = pathname.startsWith(`${base}/attachments`);

  return (
    // A stable handle for the browser gate. The 44px touch-target rule is asserted against this
    // subtree rather than the whole page: the app shell's own controls (skip link, sidebar
    // toggles, breadcrumb links) are shared by every screen and are their own finding, not this
    // workspace's — scanning the document would make the Documents gate fail on shell debt.
    <div data-qa="documents-workspace" className="space-y-6">
      <div>
        <h1 className="text-h1 font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {/* Horizontally scrollable at 375px rather than wrapping into two rows, so the workspace
          header keeps a fixed height on mobile. Same treatment as the Finance shell. */}
      <nav aria-label={t('title')} className="-mx-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border px-1">
          {VIEWS.map((view) => {
            const href = view.segment ? `${base}/${view.segment}` : base;
            const active = view.segment ? onAttachments : !onAttachments;
            const Icon = view.icon;
            return (
              <li key={view.key}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-body-sm font-medium transition-colors',
                    active
                      ? 'border-brand-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                  {t(`views.${view.key}`)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
