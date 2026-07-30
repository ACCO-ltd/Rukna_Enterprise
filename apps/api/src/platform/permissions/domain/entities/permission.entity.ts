export class PermissionEntity {
  constructor(
    public readonly id: string,
    public readonly action: string,
    public readonly resource: string,
    public readonly description: string | null,
    public readonly createdAt: Date,
  ) {}
}
