# syntax=docker/dockerfile:1
#
# Build image for @erp/api.
#
# The build context is the monorepo root, not apps/api — the API depends on the
# @erp/types and @erp/config workspace packages, so pnpm needs the whole
# workspace to resolve them.
#
# devDependencies are kept in the final image on purpose: the release step runs
# `prisma migrate deploy` (prisma CLI) via tsx, both of which are devDeps.

FROM node:22-slim

# openssl is required by Prisma's query engine
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

COPY . .

# apps/api's postinstall runs `prisma generate` for both schemas. That must
# happen before the build, because nest-cli.json copies src/generated/** into
# dist as build assets.
RUN pnpm install --frozen-lockfile

# Builds @erp/types and @erp/config first via turbo's dependency graph
RUN pnpm exec turbo run build --filter=@erp/api

WORKDIR /app/apps/api

ENV NODE_ENV=production

# Railway injects PORT; main.ts falls back to 3001 when it is absent
EXPOSE 3001

CMD ["node", "dist/main.js"]
