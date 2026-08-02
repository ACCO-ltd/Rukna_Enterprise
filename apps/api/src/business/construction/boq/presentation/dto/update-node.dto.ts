import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateNodeDto } from './create-node.dto.js';

// parentId and sortOrder cannot be changed via update — use /move instead.
export class UpdateNodeDto extends PartialType(
  OmitType(CreateNodeDto, ['parentId', 'sortOrder'] as const),
) {}
