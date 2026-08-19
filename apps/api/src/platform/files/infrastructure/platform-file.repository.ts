import { Injectable } from '@nestjs/common';
import type { PrismaClient, PlatformFile } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CreatePlatformFileData {
  organizationId: string;
  originalName: string;
  mimeType: string;
  storageBucket: string;
  storageKey: string;
  uploadedBy: string;
}

@Injectable()
export class PlatformFileRepository {
  create(prisma: TenantPrisma, data: CreatePlatformFileData): Promise<PlatformFile> {
    return prisma.platformFile.create({
      data: {
        organizationId: data.organizationId,
        originalName: data.originalName,
        mimeType: data.mimeType,
        sizeBytes: 0, // real size recorded on confirm (markReady)
        storageBucket: data.storageBucket,
        storageKey: data.storageKey,
        uploadedBy: data.uploadedBy,
      },
    });
  }

  findById(
    prisma: TenantPrisma,
    organizationId: string,
    id: string,
  ): Promise<PlatformFile | null> {
    return prisma.platformFile.findFirst({ where: { id, organizationId } });
  }

  markReady(
    prisma: TenantPrisma,
    id: string,
    sizeBytes: number,
    checksumSha256: string | null,
  ): Promise<PlatformFile> {
    return prisma.platformFile.update({
      where: { id },
      data: { status: 'READY', sizeBytes, checksumSha256, confirmedAt: new Date() },
    });
  }

  setImmutable(prisma: TenantPrisma, id: string): Promise<PlatformFile> {
    return prisma.platformFile.update({ where: { id }, data: { immutable: true } });
  }

  delete(prisma: TenantPrisma, id: string): Promise<PlatformFile> {
    return prisma.platformFile.delete({ where: { id } });
  }
}
