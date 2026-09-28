import * as React from 'react';
import { cva } from 'class-variance-authority';
import { CircleAlert, CircleCheck, History, Info, TriangleAlert } from 'lucide-react';

import { cn } from '../lib/utils';

export type NoticeTone = 'info' | 'attention' | 'danger' | 'historical' | 'success';

const noticeVariants = cva('rounded-panel border px-4 py-3 text-body-sm text-foreground', {
  variants: {
    tone: {
      info: 'border-border bg-surface-subtle',
      attention: 'border-warning/25 bg-warning-subtle',
      danger: 'border-danger/25 bg-danger-subtle',
      historical: 'border-historical/25 bg-historical-subtle',
      success: 'border-success/25 bg-success-subtle',
    },
  },
  defaultVariants: { tone: 'info' },
});

const ICON_TONE: Record<NoticeTone, string> = {
  info: 'text-muted-foreground',
  attention: 'text-warning',
  danger: 'text-danger',
  historical: 'text-historical',
  success: 'text-success',
};

const DEFAULT_ICON: Record<NoticeTone, React.ComponentType<{ size?: number }>> = {
  info: Info,
  attention: TriangleAlert,
  danger: CircleAlert,
  historical: History,
  success: CircleCheck,
};

export interface NoticeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: NoticeTone;
  /** Bold first line — what happened, in words: "Posting is blocked by a match exception". */
  title?: React.ReactNode;
  /** Replaces the tone's default glyph. Pass `null` for none. */
  icon?: React.ReactNode;
  /** One trailing control that resolves the notice — "Retry posting". Never a dismiss. */
  action?: React.ReactNode;
}

/**
 * A notice explains a state in words (ADR-035): why posting is blocked, that a record was
 * reversed, that a period is locked. One per document at most — a stack of them is a page
 * shouting.
 *
 * Tone follows the status registry's meanings. The text stays in `foreground` so it reads;
 * only the glyph and the surface carry the tone. Danger is announced assertively, everything
 * else politely.
 */
export const Notice = React.forwardRef<HTMLDivElement, NoticeProps>(
  ({ tone = 'info', title, icon, action, className, children, ...props }, ref) => {
    const Glyph = DEFAULT_ICON[tone];
    const glyph = icon === undefined ? <Glyph size={16} /> : icon;
    const urgent = tone === 'danger';

    return (
      <div
        ref={ref}
        role={urgent ? 'alert' : 'status'}
        aria-live={urgent ? 'assertive' : 'polite'}
        className={cn(noticeVariants({ tone }), className)}
        {...props}
      >
        {/* The action wraps under the text on a phone rather than squeezing it into a column. */}
        <div className="flex flex-wrap items-start gap-3">
          {glyph ? (
            <span className={cn('mt-0.5 shrink-0', ICON_TONE[tone])} aria-hidden="true">
              {glyph}
            </span>
          ) : null}
          <div className="min-w-0 flex-[1_1_16rem]">
            {title ? <p className="font-semibold text-foreground">{title}</p> : null}
            {children ? (
              <div className={cn('text-foreground/85', title ? 'mt-0.5' : undefined)}>{children}</div>
            ) : null}
          </div>
          {action ? <div className="shrink-0 self-center">{action}</div> : null}
        </div>
      </div>
    );
  },
);
Notice.displayName = 'Notice';
