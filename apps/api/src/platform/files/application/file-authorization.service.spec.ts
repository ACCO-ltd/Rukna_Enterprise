import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { FileAuthorizationService } from './file-authorization.service.js';

/**
 * The P0-1 regression suite.
 *
 * The defect: `/files/*` was authenticated but not authorized, so a member of one project could
 * download or delete evidence from another project — or from another organisation's file id —
 * because the only scope applied was `organizationId`. Every test here is a claim that a specific
 * caller cannot reach a specific file, so a future refactor that quietly widens the scope fails
 * loudly rather than silently.
 */

const ALICE: RequestIdentity = {
  userId: 'alice',
  activeOrganizationId: 'org-1',
  tenantSlug: 'acco',
  roles: [],
  permissions: [PERMISSIONS.projectsView],
};
/** Same organisation, different projects — the lateral-movement case. */
const BOB: RequestIdentity = { ...ALICE, userId: 'bob' };
const ADMIN: RequestIdentity = { ...ALICE, userId: 'root', roles: ['ADMIN'] };

interface FileRow {
  id: string;
  organizationId: string;
  uploadedBy: string;
  lifecycle: 'TEMPORARY' | 'BOUND' | 'IMMUTABLE';
  status: 'PENDING' | 'READY';
  // Phase 7A: the register holds files on REVISIONS, not on the document — a superseded drawing
  // stays readable, which is the whole reason revisions exist.
  documentRevisions: { id: string; projectDocumentId: string; document: { projectId: string } }[];
  dprAttachments: { id: string; dprId: string; dpr: { projectId: string } }[];
  contractAttachments: { id: string; contractId: string; contract: { projectId: string } }[];
  guaranteeAttachments: {
    id: string;
    guaranteeId: string;
    guarantee: { contract: { projectId: string } };
  }[];
  ipaAttachments: {
    id: string;
    applicationId: string;
    application: { contract: { projectId: string } };
  }[];
  ipcAttachments: {
    id: string;
    certificateId: string;
    certificate: { application: { contract: { projectId: string } } };
  }[];
}

/** A revision binding on the given project — the register's owner shape, in one place. */
function revisionOn(projectId: string, id = 'rev-1') {
  return [{ id, projectDocumentId: 'doc-1', document: { projectId } }];
}

function fileRow(over: Partial<FileRow> = {}): FileRow {
  return {
    id: 'file-1',
    organizationId: 'org-1',
    uploadedBy: 'alice',
    lifecycle: 'TEMPORARY',
    status: 'READY',
    documentRevisions: [],
    dprAttachments: [],
    contractAttachments: [],
    guaranteeAttachments: [],
    ipaAttachments: [],
    ipcAttachments: [],
    ...over,
  };
}

/**
 * @param row          what the org-scoped lookup finds (null = another tenant's file, or none)
 * @param memberOf     the projects the caller is actually a member of
 */
function build(row: FileRow | null, memberOf: string[] = []) {
  const prisma = {
    platformFile: { findFirst: jest.fn().mockResolvedValue(row) },
  };
  const projectAccess = {
    assertMember: jest.fn(async (_identity: RequestIdentity, projectId: string) => {
      if (!memberOf.includes(projectId)) throw new ForbiddenException('not a member');
    }),
  };
  const service = new FileAuthorizationService(
    { getClient: () => prisma } as never,
    projectAccess as never,
  );
  return { prisma, projectAccess, service };
}

