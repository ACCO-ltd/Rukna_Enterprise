'use client';

import { useTranslations } from 'next-intl';
import { Button, useToast } from '@erp/ui';
import { Download } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { usePermissions } from '@/features/auth/permissions/can';
import { useProject } from '@/features/projects/hooks/use-project';

import { useDownloadMasterSchedule } from '../hooks/use-programme';

/**
 * Master Schedule P4 (ADR-029) — the "Download PDF" action for the Schedule view.
 *
 * The endpoint is a read gated on `view:project` (the same permission the whole progress workspace
 * requires to render), so any workspace member who can see the Schedule view can download it; the
 * control is still hidden from a user who lacks the view permission, keeping the UI honest with the
 * API boundary. Generation is server-side and synchronous, so the button shows a pending state
 * while the PDF is composed and streamed, and a `401` is not treated as a download failure — the
 * api layer tears the session down and routes to login.
 *
 * The project code (from the loaded project) names the file only when the browser cannot read the
 * server's `Content-Disposition` filename; the button is disabled until the code is available so a
 * download never falls back to an empty name.
 */
export function DownloadMasterScheduleButton({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const { can } = usePermissions();
  const { toast } = useToast();
  const project = useProject(projectId);
  const download = useDownloadMasterSchedule(projectId);

  // Honesty: no disabled stub for a user who cannot read the project — the control simply is not there.
  if (!can('view:project')) return null;

  const projectCode = project.data?.code ?? '';

  function onDownload() {
    download.mutate(projectCode, {
      onError: (error) => {
        if (error instanceof ApiError && error.status === 401) return; // handled: redirected to login
        toast({ tone: 'error', title: t('masterSchedule.downloadFailed') });
      },
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-2"
      onClick={onDownload}
      disabled={download.isPending || !projectCode}
    >
      <Download size={16} strokeWidth={1.9} aria-hidden="true" />
      {download.isPending ? t('masterSchedule.downloading') : t('masterSchedule.download')}
    </Button>
  );
}
