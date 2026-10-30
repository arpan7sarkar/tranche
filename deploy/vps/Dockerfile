FROM node:24-bookworm-slim
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agents/package.json ./apps/agents/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/scripts ./apps/web/scripts
COPY packages/agents/package.json ./packages/agents/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/paypal/package.json ./packages/paypal/package.json
COPY packages/verifiers/package.json ./packages/verifiers/package.json
COPY e2e/package.json ./e2e/package.json
RUN --mount=type=cache,id=tranche-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir /pnpm/store
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN pnpm --filter @tranche/agents-service exec playwright install --with-deps chromium
COPY . .
RUN pnpm --filter @tranche/agents-service build
ENV NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "apps/agents/dist/index.mjs"]
