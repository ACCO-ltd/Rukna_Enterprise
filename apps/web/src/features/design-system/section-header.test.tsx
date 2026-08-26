import { render, screen } from '@testing-library/react';
import { SectionHeader } from '@erp/ui';
import { describe, expect, it } from 'vitest';

/**
 * SectionHeader — a section title + hairline rule, promoted out of the project overview so
 * IPA and IPC details can share it (Round-2 A3). These pin the contract the two detail pages
 * rely on: a level-2 heading, an optional `id` for `aria-labelledby`, and an action slot.
 */
describe('SectionHeader', () => {
  it('renders the title as a level-2 heading', () => {
    render(<SectionHeader title="Summary" />);

    expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument();
  });

  it('wires the heading id so a section can label itself by it', () => {
    render(
      <section aria-labelledby="sec-heading">
        <SectionHeader id="sec-heading" title="Summary" />
      </section>,
    );

    // aria-labelledby resolves through the heading id to give the region an accessible name.
    expect(screen.getByRole('region', { name: 'Summary' })).toBeInTheDocument();
  });

  it('renders an optional action alongside the title', () => {
    render(
      <SectionHeader title="Project details">
        <a href="/edit">Edit information</a>
      </SectionHeader>,
    );

    expect(screen.getByRole('link', { name: 'Edit information' })).toBeInTheDocument();
  });
});
