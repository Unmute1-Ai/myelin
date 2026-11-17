# Grace · U1 Instinctive Companion

**Implementation status:** The MJ + Jake companion implementation was merged into
Myelin on 2026-11-05. The Grace interface remake is on
`feat/grace-companion-remake`. Neither change is evidence of a production
deployment. Live provider integration and release gates remain unverified.

## Product shape

Grace is the companion harness and coordination surface:

- **Grace:** presents the interaction, routes the user's selected turn, keeps
  status visible, and preserves the separation between specialist systems.
- **MJ / Instinctive Intelligence:** reasoning, pattern analysis, investigation,
  and planning.
- **Jake / Primer on Myelin:** adaptive tutoring and learner-centered
  communication.
- **Myelin:** authenticated application shell, learner sessions, and persistence.
- **U1Si-Q:** independent authorization and enforcement boundary. It is not
  replaced by Grace or by model consensus.

## Non-negotiable boundaries

1. A user turn may be routed to MJ, Jake, or both.
2. Joint mode shares the current user-provided turn and the two explicit
   specialist outputs with the synthesis step. It does not merge stored
   memories.
3. MJ and Jake do not receive each other's stored memories. Jake uses Myelin's
   authenticated session; MJ receives only the current turn.
4. MJ routing requires a fresh per-turn consent action. Consent is consumed
   when a request is submitted and is not retained as a standing grant.
5. In Together mode, the disclosure explicitly covers sending both current-turn
   specialist outputs to the configured MJ model provider for synthesis.
6. The companion runtime has no tool-execution, settings-change, or data-sharing
   authority.
7. Any consequential action must be authorized by the independent U1Si-Q
   integration. A model response is never an authorization token.
8. Learner communication must not be forced into a single modality. The current
   interface supports keyboard-accessible text; sign, speech, and AAC adapters
   are not connected in this build.
9. Do not claim local inference, edge execution, model quality, or learner
   outcomes until the actual runtime and validation evidence exist.

## Implemented

- `lib/instinctive-core`: typed specialist adapter contracts, explicit
  MJ/Jake/joint routing, owner-and-specialist memory namespaces,
  consent-gated reads, explicit writes, and no execution authority.
- `apps/web/app/companion/page.tsx`: Grace-branded companion UI with
  MJ/Jake/Together selection, frosted multicolor orb, fresh per-turn MJ
  consent, separate specialist outputs, provider status, and a joint
  synthesis view.
- `artifacts/api-server/src/companion/routes.ts`: authenticated API proxy
  for MJ turn and synthesis calls. It rejects non-HTTPS remote origins and
  does not expose the MJ service URL to the browser.
- `artifacts/api-server/src/routes/index.ts`: mounts the authenticated
  companion routes.
- `app/api/organism/synthesize/route.ts` in the MJ project: separate
  synthesis endpoint that receives the user's prompt and both specialist
  outputs.
- The Myelin landing page links directly to Grace.

## Required deployment configuration

The web application uses the Next.js rewrite in `apps/web/next.config.ts`.
Set `API_PROXY_TARGET` to the HTTPS origin of the deployed Myelin Express API
server. This is a server-side value, not a `NEXT_PUBLIC_*` browser variable.

On the Myelin API server, set `MJ_ORGANISM_BASE_URL` to the HTTPS origin of
the deployed MJ Organism application.

The MJ Organism deployment must have its model provider configured using its
existing server-side `MODEL_API_KEY`, with optional `MODEL_BASE_URL` and
`MODEL_NAME`. For joint synthesis, set `COMPANION_SHARED_SECRET` on MJ and
the identical value as `MJ_ORGANISM_COMPANION_TOKEN` on the Myelin API
server. Use a high-entropy random secret. Never expose it through
`NEXT_PUBLIC_*` or commit it to source control.

The Myelin API server also requires its normal production configuration,
including `DATABASE_URL`, `SESSION_SECRET`, `PORT`, and
`NODE_ENV=production`. The API image and database migrations must be deployed
according to the root README. The companion status endpoint checks MJ provider
readiness; a configured URL alone is not reported as a ready model.

## Current runtime behavior

- Jake turns use the existing authenticated Myelin session endpoint and its
  configured Primer provider. The default remains the deterministic scripted
  provider. This is not live model inference. The Gemma-local adapter exists
  for an OpenAI-compatible local inference endpoint; it must be configured and
  exercised against a real inference server before claiming that path works.
- MJ turns call the MJ Organism specialist route.
- Together mode runs MJ and Jake independently, then sends the two returned
  assessments to the separate MJ synthesis route.
- If one specialist fails, Grace preserves the successful specialist's
  response and does not invent a joint conclusion.
- MJ's durable learning is not enabled. Jake's existing session persistence
  remains governed by Myelin.
- No product action is executed by Grace.

## Release blockers / verification still required

- Install the workspace from a clean checkout and run the full typecheck,
  lint, test, and production build.
- Deploy the Myelin web app and Express API with the required environment
  configuration.
- Deploy MJ Organism with a configured model provider and matching
  server-to-server secret.
- Verify real MJ and Jake provider responses, including Together synthesis.
- Verify that consent-off makes no MJ request, that consent is consumed after
  every submission, and that a new turn requires a fresh affirmative action.
- Verify owner-scoped memory behavior and confirm no cross-specialist memory
  leakage.
- Integrate and independently verify the production U1Si-Q enforcement
  service before enabling consequential operations.
- Complete independent Deaf-led accessibility review before release intended
  for Deaf, hard-of-hearing, or neurodivergent users.

## Definition of done

- Existing Primer flows still pass their current tests.
- MJ and Jake each answer through their real configured providers.
- Joint mode invokes both real systems and a separate synthesis pass.
- Consent is fresh and one-turn only.
- No specialist can execute tools or share data through this package.
- U1Si-Q independently denies unauthorized actions.
- Accessibility review is completed before a release intended for Deaf,
  hard-of-hearing, or neurodivergent users.
