import { Logger } from '@nestjs/common';

import { WhatsAppClient, WhatsAppSendError, classifyMetaError, maskPhone } from './whatsapp.client';
import { resolveWhatsAppTemplate } from './whatsapp-templates';

const TOKEN = 'EAAG-super-secret-token-123';
const ENV = { WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: '1234567890' };

const client = (env: Record<string, string | undefined> = ENV) =>
  new WhatsAppClient({ get: (key: string) => env[key] } as never);

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) }) as unknown as Response;

const metaError = (status: number, code: number) => json(status, { error: { message: `Bearer ${TOKEN} bad`, code, fbtrace_id: 'x' } });

const message = { to: '+252612345678', templateName: 'invoice_v1', language: 'en', bodyParams: ['Hodan', 'INV-1'] };

describe('WhatsAppClient (ADR-042 phase 2)', () => {
  let fetchMock: jest.Mock;
  const logs: string[] = [];
  const realFetch = global.fetch;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    logs.length = 0;
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((m: unknown) => {
        logs.push(String(m));
      });
    }
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  afterEach(() => {
    // The token and the full number must never reach a log line.
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain('252612345678');
    }
  });

  async function caught(p: Promise<unknown>): Promise<WhatsAppSendError> {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(WhatsAppSendError);
      const err = e as WhatsAppSendError;
      expect(err.message).not.toContain(TOKEN);
      expect(JSON.stringify(err)).not.toContain(TOKEN);
      return err;
    }
    throw new Error('expected a WhatsAppSendError');
  }

  it('sends a template with a document header and returns the wamid', async () => {
    fetchMock.mockResolvedValue(json(200, { messages: [{ id: 'wamid.OK' }] }));
    const result = await client({ ...ENV, WHATSAPP_GRAPH_VERSION: 'v22.0' }).sendTemplate({
      ...message,
      document: { mediaId: 'MEDIA1', filename: 'INV-1.pdf' },
    });
    expect(result).toEqual({ providerMessageId: 'wamid.OK' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v22.0/1234567890/messages');
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '252612345678',
      type: 'template',
      template: {
        name: 'invoice_v1',
        language: { code: 'en' },
        components: [
          { type: 'header', parameters: [{ type: 'document', document: { id: 'MEDIA1', filename: 'INV-1.pdf' } }] },
          { type: 'body', parameters: [{ type: 'text', text: 'Hodan' }, { type: 'text', text: 'INV-1' }] },
        ],
      },
    });
  });

  it('defaults the Graph version to v21.0 and omits components when there are none', async () => {
    fetchMock.mockResolvedValue(json(200, { messages: [{ id: 'wamid.2' }] }));
    await client().sendTemplate({ ...message, bodyParams: [] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/messages');
    expect(JSON.parse(init.body).template.components).toBeUndefined();
  });

  it('uploads media as multipart and returns the media id', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'MEDIA9' }));
    await expect(client().uploadMedia(Buffer.from('%PDF-1.4'), 'application/pdf', 'INV-1.pdf')).resolves.toBe('MEDIA9');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1234567890/media');
    const form = init.body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('application/pdf');
    expect((form.get('file') as File).name).toBe('INV-1.pdf');
  });

  it('is NOT_CONFIGURED without a token or phone number id, and never calls Meta', async () => {
    expect(client({}).isConfigured()).toBe(false);
    expect((await caught(client({ WHATSAPP_ACCESS_TOKEN: TOKEN }).sendTemplate(message))).code).toBe('NOT_CONFIGURED');
    expect((await caught(client({ WHATSAPP_PHONE_NUMBER_ID: '1' }).uploadMedia(Buffer.from('x'), 'application/pdf', 'a.pdf'))).code).toBe(
      'NOT_CONFIGURED',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a malformed number before calling Meta', async () => {
    expect((await caught(client().sendTemplate({ ...message, to: '12' }))).code).toBe('INVALID_RECIPIENT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 190, 'AUTH_FAILED'],
    [400, 131026, 'INVALID_RECIPIENT'],
    [400, 131030, 'INVALID_RECIPIENT'],
    [400, 132000, 'TEMPLATE_NOT_APPROVED'],
    [404, 132001, 'TEMPLATE_NOT_APPROVED'],
    [429, 130429, 'RATE_LIMITED'],
    [400, 131048, 'RATE_LIMITED'],
    [400, 131056, 'RATE_LIMITED'],
    [400, 131053, 'MEDIA_UPLOAD_FAILED'],
    [500, 131000, 'PROVIDER_ERROR'],
  ])('maps HTTP %i / Meta %i to %s on send', async (status, code, expected) => {
    fetchMock.mockResolvedValue(metaError(status, code));
    const err = await caught(client().sendTemplate(message));
    expect(err.code).toBe(expected);
    expect(err.providerCode).toBe(code);
  });

  it('maps an unclassified upload error to MEDIA_UPLOAD_FAILED but keeps auth as AUTH_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(metaError(400, 100)).mockResolvedValueOnce(metaError(401, 190));
    expect((await caught(client().uploadMedia(Buffer.from('x'), 'application/pdf', 'a.pdf'))).code).toBe('MEDIA_UPLOAD_FAILED');
    expect((await caught(client().uploadMedia(Buffer.from('x'), 'application/pdf', 'a.pdf'))).code).toBe('AUTH_FAILED');
  });

  it('maps a non-JSON error body by HTTP status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: () => Promise.reject(new Error('not json')) });
    expect((await caught(client().sendTemplate(message))).code).toBe('RATE_LIMITED');
  });

  it('maps a network failure to NETWORK without leaking the error text', async () => {
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for Bearer ${TOKEN}`));
    const err = await caught(client().sendTemplate(message));
    expect(err.code).toBe('NETWORK');
  });

  it('aborts after the timeout and reports NETWORK', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    );
    const pending = caught(client().sendTemplate(message));
    await jest.advanceTimersByTimeAsync(20_000);
    const err = await pending;
    expect(err.code).toBe('NETWORK');
    expect(err.message).toMatch(/in time/);
  });

  it('treats a success without a message id as PROVIDER_ERROR with an unknown outcome', async () => {
    fetchMock.mockResolvedValue(json(200, {}));
    const err = await caught(client().sendTemplate(message));
    expect(err.code).toBe('PROVIDER_ERROR');
    expect(err.outcomeUnknown).toBe(true);
  });

  describe('outcome unknown vs. definite refusal', () => {
    it('send: network error, timeout and Meta 5xx are outcome-unknown; a Meta 4xx is a definite refusal', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      expect((await caught(client().sendTemplate(message))).outcomeUnknown).toBe(true);
      fetchMock.mockResolvedValueOnce(metaError(500, 131000));
      expect((await caught(client().sendTemplate(message))).outcomeUnknown).toBe(true);
      fetchMock.mockResolvedValueOnce(metaError(400, 131026));
      expect((await caught(client().sendTemplate(message))).outcomeUnknown).toBe(false);
    });

    it('upload and pre-flight failures are definite (nothing was sent)', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      expect((await caught(client().uploadMedia(Buffer.from('x'), 'application/pdf', 'a.pdf'))).outcomeUnknown).toBe(false);
      fetchMock.mockResolvedValueOnce(metaError(500, 1));
      expect((await caught(client().uploadMedia(Buffer.from('x'), 'application/pdf', 'a.pdf'))).outcomeUnknown).toBe(false);
      expect((await caught(client({}).sendTemplate(message))).outcomeUnknown).toBe(false);
      expect((await caught(client().sendTemplate({ ...message, to: '1' }))).outcomeUnknown).toBe(false);
    });

    it('the timeout also covers reading the response body', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
        }),
      );
      const pending = caught(client().sendTemplate(message));
      await jest.advanceTimersByTimeAsync(20_000);
      const err = await pending;
      expect(err.code).toBe('NETWORK');
      expect(err.outcomeUnknown).toBe(true);
    });
  });

  it('helpers: classify and mask', () => {
    expect(classifyMetaError(undefined, 401)).toBe('AUTH_FAILED');
    expect(classifyMetaError(undefined, 500)).toBe('PROVIDER_ERROR');
    expect(maskPhone('+252612345678')).toBe('…5678');
    expect(maskPhone(null)).toBe('…');
  });
});

describe('resolveWhatsAppTemplate', () => {
  const cfg = (env: Record<string, string>) => ({ get: (k: string) => env[k] }) as never;

  it('returns the configured name with the default language', () => {
    expect(resolveWhatsAppTemplate(cfg({ WHATSAPP_TEMPLATE_INVOICE: 'rukna_invoice' }), 'INVOICE')).toEqual({
      name: 'rukna_invoice',
      language: 'en',
    });
  });

  it('honours WHATSAPP_TEMPLATE_LANGUAGE and returns null when unconfigured', () => {
    const c = cfg({ WHATSAPP_TEMPLATE_RECEIPT: 'r', WHATSAPP_TEMPLATE_LANGUAGE: 'en_GB' });
    expect(resolveWhatsAppTemplate(c, 'RECEIPT')).toEqual({ name: 'r', language: 'en_GB' });
    expect(resolveWhatsAppTemplate(c, 'OVERDUE_REMINDER')).toBeNull();
  });
});
