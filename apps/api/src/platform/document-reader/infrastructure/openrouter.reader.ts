import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ReaderProviderError, type DocumentReaderProvider, type ReaderImage } from '../application/reader-provider.port.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** OpenRouter's free router: picks a free model that accepts images. Override with OPENROUTER_MODEL. */
export const OPENROUTER_DEFAULT_MODEL = 'openrouter/free';
const TIMEOUT_MS = 60_000;

/**
 * Step 7 — OpenRouter as the photo reader (owner decision 2026-10-28: free models first). The image
 * is sent inline as a data URL with the prompt; nothing else about the company goes with it.
 *
 * Config: `OPENROUTER_API_KEY` (required), `OPENROUTER_MODEL` (default `openrouter/free`).
 */
@Injectable()
export class OpenRouterReader implements DocumentReaderProvider {
  readonly label = 'OpenRouter';

  constructor(private readonly config: ConfigService) {}

  private key(): string | null {
    return this.config.get<string>('OPENROUTER_API_KEY')?.trim() || null;
  }

  isAvailable(): boolean {
    return this.key() !== null;
  }

  model(): string {
    return this.config.get<string>('OPENROUTER_MODEL')?.trim() || OPENROUTER_DEFAULT_MODEL;
  }

  async read(image: ReaderImage, prompt: string): Promise<string> {
    const key = this.key();
    if (!key) throw new ReaderProviderError('NOT_CONFIGURED', 'The photo reader has no API key.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await fetch(ENDPOINT, {
          method: 'POST',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Rukna ERP' },
          body: JSON.stringify({
            model: this.model(),
            temperature: 0,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.bytes.toString('base64')}` } },
              ],
            }],
          }),
        });
      } catch (error) {
        if (controller.signal.aborted) throw new ReaderProviderError('TIMEOUT', 'The photo reader took too long to answer.');
        throw new ReaderProviderError('PROVIDER_ERROR', `The photo reader could not be reached: ${(error as Error).message}`);
      }
      const body = (await response.json().catch(() => null)) as
        | { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } }
        | null;
      if (response.status === 429) throw new ReaderProviderError('RATE_LIMITED', 'The free photo reader is busy. Try again in a minute.');
      if (!response.ok) throw new ReaderProviderError('PROVIDER_ERROR', body?.error?.message ?? `The photo reader answered ${response.status}.`);
      const content = body?.choices?.[0]?.message?.content;
      const text = typeof content === 'string'
        ? content
        : Array.isArray(content) ? content.map((c) => (c && typeof c === 'object' && 'text' in c ? String((c as { text: unknown }).text) : '')).join('') : '';
      if (!text.trim()) throw new ReaderProviderError('REFUSED', 'The photo reader gave no answer.');
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** No reader configured (`DOCUMENT_READER_PROVIDER=none`): the feature is simply unavailable. */
@Injectable()
export class NoReader implements DocumentReaderProvider {
  readonly label = null;
  isAvailable(): boolean {
    return false;
  }
  model(): null {
    return null;
  }
  read(): Promise<string> {
    return Promise.reject(new ReaderProviderError('NOT_CONFIGURED', 'No photo reader is configured.'));
  }
}