describe('FileAuthorizationService', () => {
  describe('tenant isolation', () => {
    /**
     * A file in another organisation is *not found*, never *forbidden*: confirming that an id
     * exists elsewhere is itself a disclosure.
     */
    it('reports a file from another organisation as not found', async () => {
      const { service } = build(null);
      await expect(service.assertCanRead(ALICE, 'other-org-file')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('scopes the lookup to the caller organisation', async () => {
      const { prisma, service } = build(fileRow());
      await service.assertCanRead(ALICE, 'file-1');
      expect(prisma.platformFile.findFirst.mock.calls[0][0].where).toEqual({
        id: 'file-1',
        organizationId: 'org-1',
      });
    });
  });

  describe('document revisions', () => {
    const onProjectB = fileRow({
      uploadedBy: 'someone-else',
      lifecycle: 'BOUND',
      documentRevisions: revisionOn('project-b'),
    });

    it('lets a member of the owning project read it', async () => {
      const { service } = build(onProjectB, ['project-b']);
      await expect(service.assertCanRead(BOB, 'file-1')).resolves.toMatchObject({
        owners: [{ kind: 'DOCUMENT_REVISION', projectId: 'project-b' }],
      });
    });

    /** THE defect: same organisation, wrong project. */
    it('denies a member of a different project in the same organisation', async () => {
      const { service } = build(onProjectB, ['project-a']);
      await expect(service.assertCanRead(BOB, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('denies a caller who is a member of nothing', async () => {
      const { service } = build(onProjectB, []);
      await expect(service.assertCanRead(BOB, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    /** Membership is necessary but not sufficient — the permission still has to be held. */
    it('denies a project member who cannot view projects at all', async () => {
      const { service } = build(onProjectB, ['project-b']);
      const noPermission = { ...BOB, permissions: [] };
      await expect(service.assertCanRead(noPermission, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('DPR evidence', () => {
    const evidence = fileRow({
      uploadedBy: 'someone-else',
      lifecycle: 'BOUND',
      dprAttachments: [{ id: 'att-1', dprId: 'dpr-1', dpr: { projectId: 'project-b' } }],
    });

    it('resolves through the report to its project', async () => {
      const { service } = build(evidence, ['project-b']);
      await expect(service.assertCanRead(BOB, 'file-1')).resolves.toMatchObject({
        owners: [{ kind: 'DPR_ATTACHMENT', dprId: 'dpr-1', projectId: 'project-b' }],
      });
    });

    it('denies a member of another project', async () => {
      const { service } = build(evidence, ['project-a']);
      await expect(service.assertCanRead(BOB, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('a file nothing owns', () => {
    /**
     * Between presign and attach there is no business record to speak for the file, so it is
     * private to whoever uploaded it. It is not org-readable, which is what it used to be.
     */
    it('lets the uploader read it', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice' }));
      await expect(service.assertCanRead(ALICE, 'file-1')).resolves.toBeDefined();
    });

    it('denies everyone else in the organisation', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice' }));
      await expect(service.assertCanRead(BOB, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admits an administrator, who already bypasses project membership elsewhere', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice' }));
      await expect(service.assertCanRead(ADMIN, 'file-1')).resolves.toBeDefined();
    });
  });

  describe('delete', () => {
    it('lets the uploader discard their own abandoned upload', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice', lifecycle: 'TEMPORARY' }));
      await expect(service.assertCanDelete(ALICE, 'file-1')).resolves.toBeDefined();
    });

    it('denies another user deleting an abandoned upload that is not theirs', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice', lifecycle: 'TEMPORARY' }));
      await expect(service.assertCanDelete(BOB, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    /**
     * A bound file is deleted by detaching it from its owner, so the owner's own rules run and
     * the register cannot fall out of step with the bytes. Even a member of the right project is
     * refused *here*; they use the register's own endpoint.
     */
    it('refuses to delete a bound file through the file API, even for the owning project', async () => {
      const bound = fileRow({
        lifecycle: 'BOUND',
        documentRevisions: revisionOn('project-b'),
      });
      const { service } = build(bound, ['project-b']);
      await expect(service.assertCanDelete(ALICE, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    /** P0-2: the rule that had a guard and no way to reach it. */
    it('never deletes a finalised file, for anyone, including an administrator', async () => {
      const frozen = fileRow({
        lifecycle: 'IMMUTABLE',
        dprAttachments: [{ id: 'att-1', dprId: 'dpr-1', dpr: { projectId: 'project-b' } }],
      });
      const { service } = build(frozen, ['project-b']);
      await expect(service.assertCanDelete(ADMIN, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('write', () => {
    it('lets the uploader confirm their own upload', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice', lifecycle: 'TEMPORARY' }));
      await expect(service.assertCanWrite(ALICE, 'file-1')).resolves.toBeDefined();
    });

    it('refuses to change a file a record already owns', async () => {
      const bound = fileRow({
        lifecycle: 'BOUND',
        documentRevisions: revisionOn('project-b'),
      });
      const { service } = build(bound, ['project-b']);
      await expect(service.assertCanWrite(ALICE, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses to change a finalised file', async () => {
      const { service } = build(fileRow({ uploadedBy: 'alice', lifecycle: 'IMMUTABLE' }));
      await expect(service.assertCanWrite(ALICE, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('a file with more than one owner', () => {
    const shared = fileRow({
      uploadedBy: 'someone-else',
      lifecycle: 'BOUND',
      documentRevisions: revisionOn('project-a'),
      dprAttachments: [{ id: 'att-1', dprId: 'dpr-1', dpr: { projectId: 'project-b' } }],
    });

    /** Read is a union: one owner granting access is enough. */
    it('is readable through either owner', async () => {
      const viaA = build(shared, ['project-a']);
      await expect(viaA.service.assertCanRead(BOB, 'file-1')).resolves.toBeDefined();

      const viaB = build(shared, ['project-b']);
      await expect(viaB.service.assertCanRead(BOB, 'file-1')).resolves.toBeDefined();
    });

    it('is unreadable by someone in neither', async () => {
      const { service } = build(shared, ['project-c']);
      await expect(service.assertCanRead(BOB, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  /**
   * Phase 7A wired four commercial attachment kinds. Each reaches its project by a different join,
   * and a resolver that got one of those joins wrong would leak another project's contract
   * evidence — silently, because the aggregation that lists these rows scopes correctly.
   */
  describe('commercial evidence', () => {
    const cases = [
      {
        name: 'contract',
        row: {
          contractAttachments: [
            { id: 'a-1', contractId: 'c-1', contract: { projectId: 'project-b' } },
          ],
        },
      },
      {
        name: 'guarantee',
        row: {
          guaranteeAttachments: [
            { id: 'a-1', guaranteeId: 'g-1', guarantee: { contract: { projectId: 'project-b' } } },
          ],
        },
      },
      {
        name: 'IPA',
        row: {
          ipaAttachments: [
            {
              id: 'a-1',
              applicationId: 'i-1',
              application: { contract: { projectId: 'project-b' } },
            },
          ],
        },
      },
      {
        name: 'IPC',
        row: {
          ipcAttachments: [
            {
              id: 'a-1',
              certificateId: 'k-1',
              certificate: { application: { contract: { projectId: 'project-b' } } },
            },
          ],
        },
      },
    ] satisfies { name: string; row: Partial<FileRow> }[];

    it.each(cases)('$name evidence is readable by a member of its project', async ({ row }) => {
      const { service } = build(fileRow({ lifecycle: 'BOUND', ...row }), ['project-b']);
      await expect(service.assertCanRead(BOB, 'file-1')).resolves.toBeDefined();
    });

    it.each(cases)('$name evidence is denied to a member of another project', async ({ row }) => {
      const { service } = build(fileRow({ lifecycle: 'BOUND', ...row }), ['project-a']);
      await expect(service.assertCanRead(BOB, 'file-1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each(cases)('$name evidence is never deletable through the file API', async ({ row }) => {
      const { service } = build(fileRow({ lifecycle: 'BOUND', ...row }), ['project-b']);
      await expect(service.assertCanDelete(BOB, 'file-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
