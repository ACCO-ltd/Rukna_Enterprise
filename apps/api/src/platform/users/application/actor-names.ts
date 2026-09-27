import type { PrismaClient } from '@prisma/client';

/** Shown when a user id no longer resolves — an audit trail must not break on a deleted user. */
export const UNKNOWN_ACTOR = 'Unknown user';

/**
 * Resolves user ids to display names ("Hodan Abdi") in one query, for read models that record
 * who acted. A pure lookup: no permission check, because the caller has already authorised
 * reading the record the names belong to.
 */
export async function loadActorNames(
  prisma: Pick<PrismaClient, 'user'>,
  ids: Iterable<string>,
): Promise<(id: string) => string> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return () => UNKNOWN_ACTOR;
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const byId = new Map(
    users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email]),
  );
  return (id: string) => byId.get(id) ?? UNKNOWN_ACTOR;
}
