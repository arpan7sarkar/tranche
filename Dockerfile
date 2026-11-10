FROM node:24-bookworm-slim AS build
WORKDIR /app

RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile

ARG NEXT_PUBLIC_PAYPAL_CLIENT_ID
ARG NEXT_PUBLIC_GITHUB_APP_INSTALL_URL
ARG NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @tranche/web build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
