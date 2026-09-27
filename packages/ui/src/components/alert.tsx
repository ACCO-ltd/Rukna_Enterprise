import * as React from 'react';

import { cn } from '../lib/utils';
import { Notice, type NoticeTone } from './notice';

type AlertVariant = 'error' | 'warning' | 'success' | 'info';

const VARIANT_TONE: Record<AlertVariant, NoticeTone> = {
  error: 'danger',
  warning: 'attention',
  success: 'success',
  info: 'info',
};

export interface AlertProps
  // `title` is omitted from the native attributes so it can carry rich content here
  // rather than being constrained to a tooltip string.
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  variant?: AlertVariant | null;
  title?: React.ReactNode;
  /**
   * Multiple messages, rendered as a list. The API returns `error.message` as an ARRAY
   * for 400 validation failures — one entry per failed constraint — so those are shown
   * individually rather than concatenated into one unreadable line.
   */
  messages?: string[];
  /** Leading glyph, ~16px. Defaults to the tone's glyph; `null` for none. */
  icon?: React.ReactNode;
  /** Trailing control — a button or link, aligned with the title row. */
  action?: React.ReactNode;
}

/**
 * The feedback message for forms and failed loads — a `Notice` that also accepts the API's
 * array of validation messages. Same look as `Notice` (ADR-035), so a screen never shows two
 * styles of message.
 */
export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ variant, title, messages, icon, action, children, className, ...props }, ref) => (
    <Notice
      ref={ref}
      tone={VARIANT_TONE[variant ?? 'info']}
      title={title}
      icon={icon}
      action={action}
      className={className}
      {...props}
    >
      {messages && messages.length > 0 ? (
        messages.length === 1 ? (
          <p>{messages[0]}</p>
        ) : (
          <ul className={cn('list-disc space-y-1 ps-5')}>
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )
      ) : null}
      {children}
    </Notice>
  ),
);
Alert.displayName = 'Alert';
