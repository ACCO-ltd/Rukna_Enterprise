import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ProjectDocumentListResponse,
  ProjectDocumentResponse,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

/**
 * The register's job is to keep three facts apart on one row: where the controlled record is
 * (status), which issue is current (revision), and whether it can be relied on today (validity).
 * Every test here is a claim that one of those three survives being rendered.
 *
 * The other running theme is the null-not-zero doctrine the Finance phase locked in: an
 * unassigned responsible person and a document with no current revision are real, visible facts,
 * not empty cells for the reader to interpret.
 */
const docMocks = vi.hoisted(() => ({
  useProjectDocuments: vi.fn(),
  useDocumentCapabilities: vi.fn(),
  useCreateDocument: vi.fn(),
}));
const memberMocks = vi.hoisted(() => ({ useProjectMembers: vi.fn() }));

vi.mock('../hooks/use-documents', () => docMocks);
vi.mock('@/features/projects/hooks/use-project-members', () => memberMocks);

// The register and the detail screen both navigate after a write (to the new document, and back
// to the register after a discard), so the app router has to be present for either to render.
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => '/projects/p1/documents',
}));


import { DocumentRegisterView } from './document-register-view';

function doc(over: Partial<ProjectDocumentResponse> = {}): ProjectDocumentResponse {
  return {
    id: 'd1',
    projectId: 'p1',
    documentNumber: 'ACCO-OB-STR-0012',
    title: 'First floor slab reinforcement',
    category: 'DRAWING',
    discipline: 'STRUCTURAL',
    status: 'ISSUED',
    responsibleUserId: 'u1',
    responsibleUserName: 'Ahmed Shirie',
    issuerName: 'ACCO Design',
    issuedAt: '2026-09-04T00:00:00.000Z',
    validFrom: null,
    expiresAt: null,
    validity: 'NO_EXPIRY',
    daysUntilExpiry: null,
    revisionCount: 3,
    currentRevision: {
      id: 'r3',
      projectDocumentId: 'd1',
      revisionNumber: 3,
      revisionCode: 'R02',
      status: 'ISSUED',
      purpose: 'ISSUED_FOR_CONSTRUCTION',
      notes: null,
      issuedAt: '2026-09-04T00:00:00.000Z',
      issuedBy: 'u1',
      issuedByName: 'Ahmed Shirie',
      supersededAt: null,
      withdrawnAt: null,
      createdBy: 'u1',
      createdByName: 'Ahmed Shirie',
      createdAt: '2026-09-03T00:00:00.000Z',
      file: {
        id: 'f3',
        originalName: 'slab-r02.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 204800,
        status: 'READY',
        lifecycle: 'IMMUTABLE',
      },
      isCurrent: true,
    },
    supersededByDocumentId: null,
    supersededByDocumentNumber: null,
    withdrawnReason: null,
    createdBy: 'u1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    ...over,
  };
}

function page(
  items: ProjectDocumentResponse[],
  summary: Partial<ProjectDocumentListResponse['summary']> = {},
): ProjectDocumentListResponse {
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 25,
    summary: {
      controlledDocuments: items.length,
      currentDrawings: 1,
      expiringSoon: 0,
      expired: 0,
      draft: 0,
      expiringSoonDays: 30,
      ...summary,
    },
  };
}

function mount(data: ProjectDocumentListResponse | undefined, over: { canCreate?: boolean } = {}) {
  docMocks.useProjectDocuments.mockReturnValue({
    data,
    isPending: data === undefined,
    isError: false,
    refetch: vi.fn(),
  });
  docMocks.useDocumentCapabilities.mockReturnValue({
    data: { canCreate: over.canCreate ?? true, canEdit: true, canIssue: true, canArchive: true },
  });
  docMocks.useCreateDocument.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  memberMocks.useProjectMembers.mockReturnValue({ data: [] });
  return renderWithProviders(<DocumentRegisterView projectId="p1" />);
}

describe('DocumentRegisterView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('leads each row with the document number, not the filename', () => {
    mount(page([doc()]));
    expect(screen.getByText('ACCO-OB-STR-0012')).toBeInTheDocument();
    expect(screen.queryByText('slab-r02.pdf')).not.toBeInTheDocument();
  });

  // Scoped to the data row. The filter selects carry the same labels as options and the
  // "Issued" column header is the same word as the Issued status, so a bare getByText would
  // pass on chrome rather than on the row it is meant to be checking.
  it('renders status, revision and validity as three separate facts', () => {
    mount(page([doc({ validity: 'EXPIRING_SOON', daysUntilExpiry: 12 })]));
    const row = within(screen.getAllByRole('row')[1]!);
    expect(row.getByText('Issued')).toBeInTheDocument();
    expect(row.getByText('R02')).toBeInTheDocument();
    expect(row.getByText('Expiring soon')).toBeInTheDocument();
  });

  it('says how long is left, so "expiring soon" is actionable rather than a colour', () => {
    mount(page([doc({ validity: 'EXPIRING_SOON', daysUntilExpiry: 12 })]));
    expect(screen.getByText('in 12 days')).toBeInTheDocument();
  });

  it('reports an expired document with how long ago it lapsed', () => {
    mount(page([doc({ validity: 'EXPIRED', daysUntilExpiry: -4 })]));
    const row = within(screen.getAllByRole('row')[1]!);
    expect(row.getByText('Expired')).toBeInTheDocument();
    expect(row.getByText('4 days ago')).toBeInTheDocument();
  });

  it('states the expiry threshold rather than leaving the reader to guess it', () => {
    mount(page([doc()], { expiringSoon: 2, expiringSoonDays: 45 }));
    expect(screen.getByText('Within 45 days')).toBeInTheDocument();
  });

  /** A document with no current revision is a real state, not an empty cell. */
  it('names a missing current revision instead of rendering a blank', () => {
    mount(page([doc({ currentRevision: null })]));
    expect(screen.getByText('No current revision')).toBeInTheDocument();
  });

  it('says when nobody is responsible rather than showing an empty column', () => {
    mount(page([doc({ responsibleUserId: null, responsibleUserName: null })]));
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('falls back to the revision number when a document has no revision code', () => {
    const withoutCode = doc();
    mount(page([doc({ currentRevision: { ...withoutCode.currentRevision!, revisionCode: null } })]));
    expect(screen.getByText('R02')).toBeInTheDocument();
  });

  it('offers "Register document" from the empty state, and leads with metadata not a drop zone', () => {
    mount(page([]));
    expect(screen.getByText('No controlled documents yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /register document/i }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/drag files/i)).not.toBeInTheDocument();
  });

  it('hides every write affordance from a caller the server says cannot create', () => {
    mount(page([doc()]), { canCreate: false });
    expect(screen.queryByRole('button', { name: /register document/i })).not.toBeInTheDocument();
  });

  it('shows a skeleton rather than an empty register while loading', () => {
    mount(undefined);
    expect(screen.queryByText('No controlled documents yet')).not.toBeInTheDocument();
  });
});
