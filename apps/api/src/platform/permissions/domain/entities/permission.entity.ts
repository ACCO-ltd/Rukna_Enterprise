export class PermissionEntity {
  constructor(
    public readonly id: string,
    public readonly action: string,
    public readonly resource: string,
    public readonly description: string | null,
    public readonly domain: string,
    public readonly riskClass: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    public readonly createdAt: Date,
  ) {}
}
