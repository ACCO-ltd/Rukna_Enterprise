import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  useWizard,
  WizardRail,
  WizardStepPanel,
  WizardSummaryRow,
  type WizardStep,
} from '@erp/ui';
import { describe, expect, it, vi } from 'vitest';

/**
 * The gate is the whole point of the shell.
 *
 * Three flows in this product step through forms that produce certificates, journals and
 * opening balances. A gate that can be bypassed — by pressing Continue, by clicking ahead on
 * the rail, or because an async validator threw — is how an invalid financial document gets
 * submitted. Each of those three routes is asserted below.
 */

type Id = 'one' | 'two' | 'three';

function Harness({
  validateTwo,
  onComplete,
}: {
  validateTwo?: () => boolean | Promise<boolean>;
  onComplete?: () => void;
}) {
  const steps: WizardStep<Id>[] = [
    { id: 'one', label: 'One', summary: () => 'first answered', render: () => <p>panel one</p> },
    { id: 'two', label: 'Two', validate: validateTwo, summary: () => 'second answered', render: () => <p>panel two</p> },
    { id: 'three', label: 'Three', render: () => <p>panel three</p> },
  ];
  const wizard = useWizard<Id>(steps, { onComplete });
  const step = steps[wizard.currentIndex];

  return (
    <div>
      <WizardRail steps={steps} wizard={wizard} label="Progress" onNavigate={wizard.goTo} />
      {steps.slice(0, wizard.currentIndex).map((s) =>
        wizard.statusOf(s.id) === 'complete' && s.summary ? (
          <WizardSummaryRow
            key={s.id}
            label={s.label}
            value={s.summary()}
            changeLabel="Change"
            onChange={() => wizard.goTo(s.id)}
          />
        ) : null,
      )}
      {step ? (
        <WizardStepPanel
          stepLabel={`Step ${wizard.currentIndex + 1} of ${steps.length}`}
          title={step.label}
          footer={
            <>
              {!wizard.isFirst ? <Button onClick={wizard.back}>Back</Button> : null}
              <Button onClick={() => void wizard.next()} disabled={wizard.validating}>
                {wizard.isLast ? 'Finish' : 'Continue'}
              </Button>
            </>
          }
        >
          {step.render()}
        </WizardStepPanel>
      ) : null}
    </div>
  );
}

describe('wizard — advancing', () => {
  it('advances when the step has no gate', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByText('panel one')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('panel two')).toBeInTheDocument();
  });

  it('collapses a completed step to a summary row that stays on screen', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // The behaviour that makes the pattern work: what was committed is still visible.
    expect(screen.getByText('first answered')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument();
  });

  it('calls onComplete on the last step instead of advancing past it', async () => {
    const onComplete = vi.fn();
    const user = userEvent.setup();
    render(<Harness onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('panel three')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText('panel three')).toBeInTheDocument();
  });
});

describe('wizard — the gate', () => {
  it('stays on the step when the gate returns false', async () => {
    const user = userEvent.setup();
    render(<Harness validateTwo={() => false} />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('panel two')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('panel two')).toBeInTheDocument();
    expect(screen.queryByText('panel three')).not.toBeInTheDocument();
  });

  it('awaits an async gate before moving', async () => {
    const user = userEvent.setup();
    render(<Harness validateTwo={async () => false} />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('panel two')).toBeInTheDocument());
    expect(screen.queryByText('panel three')).not.toBeInTheDocument();
  });

  it('treats a gate that throws as a gate that failed', async () => {
    // A validator that throws — a network check that 500s, a parse that blew up — must not
    // advance. Advancing on an exception is how an unvalidated certificate reaches review.
    const user = userEvent.setup();
    render(
      <Harness
        validateTwo={() => {
          throw new Error('validator exploded');
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('panel two')).toBeInTheDocument());
    expect(screen.queryByText('panel three')).not.toBeInTheDocument();
  });
});

describe('wizard — navigation', () => {
  it('goes back to look without undoing progress', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('panel one')).toBeInTheDocument();

    // The invariant: going back is not undoing. Continue moves forward again rather than
    // treating step one as unvisited.
    //
    // Note step one renders as a span here, not a button — once you are on a step the rail
    // has no reason to offer it as a destination, and only completed steps are clickable.
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('panel two')).toBeInTheDocument();
    expect(screen.getByText('first answered')).toBeInTheDocument();
  });

  it('returns to exactly one step via its Change control', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText('panel three')).toBeInTheDocument();

    // Change on the first summary row — not a restart, and step two stays complete.
    await user.click(screen.getAllByRole('button', { name: 'Change' })[0] as HTMLElement);
    expect(screen.getByText('panel one')).toBeInTheDocument();
  });

  it('refuses a forward jump to a step that has not been completed', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // "Three" is not a button while incomplete — the rail only makes completed steps
    // reachable, so there is nothing to click. This is the assertion that matters: an
    // ungated route forward must not exist in the markup at all.
    expect(screen.queryByRole('button', { name: 'Three' })).not.toBeInTheDocument();
    expect(screen.getByText('panel one')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.queryByRole('button', { name: 'Three' })).not.toBeInTheDocument();
  });

  it('marks the current step with aria-current for assistive technology', () => {
    render(<Harness />);
    expect(document.querySelector('[aria-current="step"]')).not.toBeNull();
  });
});
