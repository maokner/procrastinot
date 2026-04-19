# syntax=docker/dockerfile:1.7

# ---------- build stage ----------
FROM node:20-alpine AS build

# better-sqlite3 is a native module — needs build toolchain.
RUN apk add --no-cache python3 make g++ \
  && corepack enable \
  && corepack prepare pnpm@9.12.0 --activate

WORKDIR /repo

# Copy monorepo manifests first for better layer caching.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/abi/package.json packages/abi/
COPY oracle/package.json oracle/

RUN pnpm install --frozen-lockfile

# Copy sources.
COPY packages/abi packages/abi
COPY oracle oracle

RUN pnpm --filter oracle build

# ---------- runtime stage ----------
FROM node:20-alpine AS runtime

WORKDIR /app

# Copy the installed node_modules (hoisted at repo root) and the built oracle.
COPY --from=build /repo/node_modules /app/node_modules
COPY --from=build /repo/oracle/node_modules /app/oracle/node_modules
COPY --from=build /repo/oracle/dist /app/oracle/dist
COPY --from=build /repo/oracle/package.json /app/oracle/package.json
COPY --from=build /repo/packages/abi /app/packages/abi

ENV NODE_ENV=production

WORKDIR /app/oracle
CMD ["node", "dist/index.js"]
