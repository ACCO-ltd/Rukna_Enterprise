/**
 * Step 7 — the swappable photo reader. One provider is configured for the whole platform
 * (`DOCUMENT_READER_PROVIDER`); each company decides whether to use it (DocumentReaderPolicy).
 */
export const DOCUMENT_READER_PROVIDER = Symbol('DOCUMENT_READER_PROVIDER');

export interface ReaderImage {
  bytes: Buffer;
  mimeType: string;
}

export class ReaderProviderError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'TIMEOUT' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'REFUSED',
    message: string,
  ) {
    super(message);
  }
}

export interface DocumentReaderProvider {
  /** Shown to administrators so they know where photos go, e.g. "OpenRouter". Null when none. */
  readonly label: string | null;
  /** Configured and able to read. */
  isAvailable(): boolean;
  model(): string | null;
  /** The model's raw text answer to the prompt about the image. */
  read(image: ReaderImage, prompt: string): Promise<string>;
}
