import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stable, like the App Router's own instance.
const nav = vi.hoisted(() => {
  const push = vi.fn();
  return { push, router: { push } };
});
vi.mock('next/navigation', () => ({ useRouter: () => nav.router }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import Link from 'next/link';

import { guardedNavigate, useUnsavedChangesGuard } from './use-unsaved-changes-guard';

function Screen({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedChangesGuard(dirty);
  return (
    <div>
      <Link href="/projects">Projects</Link>
      <Link href="/admin">Admin</Link>
      <button type="button" onClick={() => guardedNavigate(() => nav.push('/picked'))}>
        Pick
      </button>
      {guard.open ? (
        <div role="dialog" aria-label="Leave?">
          <button type="button" onClick={guard.confirm}>
            Leave
          </button>
          <button type="button" onClick={guard.cancel}>
            Stay
          </button>
        </div>
      ) : null}
    </div>
  );
}

beforeEach(() => vi.clearAllMocks());

describe('useUnsavedChangesGuard', () => {
  it('lets links through when there is nothing to lose', async () => {
    const user = userEvent.setup();
    render(<Screen dirty={false} />);
    await user.click(screen.getByRole('button', { name: 'Pick' }));
    expect(nav.push).toHaveBeenCalledWith('/picked');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('holds a link and a guarded navigation until the user agrees', async () => {
    const user = userEvent.setup();
    render(<Screen dirty />);

    await user.click(screen.getByRole('link', { name: 'Projects' }));
    expect(screen.getByRole('dialog', { name: 'Leave?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(nav.push).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(nav.push).toHaveBeenCalledWith('/picked');
  });

  it('detaches once the user agrees, so the released navigation is not held again', async () => {
    const user = userEvent.setup();
    render(<Screen dirty />);

    await user.click(screen.getByRole('link', { name: 'Projects' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(nav.push).toHaveBeenCalledWith('/projects');

    // Still mounted and still "dirty" (the route change is on its way), but no longer guarding.
    nav.push.mockClear();
    await act(async () => {
      guardedNavigate(() => nav.push('/next'));
    });
    expect(nav.push).toHaveBeenCalledWith('/next');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
