# U1 Instinctive Companion

**Status:** implementation in progress on a feature branch. Not a production release.

## Product shape

One companion surface coordinates two specialist systems:

- **MJ / Instinctive Intelligence:** reasoning, pattern analysis, investigation and planning.
- **Jake / Primer on Myelin:** adaptive tutoring and learner-centered communication.
- **Myelin:** authenticated application shell, learner sessions and persistence.
- **U1Si-Q:** independent authorization and enforcement boundary. It is not replaced by the companion orchestrator.

## Non-negotiable boundaries

1. A user turn may be routed to MJ, Jake, or both.
2. Joint mode shares the current user-provided turn and the two explicit specialist outputs with the synthesis step. It does not merge stored memories.
3. MJ and Jake do not receive each other's stored memory. Jake uses Myelin's authenticated session; MJ receives only the current turn.
4. MJ routing requires a per-turn consent checkbox in the companion UI. The permission is not stored as a standing grant.
5. The companion runtime has no tool-execution, settings-change, or data-sharing authority.
6. Any consequential action must be authorized by the independent U1Si-Q integration. A model response is never an authorization token.
7. Learner communication must not be forced into a single modality. The current UI supports keyboard-accessible text; sign, speech, and AAC adapters are not yet integrated.
8. Do not claim local inference, edge execution, model quality, or learner outcomes until the actual runtime and validation evidence exist.

## Implemented in this branch

- `lib/instinctive-core`: typed specialist adapter contracts, explicit MJ/Jake/joint routing, owner-and-specialist memory namespaces, consent-gated reads, explicit writes, and no execution authority.
- `apps/web/app/companion/page.tsx`: companion UI with MJ/Jake/Together selection, frosted multicolor orb, per-turn MJ consent, separate specialist outputs, and a joint synthesis view.
- `artifacts/api-server/src/companion/routes.ts`: authenticated API proxy for MJ turn and synthesis calls. It rejects non-HTTPS remote origins and does not expose the MJ service URL to the browser.
- `artifacts/api-server/src/routes/index.ts`: mounts the authenticated companion routes.
- `app/api/organism/synthesize/route.ts` in the MJ project: separate synthesis endpoint that receives the user's prompt and both specialist outputs.
- The Myelin landing page links to the companion.
- The workspace TypeScript project references include the new core package.

## Required deployment configuration

On the Myelin API server, set `MJ_ORGANISM_BASE_URL` to the origin of the deployed MJ Organism application, for example `https://your-mj-host.example`. The value must be HTTPS in remote deployments; localhost HTTP is allowed for local development.

The MJ Organism deployment must have its model provider configured using its existing server-side `MODEL_API_KEY`, with optional `MODEL_BASE_URL` and `MODEL_NAME`. For joint synthesis, set `COMPANION_SHARED_SECRET` on MJ and the identical value as `MJ_ORGANISM_COMPANION_TOKEN` on the Myelin API server. Use a high-entropy random secret and never expose it through `NEXT_PUBLIC_*`.

The companion's status endpoint checks the MJ application and its provider readiness. A configured URL alone is not reported as a ready model.

## Current runtime behavior

- Jake turns use the existing authenticated Myelin session endpoint and its existing Primer provider configuration. They remain stored as Myelin learner-session turns.
- MJ turns call the existing MJ Organism specialist route.
- Together mode runs MJ and Jake independently, then sends the two returned assessments to the separate MJ synthesis route.
- If one specialist fails, the UI preserves the successful specialist's response and does not invent a joint conclusion.
- MJ's durable learning is not enabled. Jake's existing session persistence remains governed by Myelin.
- No product action is executed by the companion.

## Not yet verified / release blockers

- This branch has not been installed, typechecked, built, or exercised against live Myelin and MJ deployments in this session.
- `MJ_ORGANISM_BASE_URL` has not been configured or verified against a deployed MJ host.
- Existing Myelin authentication, session creation, and Jake provider behavior need real integration verification.
- The MJ provider may be remote depending on deployment configuration; the consent disclosure is therefore explicit.
- U1Si-Q is represented as an authority boundary in the UI and documentation, but a production service integration is not part of this change.
- No Deaf-led review approval has been obtained for release. This work must not be released as a product for Deaf, hard-of-hearing, or neurodivergent users before the charter's independent review gate is implemented and satisfied.

## Definition of done

- Existing Primer flows still pass their current tests.
- MJ and Jake each answer through their real configured providers.
- Joint mode invokes both real systems and a separate synthesis pass.
- Consent-off mode makes no MJ request.
- Consent-on mode is one-turn only and is not persisted as standing permission.
- No specialist can execute tools or share data through this package.
- U1Si-Q independently denies unauthorized actions.
- Accessibility review is completed before a release intended for Deaf, hard-of-hearing, or neurodivergent users.
