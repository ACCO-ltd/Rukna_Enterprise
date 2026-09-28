import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { StepSection } from './step-section';

describe('StepSection', () => {
  it('done: shows a check, the title, one summary line and an Open link — no body', () => {
    renderWithProviders(
      <StepSection
        step={1}
        state="done"
        title="BOQ baselined"
        summary="Version 1 · 11 items in 4 sections"
        doneAction={{ kind: 'open', href: '/projects/p1/boq' }}
      >
        <p>Body</p>
      </StepSection>,
    );

    expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'BOQ baselined' })).toBeInTheDocument();
    expect(screen.getByText('Version 1 · 11 items in 4 sections')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open/ })).toHaveAttribute('href', '/projects/p1/boq');
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
  });

  it('done with edit: "Edit" expands the body in place and "Hide" collapses it', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StepSection step={2} state="done" title="Work packages" summary="4 packages" doneAction={{ kind: 'edit' }}>
        <p>Editor</p>
      </StepSection>,
    );

    expect(screen.queryByText('Editor')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.getByText('Editor')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Editor')).not.toBeInTheDocument();
  });

  it('current: numbered, described, body open and marked as the current step', () => {
    renderWithProviders(
      <StepSection step={2} state="current" title="Work packages" description="Split the scope.">
        <button type="button">Create delivery plan from BOQ</button>
      </StepSection>,
    );

    const section = screen.getByRole('region', { name: 'Work packages' });
    expect(section).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Split the scope.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create delivery plan from BOQ' })).toBeInTheDocument();
    // Not hideable unless asked.
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
  });

  it('current + hideable: offers a Hide toggle', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StepSection step={2} state="current" title="Work packages" hideable>
        <p>Body</p>
      </StepSection>,
    );

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('todo: collapsed by default, carries the Optional pill, and can be shown', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <StepSection step={3} state="todo" title="Planned baseline" optional description="Lock the plan.">
        <p>Curve editor</p>
      </StepSection>,
    );

    expect(screen.getByText('Optional')).toBeInTheDocument();
    expect(screen.queryByText('Curve editor')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('Curve editor')).toBeInTheDocument();
    expect(screen.getByText('Lock the plan.')).toBeInTheDocument();
  });

  it('locked: says what it waits for, renders no body and no buttons', () => {
    const { container } = renderWithProviders(
      <StepSection step={4} state="locked" title="Milestones" waitsFor="work packages">
        <button type="button">Add milestone</button>
      </StepSection>,
    );

    expect(screen.getByRole('img', { name: 'Waiting' })).toBeInTheDocument();
    expect(screen.getByText('Waits for work packages.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('section')).toHaveClass('border-dashed');
  });
});
