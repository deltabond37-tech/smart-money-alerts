# Build from the monorepo root:  docker build -f apps/worker/Dockerfile -t sma-worker .
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @sma/worker...

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @sma/core build && pnpm --filter @sma/worker build
RUN pnpm --filter @sma/worker --prod deploy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out /app
USER node
CMD ["node", "dist/index.js"]
