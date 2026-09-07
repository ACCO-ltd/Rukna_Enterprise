import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type {
  IFileStoragePort,
  PresignUploadOptions,
  StoredObjectStat,
} from '../application/ports/file-storage.port.js';

const URL_TTL_SECONDS = 900; // 15 minutes — short-lived signed URLs (ADR-014)

/**
 * ADR-014: the MinIO (S3-compatible) adapter behind {@link IFileStoragePort}. The rest of the
 * platform never imports the S3 SDK — swapping to a managed S3 store is a change here only.
 *
 * **Two clients, deliberately.** A presigned URL's signature covers the host, so a URL signed
 * against the internal address does not validate when the browser follows it at the public one.
 * The API talks to storage over the internal network for its own calls (stat, delete, bucket
 * checks) and signs browser-facing URLs against `MINIO_PUBLIC_ENDPOINT`. This is what makes
 * uploads work in production: previously one endpoint served both purposes, and whichever value
 * it held, one of the two roles was broken (Phase 7 audit P0-3).
 *
 * When no public endpoint is configured the internal one is used for both, which is correct for
 * local development where they are the same address.
 */
@Injectable()
export class MinioFileStorageAdapter implements IFileStoragePort, OnModuleInit {
  private readonly logger = new Logger(MinioFileStorageAdapter.name);
  /** Server-to-server: stat, delete, bucket lifecycle. Reaches storage over the private network. */
  private readonly client: S3Client;
  /** Signing only. Its endpoint is the hostname the browser will resolve. */
  private readonly signingClient: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string | undefined;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('FILE_STORAGE_BUCKET') ?? 'rukna-files';

    const internalEndpoint = config.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000';
    this.publicEndpoint = config.get<string>('MINIO_PUBLIC_ENDPOINT') ?? undefined;
    const credentials = {
      accessKeyId: config.get<string>('MINIO_ACCESS_KEY') ?? 'minioadmin',
      secretAccessKey: config.get<string>('MINIO_SECRET_KEY') ?? 'minioadmin',
    };
    const region = config.get<string>('MINIO_REGION') ?? 'us-east-1';

    this.client = new S3Client({
      endpoint: internalEndpoint,
      region,
      credentials,
      forcePathStyle: true, // MinIO requires path-style addressing
    });

    this.signingClient = this.publicEndpoint
      ? new S3Client({
          endpoint: this.publicEndpoint,
          region,
          credentials,
          forcePathStyle: true,
        })
      : this.client;
  }

  /** Ensure the bucket exists on boot (best-effort — never blocks startup if storage is down). */
  async onModuleInit(): Promise<void> {
    if (!this.publicEndpoint) {
      this.logger.warn(
        'MINIO_PUBLIC_ENDPOINT is not set — presigned URLs will be signed against the internal ' +
          'storage endpoint. That is correct for local development and BROKEN in any deployment ' +
          'where the browser cannot resolve it.',
      );
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created object-storage bucket "${this.bucket}"`);
      } catch (err) {
        this.logger.warn(
          `Object storage not reachable / bucket "${this.bucket}" unavailable: ${(err as Error).message}. ` +
            'File uploads will fail until storage is up.',
        );
      }
    }
  }

  /**
   * Sign the PUT with the expected SHA-256 so storage rejects a mismatched body.
   *
   * S3 wants the digest base64-encoded in `x-amz-checksum-sha256`; the platform stores hex
   * because that is what a person reads in an audit trail, so the conversion happens here.
   */
  presignUpload(
    bucket: string,
    key: string,
    mimeType: string,
    options: PresignUploadOptions = {},
  ): Promise<string> {
    const checksum = options.checksumSha256
      ? Buffer.from(options.checksumSha256, 'hex').toString('base64')
      : undefined;

    return getSignedUrl(
      this.signingClient,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: mimeType,
        ...(checksum ? { ChecksumSHA256: checksum } : {}),
      }),
      { expiresIn: URL_TTL_SECONDS },
    );
  }

  presignDownload(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.signingClient, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: URL_TTL_SECONDS,
    });
  }

  async statObject(bucket: string, key: string): Promise<StoredObjectStat> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }),
      );
      return {
        exists: true,
        sizeBytes: Number(res.ContentLength ?? 0),
        // Present only when the object was stored with a checksum. Converted back to hex so the
        // caller compares like with like.
        ...(res.ChecksumSHA256
          ? { checksumSha256: Buffer.from(res.ChecksumSHA256, 'base64').toString('hex') }
          : {}),
      };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }

  /** Idempotent: S3 delete of a missing key succeeds, which is what the cleanup sweep needs. */
  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
