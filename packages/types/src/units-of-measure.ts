/**
 * `GET /units-of-measure` — the org's unit registry as a read-only lookup, for anyone
 * holding `view:project` (the BOQ unit picker, and anywhere else a unit is chosen).
 *
 * A projection, not the record: no id, no timestamps. Managing units stays on
 * `/procurement/uom` behind `manage:procurement-config`.
 */
export interface UnitOfMeasureOption {
  /** Stable registry code: `M3`, `TON`. */
  code: string;
  /** Display name: "Cubic metre". */
  name: string;
  /** What a quantity is written with: `m³`, `t`. */
  symbol: string;
}

export type UnitOfMeasureLookupStatus = 'ACTIVE' | 'INACTIVE';
