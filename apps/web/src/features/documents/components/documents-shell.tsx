'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';
import { WorkspaceSectionHeader } from '@/components/layout/workspace-section-header';

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
  { key: 'register', segment: '' },
  { key: 'attachments', segment: 'attachments' },
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
      <WorkspaceSectionHeader title={t('title')} description={t('subtitle')} />

      <WorkspaceSubNav
        label={t('title')}
        value={onAttachments ? 'attachments' : 'register'}
        items={VIEWS.map((view) => ({
          value: view.key,
          label: t(`views.${view.key}`),
          href: view.segment ? `${base}/${view.segment}` : base,
        }))}
      />

      {children}
    </div>
  );
}
