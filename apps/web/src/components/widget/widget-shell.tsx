interface WidgetShellProps {
  id: string;
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function WidgetShell({ id, title, action, children }: WidgetShellProps) {
  return (
    <section aria-labelledby={id}>
      <div className="flex items-center justify-between">
        <h2
          id={id}
          className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
        >
          {title}
        </h2>
        {action ? <div>{action}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}
