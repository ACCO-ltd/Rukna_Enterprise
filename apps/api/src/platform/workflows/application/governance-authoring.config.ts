import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * ADR-027 rollout — the policy-authoring surface ships behind a platform feature flag.
 *
 * The authoring WRITE endpoints under `/workflows/policies` (create draft, add/edit/delete/reorder
 * rules, SoD, clone, and the lifecycle transitions submit-review/schedule/activate/retire) execute
 * only when this flag is on. Reads stay available regardless, so an administrator can still inspect
 * the seeded ACCO policies in a non-production tenant before authoring is enabled (the API-contract
 * rollout step: "enable policy authoring only after seeded ACCO policies validate").
 *
 * Config-driven via `GOVERNANCE_AUTHORING_ENABLED`, DEFAULT OFF. Only the literal strings "true"
 * and "1" enable it, so a missing, empty, or misspelt value fails safe to disabled. No schema
 * change — this is a process-level env flag, uniform across the tenants the process serves.
 *
 * The flag's boolean value is also exposed on the public liveness read (`GET /health`) so the web
 * can hide the authoring affordances when it is off (the UI still additionally honours the caller's
 * `manage:workflow` / `publish:workflow` permissions — the flag gates the whole surface, the
 * permissions gate the individual actor).
 */
@Injectable()
export class GovernanceAuthoringConfig {
  static readonly ENV_KEY = 'GOVERNANCE_AUTHORING_ENABLED';

  constructor(private readonly config: ConfigService) {}

  /** True only when the flag is explicitly set to an enabling value. Fails safe to false. */
  isEnabled(): boolean {
    const raw = this.config.get<string>(GovernanceAuthoringConfig.ENV_KEY);
    if (raw === undefined || raw === null) return false;
    const normalized = String(raw).trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
  }

  /**
   * Guard for an authoring write path. Throws 403 with a clear, stable message when the flag is
   * off, so the mutation never executes; callers on read paths do not call this.
   */
  assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ForbiddenException('Governance authoring is not enabled');
    }
  }
}
