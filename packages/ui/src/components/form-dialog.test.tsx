import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  FormDialog,
  FormDialogBody,
  FormDialogClose,
  FormDialogFooter,
  FormDialogSection,
  type FormDialogProps,
} from './form-dialog';

function Harness(props: Partial<FormDialogProps> & { onClosed?: () => void }) {
  const { onClosed, ...rest } = props;
  const [open, setOpen] = React.useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <FormDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClosed?.();
        }}
        title="Item 2.1"
        subtitle="Measurement and pricing"
        {...rest}
      >
        <FormDialogBody>
          <FormDialogSection title="Measurement" description="How the quantity is counted.">
            <label htmlFor="qty">Quantity</label>
            <input id="qty" defaultValue="12" />
          </FormDialogSection>
        </FormDialogBody>
        <FormDialogFooter>
          <FormDialogClose asChild>
            <button type="button">Cancel</button>
          </FormDialogClose>
          <button type="button">Save</button>
        </FormDialogFooter>
      </FormDialog>
    </>
  );
}

describe('FormDialog', () => {
  it('is a labelled, described modal dialog', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Item 2.1' });
    expect(dialog).toHaveAccessibleDescription('Measurement and pricing');
    expect(screen.getByRole('heading', { name: 'Item 2.1' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Measurement' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('omits aria-describedby when there is no subtitle', () => {
    render(<Harness subtitle={undefined} />);
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-describedby');
  });

  it.each([
    ['md', 'sm:max-w-[560px]'],
    ['lg', 'sm:max-w-[720px]'],
    ['xl', 'sm:max-w-[960px]'],
    ['2xl', 'sm:max-w-[1200px]'],
  ] as const)('size %s caps the width at %s, never wider than the viewport', (size, cls) => {
    render(<Harness size={size} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-size', size);
    expect(dialog.className).toContain(cls);
    expect(dialog.className).toContain('sm:w-[calc(100vw-2rem)]');
    // Full screen below sm, capped at ~90dvh above it.
    expect(dialog.className).toContain('h-dvh');
    expect(dialog.className).toContain('w-dvw');
    expect(dialog.className).toContain('sm:max-h-[90dvh]');
  });

  it('defaults to md', () => {
    render(<Harness />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-size', 'md');
  });

  it('focuses the first field on open, not the close button', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByLabelText('Quantity')).toHaveFocus());
  });

  it("initialFocus='dialog' focuses the dialog itself", async () => {
    render(<Harness initialFocus="dialog" />);
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
  });

  it('closes on Escape when clean', async () => {
    const onClosed = vi.fn();
    render(<Harness onClosed={onClosed} />);
    await userEvent.keyboard('{Escape}');
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('dirty guard', () => {
    it('asks before discarding on Escape, and keeps editing on "Keep editing"', async () => {
      const onClosed = vi.fn();
      render(<Harness dirty onClosed={onClosed} />);

      await userEvent.keyboard('{Escape}');
      const confirm = await screen.findByRole('dialog', { name: 'Discard unsaved changes?' });
      expect(confirm).toBeInTheDocument();
      expect(onClosed).not.toHaveBeenCalled();
      // The safe answer has focus, so Enter keeps the edits rather than throwing them away.
      await waitFor(() =>
        expect(screen.getAllByRole('button', { name: 'Keep editing' }).find((b) => b.textContent === 'Keep editing')).toHaveFocus(),
      );

      // The confirmation's ✕ carries the same name as its Keep editing button.
      await userEvent.click(screen.getAllByRole('button', { name: 'Keep editing' })[0]!);
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('dialog', { name: 'Item 2.1' })).toBeInTheDocument();
      expect(onClosed).not.toHaveBeenCalled();
    });

    it('closes after "Discard changes"', async () => {
      const onClosed = vi.fn();
      render(<Harness dirty onClosed={onClosed} />);

      await userEvent.click(screen.getByRole('button', { name: 'Close' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

      expect(onClosed).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('guards a FormDialogClose Cancel the same way', async () => {
      const onClosed = vi.fn();
      render(<Harness dirty onClosed={onClosed} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
      expect(onClosed).not.toHaveBeenCalled();
    });

    it('takes translated discard copy', async () => {
      render(
        <Harness
          dirty
          discardLabels={{ title: 'Throw away edits?', confirm: 'Throw away', cancel: 'Stay' }}
        />,
      );
      await userEvent.keyboard('{Escape}');
      expect(await screen.findByRole('dialog', { name: 'Throw away edits?' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Throw away' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Stay' }).length).toBeGreaterThan(0);
    });
  });

  describe('busy guard', () => {
    it('blocks Escape and disables the close button while busy', async () => {
      const onClosed = vi.fn();
      render(<Harness busy dirty onClosed={onClosed} />);
      const dialog = screen.getByRole('dialog', { name: 'Item 2.1' });
      expect(dialog).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();

      await userEvent.keyboard('{Escape}');
      expect(onClosed).not.toHaveBeenCalled();
      // Busy wins over dirty: nothing to ask while the save is still deciding the outcome.
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Item 2.1' })).toBeInTheDocument();
    });

    it('blocks a FormDialogClose Cancel while busy', async () => {
      const onClosed = vi.fn();
      render(<Harness busy onClosed={onClosed} />);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(onClosed).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('wraps body and footer in a form when onSubmit is given', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <FormDialog open onOpenChange={() => {}} title="New unit" onSubmit={onSubmit}>
        <FormDialogBody>
          <label htmlFor="code">Code</label>
          <input id="code" />
        </FormDialogBody>
        <FormDialogFooter>
          <button type="submit">Save</button>
        </FormDialogFooter>
      </FormDialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('puts the footer start slot before the actions', () => {
    render(
      <FormDialog open onOpenChange={() => {}} title="Edit item">
        <FormDialogBody>Body</FormDialogBody>
        <FormDialogFooter start={<button type="button">Delete item</button>}>
          <button type="button">Cancel</button>
          <button type="button">Save</button>
        </FormDialogFooter>
      </FormDialog>,
    );
    const names = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter(Boolean);
    expect(names).toEqual(['Delete item', 'Cancel', 'Save']);
  });

  it('submits only itself when rendered inside a page-level form', async () => {
    const outerSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const dialogSubmit = vi.fn();
    render(
      <form onSubmit={outerSubmit}>
        <FormDialog open onOpenChange={() => {}} title="New unit" onSubmit={dialogSubmit}>
          <FormDialogBody>
            <label htmlFor="code">Code</label>
            <input id="code" />
          </FormDialogBody>
          <FormDialogFooter>
            <button type="submit">Save</button>
          </FormDialogFooter>
        </FormDialog>
      </form>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(dialogSubmit).toHaveBeenCalledTimes(1);
    expect(dialogSubmit.mock.calls[0]![0].defaultPrevented).toBe(true);
    expect(outerSubmit).not.toHaveBeenCalled();
  });

  it('pads the pinned header and footer for the safe area on phones', () => {
    render(<Harness />);
    const heading = screen.getByRole('heading', { name: 'Item 2.1' });
    expect(heading.closest('div.shrink-0')!.className).toContain('pt-[max(1rem,env(safe-area-inset-top))]');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.parentElement!.className).toContain('pb-[max(1rem,env(safe-area-inset-bottom))]');
  });

  describe('when the parent drives open and dirty', () => {
    function Controlled({ onOpenChange }: { onOpenChange?: (open: boolean) => void }) {
      const [open, setOpen] = React.useState(true);
      const [dirty, setDirty] = React.useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            Toggle from parent
          </button>
          <button type="button" onClick={() => setDirty((d) => !d)}>
            Toggle dirty
          </button>
          <FormDialog
            open={open}
            onOpenChange={(next) => {
              setOpen(next);
              onOpenChange?.(next);
            }}
            title="Item 2.1"
            dirty={dirty}
          >
            <FormDialogBody>
              <label htmlFor="qty">Quantity</label>
              <input id="qty" />
            </FormDialogBody>
          </FormDialog>
        </>
      );
    }

    // The toggles sit behind the modal (Radix hides them from pointer and a11y), so they are
    // clicked through the DOM, the way a parent's own state change would arrive.
    const parentClick = (name: string) =>
      (screen.getByText(name) as HTMLButtonElement).click();

    it('closes without a prompt when the parent sets open=false while dirty', async () => {
      const onOpenChange = vi.fn();
      render(<Controlled onOpenChange={onOpenChange} />);
      React.act(() => parentClick('Toggle from parent'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('drops a pending discard question when the parent closes the dialog, and does not reshow it on reopen', async () => {
      render(<Controlled />);
      await userEvent.keyboard('{Escape}');
      expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();

      React.act(() => parentClick('Toggle from parent'));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      React.act(() => parentClick('Toggle from parent'));
      expect(await screen.findByRole('dialog', { name: 'Item 2.1' })).toBeInTheDocument();
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument();
    });

    it('drops a pending discard question when the form stops being dirty, and does not revive it', async () => {
      render(<Controlled />);
      await userEvent.keyboard('{Escape}');
      expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();

      React.act(() => parentClick('Toggle dirty'));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument(),
      );

      React.act(() => parentClick('Toggle dirty'));
      expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Item 2.1' })).toBeInTheDocument();
    });

    it('Escape on the discard question closes only the question', async () => {
      const onOpenChange = vi.fn();
      render(<Controlled onOpenChange={onOpenChange} />);
      await userEvent.keyboard('{Escape}');
      expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();

      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: 'Discard unsaved changes?' })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('dialog', { name: 'Item 2.1' })).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });
});
