import { SetMetadata } from '@nestjs/common';

export const NO_AUDIT_KEY = 'noAudit';

/**
 * Leave this route out of the request audit log (AuditInterceptor). Only for a POST that changes
 * nothing — e.g. rendering a preview — which would otherwise log a row per call.
 */
export const NoAudit = () => SetMetadata(NO_AUDIT_KEY, true);
