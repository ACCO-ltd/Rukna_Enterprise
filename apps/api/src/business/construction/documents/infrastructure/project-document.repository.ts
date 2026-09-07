import { Injectable } from '@nestjs/common';
import type { PrismaClient, ProjectDocument, DocumentCategory } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CreateProjectDocumentData {
  organizationId: string;
  projectId: string;
  platformFileId: string;
  category: DocumentCategory;
  title: string;
  uploadedBy: string;
}

@Injectable()
export class ProjectDocumentRepository {
  create(prisma: TenantPrisma, data: CreateProjectDocumentData): Promise<ProjectDocument> {
    return prisma.projectDocument.create({ data });
  }

  findByProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.projectDocument.findMany({
      where: { organizationId, projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        platformFile: {
          select: { originalName: true, mimeType: true, sizeBytes: true, status: true },
        },
      },
    });
  }

  /** Includes the file's lifecycle: removal is refused once the file is IMMUTABLE. */
  findOwned(prisma: TenantPrisma, organizationId: string, projectId: string, id: string) {
    return prisma.projectDocument.findFirst({
      where: { id, organizationId, projectId },
      include: { platformFile: { select: { lifecycle: true } } },
    });
  }

  delete(prisma: TenantPrisma, id: string): Promise<ProjectDocument> {
    return prisma.projectDocument.delete({ where: { id } });
  }

  /**
   * Verify a PlatformFile exists in this org and read what attaching it depends on: whether the
   * bytes arrived, whether anything already owns it, and who uploaded it.
   */
  findFileStatus(prisma: TenantPrisma, organizationId: string, fileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, status: true, lifecycle: true, uploadedBy: true },
    });
  }
}
