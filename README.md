# Myelin

**Application infrastructure for the Unmute1AI assistive-computing vision.**

[Portfolio](https://github.com/Unmute1-Ai/Unmute1ai#readme) · [Engineering](https://github.com/Unmute1-Ai/U1Ai#readme) · [Security evidence](https://github.com/Unmute1-Ai/glass-box#readme)

Myelin contains a TypeScript workspace with an Express API server, PostgreSQL/Drizzle data layer, generated API clients, and a React UI sandbox.

**Status: development scaffold.** The repository provides application infrastructure. A complete on-device neurodivergent companion or assistive operating system is not established by these files.

## Repository map

| Path | Purpose |
| --- | --- |
| [artifacts/api-server/](artifacts/api-server/) | Express API service |
| [artifacts/mockup-sandbox/](artifacts/mockup-sandbox/) | React/Vite interface sandbox |
| [lib/api-spec/](lib/api-spec/) | API contract and generation tooling |
| [lib/api-client-react/](lib/api-client-react/) | React API client package |
| [lib/api-zod/](lib/api-zod/) | API validation package |
| [lib/db/](lib/db/) | Database package |
| [scripts/](scripts/) | Workspace utilities |

## Local development

Use Node.js 24 and pnpm, following the workspace's existing tooling. The API requires a PostgreSQL connection supplied through `DATABASE_URL` in your local environment.

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run dev
```

Run the interface sandbox in a second terminal:

```bash
pnpm --filter @workspace/mockup-sandbox run dev
```

Use the local address printed by each service. Commands above correspond to checked-in scripts; they are not a claim that a clean build has been validated.

## Product direction

Myelin can provide infrastructure for assistive experiences such as Neche. That relationship is a development direction, not a claim that Neche's local inference, memory isolation, or disclosure controls are implemented here.

## Contributing

Keep API contracts, generated clients, and validation schemas aligned. Explain data flows in changes that add a provider, database field, or external service. Use synthetic data for development and keep credentials outside source control.

See [replit.md](replit.md) for workspace operation notes.

---

**Unmute1AI · Technology that adapts to people.**
