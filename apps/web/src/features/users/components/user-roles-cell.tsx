import { useTranslations } from 'next-intl';
import { Badge } from '@erp/ui';

import type { RoleRef } from '@erp/types';

/** Renders a user's roles as chips, or a muted placeholder when they hold none. */
export function UserRolesCell({ roles }: { roles: RoleRef[] }) {
  const t = useTranslations('platform.users');

  if (roles.length === 0) {
    return <span className="text-xs text-muted-foreground/70">{t('noRoles')}</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <Badge key={role.id} tone="neutral">
          {role.name}
        </Badge>
      ))}
    </div>
  );
}
