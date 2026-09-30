import * as React from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Disclosure } from './disclosure';
import {
  FormDialog,
  FormDialogBody,
  FormDialogFooter,
  FormDialogSection,
} from './form-dialog';
import { SettingRow, SettingsGroup } from './settings-row';
import { Switch } from './switch';

/**
 * The calmer dialog treatment: rules that appear only while content passes under the header and
 * footer, field groups on a panel, a header slot for a step indicator, setting rows, and the
 * Advanced disclosure.
 */

function ScrollingDialog() {
  return (
    <FormDialog
      open
      onOpenChange={() => {}}
      title="New GL account"
      icon={<svg data-testid="icon" />}
      progress={<p>Step 1 of 3</p>}
    >
      <FormDialogBody data-testid="body">
        <FormDialogSection title="Account details">
          <input aria-label="Name" />
        </FormDialogSection>
        <FormDialogSection title="Lines" variant="plain">
          <table />
        </FormDialogSection>
      </FormDialogBody>
      <FormDialogFooter data-testid="footer">
        <button type="button">Save</button>
      </FormDialogFooter>
    </FormDialog>
  );
}

/** jsdom does no layout, so the scroll geometry is set by hand. */
function setGeometry(node: HTMLElement, { top, height, client }: { top: number; height: number; client: number }) {
  Object.defineProperty(node, 'scrollTop', { configurable: true, value: top });
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: height });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: client });
}

describe('FormDialog restyle', () => {
  it('draws no header or footer rule at rest, and each one once content passes under it', () => {
    render(<ScrollingDialog />);
    const header = screen.getByRole('heading', { name: 'New GL account' }).closest('div.shrink-0')!;
    const footer = screen.getByTestId('footer');
    const body = screen.getByTestId('body');

    expect(header.className).toContain('border-transparent');
    expect(footer.className).toContain('border-transparent');

    // Scrolled halfway: content is both above (under the header) and below (under the footer).
    setGeometry(body, { top: 100, height: 800, client: 400 });
    fireEvent.scroll(body);
    expect(header.className).toContain('border-border');
    expect(footer.className).toContain('border-border');

    // At the bottom: nothing left below, so the footer rule goes; the header's stays.
    setGeometry(body, { top: 400, height: 800, client: 400 });
    fireEvent.scroll(body);
    expect(header.className).toContain('border-border');
    expect(footer.className).toContain('border-transparent');
  });

  it('shows the icon tile and the step indicator inside the pinned header', () => {
    render(<ScrollingDialog />);
    const header = screen.getByRole('heading', { name: 'New GL account' }).closest('div.shrink-0')!;

    expect(header).toContainElement(screen.getByTestId('icon'));
    expect(header).toContainElement(screen.getByText('Step 1 of 3'));
    // Decorative: the title alone names the dialog.
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('sets a section on a grey panel by default, and not when it is plain', () => {
    render(<ScrollingDialog />);

    const panel = screen.getByRole('textbox', { name: 'Name' }).parentElement!;
    expect(panel.className).toContain('bg-surface-subtle');
    const plain = screen.getByRole('table').parentElement!;
    expect(plain.className).not.toContain('bg-surface-subtle');
    expect(screen.getByRole('region', { name: 'Account details' })).toBeInTheDocument();
  });
});

describe('SettingRow', () => {
  function Row() {
    const [on, setOn] = React.useState(true);
    return (
      <SettingsGroup>
        <SettingRow htmlFor="posting" label="Accepts postings" description="Turn off for a heading.">
          <Switch id="posting" aria-describedby="posting-description" checked={on} onCheckedChange={setOn} />
        </SettingRow>
      </SettingsGroup>
    );
  }

  it('toggles from its words, and describes the control', async () => {
    const user = userEvent.setup();
    render(<Row />);
    const control = screen.getByRole('switch', { name: 'Accepts postings' });

    expect(control).toHaveAttribute('aria-checked', 'true');
    expect(control).toHaveAccessibleDescription('Turn off for a heading.');
    await user.click(screen.getByText('Accepts postings'));
    expect(control).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Disclosure', () => {
  it('starts folded, opens on click, and keeps what was typed while folded again', async () => {
    const user = userEvent.setup();
    render(
      <Disclosure label="Advanced" hint="Normal balance, posting policy">
        <input aria-label="Normal balance" />
      </Disclosure>,
    );
    const toggle = screen.getByRole('button', { name: /Advanced/ });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Normal balance')).not.toBeVisible();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.type(screen.getByLabelText('Normal balance'), 'Credit');

    await user.click(toggle);
    await user.click(toggle);
    expect(screen.getByLabelText('Normal balance')).toHaveValue('Credit');
  });

  it('follows the open state it is given', () => {
    const { rerender } = render(
      <Disclosure label="Advanced" open={false}>
        <p>Inside</p>
      </Disclosure>,
    );
    expect(screen.getByText('Inside')).not.toBeVisible();

    rerender(
      <Disclosure label="Advanced" open>
        <p>Inside</p>
      </Disclosure>,
    );
    expect(screen.getByText('Inside')).toBeVisible();
  });
});

describe('FormDialog restyle — content that arrives later', () => {
  it("re-measures when the body's content changes without a scroll", async () => {
    function Late() {
      const [more, setMore] = React.useState(false);
      return (
        <FormDialog open onOpenChange={() => {}} title="Late">
          <FormDialogBody data-testid="late-body">
            <button type="button" onClick={() => setMore(true)}>
              Load
            </button>
            {more ? <p>Arrived</p> : null}
          </FormDialogBody>
          <FormDialogFooter data-testid="late-footer">
            <span />
          </FormDialogFooter>
        </FormDialog>
      );
    }
    const user = userEvent.setup();
    render(<Late />);
    const body = screen.getByTestId('late-body');
    expect(screen.getByTestId('late-footer').className).toContain('border-transparent');

    // The body is a fixed height (a phone): it does not resize, its content just grows.
    setGeometry(body, { top: 0, height: 900, client: 400 });
    await user.click(screen.getByRole('button', { name: 'Load' }));

    await screen.findByText('Arrived');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('late-footer').className).toContain('border-border');
  });
});
