import Link from 'next/link';
import type { ActivityTimelineProps } from '@erp/ui';

/**
 * `renderLink` for `@erp/ui` components that are router-agnostic (`ActivityTimeline`): renders
 * Next's `<Link>`, so a target such as a contract number navigates client-side.
 */
export const renderNextLink: NonNullable<ActivityTimelineProps['renderLink']> = ({
  href,
  className,
  children,
}) => (
  <Link href={href} className={className}>
    {children}
  </Link>
);
