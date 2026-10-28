import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SentBackItem } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { SiteHome } from './site-home';

const mocks = vi.hoisted(() => ({ held: new Set<string>() }));
const sentBack: SentBackItem[] = [
  { kind: 'QUOTE_REJECTED', id: 'q1', quotationRequestId: 'qr1', number: 'QR-0007', storeName: 'Hodan Hardware', reason: 'ILLEGIBLE', note: 'Top half cut off', at: '2026-10-28T09:00:00.000Z' },
];
vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: vi.fn(async () => sentBack),
}));
vi.mock('@/features/auth/permissions/can', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/permissions/can')>()),
  usePermissions: () => ({ can: (p: string) => mocks.held.has(p) }),
}));
vi.mock('@/features/procurement/hooks/use-quote-uploads', () => ({
  useQueueItems: () => [{ phase: 'offline' }, { phase: 'uploading' }, { phase: 'failed' }],
}));

describe('SiteHome (Step 7)', () => {
  it('leads with what was sent back, then the buttons this person may use', async () => {
    mocks.held = new Set(['view:procurement', 'collect:quotation', 'create:goods-receipt']);
    renderWithProviders(<SiteHome />);
    const back = await screen.findByRole('link', { name: /QR-0007: retake the quote from Hodan Hardware/ });
    expect(back).toHaveAttribute('href', '/procurement/quotes/qr1');
    expect(back).toHaveTextContent('Photo is blurry — retake — Top half cut off');
    expect(screen.getByRole('status')).toHaveTextContent('2 photos are waiting for signal');
    const actions = screen.getByRole('navigation', { name: 'Send' });
    expect(within(actions).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/procurement/quotes', '/procurement/quotes', '/procurement/grn/new',
    ]);
  });

  it('says so when the role sends none of these', () => {
    mocks.held = new Set();
    renderWithProviders(<SiteHome />);
    expect(screen.getByText(/Your role does not send/)).toBeInTheDocument();
  });
});
