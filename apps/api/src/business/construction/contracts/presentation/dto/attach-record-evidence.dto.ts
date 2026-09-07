import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IpcAttachmentPurpose } from '@prisma/client';

/**
 * Attach a confirmed upload as evidence on a business record.
 *
 * Shared by contract, guarantee, IPA and IPC because the payload is the same in all four cases —
 * a file id, and for the IPC alone, what kind of evidence it is. `purpose` is accepted only where
 * it means something; elsewhere it is ignored rather than validated away, so the same client
 * helper can post to any of the four.
 */
export class AttachRecordEvidenceDto {
  @ApiProperty({ description: 'A confirmed (READY) PlatformFile id' })
  @IsString() @IsNotEmpty()
  platformFileId!: string;

  @ApiPropertyOptional({
    enum: IpcAttachmentPurpose,
    description:
      'IPC only. ISSUED_CERTIFICATE is the signed certificate itself and freezes immediately — ' +
      'the certificate it evidences is already effective, so there is no later event to wait for.',
  })
  @IsOptional() @IsEnum(IpcAttachmentPurpose)
  purpose?: IpcAttachmentPurpose;
}
