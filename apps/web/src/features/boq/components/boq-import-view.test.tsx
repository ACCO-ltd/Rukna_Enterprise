import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoqImportPreview } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { importBoq, previewBoqImport } from '../api/boq-api';
import { parseSpreadsheet } from '../boq-import-parse';

import { BoqImportView } from './boq-import-view';

vi.mock('../api/boq-api', () => ({
  previewBoqImport: vi.fn(),
  importBoq: vi.fn(),
}));

vi.mock('../boq-import-parse', () => ({ parseSpreadsheet: vi.fn() }));

const preview: BoqImportPreview = {
  ok: true,
  mode: 'APPEND',
  sectionCount: 2,
  itemCount: 2,
  autoCreatedSectionCount: 0,
  // Level by level, as the planner returns it.
  nodes: [
    { code: '1', parentCode: null, description: 'Substructure', isLeaf: false, depth: 0, unit: null, quantity: null, unitRate: null, totalAmount: null, autoCreated: false },
    { code: '2', parentCode: null, description: 'Preliminaries', isLeaf: false, depth: 0, unit: null, quantity: null, unitRate: null, totalAmount: null, autoCreated: false },
    { code: '1.1', parentCode: '1', description: 'Excavation', isLeaf: true, depth: 1, unit: 'm3', quantity: '180', unitRate: null, totalAmount: null, autoCreated: false },
    { code: '2.1', parentCode: '2', description: 'Mobilisation', isLeaf: true, depth: 1, unit: 'LS', quantity: '1', unitRate: '9800.00', totalAmount: '9800.00', autoCreated: false },
  ],
  violations: [],
  warnings: [
    { code: 'UNPRICED_ITEM', rowNumber: 3, nodeCode: '1.1', message: 'No rate' },
    { code: 'AMOUNT_MISMATCH', rowNumber: 5, nodeCode: '2.1', message: 'Mismatch' },
  ],
};

beforeEach(() => {
  vi.mocked(parseSpreadsheet).mockResolvedValue({
    columns: ['Item No.', 'Description', 'Unit', 'Qty', 'Rate', 'Amount'],
    rows: [
      ['1', 'Substructure', '', '', '', ''],
      ['1.1', 'Excavation', 'm3', '180', '', '1170'],
      ['', '', '', '', '', ''],
      ['2', 'Preliminaries', '', '', '', ''],
      ['2.1', 'Mobilisation', 'LS', '1', '9800', '9000'],
    ],
  });
  vi.mocked(previewBoqImport).mockReset().mockResolvedValue(preview);
  vi.mocked(importBoq).mockReset().mockResolvedValue({
    versionId: 'v1',
    versionNumber: 1,
    mode: 'APPEND',
    createdSectionCount: 2,
    createdItemCount: 2,
    autoCreatedSectionCount: 0,
    addedToLibraryCount: 0,
    warnings: [],
  });
});

async function walkToReview(existing = { sections: 3, items: 11 }) {
  const user = userEvent.setup();
  const onImported = vi.fn();
  renderWithProviders(
    <BoqImportView
      projectId="p1"
      currency="USD"
      existing={existing}
      canViewCost
      onCancel={vi.fn()}
      onImported={onImported}
    />,
  );

  // Continue with no file asks for one; it does not disable the button.
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('Choose a spreadsheet to continue.')).toBeInTheDocument();

  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, new File(['x'], 'hayat-boq.xlsx'));
  expect(await screen.findByText('hayat-boq.xlsx')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continue' }));

  // Match columns: pre-matched by heading, first row value beside each field.
  expect(screen.getAllByText('Item No.').length).toBeGreaterThan(0);
  expect(screen.getByText('Substructure')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Imports, but worth a look');
  return { user, onImported };
}

describe('BoqImportView', () => {
  it('reviews the dry-run as a true tree, with one attention notice for what deserves a look', async () => {
    await walkToReview();
    const codes = screen
      .getAllByRole('row')
      .map((row) => row.querySelector('td')?.textContent?.replace(/Section|Item/g, '').trim())
      .filter(Boolean);
    expect(codes).toEqual(['1', '1.1', '2', '2.1']);
    expect(screen.getByText('1 row has no rate (row 3).')).toBeInTheDocument();
    expect(screen.getByText("1 row's amount doesn't match quantity × rate (row 5).")).toBeInTheDocument();
    expect(screen.getByText('1 blank row was skipped.')).toBeInTheDocument();
  });

  it('adds to the draft by default, and sends Replace only when chosen', async () => {
    const { user, onImported } = await walkToReview();
    expect(screen.getByRole('radio', { name: 'Add to the draft' })).toBeChecked();

    await user.click(screen.getByRole('radio', { name: 'Replace the draft' }));
    await waitFor(() =>
      expect(previewBoqImport).toHaveBeenLastCalledWith('p1', expect.objectContaining({ mode: 'REPLACE' })),
    );
    await user.click(screen.getByRole('button', { name: 'Import 2 items' }));
    await waitFor(() => expect(importBoq).toHaveBeenCalledWith('p1', expect.objectContaining({ mode: 'REPLACE' })));
    expect(onImported).toHaveBeenCalledWith({ items: 2, sections: 2, fileName: 'hayat-boq.xlsx' });
  });

  it('sends Add when the default is kept', async () => {
    const { user } = await walkToReview();
    await user.click(screen.getByRole('button', { name: 'Import 2 items' }));
    await waitFor(() => expect(importBoq).toHaveBeenCalledWith('p1', expect.objectContaining({ mode: 'APPEND' })));
  });

  it('asks nothing about Add or Replace when the draft is empty', async () => {
    await walkToReview({ sections: 0, items: 0 });
    expect(screen.queryByRole('radio', { name: 'Replace the draft' })).not.toBeInTheDocument();
  });

  it('hides Import — not disables it — when the dry-run found errors', async () => {
    vi.mocked(previewBoqImport).mockResolvedValue({
      ...preview,
      ok: false,
      violations: [{ code: 'DUPLICATE_CODE', rowNumber: 4, nodeCode: '1.1', message: 'Duplicate code 1.1' }],
    });
    await walkToReview();
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
    expect(screen.getByText('Row 4: Duplicate code 1.1')).toBeInTheDocument();
  });
});
