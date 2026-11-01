# PRIMER Express API (artifacts/api-server) — container-ready image.
#
# Build from the REPO ROOT (the pnpm workspace root), because the bundle
# stitches in workspace sources from lib/:
#
#   docker build -f artifacts/api-server/Dockerfile -t primer-api .
#
# Run (DATABASE_URL and SESSION_SECRET are required — see the root README):
#
#   docker run --rm -p 8080:8080 \
#     -e DATABASE_URL=postgres://... \
#     -e SESSION_SECRET=$(openssl rand -hex 32) \
#     primer-api
#
# Deploy target is intentionally open: this image is plain `node:24-slim` and
# runs on any container platform (Fly.io, Railway, Kubernetes, self-hosted).
#
# If a workspace package is added, add its package.json to the manifest COPY
# lists in both stages below (pnpm needs every lockfile importer present).

# syntax=docker/dockerfile:1
FROM node:24-slim AS base

# pnpm is pinned by the repo's packageManager field; corepack enforces it.
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# Stage 1 — build: bundle the API with esbuild (pnpm workspace context).
# ---------------------------------------------------------------------------
FROM base AS build

# Manifests first so the install layer only busts when the dependency graph
# changes. Every workspace importer must exist for --frozen-lockfile; only
# packages WITH a package.json are listed (pnpm skips bare dirs like
# artifacts/u1-neurosignal-v0, a docs/prototype directory).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY scripts/package.json scripts/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Sources the bundle stitches in: the api-server plus its TS-source workspace
# dependencies (lib/db, lib/api-zod export raw TypeScript from src/).
COPY artifacts/api-server/ artifacts/api-server/
COPY lib/db/ lib/db/
COPY lib/api-zod/ lib/api-zod/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @workspace/api-server run build

# ---------------------------------------------------------------------------
# Stage 2 — runtime: fresh workspace with only the API's production graph.
# A filtered prod install (not `pnpm deploy`, which pnpm 10 reserves for
# inject-workspace-packages workspaces) links every transitive dep the bundle
# externalizes — including the native @node-rs/argon2 — where node can
# resolve it from dist/.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=8080

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY scripts/package.json scripts/
COPY artifacts/api-server/package.json artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json artifacts/mockup-sandbox/
COPY lib/api-client-react/package.json lib/api-client-react/
COPY lib/api-spec/package.json lib/api-spec/
COPY lib/api-zod/package.json lib/api-zod/
COPY lib/db/package.json lib/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter @workspace/api-server... install --prod --frozen-lockfile

COPY --from=build /repo/artifacts/api-server/dist artifacts/api-server/dist/

# The API never writes to the filesystem; run unprivileged.
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
