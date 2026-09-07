import { Injectable } from '@nestjs/common';
import type { PrismaClient, PlatformFile, PlatformFileLifecycle } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface CreatePlatformFileData {
  organizationId: string;
  originalName: string;
  mimeType: string;
  /** Registered before the bytes exist — the PUT is signed with it. */
  checksumSha256: string;
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
        checksumSha256: data.checksumSha256,
        storageBucket: data.storageBucket,
        storageKey: data.storageKey,
        uploadedBy: data.uploadedBy,
        lifecycle: 'TEMPORARY',
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

  /**
   * The checksum is not written here: it was registered at presign and the upload was signed with
   * it, so overwriting it on confirm would let a client replace the value it was held to.
   */
  markReady(prisma: TenantPrisma, id: string, sizeBytes: number): Promise<PlatformFile> {
    return prisma.platformFile.update({
      where: { id },
      data: { status: 'READY', sizeBytes, confirmedAt: new Date() },
    });
  }

  setLifecycle(
    prisma: TenantPrisma,
    id: string,
    lifecycle: PlatformFileLifecycle,
    reason: string,
  ): Promise<PlatformFile> {
    return prisma.platformFile.update({
      where: { id },
      data: {
        lifecycle,
        lifecycleReason: reason.slice(0, 120),
        ...(lifecycle === 'BOUND' ? { boundAt: new Date() } : {}),
      },
    });
  }

  async setLifecycleMany(
    prisma: TenantPrisma,
    ids: string[],
    lifecycle: PlatformFileLifecycle,
    reason: string,
  ): Promise<number> {
    const result = await prisma.platformFile.updateMany({
      where: { id: { in: ids }, lifecycle: { not: lifecycle } },
      data: { lifecycle, lifecycleReason: reason.slice(0, 120) },
    });
    return result.count;
  }

  /**
   * Abandoned uploads: TEMPORARY past the retention window.
   *
   * The lifecycle filter is the safety property, not the date — a BOUND file can never appear
   * here however old it is. Bounded so one sweep cannot try to delete an unbounded number of
   * objects; the sweep is idempotent, so the remainder goes on the next run.
   */
  findReapable(prisma: TenantPrisma, olderThan: Date, take = 500) {
    return prisma.platformFile.findMany({
      where: { lifecycle: 'TEMPORARY', createdAt: { lt: olderThan } },
      select: { id: true, storageBucket: true, storageKey: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  delete(prisma: TenantPrisma, id: string): Promise<PlatformFile> {
    return prisma.platformFile.delete({ where: { id } });
  }
}
