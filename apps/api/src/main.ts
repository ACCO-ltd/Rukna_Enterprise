import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api/v1');

  app.enableCors({
    origin: process.env['FRONTEND_URL'] ?? 'http://localhost:3000',
    credentials: true,
  });

  const openApiConfig = new DocumentBuilder()
    .setTitle('Rukna ERP API')
    .setDescription(
      'Platform API for the Rukna ERP system.\n\n' +
        '**Authentication:** All protected endpoints require a JWT bearer token obtained from `POST /api/v1/auth/login`.\n\n' +
        '**Tenancy:** Tenant is resolved from the request subdomain (e.g. `acco.rukna.app`).',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .addTag('Auth', 'Authentication — login, token refresh, logout')
    .addTag('Users', 'User account lookup')
    .addTag('Organizations', 'Organization management')
    .addTag('Roles', 'Role catalogue per organization')
    .addTag('Permissions', 'Platform permission catalogue')
    .addTag('Audit Logs', 'Immutable audit trail')
    .addTag('Workflows', 'Approval workflow engine')
    .build();

  const document = SwaggerModule.createDocument(app, openApiConfig);

  // Raw OpenAPI JSON — consumed by Scalar and any external tooling
  app.use('/docs-json', (_req: Request, res: Response) => void res.json(document));

  // Scalar API reference UI
  app.use('/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!doctype html>
<html lang="en">
  <head>
    <title>Rukna ERP — API Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <script
      id="api-reference"
      data-url="/docs-json"
      data-configuration='{"theme":"purple","layout":"modern","defaultHttpClient":{"targetKey":"javascript","clientKey":"fetch"},"authentication":{"preferredSecurityScheme":"access-token"}}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
  });

  const port = process.env['PORT'] ?? 3001;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/api/v1`);
  logger.log(`API docs  →  http://localhost:${port}/docs`);
}

bootstrap();
