/**
 * ADR-044 §10 — how long a sent request has been waiting for finance, in WORKING time.
 *
 * ACCO works Saturday–Thursday, 07:00–17:00 in Mogadishu (Friday off). Africa/Mogadishu is UTC+3
 * with no daylight saving; the offset is still read from `Intl` per instant rather than hard-coded,
 * so a future tz-database change is picked up. An URGENT request counts clock minutes. Public
 * holidays are out of scope (Phase 1). Pure: callers pass both instants (`to` = now at read time).
 */

export const SLA_TIME_ZONE = 'Africa/Mogadishu';
const WORK_START_MINUTE = 7 * 60;
const WORK_END_MINUTE = 17 * 60;
const FRIDAY = 5;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export type SlaTone = 'none' | 'amber' | 'red';
export const SLA_AMBER_MINUTES = 120;
export const SLA_RED_MINUTES = 240;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SLA_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** The zone's offset from UTC at `instant`, in ms (Mogadishu: +3 h). */
function offsetMs(instant: number): number {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(instant)).map((p) => [p.type, p.value] as const),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Whole minutes `from` → `to` that fall inside working hours (or all of them when urgent). */
export function waitingMinutes(from: Date, to: Date, options: { urgent?: boolean } = {}): number {
  const start = from.getTime();
  const end = to.getTime();
  if (end <= start) return 0;
  if (options.urgent) return Math.floor((end - start) / MINUTE);

  // Walk local calendar days. Shifting by the offset turns the zone's wall clock into a UTC
  // timeline, where day boundaries and weekdays can be read directly.
  const offset = offsetMs(start);
  const localStart = start + offset;
  const localEnd = end + offsetMs(end);
  let total = 0;
  for (let dayStart = Math.floor(localStart / DAY) * DAY; dayStart < localEnd; dayStart += DAY) {
    if (new Date(dayStart).getUTCDay() === FRIDAY) continue;
    const open = dayStart + WORK_START_MINUTE * MINUTE;
    const close = dayStart + WORK_END_MINUTE * MINUTE;
    const overlap = Math.min(close, localEnd) - Math.max(open, localStart);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(total / MINUTE);
}

/** none < 2 h ≤ amber < 4 h ≤ red. */
export function slaTone(minutes: number): SlaTone {
  if (minutes >= SLA_RED_MINUTES) return 'red';
  if (minutes >= SLA_AMBER_MINUTES) return 'amber';
  return 'none';
}
