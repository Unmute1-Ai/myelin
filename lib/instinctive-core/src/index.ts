/**
 * U1 Instinctive Companion orchestration boundary.
 * MJ and Jake remain separate specialist adapters. This package coordinates a
 * turn; it does not implement either model or grant tool authority.
 * Memory is partitioned by owner and specialist, and is inaccessible unless
 * the caller supplies explicit consent for this turn.
 */
export type Specialist = "mj" | "jake";
export type CompanionMode = Specialist | "joint";
export type InputModality = "text" | "speech" | "sign" | "aac" | "mixed";

export interface CompanionTurn {
  ownerId: string;
  sessionId: string;
  input: string;
  modality: InputModality;
  mode: CompanionMode;
  memoryConsent: boolean;
}
export interface MemoryEntry { id: string; content: string; createdAt: string }
export interface SpecialistMemory {
  readonly ownerId: string;
  readonly specialist: Specialist;
  readonly entries: readonly MemoryEntry[];
}
export interface MemoryStore {
  read(ownerId: string, specialist: Specialist): Promise<readonly MemoryEntry[]>;
  append(ownerId: string, specialist: Specialist, entry: Omit<MemoryEntry, "id">): Promise<void>;
}
export interface SpecialistRequest {
  ownerId: string;
  sessionId: string;
  input: string;
  modality: InputModality;
  memory: SpecialistMemory;
}
export interface SpecialistResponse {
  specialist: Specialist;
  message: string;
  evidence?: readonly string[];
  suggestedNextSteps?: readonly string[];
}
export interface SpecialistAdapter {
  readonly specialist: Specialist;
  respond(request: SpecialistRequest): Promise<SpecialistResponse>;
}
export interface JointResponseComposer {
  compose(input: string, mj: SpecialistResponse, jake: SpecialistResponse): Promise<string>;
}
export interface CompanionResult {
  mode: CompanionMode;
  responses: readonly SpecialistResponse[];
  message: string;
  memoryUsed: boolean;
  memoryWritten: false;
  actionsExecuted: false;
}
export interface CompanionDependencies {
  mj: SpecialistAdapter;
  jake: SpecialistAdapter;
  memory: MemoryStore;
  composer: JointResponseComposer;
}
function assertValidTurn(turn: CompanionTurn): void {
  if (!turn.ownerId.trim()) throw new Error("ownerId is required");
  if (!turn.sessionId.trim()) throw new Error("sessionId is required");
  if (!turn.input.trim()) throw new Error("input is required");
}
async function specialistMemory(
  store: MemoryStore, ownerId: string, specialist: Specialist, consent: boolean,
): Promise<SpecialistMemory> {
  const entries = consent ? await store.read(ownerId, specialist) : [];
  return { ownerId, specialist, entries };
}
/**
 * Joint mode shares only the current user-provided turn. Each specialist
 * receives its own owner-scoped memory namespace, never the other's memories.
 */
export async function runCompanionTurn(
  turn: CompanionTurn, deps: CompanionDependencies,
): Promise<CompanionResult> {
  assertValidTurn(turn);
  const selected: Specialist[] = turn.mode === "joint" ? ["mj", "jake"] : [turn.mode];
  const adapters: Record<Specialist, SpecialistAdapter> = { mj: deps.mj, jake: deps.jake };
  const responses = await Promise.all(selected.map(async (specialist) => {
    const memory = await specialistMemory(deps.memory, turn.ownerId, specialist, turn.memoryConsent);
    return adapters[specialist].respond({
      ownerId: turn.ownerId, sessionId: turn.sessionId, input: turn.input,
      modality: turn.modality, memory,
    });
  }));
  const message = turn.mode === "joint"
    ? await deps.composer.compose(turn.input, responses[0]!, responses[1]!)
    : responses[0]!.message;
  return {
    mode: turn.mode, responses, message, memoryUsed: turn.memoryConsent,
    memoryWritten: false, actionsExecuted: false,
  };
}
/** Persistence is explicit and never occurs as a side effect of a conversation turn. */
export async function saveSpecialistMemory(
  store: MemoryStore, consent: boolean, ownerId: string, specialist: Specialist,
  content: string, createdAt = new Date().toISOString(),
): Promise<void> {
  if (!consent) throw new Error("Explicit memory consent is required");
  if (!ownerId.trim()) throw new Error("ownerId is required");
  if (!content.trim()) throw new Error("Memory content is required");
  await store.append(ownerId, specialist, { content, createdAt });
}
/**
 * This runtime has no execution port. Consequential operations must be
 * authorized independently by U1Si-Q; model output is never authorization.
 */
export function assertNoExecutionAuthority(): {
  canExecuteTools: false; canChangeSettings: false; canShareData: false;
} {
  return { canExecuteTools: false, canChangeSettings: false, canShareData: false };
}
