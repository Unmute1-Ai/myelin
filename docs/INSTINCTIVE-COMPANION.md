# U1 Instinctive Companion

**Status:** integration foundation committed on a feature branch. Not a production release.

## Product shape

One companion surface coordinates two specialist systems:

- **MJ / Instinctive Intelligence:** reasoning, pattern analysis, investigation and planning.
- **Jake / Primer on Myelin:** adaptive tutoring and learner-centered communication.
- **Myelin:** application shell, learner profiles and session infrastructure.
- **U1Si-Q:** independent authorization and enforcement boundary. It is not replaced by the companion orchestrator.

## Non-negotiable boundaries

1. A single user turn may be routed to MJ, Jake, or both.
2. Joint mode shares only the current user-provided turn. MJ and Jake receive separate memory namespaces.
3. Memory is not read unless the caller supplies explicit consent.
4. Memory writes are a separate explicit operation. Conversation turns never write memory automatically.
5. The companion runtime has no tool-execution, settings-change, or data-sharing authority.
6. Any consequential action must be authorized by the independent U1Si-Q integration. A model response is never an authorization token.
7. Learner communication is accepted as text, speech, sign, AAC, or mixed modality. The interface must not require a learner to normalize their communication.
8. Do not claim local inference, edge execution, model quality, or learner outcomes until the actual runtime and validation evidence exist.

## Current implementation

The new lib/instinctive-core package provides:

- typed MJ and Jake specialist adapter contracts;
- explicit mode selection (mj, jake, joint);
- parallel specialist execution in joint mode;
- owner- and specialist-scoped memory access;
- consent-gated memory reads and explicit memory writes;
- a hard no-execution-authority result.

The package deliberately does not contain a fabricated MJ model, Jake model, inference provider, database adapter, or UI. Those must be connected to real implementations and tested against real systems.

## Integration sequence

1. Connect the Jake adapter to the existing Primer tutor service without changing its learner-first prompt or authorization rules.
2. Locate and verify the actual MJ runtime and expose it through the SpecialistAdapter contract. The previous Vercel project is not evidence of a functioning inference path.
3. Implement a persistent MemoryStore backed by Myelin's existing data layer, with owner and specialist scoping enforced in the database as well as the application.
4. Add a joint response composer that reconciles outputs without merging specialist memory.
5. Add a companion UI to apps/web with explicit MJ / Jake / Together selection, accessible modality controls, and visible memory consent.
6. Integrate U1Si-Q as an independent authorization service. Do not add a local bypass or founder override.
7. Run real integration tests against configured services and a provisioned test database before describing the integration as tested.

## Definition of done

- Existing Primer flows still pass their current tests.
- MJ and Jake each answer through their real provider adapters.
- Joint mode invokes both real adapters and preserves memory separation.
- Consent-off mode performs no memory reads or writes.
- Consent-on mode reads only the requesting owner's namespace.
- No specialist can execute tools or share data through this package.
- U1Si-Q independently denies unauthorized actions.
- Accessibility review is completed before a release intended for Deaf, hard-of-hearing, or neurodivergent users.
