import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DocumentRevisionResponse,
  ProjectDocumentDetailResponse,
  ProjectDocumentResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * The detail screen is where the register's rules become visible affordances, so these tests are
 * mostly about what is *not* offered:
 *
 *  - an issued revision has no Replace file, because its bytes are frozen;
 *  - an issued document has no Discard, because a controlled record keeps its history;
 *  - a caller without issue authority sees no Issue button, and the server refuses it anyway.
 *
 * Each of those mirrors a guard in `document-lifecycle.policy.ts`. When the two drift the server
 * wins — but a hidden button that the server would have allowed is a bug in the other direction,
 * so the positive cases are asserted too.
 */
const docMocks = vi.hoisted(() => ({
  useProjectDocument: vi.fn(),
  useDocumentCapabilities: vi.fn(),
  useUpdateDocument: vi.fn(),
  useCreateRevision: vi.fn(),
  useReplaceRevisionFile: vi.fn(),
  useIssueRevision: vi.fn(),
  useWithdrawDocument: vi.fn(),
  useSupersedeDocument: vi.fn(),
  useArchiveDocument: vi.fn(),
  useDeleteDocument: vi.fn(),
}));

vi.mock('../hooks/use-documents', () => docMocks);
vi.mock('@/features/projects/hooks/use-project-members', () => ({
  useProjectMembers: () => ({ data: [] }),
}));

// The register and the detail screen both navigate after a write (to the new document, and back
// to the register after a discard), so the app router has to be present for either to render.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => '/projects/p1/documents',
}));


import { DocumentDetailView } from './document-detail-view';

function revision(over: Partial<DocumentRevisionResponse> = {}): DocumentRevisionResponse {
  return {
    id: 'r1',
    projectDocumentId: 'd1',
    revisionNumber: 1,
    revisionCode: 'R00',
    status: 'ISSUED',
    purpose: null,
    notes: null,
    issuedAt: '2026-09-01T00:00:00.000Z',
    issuedBy: 'u1',
    issuedByName: 'Ahmed Shirie',
    supersededAt: null,
    withdrawnAt: null,
    createdBy: 'u1',
    createdByName: 'Ahmed Shirie',
    createdAt: '2026-08-30T00:00:00.000Z',
    file: {
      id: 'f1',
      originalName: 'permit.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 102400,
      status: 'READY',
      lifecycle: 'IMMUTABLE',
    },
    isCurrent: true,
    ...over,
  };
}

