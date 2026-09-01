import { IsString } from 'class-validator';
export class ReassignRoleOwnerDto { @IsString() ownerUserId!: string; }
