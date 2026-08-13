import { Breadcrumbs, type BreadcrumbItem } from './breadcrumbs';

interface PageHeaderProps {
  /** Breadcrumb trail above the title. */
  breadcrumbs?: BreadcrumbItem[];
  /** Primary page title — rendered as h1. */
  title: string;
  /** Optional secondary line below the title. */
  subtitle?: string;
  /**
   * Right-aligned action slot — typically a "New …" button or lifecycle commands.
   * Stacks below the title on mobile, inline on sm+.
   */
  actions?: React.ReactNode;
}

/**
 * Standard heading block for every top-level page.
 *
 * Renders breadcrumbs (when provided), the h1 title, an optional subtitle, and
 * an actions slot. Place this as the first child of a page's content area.
 *
 * @example
 * <PageHeader
 *   breadcrumbs={[{ label: t('nav.projects'), href: '/projects' }]}
 *   title={project.name}
 *   subtitle={project.code}
 *   actions={<Button asChild><Link href="…">{t('newContract')}</Link></Button>}
 * />
 */
export function PageHeader({ breadcrumbs, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-7">
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <div className="mb-2">
          <Breadcrumbs items={breadcrumbs} />
        </div>
      ) : null}

      <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="truncate text-[28px] font-bold leading-tight tracking-[-0.025em] text-foreground">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
