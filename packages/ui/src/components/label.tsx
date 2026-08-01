import * as React from 'react';

import { cn } from '../lib/utils';

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn('block text-sm font-medium text-gray-700 dark:text-gray-300', className)}
      {...props}
    />
  ),
);
Label.displayName = 'Label';
