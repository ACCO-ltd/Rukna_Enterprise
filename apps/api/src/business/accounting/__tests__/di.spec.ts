/**
 * DI — the application module graph resolves.
 *
 * Slice D made `FinancialPositionModule` import `ProjectProcurementModule` so the Finance
 * Overview reuses the same cost rollup Cost Control renders rather than computing a second
 * answer. A cross-module edge like that is exactly where a provider goes unexported or a cycle
 * appears, and neither shows up in a unit test — only when the app boots.
 */
import { Test } from '@nestjs/testing';
import { AppModule } from '../../../app.module.js';

it('DI-01: the whole application graph compiles', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  expect(moduleRef).toBeDefined();
  await moduleRef.close();
}, 60_000);
