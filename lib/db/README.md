# @workspace/db

Persistent storage for the PRIMER platform: Drizzle ORM schema, generated
migrations, and a repeatable demo seed. PostgreSQL is the only sanctioned
backend.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm --filter @workspace/db db:generate` | Generate a migration from `src/schema` (requires `DATABASE_URL`) |
| `pnpm --filter @workspace/db db:migrate` | Apply pending migrations |
| `pnpm --filter @workspace/db db:push` | Push schema directly (prototyping; migrations are the release path) |
| `pnpm --filter @workspace/db db:seed` | Reset + load demo data (requires `DATABASE_URL`) |
| `pnpm --filter @workspace/db test` | Unit tests; integration tests run when `DATABASE_URL` is set |

`DATABASE_URL` comes from the environment — never commit credentials.

## Schema map (`src/schema/`)

| Module | Tables |
| --- | --- |
| `users.ts` | `users`, `guardian_links`, `consents` |
| `tutoring.ts` | `tutoring_sessions`, `session_turns`, `assessments` |
| `learning-profiles.ts` | `learning_profiles`, `profile_entries` |
| `progress.ts` | `progress_events` |
| `accessibility.ts` | `accessibility_prefs` |
| `audit.ts` | `audit_log` |
| `enums.ts` / `relations.ts` | Shared enums and relational queries |

Design rules baked into the schema and tests (`round-trip.test.ts`,
`db-round-trip.test.ts`):

- **No diagnosis field anywhere** — asserted, not just promised. Interpretation
  is not authorization (spec §7.10).
- **Mastery requires evidence**: recall evidence can only support
  `memorization`/`recognition`; `comprehension` and above require independent
  application, explanation, or transfer evidence — enforced by a CHECK
  constraint and a zod refinement.
- **Explicit-only preferences**: `profile_entries.kind` has no inferred
  disability types; strategy changes carry a human-readable `whyChanged`.
- **Append-only trails**: `audit_log` and `progress_events` never cascade away
  with actors (FK `set null`), preserving the authorization trail.

## Workflow: changing the schema

1. Edit the table modules under `src/schema/`.
2. `pnpm --filter @workspace/db db:generate -- --name=short_descriptive_name`.
3. Never hand-edit generated files under `drizzle/`.
4. Run the tests with a database provisioned (`DATABASE_URL`) — the
   integration suite applies every migration to a fresh database.
