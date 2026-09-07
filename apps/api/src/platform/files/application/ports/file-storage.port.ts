// ADR-014: the seam between domain modules and object storage. Domain code depends on this port,
// never on the S3/MinIO SDK, so swapping MinIO for a managed store is an adapter change only.

export const FILE_STORAGE_PORT = Symbol('FILE_STORAGE_PORT');

export interface StoredObjectStat {
  exists: boolean;
  sizeBytes: number;
  /** Present when the store exposes an integrity hash (e.g. via ETag / object metadata). */
  checksumSha256?: string;
}

export interface PresignUploadOptions {
  /**
   * Lower-case hex SHA-256 the uploaded body must hash to.
   *
   * Passing it here is what turns the checksum from a claim into a control: the URL is signed
   * with it, so object storage itself rejects a body that does not match, and the API never has
   * to see the bytes to know they are the ones that were promised.
   */
  checksumSha256?: string;
}

export interface IFileStoragePort {
  /** Short-lived presigned URL for the client to PUT the bytes directly to storage. */
  presignUpload(
    bucket: string,
    key: string,
    mimeType: string,
    options?: PresignUploadOptions,
  ): Promise<string>;
  /** Short-lived, authorization-gated presigned URL to GET the bytes. */
  presignDownload(bucket: string, key: string): Promise<string>;
  /** Verify the object exists and read its size/checksum — integrity on serve (ADR-014). */
  statObject(bucket: string, key: string): Promise<StoredObjectStat>;
  /** Remove the bytes. Must succeed silently when the object is already gone. */
  deleteObject(bucket: string, key: string): Promise<void>;
}
