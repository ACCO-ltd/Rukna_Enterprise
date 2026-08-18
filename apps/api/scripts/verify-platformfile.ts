/**
 * ADR-014 end-to-end verification: drives the real MinioFileStorageAdapter against a running MinIO
 * (docker compose up -d minio). Presign PUT -> upload bytes -> stat -> presign GET -> download ->
 * compare. Run: npx tsx scripts/verify-platformfile.ts
 */
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioFileStorageAdapter } from '../src/platform/files/infrastructure/minio-file-storage.adapter.js';

const env: Record<string, string> = {
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_REGION: 'us-east-1',
  MINIO_ACCESS_KEY: 'minioadmin',
  MINIO_SECRET_KEY: 'minioadmin',
};
const config = { get: (k: string) => env[k] } as never;

async function main() {
  const bucket = 'rukna-files';
  const adapter = new MinioFileStorageAdapter(config);

  const s3 = new S3Client({
    endpoint: env.MINIO_ENDPOINT,
    region: env.MINIO_REGION,
    credentials: { accessKeyId: env.MINIO_ACCESS_KEY, secretAccessKey: env.MINIO_SECRET_KEY },
    forcePathStyle: true,
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log('bucket created:', bucket);
  } catch (e) {
    console.log('bucket ready (already exists):', (e as Error).name);
  }

  const key = `acco/org-1/verify-${Date.now()}`;
  const payload = `hello platformfile — ${new Date().toISOString()}`;
  const expectedSize = Buffer.byteLength(payload);

  // 1. presigned upload -> PUT the bytes directly to MinIO
  const putUrl = await adapter.presignUpload(bucket, key, 'text/plain');
  const putRes = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: payload,
  });
  console.log('1) PUT status:', putRes.status);

  // 2. statObject -> exists + size
  const stat = await adapter.statObject(bucket, key);
  console.log('2) stat:', stat);

  // 3. presigned download -> GET -> compare
  const getUrl = await adapter.presignDownload(bucket, key);
  const getRes = await fetch(getUrl);
  const body = await getRes.text();
  const match = body === payload;
  console.log('3) GET status:', getRes.status, '| body matches:', match);

  // 4. a missing key stats as not-exists
  const missing = await adapter.statObject(bucket, `${key}-nope`);
  console.log('4) missing-key stat:', missing);

  const ok =
    putRes.status === 200 &&
    stat.exists &&
    stat.sizeBytes === expectedSize &&
    match &&
    !missing.exists;

  if (!ok) throw new Error('ROUND-TRIP FAILED');
  console.log(`\n✅ PlatformFile MinIO round-trip OK — ${expectedSize} bytes stored, signed, and read back.`);
}

main().catch((e) => {
  console.error('❌ verification failed:', e);
  process.exit(1);
});
