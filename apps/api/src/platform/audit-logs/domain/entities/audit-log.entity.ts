export class AuditLogEntity {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly orgId: string,
    public readonly action: string,
    public readonly resource: string,
    public readonly resourceId: string,
    public readonly before: Record<string, unknown> | null,
    public readonly after: Record<string, unknown> | null,
    public readonly ipAddress: string | null,
    public readonly createdAt: Date,
  ) {}
}
