import { OPENROUTER_DEFAULT_MODEL, OpenRouterReader } from './openrouter.reader';

const config = (values: Record<string, string>) => ({ get: (k: string) => values[k] }) as never;
const image = { bytes: Buffer.from('img'), mimeType: 'image/jpeg' };

describe('OpenRouterReader (Step 7)', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('is unavailable without a key, and defaults to the free router', () => {
    expect(new OpenRouterReader(config({})).isAvailable()).toBe(false);
    expect(new OpenRouterReader(config({ OPENROUTER_API_KEY: 'k' })).model()).toBe(OPENROUTER_DEFAULT_MODEL);
  });

  it('sends the prompt and the photo inline, and returns the answer text', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"lines":[]}' } }] }) });
    global.fetch = fetchMock as never;
    const r = new OpenRouterReader(config({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'some/vision:free' }));
    await expect(r.read(image, 'Read it')).resolves.toBe('{"lines":[]}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('some/vision:free');
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: 'Read it' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('img').toString('base64')}` } },
    ]);
  });

  it('maps a busy free tier and an empty answer to their own errors', async () => {
    const r = new OpenRouterReader(config({ OPENROUTER_API_KEY: 'k' }));
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }) as never;
    await expect(r.read(image, 'p')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) }) as never;
    await expect(r.read(image, 'p')).rejects.toMatchObject({ code: 'REFUSED' });
  });
});
