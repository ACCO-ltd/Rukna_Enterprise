import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge only knows Tailwind's default font sizes. Our closed type scale
 * (`text-caption`, `text-body-sm`, …) would otherwise be read as a text *colour* and
 * silently drop a real colour class merged alongside it — `cn('text-brand-on-primary',
 * 'text-caption')` lost the colour. Registering the scale keeps size and colour apart.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'h1', 'h2', 'h3', 'body', 'body-sm', 'caption', 'micro'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
