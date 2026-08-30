# syntax=docker/dockerfile:1
#
# Build image for @erp/web (Next.js). Context is the monorepo root, not apps/web —
# the app depends on the @erp/ui and @erp/types workspace packages.
#
# NEXT_PUBLIC_* values are inlined into the client bundle at BUILD time, so the API
# URL is a build arg, not a runtime env var. Change it (or rebuild) to point the
# browser at a different API host.

FROM node:22-slim

RUN corepack enable

WORKDIR /app

COPY . .

RUN pnpm install --frozen-lockfile

# Baked into the client bundle at build time (single-tenant: the one API host).
ARG NEXT_PUBLIC_API_URL=https://api.rukna.site/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# Builds @erp/ui and @erp/types first via turbo's dependency graph, then the Next app.
RUN pnpm exec turbo run build --filter=@erp/web

WORKDIR /app/apps/web

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# `next start` serves the prebuilt .next on 0.0.0.0:$PORT.
CMD ["pnpm", "start"]