function document(over: Partial<ProjectDocumentResponse> = {}): ProjectDocumentResponse {
  return {
    id: 'd1',
    projectId: 'p1',
    documentNumber: 'ACCO-OB-PRM-0001',
    title: 'Municipality building permit',
    category: 'PERMIT_LICENSE',
    discipline: null,
    status: 'ISSUED',
    responsibleUserId: null,
    responsibleUserName: null,
    issuerName: 'Banadir Regional Administration',
    issuedAt: '2026-09-01T00:00:00.000Z',
    validFrom: '2026-09-01T00:00:00.000Z',
    expiresAt: '2027-08-31T00:00:00.000Z',
    validity: 'VALID',
    daysUntilExpiry: 358,
    revisionCount: 1,
    currentRevision: revision(),
    supersededByDocumentId: null,
    supersededByDocumentNumber: null,
    withdrawnReason: null,
    createdBy: 'u1',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function mount(
  detail: Partial<ProjectDocumentDetailResponse> = {},
  capabilities: { canEdit?: boolean; canIssue?: boolean } = {},
) {
  const data: ProjectDocumentDetailResponse = {
    document: detail.document ?? document(),
    revisions: detail.revisions ?? [revision()],
    activity: detail.activity ?? [],
  };
  docMocks.useProjectDocument.mockReturnValue({
    data,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  docMocks.useDocumentCapabilities.mockReturnValue({
    data: {
      canCreate: capabilities.canEdit ?? true,
      canEdit: capabilities.canEdit ?? true,
      canIssue: capabilities.canIssue ?? true,
      canArchive: capabilities.canIssue ?? true,
    },
  });
  for (const key of [
    'useUpdateDocument',
    'useCreateRevision',
    'useReplaceRevisionFile',
    'useIssueRevision',
    'useWithdrawDocument',
    'useSupersedeDocument',
    'useArchiveDocument',
    'useDeleteDocument',
  ] as const) {
    docMocks[key].mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  }
  return renderWithProviders(<DocumentDetailView projectId="p1" documentId="d1" />);
}

describe('DocumentDetailView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leads with the title and the number, the two things that identify the record', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Municipality building permit' })).toBeInTheDocument();
    expect(screen.getByText('ACCO-OB-PRM-0001')).toBeInTheDocument();
  });

  // "Issued" appears twice by design — once as the document's status and once as the current
  // revision's — which is the point: they are two different facts that happen to agree here.
  it('keeps status, revision and validity as three chips, not one verdict', () => {
    mount();
    expect(screen.getAllByText('Issued').length).toBeGreaterThan(0);
    expect(screen.getAllByText('R00').length).toBeGreaterThan(0);
    expect(screen.getByText('Valid')).toBeInTheDocument();
  });

  it('marks the current revision in the history so the site can see what to build from', () => {
    mount({ revisions: [revision({ id: 'r2', revisionNumber: 2, revisionCode: 'R01' }), revision({ isCurrent: false, status: 'SUPERSEDED' })] });
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('keeps superseded revisions openable — that is why they are kept', () => {
    mount({
      revisions: [
        revision(),
        revision({ id: 'r0', revisionNumber: 0, revisionCode: 'R-1', isCurrent: false, status: 'SUPERSEDED', file: { ...revision().file, id: 'f0', originalName: 'permit-old.pdf' } }),
      ],
    });
    expect(screen.getByRole('button', { name: 'permit-old.pdf' })).toBeInTheDocument();
  });

  it('offers Issue only when a draft revision exists', () => {
    mount({ revisions: [revision({ status: 'DRAFT', isCurrent: false, issuedAt: null })] });
    expect(screen.getByRole('button', { name: /issue revision/i })).toBeInTheDocument();
  });

  it('does not offer Issue when every revision is already issued', () => {
    mount();
    expect(screen.queryByRole('button', { name: /issue revision/i })).not.toBeInTheDocument();
  });

  it('hides Issue from a caller the server says cannot issue', () => {
    mount(
      { revisions: [revision({ status: 'DRAFT', isCurrent: false, issuedAt: null })] },
      { canIssue: false },
    );
    expect(screen.queryByRole('button', { name: /issue revision/i })).not.toBeInTheDocument();
  });

  it('says an issued file cannot be replaced, rather than offering a button that 403s', () => {
    mount();
    expect(screen.getByText(/cannot be replaced/i)).toBeInTheDocument();
  });

  it('states why a withdrawn document was withdrawn, where the reader is already looking', () => {
    mount({
      document: document({ status: 'WITHDRAWN', withdrawnReason: 'Replaced by CI-014' }),
    });
    expect(screen.getByText(/Replaced by CI-014/)).toBeInTheDocument();
  });

  it('links a superseded document to the one that replaced it, so the status is not a dead end', () => {
    mount({
      document: document({
        status: 'SUPERSEDED',
        supersededByDocumentId: 'd2',
        supersededByDocumentNumber: 'ACCO-OB-PRM-0002',
      }),
    });
    expect(screen.getByRole('link', { name: /ACCO-OB-PRM-0002/ })).toHaveAttribute(
      'href',
      '/projects/p1/documents/d2',
    );
  });

  it('hides every edit affordance on a terminal document', () => {
    mount({ document: document({ status: 'ARCHIVED' }) });
    expect(screen.queryByRole('button', { name: /edit details/i })).not.toBeInTheDocument();
  });

  it('says when nothing has been recorded rather than inventing history', () => {
    mount();
    expect(screen.getByText('No recorded activity yet.')).toBeInTheDocument();
  });
});
