import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, Matches, MaxLength } from 'class-validator';

/** Lower-case hex SHA-256. Enforced here and again in the service — a checksum nobody validates
 *  is decoration, and this is the field the presigned upload is signed with. */
const SHA256_HEX = /^[0-9a-fA-F]{64}$/;

export class InitiateUploadDto {
  @ApiProperty({ example: 'building-permit.pdf' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  originalName!: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsString() @IsNotEmpty() @MaxLength(255)
  mimeType!: string;

  @ApiProperty({
    description:
      'SHA-256 of the file, as 64 hex characters, computed by the client BEFORE uploading. The ' +
      'presigned PUT is signed with it, so object storage rejects a body that does not match.',
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  @IsString() @Matches(SHA256_HEX, { message: 'checksumSha256 must be a 64-character hex SHA-256 digest' })
  checksumSha256!: string;
}

export class ConfirmUploadDto {
  @ApiPropertyOptional({
    description:
      'Optional re-statement of the checksum registered at presign. Rejected if it disagrees; it ' +
      'cannot replace the registered value.',
  })
  @IsString() @IsOptional() @Matches(SHA256_HEX, { message: 'checksumSha256 must be a 64-character hex SHA-256 digest' })
  checksumSha256?: string;
}
