import { describe, expect, it } from 'vitest';

import messages from '../../../../messages/en/platform.json';
import { WorkflowTransactionType } from '../types';

/**
 * Every transaction type the viewer's picker lists needs a label, or /admin/workflows logs a
 * MISSING_MESSAGE for it and shows the raw key.
 */
describe('workflow definition viewer type labels', () => {
  it('has a label for every WorkflowTransactionType', () => {
    const labels = messages.workflows.viewer.types as Record<string, string>;
    const missing = Object.values(WorkflowTransactionType).filter((type) => !labels[type]);
    expect(missing).toEqual([]);
  });
});
