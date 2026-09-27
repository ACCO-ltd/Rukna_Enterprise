import { describe, expect, it } from 'vitest';
import { cn } from '@erp/ui';

describe('cn — type-scale tokens vs text colours', () => {
  it('keeps a text colour when a type-scale size is merged beside it', () => {
    expect(cn('text-brand-on-primary', 'text-caption')).toBe('text-brand-on-primary text-caption');
    expect(cn('text-muted-foreground', 'text-body-sm')).toBe('text-muted-foreground text-body-sm');
  });

  it('still lets a later size override an earlier one', () => {
    expect(cn('text-caption', 'text-h2')).toBe('text-h2');
    expect(cn('text-sm', 'text-body')).toBe('text-body');
  });
});
