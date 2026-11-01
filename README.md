# Myelin

**Application infrastructure for the Unmute1AI assistive-computing vision.**

[Portfolio](https://github.com/Unmute1-Ai/Unmute1ai#readme) · [Engineering](https://github.com/Unmute1-Ai/U1Ai#readme) · [Security evidence](https://github.com/Unmute1-Ai/glass-box#readme)

Myelin contains a TypeScript workspace with an Express API server, PostgreSQL/Drizzle data layer, generated API clients, and React UIs.

**Status: development scaffold.** The repository provides application infrastructure. A complete on-device neurodivergent companion or assistive operating system is not established by these files.

## Repository map

| Path | Purpose |
| --- | --- |
| [apps/web/](apps/web/) | PRIMER web app (Next.js 15) — student, parent, and educator surfaces |
| [artifacts/api-server/](artifacts/api-server/) | PRIMER Express API service (auth/RBAC, tutor, profiles, assessments, audit) |
| [artifacts/mockup-sandbox/](artifacts/mockup-sandbox/) | React/Vite interface sandbox |
| [artifacts/u1-neurosignal-v0/](artifacts/u1-neurosignal-v0/) | Local-first EEG + physiology clinician-review research prototype |
| [lib/api-spec/](lib/api-spec/) | API contract and generation tooling |
| [lib/api-client-react/](lib/api-client-react/) | React API client package |
| [lib/api-zod/](lib/api-zod/) | API validation package |
| [lib/db/](lib/db/) | Database package (Drizzle schema, migrations, demo seed) |
| [scripts/](scripts/) | Workspace utilities |

## PRIMER platform

PRIMER ("Learn the child. Then teach the lesson.") is the adaptive tutoring product built on this workspace: `apps/web` is the role-based front end, `artifacts/api-server` is the API and adaptive teaching engine, and `lib/db` persists learning profiles, sessions, assessments, and audit records in PostgreSQL. See `replit.md` for workspace operation notes.

## Local development

### Prerequisites

- **Node.js 24** (the container image uses `node:24-slim`; `.nvmrc` pins 24 for version managers)
- **pnpm 10** — the exact version is pinned by `packageManager` in `package.json`; enable corepack once with `corepack enable`
- **PostgreSQL** (any recent version; the setup below was verified against PostgreSQL 17)

### Setup

```sh
corepack enable                 # provides the pinned pnpm
pnpm install --frozen-lockfile
```

Provision a database and export its connection string (never commit values):

```sh
export DATABASE_URL=postgres://user:password@localhost:5432/primer
```

No PostgreSQL handy? Start a throwaway one:

```sh
docker run -d --rm --name primer-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=primer -p 5432:5432 postgres:17-alpine
export DATABASE_URL=postgres://postgres:test@localhost:5432/primer
```

Apply the schema, then optionally load demo data:

```sh
pnpm --filter @workspace/db db:migrate
pnpm --filter @workspace/db db:seed      # optional — demo data only, see below
```

### Run the API server

```sh
export PORT=8080
export SESSION_SECRET=$(openssl rand -hex 32)   # ≥32 chars; signs session cookies
pnpm --filter @workspace/api-server run dev
```

With no `TUTOR_PROVIDER` set, the deterministic scripted provider answers — no API keys needed. Health check: `curl localhost:8080/api/healthz`.

### Run the web app

```sh
pnpm --filter @workspace/web run dev     # http://localhost:3000
```

The React/Vite interface sandbox runs in a second terminal:

```sh
pnpm --filter @workspace/mockup-sandbox run dev
```

Set `NEXT_PUBLIC_API_BASE_URL` (see [apps/web/.env.example](apps/web/.env.example)) when the app should call the API.

## Environment variables

Secrets come from the environment — **never commit values**. `.env` files are git-ignored; `*.example` files are the committable templates.

### API server (`artifacts/api-server` — see its [.env.example](artifacts/api-server/.env.example))

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | ✅ | TCP port to bind; boot exits without it |
| `DATABASE_URL` | ✅ | PostgreSQL connection string (authenticated routes, audit log) |
| `SESSION_SECRET` | ✅ | HMAC key for signed session cookies, ≥32 chars (`openssl rand -hex 32`) |
| `TUTOR_PROVIDER` | — | `scripted` (default, no key) \| `anthropic` \| `openai` \| `gemini`; unknown values fail at startup |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | — | Required by the matching `TUTOR_PROVIDER`; a missing key fails loud at startup. Cloud providers are **dev-only** per the 2026-10-30 local-first decision |
| `TUTOR_ANTHROPIC_MODEL` / `TUTOR_OPENAI_MODEL` / `TUTOR_GEMINI_MODEL` | — | Model overrides (defaults: `claude-sonnet-4-5`, `gpt-4o`, `gemini-2.0-flash`) |
| `TUTOR_PROVIDER_TIMEOUT_MS` | — | Cloud provider HTTP timeout, ms (default `30000`); invalid values fall back to the default |
| `TUTOR_PROVIDER_MAX_RPM` | — | Cloud provider rate limit, requests/minute (default `30`); invalid values fall back to the default |
| `LOG_LEVEL` | — | pino level, default `info` |
| `NODE_ENV` | — | `production` enables secure cookies and JSON logs |

### Web app (`apps/web` — see its [.env.example](apps/web/.env.example))

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | — | Browser-facing origin of the API. **Build-time** inlined by Next.js — set it in the environment (or Vercel project settings) *before* the build and redeploy on change |
| `BASE_URL` | — | Target for the render smoke test only (`pnpm --filter @workspace/web run smoke`), default `http://localhost:3000` |

### Database tooling & tests (`lib/db`, api-server tests)

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Same variable — read by `db:migrate`, `db:seed`, and `db:generate` |
| `AUTH_TEST_DATABASE_URL` | — | Test-only: when set, auth route integration tests run against that PostgreSQL (copied into `DATABASE_URL` for the test process); when unset those tests skip |
| `EVAL_UPDATE_SNAPSHOT` | — | Test tooling: set to `1` to regenerate the provider eval snapshot (`eval.test.ts`) |

## Demo seed (development only)

`pnpm --filter @workspace/db db:seed` loads a self-contained demo dataset: a student (Jordan), a linked parent with granted consent, an educator, a learning profile with evidence-backed entries, a tutoring session with turns, assessments, progress events, and accessibility preferences. Re-running it resets this demo data safely.

> ⚠️ **Demo-only credentials — never use in a real deployment.** The seed creates these accounts, and the password below is intentionally public and valid only for seeded `@demo.primer` users:

| Account | Email | Password |
| --- | --- | --- |
| Student | `student@demo.primer` | `primer-demo-password` |
| Parent | `parent@demo.primer` | `primer-demo-password` |
| Educator | `educator@demo.primer` | `primer-demo-password` |

Real credentials are hashed with the same Argon2id path as production auth, and real secrets stay out of source control.

## Deployment

Two deployment surfaces, two paths. **The API's hosting target is deliberately an open decision** — both options below are documented and neither is committed to.

### Web app → Vercel (preferred)

1. Import the repo into Vercel and set the project's **Root Directory** to `apps/web` (the app carries [apps/web/vercel.json](apps/web/vercel.json) pinning the `nextjs` framework).
2. Set the Node.js version to 24 via the `NODE_VERSION` environment variable in project settings.
3. Set `NEXT_PUBLIC_API_BASE_URL` to the API's public origin in project settings — it is inlined at build time, so changing it requires a redeploy.
4. Deploy. Vercel detects the pnpm workspace and installs from the repo root.

### API → any container platform

The API ships as a plain `node:24-slim`-based image — [artifacts/api-server/Dockerfile](artifacts/api-server/Dockerfile) — that runs anywhere containers run (Fly.io, Railway, Kubernetes, self-hosted); pick one and record the decision when it is made.

```sh
# from the repo root (the pnpm workspace root)
docker build -f artifacts/api-server/Dockerfile -t primer-api .

docker run --rm -p 8080:8080 \
  -e DATABASE_URL=postgres://user:password@db-host:5432/primer \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  primer-api
```

The image defaults to `NODE_ENV=production` and `PORT=8080`, runs as an unprivileged user, and exposes a `HEALTHCHECK` against `/api/healthz`. Run schema migrations against the target database before (or alongside) first boot: `pnpm --filter @workspace/db db:migrate` with the production `DATABASE_URL`. Secrets are supplied by the platform's environment — the build context excludes `.env` files by design.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm -r --if-present run test
pnpm run build
```

Commands above correspond to checked-in scripts.

## Product direction

Myelin can provide infrastructure for assistive experiences such as Neche. That relationship is a development direction, not a claim that Neche's local inference, memory isolation, or disclosure controls are implemented here.

U1 NeuroSignal V0 extends this research direction with synthetic EEG and physiological sensing, a within-person baseline engine, and a clinician-facing review interface. It is a research prototype, not a diagnostic or treatment system.

## Contributing

Keep API contracts, generated clients, and validation schemas aligned. Explain data flows in changes that add a provider, database field, or external service. Use synthetic data for development and keep credentials outside source control.

---

**Unmute1AI · Technology that adapts to people.**
