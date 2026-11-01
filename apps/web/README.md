# @workspace/web — PRIMER web app

Next.js 15 (App Router, TypeScript, Tailwind 4) shell for the PRIMER platform.
The student, parent, and educator dashboards build on this app.

## Run

```sh
# from the repo root
pnpm install

# from apps/web
pnpm dev        # http://localhost:3000
pnpm build      # production build
pnpm lint       # eslint (next/core-web-vitals + next/typescript)
pnpm typecheck  # tsc --noEmit
pnpm smoke      # render smoke test against a running server (BASE_URL env optional)
```

## Configuration

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Browser-facing origin of the Express API (`artifacts/api-server`). See `.env.example`. Unset is valid while nothing fetches — `lib/api-config.ts` surfaces "not configured" instead of guessing an origin. |

`NEXT_PUBLIC_` variables are **inlined at build time**: set them in the
environment (or Vercel project settings) before `pnpm build` / before a
deploy, and redeploy when they change.

React and React DOM resolve to the workspace catalog's **exact 19.1.0 pin**
(Expo requires it — do not bump). `next` is `^15.5.28`, which supports React 19.

## Deploy to Vercel

`vercel.json` pins the `nextjs` framework. In the Vercel project, set the
**Root Directory** to `apps/web` (Vercel detects the pnpm workspace and
installs from the repo root), pin Node.js 24 via the `NODE_VERSION`
environment variable, and set `NEXT_PUBLIC_API_BASE_URL` to the API's public
origin. The full walkthrough lives in the root README's Deployment section.

## Design tokens

`app/globals.css` defines the PRIMER palette as Tailwind 4 `@theme` tokens:
soft lavender/white backgrounds (`bg-background`, `bg-lavender`), deep-purple
accents (`bg-primary`, `text-primary`), mascot-yellow secondary (`bg-mascot`),
rounded cards (`rounded-card`), and a friendly rounded-first font stack
(`font-sans`). Screens compose these tokens; the palette changes in one place.

## Mascot slot

`components/mascot-slot.tsx` is a documented placeholder for the approved
mascot art, which ships as project files in a later wave. When it lands, drop
the files into `public/mascot/` and render them there.

## What this wave intentionally does not include

- **Auth API** — register/login are validated UI shells; session cookies,
  argon2 hashing, and the `authorize()` boundary land in a later wave.
- **Dashboards** — the four role-based surfaces arrive in their own waves.
- **API calls** — nothing fetches yet; `lib/api-config.ts` is the seam.
