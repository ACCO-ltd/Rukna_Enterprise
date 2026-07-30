export class RoleEntity {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string | null,
    public readonly organizationId: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
