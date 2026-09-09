# Myelin

**Typed application infrastructure and API workspace for Unmute1AI.**

Myelin is a pnpm monorepo containing reusable API, database, and client packages plus deployable application artifacts.

## Workspace layout

- `artifacts/api-server` — Express-based API server
- `artifacts/mockup-sandbox` — Vite/React interface sandbox
- `lib/api-client-react` — generated/typed client layer
- `lib/api-spec` — API schema/code-generation tooling
- `lib/api-zod` — shared runtime validation
- `lib/db` — database schema and Drizzle ORM integration
- `scripts` — workspace automation

> **Status: production candidate platform workspace.** Deployment readiness depends on the concrete artifact, environment, database, and secret configuration.

## Requirements

- Node.js 20+
- pnpm

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
```

## Development

API server:

```bash
pnpm --filter @workspace/api-server run dev
```

Mockup sandbox:

```bash
pnpm --filter @workspace/mockup-sandbox run dev
```

## Production principles

- Schemas and generated clients should come from one versioned API contract.
- Database migrations/schema changes require review and rollback planning.
- Production credentials belong in managed secrets, never committed config.
- CORS, cookies, session handling, and logs must be environment-specific and least-privilege.
- Generated code should be reproducible from committed specifications.
- API changes should preserve compatibility or clearly version breaking changes.

See [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) and [SECURITY.md](SECURITY.md).

---

**Unmute1AI**  
Reliable infrastructure underneath accessible AI.
