import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-control border border-transparent text-sm font-semibold transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:shadow-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-brand-primary bg-brand-primary text-brand-on-primary shadow-e1 hover:border-brand-primary-hover hover:bg-brand-primary-hover active:bg-brand-primary-active',
        outline:
          'border-border-strong bg-surface text-foreground shadow-e1 hover:border-border-interactive hover:bg-surface-hover',
        ghost: 'text-foreground hover:bg-surface-hover',
        // Tertiary — no border, no fill, no shadow: an inline text action, not a control.
        // Underlined so it reads as a link even where the accent colour alone isn't enough.
        link: 'border-transparent text-brand-primary underline underline-offset-4 hover:text-brand-primary-hover',
        destructive:
          'border-danger bg-danger text-danger-foreground shadow-e1 hover:border-danger-hover hover:bg-danger-hover',
      },
      size: {
        default: 'h-control px-4 py-2',
        sm: 'h-9 rounded-control px-3',
        lg: 'h-12 px-8',
        icon: 'h-control w-control',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = 'Button';
