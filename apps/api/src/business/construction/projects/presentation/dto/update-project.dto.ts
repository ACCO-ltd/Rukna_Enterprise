import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProjectDto } from './create-project.dto.js';

// Code is immutable after creation.
export class UpdateProjectDto extends PartialType(OmitType(CreateProjectDto, ['code'] as const)) {}
