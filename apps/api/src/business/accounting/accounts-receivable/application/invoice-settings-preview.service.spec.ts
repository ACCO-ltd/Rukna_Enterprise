/**
 * The invoice settings preview renders the real invoice document from UNSAVED settings: the draft
 * is validated as a save would validate it, the org's own identity and logo are used, the invoice
 * itself is the sample, and nothing is written.
 */
import { HttpException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

import {
  InvoiceSettingsPreviewService,
  PREVIEW_RENDERS_PER_WINDOW,
  PREVIEW_WINDOW_MS,
} from './invoice-settings-preview.service';
import type { InvoiceDocumentInput } from './document-pdf/invoice-view-model';

const identity = { userId: 'u1', activeOrganizationId: 'org1' } as RequestIdentity;

function setup(
  org: Record<string, unknown> | null = {
    name: 'ACCO Ltd',
    logoFileId: 'logo1',
    legalAddress: 'Olow Tower\nMogadishu',
    taxRegistrationNumber: 'TIN-1',
    brandColorHex: '#1F3FA8',
    invoiceTemplate: 'STANDARD',
  },
) {
  const prisma = {
    organization: { findUnique: jest.fn().mockResolvedValue(org) },
    invoiceDocumentPolicy: { upsert: jest.fn(), update: jest.fn(), create: jest.fn() },
  };
  const tenancy = { getClient: () => prisma };
  const logo = { buffer: Buffer.from('png'), mimeType: 'image/png' };
  const files = { readBytesForRendering: jest.fn().mockResolvedValue(logo) };
  const documents = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF')) };
  const service = new InvoiceSettingsPreviewService(tenancy as never, files as never, documents as never);
  const rendered = () => documents.render.mock.calls[0][0] as InvoiceDocumentInput;
  return { service, prisma, files, documents, logo, rendered };
}

describe('InvoiceSettingsPreviewService', () => {
  it('prints the draft settings with the org identity on the sample invoice, storing nothing', async () => {
    const { service, prisma, files, logo, rendered } = setup();

    const pdf = await service.render(identity, {
      tagline: '  Construction & Development ',
      footerAddress: 'Olow Tower\n\nMaka Al-Mukarama Road',
      footerPhones: ['+252 61 234 5678', ''],
      footerEmail: 'info@acco.so',
      footerWebsite: 'www.acco.so',
      signatoryName: 'Ahmed Abdi',
      signatoryTitle: 'CEO',
      paymentAccounts: [{ bankName: 'Salaam Bank', accountNumber: '3302' }],
      showBankDetails: true,
      showNotes: false,
    });

    expect(pdf.toString()).toBe('%PDF');
    expect(files.readBytesForRendering).toHaveBeenCalledWith('logo1');
    const input = rendered();
    expect(input.invoiceNumber).toBe('SAMPLE');
    expect(input.client.name).toBe('Sample Client');
    expect(input.org).toMatchObject({
      name: 'ACCO Ltd',
      tagline: 'Construction & Development',
      logo,
    });
    expect(input.footer).toEqual({
      address: 'Olow Tower\nMaka Al-Mukarama Road',
      phones: ['+252 61 234 5678'],
      email: 'info@acco.so',
      website: 'www.acco.so',
    });
    expect(input.signatory).toEqual({ name: 'Ahmed Abdi', title: 'CEO' });
    expect(input.paymentAccounts).toEqual([{ bankName: 'Salaam Bank', accountNumber: '3302' }]);
    expect(input.showBankDetails).toBe(true);
    expect(prisma.invoiceDocumentPolicy.upsert).not.toHaveBeenCalled();
  });

  it('treats omitted fields as empty — nothing falls back to the stored settings', async () => {
    const { service, rendered } = setup();
    await service.render(identity, {});
    const input = rendered();
    expect(input.footer).toEqual({ address: null, phones: [], email: null, website: null });
    expect(input.signatory).toBeNull();
    expect(input.org.tagline).toBeNull();
    expect(input.showBankDetails).toBe(false);
  });

  it('refuses what a save would refuse (422), without rendering', async () => {
    const { service, documents } = setup();
    await expect(service.render(identity, { footerEmail: 'not-an-email' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.render(identity, { footerAddress: 'one\ntwo\nthree' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(documents.render).not.toHaveBeenCalled();
  });

  it('renders without a logo or org row', async () => {
    const { service, files, rendered } = setup(null);
    files.readBytesForRendering.mockResolvedValue(null);
    await service.render(identity, {});
    expect(files.readBytesForRendering).toHaveBeenCalledWith(null);
    expect(rendered().org).toMatchObject({ name: 'Invoice', logo: null, template: 'STANDARD' });
  });

  it('answers 429 to a user rendering faster than the limit, per user, until the window passes', async () => {
    const { service } = setup();
    const t0 = 1_000_000;
    for (let i = 0; i < PREVIEW_RENDERS_PER_WINDOW; i += 1) await service.render(identity, {}, t0 + i);
    const refused = await service.render(identity, {}, t0 + 100).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(429);
    // Another user is unaffected; the same user is admitted once the window has passed.
    await expect(service.render({ ...identity, userId: 'u2' }, {}, t0 + 100)).resolves.toBeInstanceOf(Buffer);
    await expect(service.render(identity, {}, t0 + PREVIEW_WINDOW_MS + 50)).resolves.toBeInstanceOf(Buffer);
  });
});
