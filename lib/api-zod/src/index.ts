// Barrel over the orval-generated contract (zod schemas + TypeScript types).
// Nothing hand-written belongs here besides re-exports — downstream lanes
// import every shape from "@workspace/api-zod".
//
// orval quirk: for an operation with query parameters it emits BOTH a zod
// const named `<OperationId>Params` (in ./generated/api) and an interface of
// the same name (in ./generated/types). Star-exporting both modules makes the
// name ambiguous (TS2308), so the interface form is re-exported explicitly —
// the runtime validators stay available under their `...QueryParams` names.
// When orval starts colliding on a new operation, typecheck names the member.
export * from "./generated/api";
export * from "./generated/types";
export type {
  ListProfileEntriesParams,
  ListProgressEventsParams,
  ListSessionTurnsParams,
  ListSessionsParams,
} from "./generated/types";
// The list operations above shadow their own runtime path-param validators
// (same name: orval emits a zod const in ./generated/api and an interface in
// ./generated/types). Re-export the validator under a distinct name so routes
// can still parse path params for those operations.
export { ListProfileEntriesParams as ListProfileEntriesParamsSchema } from "./generated/api";
