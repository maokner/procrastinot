# syntax=docker/dockerfile:1.7

# ---------- build stage ----------
FROM node:20-alpine AS build

RUN corepack enable \
  && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

# Copy monorepo manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/abi/package.json packages/abi/
COPY indexer/package.json indexer/

RUN pnpm install --frozen-lockfile

# Copy sources.
COPY packages/abi packages/abi
COPY indexer indexer

# Build the abi package first, then the indexer (which imports from it).
RUN pnpm --filter @procrastinot/abi build \
 && pnpm --filter indexer build

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime

WORKDIR /app

COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/indexer/node_modules /app/indexer/node_modules
COPY --from=build /repo/indexer/dist /app/indexer/dist
COPY --from=build /repo/indexer/package.json /app/indexer/package.json
COPY --from=build /repo/packages/abi /app/packages/abi

ENV NODE_ENV=production

WORKDIR /app/indexer
CMD ["node", "dist/index.js"]
