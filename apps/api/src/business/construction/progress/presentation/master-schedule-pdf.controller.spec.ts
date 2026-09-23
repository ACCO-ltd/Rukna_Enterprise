import { StreamableFile } from '@nestjs/common';

// Keep react-pdf's ESM tree out of jest — the controller imports the PDF service, which imports the
// renderer, which imports @react-pdf/renderer. This suite never renders, so a bare stub is enough.
jest.mock('@react-pdf/renderer', () => ({
  __esModule: true,
  Document: 'DOCUMENT',
  Page: 'PAGE',
  View: 'VIEW',
  Text: 'TEXT',
  Image: 'IMAGE',
  Svg: 'SVG',
  Polyline: 'POLYLINE',
  Line: 'LINE',
  Rect: 'RECT',
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: jest.fn(async () => Buffer.from('%PDF-')),
}));

import { ProgressController } from './progress.controller.js';
import type { MasterSchedulePdfResult } from '../application/master-schedule-pdf.service.js';

/**
 * Master Schedule P4 (ADR-029) — a light controller test for the first binary/streaming route. It
 * proves the endpoint wraps the service's buffer in a StreamableFile with the right Content-Type and
 * Content-Disposition (attachment; filename=...). NestJS reads those from the StreamableFile options
 * and writes the raw PDF body (no global interceptor/serializer wraps a GET response — the only
 * APP_INTERCEPTOR short-circuits GET).
 */

const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

describe('ProgressController — master-schedule.pdf', () => {
  it('streams a StreamableFile with application/pdf + attachment disposition from the service', async () => {
    const buffer = Buffer.from('%PDF-1.7 fake body');
    const result: MasterSchedulePdfResult = {
      buffer,
      projectCode: 'ACCO-WBR-26-0062',
      asOf: '2026-09-10',
      filename: 'master-schedule-ACCO-WBR-26-0062-2026-09-10.pdf',
    };
    const generate = jest.fn().mockResolvedValue(result);
    const pdfService = { generate } as never;

    const controller = new ProgressController({} as never, {} as never, pdfService);
    const streamable = await controller.masterSchedulePdfReport(identity, 'p1', '2026-09-10');

    expect(generate).toHaveBeenCalledWith(identity, 'p1', '2026-09-10');
    expect(streamable).toBeInstanceOf(StreamableFile);

    const headers = streamable.getHeaders();
    expect(headers.type).toBe('application/pdf');
    expect(headers.disposition).toBe(
      'attachment; filename="master-schedule-ACCO-WBR-26-0062-2026-09-10.pdf"',
    );
    expect(headers.length).toBe(buffer.length);
  });

  it('passes the optional asOf query through (undefined by default)', async () => {
    const generate = jest.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF-'),
      projectCode: 'C',
      asOf: '2026-09-10',
      filename: 'master-schedule-C-2026-09-10.pdf',
    } satisfies MasterSchedulePdfResult);
    const controller = new ProgressController({} as never, {} as never, { generate } as never);

    await controller.masterSchedulePdfReport(identity, 'p1');
    expect(generate).toHaveBeenCalledWith(identity, 'p1', undefined);
  });
});
