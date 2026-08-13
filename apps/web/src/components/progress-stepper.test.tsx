import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ProgressStepper, type Step } from './progress-stepper';

const STEPS: Step[] = [
  { id: 'details', label: 'Details',  status: 'complete' },
  { id: 'review',  label: 'Review',   status: 'current'  },
  { id: 'confirm', label: 'Confirm',  status: 'upcoming' },
];

describe('ProgressStepper', () => {
  it('renders all step labels', () => {
    renderWithProviders(<ProgressStepper steps={STEPS} />);
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('marks the current step with aria-current="step"', () => {
    renderWithProviders(<ProgressStepper steps={STEPS} />);
    const el = document.querySelector('[aria-current="step"]');
    expect(el).not.toBeNull();
  });

  it('renders a navigation landmark', () => {
    renderWithProviders(<ProgressStepper steps={STEPS} />);
    expect(screen.getByRole('navigation', { name: 'Progress' })).toBeInTheDocument();
  });

  it('shows step number for current and upcoming steps', () => {
    renderWithProviders(<ProgressStepper steps={STEPS} />);
    // Current step is index 1 → shows "2"
    expect(screen.getByText('2')).toBeInTheDocument();
    // Upcoming step is index 2 → shows "3"
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('does not render interactive buttons without onStepClick', () => {
    renderWithProviders(<ProgressStepper steps={STEPS} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders buttons for non-upcoming steps when onStepClick is provided', async () => {
    const onStepClick = vi.fn();
    renderWithProviders(<ProgressStepper steps={STEPS} onStepClick={onStepClick} />);
    // "complete" and "current" steps get buttons; "upcoming" does not
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('calls onStepClick with the step id when a button is clicked', async () => {
    const user = userEvent.setup();
    const onStepClick = vi.fn();
    renderWithProviders(<ProgressStepper steps={STEPS} onStepClick={onStepClick} />);

    await user.click(screen.getAllByRole('button')[0]);
    expect(onStepClick).toHaveBeenCalledWith('details');
  });

  it('renders an error step without interactive button (no onStepClick)', () => {
    const stepsWithError: Step[] = [
      { id: 'a', label: 'A', status: 'error' },
      { id: 'b', label: 'B', status: 'upcoming' },
    ];
    renderWithProviders(<ProgressStepper steps={stepsWithError} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
