import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Combobox } from './combobox';
import { Dialog, DialogContent, DialogTitle } from './dialog';
import { FormDialog, FormDialogBody } from './form-dialog';

/**
 * A modal dialog makes everything outside its content inert, so a Combobox list portalled to
 * the body opened behind the dialog, took no clicks and its search box could not take focus.
 * Inside a dialog the list must portal into the dialog itself.
 */

const OPTIONS = [
  { value: '51100', label: '51100 · Cement and concrete' },
  { value: '51200', label: '51200 · Steel and reinforcement' },
];

function Picker() {
  return (
    <Combobox
      id="acct"
      value=""
      onChange={() => {}}
      options={OPTIONS}
      placeholder="Choose an account"
      searchPlaceholder="Search accounts"
      emptyLabel="No match"
    />
  );
}

describe('Combobox inside a dialog', () => {
  it('portals its list into a FormDialog and focuses its search box', async () => {
    render(
      <FormDialog open onOpenChange={() => {}} title="New posting profile">
        <FormDialogBody>
          <Picker />
        </FormDialogBody>
      </FormDialog>,
    );

    await userEvent.click(screen.getByRole('combobox'));

    const dialog = screen.getByRole('dialog');
    const listbox = await screen.findByRole('listbox');
    expect(dialog).toContainElement(listbox);
    expect(screen.getByPlaceholderText('Search accounts')).toHaveFocus();
  });

  it('portals its list into a plain Dialog too', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Pick</DialogTitle>
          <Picker />
        </DialogContent>
      </Dialog>,
    );

    await userEvent.click(screen.getByRole('combobox'));

    expect(screen.getByRole('dialog')).toContainElement(await screen.findByRole('listbox'));
  });

  it('still portals to the body outside any dialog', async () => {
    render(<Picker />);
    await userEvent.click(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    expect(listbox.closest('[role="dialog"]')).toBeNull();
    expect(document.body).toContainElement(listbox);
  });
});

describe('Escape inside a dialog', () => {
  it('closes the open list only, and a second Escape closes the dialog', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <FormDialog open onOpenChange={onOpenChange} title="New posting profile">
        <FormDialogBody>
          <Picker />
        </FormDialogBody>
      </FormDialog>,
    );

    await user.click(screen.getByRole('combobox'));
    await user.type(await screen.findByPlaceholderText('Search accounts'), 'cem');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes the list only inside a plain Dialog too', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Pick</DialogTitle>
          <Picker />
        </DialogContent>
      </Dialog>,
    );

    await user.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
