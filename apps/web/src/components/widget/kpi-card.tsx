import Link from 'next/link';

interface KpiCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  href?: string;
}

export function KpiCard({ label, value, sublabel, href }: KpiCardProps) {
  const inner = (
    <>
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{value}</p>
      {sublabel ? <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="block rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-panel)] transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
      >
        {inner}
      </Link>
    );
  }

  return <div className="rounded-lg border border-border bg-surface p-5 shadow-[var(--shadow-panel)]">{inner}</div>;
}
