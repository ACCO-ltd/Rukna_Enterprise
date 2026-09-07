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

// Booting the whole graph pulls in AuthModule → Jwt/JwtRefresh strategies, whose passport
// constructors throw when their secret is empty. CI's test env carries the DB URLs but no JWT
// secrets, so provide test-only defaults here (||= never clobbers a real env value locally).
beforeAll(() => {
  process.env.JWT_ACCESS_SECRET ||= 'test-access-secret';
  process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret';
});

it('DI-01: the whole application graph compiles', async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  expect(moduleRef).toBeDefined();
  await moduleRef.close();
}, 60_000);
