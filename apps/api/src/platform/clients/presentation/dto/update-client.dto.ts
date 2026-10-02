import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { ClientFieldsDto } from './create-client.dto.js';

/**
 * `PATCH /clients/:id` — client fields only, all optional (`null` clears an optional field).
 * `status` is deliberately absent: the global ValidationPipe (forbidNonWhitelisted) rejects it —
 * status changes go through deactivate / reactivate.
 */
export class UpdateClientDto extends ClientFieldsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;
}
