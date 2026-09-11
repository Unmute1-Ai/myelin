# Myelin Workspace Notes

Myelin is the TypeScript API and interface-development workspace for Unmute1AI assistive applications. See [README.md](README.md) for project scope and setup.

## Run and build

- `pnpm --filter @workspace/api-server run dev` — build and start the API service.
- `pnpm --filter @workspace/mockup-sandbox run dev` — start the interface sandbox.
- `pnpm run typecheck` — check libraries and application packages.
- `pnpm run build` — typecheck and build workspace packages.
- `DATABASE_URL` — supply the PostgreSQL connection string through the environment.

## Stack and structure

Node.js 24, pnpm workspaces, TypeScript 5.9, Express 5, PostgreSQL, Drizzle ORM, Zod, and React/Vite.

| Location | Responsibility |
| --- | --- |
| `artifacts/api-server/` | API implementation |
| `artifacts/mockup-sandbox/` | UI development |
| `lib/api-spec/` | API specification and generation |
| `lib/api-client-react/` | React client package |
| `lib/api-zod/` | Validation schemas |
| `lib/db/` | Database schema and access |
| `scripts/` | Workspace scripts |

## Development conventions

Use pnpm; the root preinstall script rejects other package managers. Keep generated API clients aligned with the API specification. Review database schema changes against a development database before any deployment.

Use synthetic data and keep database credentials outside committed files. The workspace is infrastructure in development; describe new product capabilities only once implemented and validated.
