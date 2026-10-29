import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class SavedViewsRepository {
  /** The caller's own views plus every published one, on one list. */
  listVisible(prisma: TenantPrisma, organizationId: string, listKey: string, userId: string) {
    return prisma.savedView.findMany({
      where: { organizationId, listKey, OR: [{ ownerUserId: userId }, { published: true }] },
      orderBy: [{ published: 'desc' }, { createdAt: 'asc' }],
    });
  }

  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.savedView.findFirst({ where: { id, organizationId } });
  }

  countOwned(prisma: TenantPrisma, organizationId: string, listKey: string, userId: string) {
    return prisma.savedView.count({ where: { organizationId, listKey, ownerUserId: userId } });
  }

  findOwnedByName(prisma: TenantPrisma, organizationId: string, listKey: string, userId: string, name: string) {
    return prisma.savedView.findFirst({
      where: { organizationId, listKey, ownerUserId: userId, name: { equals: name, mode: 'insensitive' } },
    });
  }

  create(
    prisma: TenantPrisma,
    data: { organizationId: string; listKey: string; name: string; state: Prisma.InputJsonValue; ownerUserId: string },
  ) {
    return prisma.savedView.create({ data });
  }

  update(
    prisma: TenantPrisma,
    id: string,
    data: { name?: string; state?: Prisma.InputJsonValue; published?: boolean },
  ) {
    return prisma.savedView.update({ where: { id }, data });
  }

  delete(prisma: TenantPrisma, id: string) {
    return prisma.savedView.delete({ where: { id } });
  }
}
