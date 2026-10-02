import { createHmac } from 'node:crypto';

import { tenancyStorage } from '../../tenancy/tenancy.context';
import { WhatsAppWebhookService, extractStatuses } from './whatsapp-webhook.service';

function deps() {
  const routes = { findTenantSlug: jest.fn(), record: jest.fn() };
  const tenancy = { resolveTenant: jest.fn() };
  const communication = { applyStatusUpdate: jest.fn() };
  return { routes, tenancy, communication };
}

function service(env: Record<string, string | undefined>, d = deps()) {
  const config = { get: (key: string) => env[key] };
  return new WhatsAppWebhookService(config as never, d.routes as never, d.tenancy as never, d.communication as never);
}

const ENV = { WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me', WHATSAPP_APP_SECRET: 'app-secret' };
const sign = (body: string, secret = 'app-secret') =>
  `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`;

describe('WhatsApp webhook (ADR-042)', () => {
  describe('verification handshake', () => {
    it('echoes the challenge for subscribe + the configured token', () => {
      expect(service(ENV).verifyHandshake('subscribe', 'verify-me', '1158201444')).toBe('1158201444');
    });

    it('refuses a wrong token, another mode, or a missing challenge', () => {
      const s = service(ENV);
      expect(s.verifyHandshake('subscribe', 'guess', '1')).toBeNull();
      expect(s.verifyHandshake('unsubscribe', 'verify-me', '1')).toBeNull();
      expect(s.verifyHandshake('subscribe', 'verify-me', undefined)).toBeNull();
    });

    it('refuses array or object query values', () => {
      const s = service(ENV);
      expect(s.verifyHandshake('subscribe', ['verify-me'], '1')).toBeNull();
      expect(s.verifyHandshake('subscribe', 'verify-me', ['1', '2'])).toBeNull();
    });

    it('refuses everything while no verify token is configured', () => {
      expect(service({}).verifyHandshake('subscribe', '', 'x')).toBeNull();
      expect(service({}).verifyHandshake('subscribe', 'anything', 'x')).toBeNull();
    });
  });

  describe('notification signature', () => {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

    it('accepts Meta’s HMAC-SHA256 of the raw body', () => {
      expect(service(ENV).isSignatureValid(Buffer.from(body), sign(body))).toBe(true);
    });

    it('refuses a forged, tampered, missing or unsigned request', () => {
      const s = service(ENV);
      expect(s.isSignatureValid(Buffer.from(body), sign(body, 'not-the-secret'))).toBe(false);
      expect(s.isSignatureValid(Buffer.from(`${body} `), sign(body))).toBe(false);
      expect(s.isSignatureValid(Buffer.from(body), undefined)).toBe(false);
      expect(s.isSignatureValid(undefined, sign(body))).toBe(false);
    });

    it('refuses everything while no app secret is configured', () => {
      expect(service({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'v' }).isSignatureValid(Buffer.from(body), sign(body))).toBe(false);
    });
  });

  it('reads status updates and masks the recipient', () => {
    const updates = extractStatuses({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.A', status: 'delivered', recipient_id: '252612345678', timestamp: '1727780000' },
                  { id: 'wamid.B', status: 'failed', recipient_id: '252615550142', timestamp: '1727780001', errors: [{ code: 131026 }] },
                  { nonsense: true },
                ],
              },
            },
            { value: { messages: [{ id: 'incoming' }] } },
          ],
        },
      ],
    });
    expect(updates).toEqual([
      { messageId: 'wamid.A', status: 'delivered', recipient: '…5678', timestamp: '1727780000' },
      { messageId: 'wamid.B', status: 'failed', recipient: '…0142', timestamp: '1727780001', errors: [{ code: 131026 }] },
    ]);
    expect(extractStatuses(null)).toEqual([]);
  });

  describe('status routing (phase 2)', () => {
    const update = (id: string, status = 'delivered') => ({
      messageId: id,
      status,
      recipient: '…5678',
      timestamp: '1727780000',
    });

    it('finds the tenant from the platform route and applies the update inside its context', async () => {
      const d = deps();
      d.routes.findTenantSlug.mockResolvedValue('acco');
      d.tenancy.resolveTenant.mockResolvedValue({ tenantId: 't1', tenantSlug: 'acco', client: {} });
      let seenTenant: string | undefined;
      d.communication.applyStatusUpdate.mockImplementation(() => {
        seenTenant = tenancyStorage.getStore()?.tenantSlug;
        return Promise.resolve('applied');
      });

      await service(ENV, d).dispatch([{ ...update('wamid.A', 'failed'), errors: [{ code: 131026 }] }]);

      expect(d.routes.findTenantSlug).toHaveBeenCalledWith('wamid.A');
      expect(d.tenancy.resolveTenant).toHaveBeenCalledWith('acco');
      expect(d.communication.applyStatusUpdate).toHaveBeenCalledWith({
        providerMessageId: 'wamid.A',
        status: 'failed',
        timestamp: '1727780000',
        errors: [{ code: 131026 }],
      });
      expect(seenTenant).toBe('acco');
    });

    it('ignores an unknown message id without resolving a tenant or throwing', async () => {
      const d = deps();
      d.routes.findTenantSlug.mockResolvedValue(null);
      await expect(service(ENV, d).dispatch([update('wamid.unknown')])).resolves.toBeUndefined();
      expect(d.tenancy.resolveTenant).not.toHaveBeenCalled();
      expect(d.communication.applyStatusUpdate).not.toHaveBeenCalled();
    });

    it('one failing update does not stop the next', async () => {
      const d = deps();
      d.routes.findTenantSlug.mockResolvedValue('acco');
      d.tenancy.resolveTenant.mockRejectedValueOnce(new Error('tenant down')).mockResolvedValue({ tenantId: 't1', tenantSlug: 'acco', client: {} });
      d.communication.applyStatusUpdate.mockResolvedValue('applied');
      await service(ENV, d).dispatch([update('wamid.1'), update('wamid.2')]);
      expect(d.communication.applyStatusUpdate).toHaveBeenCalledTimes(1);
      expect(d.communication.applyStatusUpdate.mock.calls[0][0].providerMessageId).toBe('wamid.2');
    });

    it('handleNotification returns at once and routes in the background', async () => {
      const d = deps();
      let release!: (v: string | null) => void;
      d.routes.findTenantSlug.mockReturnValue(new Promise((r) => (release = r)));
      const updates = service(ENV, d).handleNotification({
        entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.Z', status: 'read', recipient_id: '252612345678', timestamp: '1' }] } }] }],
      });
      expect(updates).toHaveLength(1);
      expect(d.communication.applyStatusUpdate).not.toHaveBeenCalled();
      release(null);
      await new Promise((r) => setImmediate(r));
      expect(d.routes.findTenantSlug).toHaveBeenCalledWith('wamid.Z');
    });
  });
});
