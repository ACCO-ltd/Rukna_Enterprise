import { validateDeliveryPlanBatch, type DeliveryPlanPackageInput } from './delivery-plan.js';

const pkg = (overrides: Partial<DeliveryPlanPackageInput> = {}): DeliveryPlanPackageInput => ({
  code: 'WP-01',
  name: 'Substructure',
  boqNodeIds: ['leaf-1', 'leaf-2'],
  ...overrides,
});

describe('validateDeliveryPlanBatch', () => {
  it('accepts a clean batch against an empty project', () => {
    const errors = validateDeliveryPlanBatch([pkg()], new Set(), new Set());
    expect(errors).toEqual([]);
  });

  it('rejects an empty batch', () => {
    const errors = validateDeliveryPlanBatch([], new Set(), new Set());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.packageIndex).toBeNull();
  });

  it('requires a code and a name', () => {
    const errors = validateDeliveryPlanBatch([pkg({ code: '  ', name: '' })], new Set(), new Set());
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('code is required'), expect.stringContaining('name is required')]),
    );
  });

  it('rejects a weight outside 0..1', () => {
    const tooHigh = validateDeliveryPlanBatch([pkg({ progressWeight: 1.5 })], new Set(), new Set());
    expect(tooHigh.some((e) => e.message.includes('weight must be between 0 and 1'))).toBe(true);

    const negative = validateDeliveryPlanBatch([pkg({ progressWeight: -0.1 })], new Set(), new Set());
    expect(negative.some((e) => e.message.includes('weight must be between 0 and 1'))).toBe(true);

    const zero = validateDeliveryPlanBatch([pkg({ progressWeight: 0 })], new Set(), new Set());
    expect(zero).toEqual([]);
  });

  it('flags a code reused within the same batch, on the second occurrence', () => {
    const errors = validateDeliveryPlanBatch(
      [pkg({ code: 'WP-01' }), pkg({ code: 'WP-01', boqNodeIds: ['leaf-3'] })],
      new Set(),
      new Set(),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({ packageIndex: 1, message: expect.stringContaining('used by more than one package') });
  });

  it('flags a code that collides with an existing work package', () => {
    const errors = validateDeliveryPlanBatch([pkg({ code: 'WP-03' })], new Set(['WP-03']), new Set());
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('already used by an existing work package');
  });

  it('flags a BOQ leaf assigned to two packages in the same batch', () => {
    const errors = validateDeliveryPlanBatch(
      [
        pkg({ code: 'WP-01', boqNodeIds: ['leaf-1'] }),
        pkg({ code: 'WP-02', boqNodeIds: ['leaf-1'] }),
      ],
      new Set(),
      new Set(),
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      packageIndex: 1,
      message: expect.stringContaining('assigned to more than one package'),
    });
  });

  it('flags a BOQ leaf already allocated to an existing work package', () => {
    const errors = validateDeliveryPlanBatch([pkg({ boqNodeIds: ['leaf-9'] })], new Set(), new Set(['leaf-9']));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('already allocated to an existing work package');
  });

  it('reports every problem in the batch, not just the first', () => {
    const errors = validateDeliveryPlanBatch(
      [
        pkg({ code: 'WP-03', name: '', boqNodeIds: ['leaf-9'] }),
        pkg({ code: 'WP-04', progressWeight: 2 }),
      ],
      new Set(['WP-03']),
      new Set(['leaf-9']),
    );
    // name required + code collides + leaf already allocated (pkg 0), plus bad weight (pkg 1).
    expect(errors.length).toBeGreaterThanOrEqual(4);
    expect(errors.some((e) => e.packageIndex === 0)).toBe(true);
    expect(errors.some((e) => e.packageIndex === 1)).toBe(true);
  });
});
