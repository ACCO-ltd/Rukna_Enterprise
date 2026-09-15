/**
 * CJS stub for `@nestjs/schedule` under Jest.
 *
 * `@nestjs/schedule@12` ships pure ESM; the unit Jest config (`^.+\.ts$` transform, node_modules
 * ignored) cannot parse it, so importing `AppModule` (which registers `ScheduleModule.forRoot()`) or
 * the notification generator (which uses `@Cron`) throws "Unexpected token 'export'". Production builds
 * (nest build / tsc) use the real package; only Jest is redirected here via `moduleNameMapper`.
 *
 * The scheduler does nothing under test — the generator body is exercised directly via
 * `generateAllTenants()`/`runOrgCycle`, never the cron — so these are inert markers.
 */

// A real (empty) class so Nest can use it as the DynamicModule `module` metatype; `forRoot()` returns
// a valid, provider-less registration.
export class ScheduleModule {
  static forRoot(): { module: typeof ScheduleModule; providers: unknown[]; exports: unknown[] } {
    return { module: ScheduleModule, providers: [], exports: [] };
  }
}

/** Method decorator marker — a no-op under test. */
export const Cron = (): MethodDecorator => () => undefined;

/** Only the expression the app references is needed; value is irrelevant under test. */
export const CronExpression = {
  EVERY_DAY_AT_6AM: '0 6 * * *',
} as const;
