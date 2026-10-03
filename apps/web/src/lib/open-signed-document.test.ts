import { afterEach, describe, expect, it, vi } from 'vitest';

import { openSignedDocument } from './open-signed-document';

function fakeTab() {
  return { opener: {} as unknown, location: { href: '' }, close: vi.fn() };
}

describe('openSignedDocument', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens the tab on the click without noopener (which would return null) and navigates it', async () => {
    const tab = fakeTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const doc = await openSignedDocument(async () => ({ url: 'https://files/x.pdf' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(tab.location.href).toBe('https://files/x.pdf');
    expect(doc.url).toBe('https://files/x.pdf');
  });

  it('closes the blank tab when the fetch fails', async () => {
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await expect(
      openSignedDocument(async () => {
        throw new Error('409');
      }),
    ).rejects.toThrow('409');
    expect(tab.close).toHaveBeenCalled();
  });

  it('falls back to opening the URL directly when the tab was blocked', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openSignedDocument(async () => ({ url: 'https://files/y.pdf' }));
    expect(open).toHaveBeenLastCalledWith('https://files/y.pdf', '_blank', 'noopener');
  });
});
