import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { IFileStoragePort, StoredObjectStat } from '../application/ports/file-storage.port.js';

const URL_TTL_SECONDS = 900; // 15 minutes — short-lived signed URLs (ADR-014)

/**
 * ADR-014: the MinIO (S3-compatible) adapter behind {@link IFileStoragePort}. The rest of the
 * platform never imports the S3 SDK — swapping to a managed S3 store is a change here only.
 */
@Injectable()
export class MinioFileStorageAdapter implements IFileStoragePort, OnModuleInit {
  private readonly logger = new Logger(MinioFileStorageAdapter.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('FILE_STORAGE_BUCKET') ?? 'rukna-files';
    this.client = new S3Client({
      endpoint: config.get<string>('MINIO_ENDPOINT') ?? 'http://localhost:9000',
      region: config.get<string>('MINIO_REGION') ?? 'us-east-1',
      credentials: {
        accessKeyId: config.get<string>('MINIO_ACCESS_KEY') ?? 'minioadmin',
        secretAccessKey: config.get<string>('MINIO_SECRET_KEY') ?? 'minioadmin',
      },
      forcePathStyle: true, // MinIO requires path-style addressing
    });
  }

  /** Ensure the bucket exists on boot (best-effort — never blocks startup if storage is down). */
  async onModuleInit(): Promise<void> {
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

  presignUpload(bucket: string, key: string, mimeType: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mimeType }),
      { expiresIn: URL_TTL_SECONDS },
    );
  }

  presignDownload(bucket: string, key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: URL_TTL_SECONDS,
    });
  }

  async statObject(bucket: string, key: string): Promise<StoredObjectStat> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { exists: true, sizeBytes: Number(res.ContentLength ?? 0) };
    } catch {
      return { exists: false, sizeBytes: 0 };
    }
  }
}
