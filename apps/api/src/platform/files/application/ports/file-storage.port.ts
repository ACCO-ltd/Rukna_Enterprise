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
  /**
   * Write bytes the API already holds directly to storage — server-generated content (a rendered
   * invoice PDF), never a client's own upload. The presign/PUT/confirm dance exists so the API
   * never has to handle a browser's bytes; a document the server rendered itself has no browser
   * leg to skip past.
   */
  putObject(bucket: string, key: string, body: Buffer, mimeType: string): Promise<void>;
  /**
   * Read bytes directly, server-side — for composing one document from another (embedding the
   * org's logo into a rendered invoice), never for serving a user a download. A user-facing read
   * always goes through `presignDownload` + {@link FileAuthorizationService}; this has no caller
   * identity to check because it is not a response to a request, it is an ingredient in one.
   */
  getObject(bucket: string, key: string): Promise<Buffer>;
}
