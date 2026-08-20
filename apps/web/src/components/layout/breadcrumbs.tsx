import Link from 'next/link';
import { cn } from '@erp/ui';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

/**
 * Platform breadcrumb trail.
 *
 * The last item is always the current page — rendered as plain text, not a link.
 * Intermediate items link to their destinations.
 *
 * Uses schema.org BreadcrumbList markup so search engines understand the hierarchy,
 * though this is primarily an internal enterprise tool.
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol
        className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground"
        itemScope
        itemType="https://schema.org/BreadcrumbList"
      >
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li
              key={item.label}
              className="flex items-center gap-x-1"
              itemProp="itemListElement"
              itemScope
              itemType="https://schema.org/ListItem"
            >
              {index > 0 ? (
                <ChevronIcon />
              ) : null}

              {isLast || !item.href ? (
                <span
                  className={cn(
                    'truncate',
                    isLast ? 'font-medium text-foreground' : 'text-muted-foreground',
                  )}
                  aria-current={isLast ? 'page' : undefined}
                  itemProp="name"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="truncate underline-offset-4 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                  itemProp="item"
                >
                  <span itemProp="name">{item.label}</span>
                </Link>
              )}
              <meta itemProp="position" content={String(index + 1)} />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0 text-border"
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}
