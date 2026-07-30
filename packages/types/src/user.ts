export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  status: UserStatus;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}
