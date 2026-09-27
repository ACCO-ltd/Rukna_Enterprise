/**
 * Read model for one record's history (ADR-036 backend request 2).
 *
 * The audit interceptor stores each successful mutation as `{ action: HTTP method, resource:
 * route pattern, resourceId }` — e.g. `POST /bills/:id/approve`. This turns that into a stable
 * event code a client can translate (`bills.approve`) without the client parsing routes.
 */

export interface ActivityEntryView {
  id: string;
  at: string;
  actor: { id: string; name: string };
  /** Stable event code — `bills.submit`, `bills.update`, `bill-matching.rerun`. */
  code: string;
}

const METHOD_VERB: Record<string, string> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * `POST /bills/:id/approve` → `bills.approve`; `PATCH /bills/:id` → `bills.update`;
 * `POST /bills` → `bills.create`; `POST /procurement/bill-matching/:billId/run` →
 * `bill-matching.run`.
 *
 * The resource is the last literal segment before the first path parameter (the thing the id
 * identifies), or the last segment when there is no parameter. The command is the last literal
 * segment after the parameter; with none, the HTTP method supplies the verb. The global
 * `/api/v1` prefix the stored route carries is ignored.
 */
export function activityCode(method: string, route: string): string {
  const segments = route
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
  const firstParam = segments.findIndex((segment) => segment.startsWith(':'));
  const before = (firstParam === -1 ? segments : segments.slice(0, firstParam)).filter(
    (segment) => segment !== 'api' && !/^v\d+$/.test(segment),
  );
  const after = firstParam === -1 ? [] : segments.slice(firstParam).filter((s) => !s.startsWith(':'));
  const resource = before[before.length - 1] ?? 'record';
  const command = after[after.length - 1] ?? METHOD_VERB[method.toUpperCase()] ?? method.toLowerCase();
  return `${resource}.${command}`;
}
