/**
 * ADR-014 + Phase 7 Step 2 end-to-end verification against a real MinIO
 * (`docker compose up -d minio`). This is the runtime test for the parts that only a real
 * object store can answer — a mocked adapter would pass whatever we told it to.
 *
 *   npx tsx scripts/verify-platformfile.ts
 *
 * It proves five things:
 *
 *   1. presign PUT → upload → stat → presign GET → download round-trips;
 *   2. the presigned PUT is signed with the SHA-256, and **storage rejects a body that does not
 *      hash to it** — the check that turns the checksum from a claim into a control;
 *   3. `statObject` reads the stored checksum back, so confirm can compare like with like;
 *   4. `deleteObject` removes the bytes and is idempotent on a missing key, which the cleanup
 *      sweep depends on;
 *   5. when a public endpoint is configured, presigned URLs are signed against THAT host — the
 *      production defect (P0-3) was URLs the browser could not reach.
 */
import { createHash } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { MinioFileStorageAdapter } from '../src/platform/files/infrastructure/minio-file-storage.adapter.js';

const env: Record<string, string> = {
  MINIO_ENDPOINT: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
  MINIO_REGION: 'us-east-1',
  MINIO_ACCESS_KEY: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  MINIO_SECRET_KEY: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
};
const config = { get: (k: string) => env[k] } as never;

const sha256Hex = (body: string) => createHash('sha256').update(body).digest('hex');
const hexToBase64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

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
  } catch {
    /* already exists */
  }

  const payload = `hello platformfile — ${new Date().toISOString()}`;
  const checksum = sha256Hex(payload);
  const key = `acco/org-1/verify-${Date.now()}`;

  console.log('\n1. round trip with a checksum-signed upload');
  const putUrl = await adapter.presignUpload(bucket, key, 'text/plain', {
    checksumSha256: checksum,
  });
  const put = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', 'x-amz-checksum-sha256': hexToBase64(checksum) },
    body: payload,
  });
  check('PUT accepted', put.ok, `status ${put.status}`);

  const stat = await adapter.statObject(bucket, key);
  check('object exists with the right size', stat.exists && stat.sizeBytes === Buffer.byteLength(payload));
  check(
    'storage reports the SHA-256 back',
    stat.checksumSha256 === checksum,
    stat.checksumSha256 ? `got ${stat.checksumSha256.slice(0, 12)}…` : 'storage returned none',
  );

  const getUrl = await adapter.presignDownload(bucket, key);
  const got = await fetch(getUrl);
  check('GET returns the same bytes', got.ok && (await got.text()) === payload);

  console.log('\n2. storage refuses a body that does not match the signed checksum');
  const tamperedKey = `${key}-tampered`;
  const tamperedUrl = await adapter.presignUpload(bucket, tamperedKey, 'text/plain', {
    checksumSha256: checksum,
  });
  const tampered = await fetch(tamperedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', 'x-amz-checksum-sha256': hexToBase64(checksum) },
    body: `${payload} — but altered in flight`,
  });
  check('mismatched body rejected', !tampered.ok, `status ${tampered.status}`);
  const tamperedStat = await adapter.statObject(bucket, tamperedKey);
  check('and nothing was stored', !tamperedStat.exists);

  console.log('\n3. delete, and delete again');
  await adapter.deleteObject(bucket, key);
  check('object removed', !(await adapter.statObject(bucket, key)).exists);
  await adapter.deleteObject(bucket, key);
  check('second delete is a no-op (cleanup sweep depends on this)', true);

  console.log('\n4. presigned URLs are signed against the PUBLIC endpoint');
  const publicAdapter = new MinioFileStorageAdapter({
    get: (k: string) => (k === 'MINIO_PUBLIC_ENDPOINT' ? 'https://storage.rukna.site' : env[k]),
  } as never);
  const publicUrl = await publicAdapter.presignDownload(bucket, key);
  check('URL host is the browser-reachable one', publicUrl.startsWith('https://storage.rukna.site/'));
  check('URL is signed and expires', publicUrl.includes('X-Amz-Signature') && publicUrl.includes('X-Amz-Expires=900'));

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
