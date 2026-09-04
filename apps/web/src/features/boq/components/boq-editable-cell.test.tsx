import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EditableCell } from './boq-editable-cell';

function setup(over: Partial<React.ComponentProps<typeof EditableCell>> = {}) {
  const onCommit = vi.fn().mockResolvedValue(undefined);
  render(
    <EditableCell
      value="10"
      display={<span>10</span>}
      editable
      kind="quantity"
      numeric
      ariaLabel="Edit quantity"
      onCommit={onCommit}
      {...over}
    />,
  );
  return { onCommit };
}

async function openEditor() {
  await userEvent.click(screen.getByRole('button', { name: 'Edit quantity' }));
  return screen.getByRole('textbox');
}

describe('EditableCell', () => {
  it('renders a static display and no control when not editable', () => {
    render(
      <EditableCell value="10" display={<span>ten</span>} editable={false} kind="quantity" ariaLabel="x" onCommit={vi.fn()} />,
    );
    expect(screen.getByText('ten')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('commits a changed value on Enter', async () => {
    const { onCommit } = setup();
    const input = await openEditor();
    await userEvent.clear(input);
    await userEvent.type(input, '25{Enter}');
    expect(onCommit).toHaveBeenCalledWith('25');
  });

  it('commits on blur', async () => {
    const { onCommit } = setup();
    const input = await openEditor();
    await userEvent.clear(input);
    await userEvent.type(input, '30');
    await userEvent.tab();
    expect(onCommit).toHaveBeenCalledWith('30');
  });

  it('does not commit an unchanged value', async () => {
    const { onCommit } = setup();
    const input = await openEditor();
    await userEvent.type(input, '{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels on Escape without committing', async () => {
    const { onCommit } = setup();
    const input = await openEditor();
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await userEvent.keyboard('{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('rejects an invalid number and stays open, marked invalid', async () => {
    const { onCommit } = setup();
    const input = await openEditor();
    await userEvent.clear(input);
    await userEvent.type(input, 'abc{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-invalid', 'true');
  });

  it('requires a non-empty description', async () => {
    const { onCommit } = setup({ kind: 'text', value: 'Mass concrete', numeric: false, ariaLabel: 'Edit description', display: <span>Mass concrete</span> });
    await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
    const input = screen.getByRole('textbox');
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
