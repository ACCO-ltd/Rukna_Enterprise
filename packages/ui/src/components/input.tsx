import * as React from 'react';

import { cn } from '../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type ?? 'text'}
      className={cn(
        'flex h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm placeholder:text-gray-400',
        'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
