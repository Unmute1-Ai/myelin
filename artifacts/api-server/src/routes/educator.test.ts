// Route tests for the educator dashboard (contract: /educator/*, spec §6.10).
// The educator data port, educator access, guardian access, and audit run as
// in-memory fakes and the session boundary is substituted — the real
// requireAuth/codec and the drizzle backing are covered by the auth and db
// suites. What is proven here is the linking model (pending grants nothing,
// an admin's grant is the human decision, revocation ends access), the role
// boundaries on every route, and the explicit invariant that educators cannot
// override the authorization or privacy layers — not even an admin can read
// child data through these routes. No database, so they run everywhere.

import express, { type Express, type RequestHandler } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { User } from "@workspace/db/schema";
import type { EducatorLinkFacts, GuardianAccessPort } from "../auth/authorize";
import type { AuditEntry, AuditPort } from "../auth/audit";
import type { AuthedRequest } from "../auth/middleware";
import { createEducatorRoutes, type EducatorDeps } from "./educator";
import type {
  ClassSummaryFact,
  EducatorDataPort,
  EducatorLinkRow,
  NewAssignment,
  SupportsUpdate,
} from "../educator/educator-service";
import { errorHandler } from "../middlewares/errorHandler";

const EDUCATOR_ID = "00000000-0000-4000-8000-00000000000a";
const OTHER_EDUCATOR_ID = "00000000-0000-4000-8000-00000000000b";
const ADMIN_ID = "00000000-0000-4000-8000-00000000000c";
const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDENT_ID = "00000000-0000-4000-8000-000000000002";
// Registered in no fake account store — exercises the 404 path.
const GHOST_STUDENT_ID = "00000000-0000-4000-8000-0000000000ff";

const NOW = new Date("2026-11-01T10:00:00.000Z");
const STUDENT_EMAIL = "student@primer.test";
const OTHER_STUDENT_EMAIL = "other-student@primer.test";

interface FakeLink {
  id: string;
  educatorId: string;
  studentId: string;
  status: "pending" | "granted" | "revoked";
  createdAt: Date;
  updatedAt: Date;
}

interface FakeStore {
  links: FakeLink[];
  studentEmails: Map<string, string>; // email → studentId
  assignments: Array<NewAssignment & { id: string; createdAt: Date }>;
  supports: Map<string, { supports: string[]; notes: string | null; updatedBy: string | null; updatedAt: Date | null }>;
  gaps: Map<string, number>;
  mastery: Map<string, ClassSummaryFact["masteryCounts"]>;
  lastActive: Map<string, Date>;
}

let linkCounter = 0;
function newLinkId(): string {
  linkCounter += 1;
  return `00000000-0000-4000-8000-${linkCounter.toString(16).padStart(12, "0")}`;
}

/** Seed state rebuilt on every test — the pending link is the ledger's start. */
function freshStore(): FakeStore {
  linkCounter = 0;
  return {
    links: [],
    studentEmails: new Map([
      [STUDENT_EMAIL, STUDENT_ID],
      [OTHER_STUDENT_EMAIL, OTHER_STUDENT_ID],
    ]),
    assignments: [],
    supports: new Map(),
    gaps: new Map([[STUDENT_ID, 2]]),
    mastery: new Map([
      [STUDENT_ID, { memorization: 1, recognition: 0, comprehension: 3, application: 1, mastery: 0 }],
    ]),
    lastActive: new Map([[STUDENT_ID, NOW]]),
  };
}

/** In-memory EducatorDataPort over the store — no database. */
function fakeEducatorData(store: FakeStore): EducatorDataPort {
  function studentById(studentId: string): { email: string; displayName: string } | undefined {
    for (const [email, id] of store.studentEmails) {
      if (id === studentId) return { email, displayName: `Student ${id.slice(-2)}` };
    }
    return undefined;
  }

  function linkRow(link: FakeLink): EducatorLinkRow {
    const student = studentById(link.studentId);
    return {
      ...link,
      studentEmail: student?.email ?? "",
      studentDisplayName: student?.displayName ?? "",
    };
  }

  return {
    async studentExists(studentId) {
      return studentById(studentId) !== undefined;
    },
    async studentIdByEmail(email) {
      return store.studentEmails.get(email);
    },
    async listLinks(educatorId) {
      return store.links.filter((l) => educatorId === undefined || l.educatorId === educatorId).map(linkRow);
    },
    async findLinkByPair(educatorId, studentId) {
      const link = store.links.find((l) => l.educatorId === educatorId && l.studentId === studentId);
      return link === undefined ? undefined : linkRow(link);
    },
    async createLink(educatorId, studentId) {
      const link: FakeLink = { id: newLinkId(), educatorId, studentId, status: "pending", createdAt: NOW, updatedAt: NOW };
      store.links.push(link);
      return linkRow(link);
    },
    async setLinkStatus(linkId, status) {
      const link = store.links.find((l) => l.id === linkId);
      if (link === undefined) throw new Error(`fake setLinkStatus: unknown link ${linkId}`);
      link.status = status;
      return linkRow(link);
    },
    async listAssignments(educatorId) {
      return store.assignments
        .filter((a) => a.educatorId === educatorId)
        .map((a) => ({
          id: a.id,
          educatorId: a.educatorId,
          studentId: a.studentId,
          title: a.title,
          detail: a.detail,
          subject: a.subject,
          status: "open" as const,
          createdAt: a.createdAt,
          updatedAt: a.createdAt,
        }));
    },
    async createAssignment(input) {
      const assignment = { ...input, id: newLinkId(), createdAt: NOW };
      store.assignments.push(assignment);
      return {
        id: assignment.id,
        educatorId: assignment.educatorId,
        studentId: assignment.studentId,
        title: assignment.title,
        detail: assignment.detail,
        subject: assignment.subject,
        status: "open" as const,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
    async getSupports(studentId) {
      const plan = store.supports.get(studentId);
      if (plan === undefined) return undefined;
      return {
        id: newLinkId(),
        studentId,
        supports: plan.supports,
        notes: plan.notes,
        updatedBy: plan.updatedBy,
        createdAt: NOW,
        updatedAt: plan.updatedAt ?? NOW,
      };
    },
    async upsertSupports(studentId, update: SupportsUpdate, updatedBy) {
      store.supports.set(studentId, {
        supports: update.supports,
        notes: update.notes,
        updatedBy,
        updatedAt: NOW,
      });
      return {
        id: newLinkId(),
        studentId,
        supports: update.supports,
        notes: update.notes,
        updatedBy,
        createdAt: NOW,
        updatedAt: NOW,
      };
    },
    // Only students that exist get a row — the route's granted-link scoping
    // decides which ids arrive here; the fake never widens that set.
    async listClassSummaries(studentIds) {
      return studentIds
        .filter((studentId) => studentById(studentId) !== undefined)
        .map(
          (studentId): ClassSummaryFact => ({
            studentId,
            displayName: studentById(studentId)!.displayName,
            gapCount: store.gaps.get(studentId) ?? 0,
            masteryCounts: store.mastery.get(studentId) ?? {
              memorization: 0,
              recognition: 0,
              comprehension: 0,
              application: 0,
              mastery: 0,
            },
            lastActiveAt: store.lastActive.get(studentId) ?? null,
          }),
        );
    },
  };
}

interface FakeDeps {
  deps: EducatorDeps;
  currentUser: { value: User | undefined };
  store: FakeStore;
  auditLog: AuditEntry[];
  grant(educatorId: string, studentId: string): string;
  seedLink(educatorId: string, studentId: string, status: FakeLink["status"]): string;
}

function fakeDeps(): FakeDeps {
  const store = freshStore();
  const currentUser: { value: User | undefined } = { value: undefined };
  const auditLog: AuditEntry[] = [];

  // The authorization port reads the SAME registry the data port writes —
  // exactly like drizzleEducatorAccess reads the table drizzleEducatorData
  // writes — so grant/revoke effects are visible to authorize() mid-test.
  const educatorAccess = {
    async hasActiveEducatorLink(educatorId: string, studentId: string) {
      return store.links.some(
        (l) => l.educatorId === educatorId && l.studentId === studentId && l.status === "granted",
      );
    },
    async getEducatorLink(linkId: string): Promise<EducatorLinkFacts | undefined> {
      const link = store.links.find((l) => l.id === linkId);
      return link === undefined ? undefined : { id: link.id, educatorId: link.educatorId, status: link.status };
    },
  };

  const guardianAccess: GuardianAccessPort = {
    async hasGrantedGuardianAccess() {
      return false;
    },
    async getGuardianLink() {
      return undefined;
    },
  };

  const audit: AuditPort = {
    async record(entry) {
      auditLog.push(entry);
    },
  };

  const authenticate: RequestHandler = (req, res, next) => {
    if (currentUser.value) {
      (req as AuthedRequest).user = currentUser.value;
      next();
      return;
    }
    res.status(401).json({ code: "unauthorized", message: "Sign in to continue." });
  };

  function seedLink(educatorId: string, studentId: string, status: FakeLink["status"]): string {
    const link: FakeLink = { id: newLinkId(), educatorId, studentId, status, createdAt: NOW, updatedAt: NOW };
    store.links.push(link);
    return link.id;
  }

  return {
    deps: {
      db: () => undefined as never,
      codec: undefined as never,
      passwords: { hash: async () => "unused", verify: async () => false },
      audit,
      guardianAccess,
      educatorAccess,
      data: fakeEducatorData(store),
      authenticate,
    },
    currentUser,
    store,
    auditLog,
    grant(educatorId, studentId) {
      return seedLink(educatorId, studentId, "granted");
    },
    seedLink,
  };
}

interface JsonBody {
  code?: string;
  message?: string;
  students?: Array<{
    studentId: string;
    displayName: string;
    gapCount: number;
    masteryCounts: Record<string, number>;
    lastActiveAt: string | null;
  }>;
  links?: Array<{ id: string; status: string; student: { id: string; email: string } }>;
  assignments?: Array<{ id: string; studentId: string; title: string; status: string }>;
  id?: string;
  status?: string;
  studentId?: string;
  student?: { id: string; email: string; displayName?: string };
  supports?: string[];
  notes?: string | null;
  updatedBy?: string | null;
}

type Result = { status: number; body: JsonBody };

describe("educator dashboard routes (in-memory fakes, contract /educator/*)", () => {
  let server: http.Server;
  let baseUrl: string;
  let harness: FakeDeps;

  beforeAll(async () => {
    harness = fakeDeps();
    const app: Express = express();
    app.use(express.json());
    app.use("/educator", createEducatorRoutes(harness.deps));
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/educator`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    // Rebuild the store behind the same deps instance so tests stay
    // order-independent (the port closures read the current store).
    const next = freshStore();
    harness.store.links = next.links;
    harness.store.studentEmails = next.studentEmails;
    harness.store.assignments = next.assignments;
    harness.store.supports = next.supports;
    harness.store.gaps = next.gaps;
    harness.store.mastery = next.mastery;
    harness.store.lastActive = next.lastActive;
    harness.currentUser.value = undefined;
    harness.auditLog.length = 0;
  });

  function asUser(id: string, role: User["role"]): void {
    harness.currentUser.value = {
      id,
      email: `${role}@primer.test`,
      passwordHash: "test-hash",
      role,
      displayName: `Test ${role}`,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  async function call(method: string, path: string, body?: unknown): Promise<Result> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : {}) as JsonBody };
  }

  // ── Role boundaries ───────────────────────────────────────────────────────

  it("rejects unauthenticated calls at the boundary", async () => {
    const res = await call("GET", "/students");
    expect(res.status).toBe(401);
  });

  it("serves the class rollup only to educators — parents and admins are denied", async () => {
    harness.grant(EDUCATOR_ID, STUDENT_ID);

    asUser(ADMIN_ID, "admin");
    expect((await call("GET", "/students")).status).toBe(403);

    asUser(EDUCATOR_ID, "parent");
    expect((await call("GET", "/students")).status).toBe(403);

    asUser(EDUCATOR_ID, "educator");
    expect((await call("GET", "/students")).status).toBe(200);
  });

  // ── Linking model: request → grant → revoke ──────────────────────────────

  it("requests a link as pending (grants nothing), audited", async () => {
    asUser(EDUCATOR_ID, "educator");
    const res = await call("POST", "/links", { studentEmail: STUDENT_EMAIL });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.student).toEqual({ id: STUDENT_ID, email: STUDENT_EMAIL, displayName: expect.any(String) });

    const entry = harness.auditLog.find((e) => e.action === "create_educator_link");
    expect(entry?.decision).toBe("allowed");
  });

  it("is idempotent per pair: re-requesting returns the same link, no duplicate", async () => {
    asUser(EDUCATOR_ID, "educator");
    const first = await call("POST", "/links", { studentEmail: STUDENT_EMAIL });
    const second = await call("POST", "/links", { studentEmail: STUDENT_EMAIL });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(harness.store.links).toHaveLength(1);
  });

  it("404s an unknown student email without creating a link", async () => {
    asUser(EDUCATOR_ID, "educator");
    const res = await call("POST", "/links", { studentEmail: "nobody@primer.test" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("student_not_found");
    expect(harness.store.links).toHaveLength(0);
  });

  it("validates the request body against the contract", async () => {
    asUser(EDUCATOR_ID, "educator");
    const res = await call("POST", "/links", { studentEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("lists an educator's own links, and gives admins the full queue", async () => {
    harness.seedLink(EDUCATOR_ID, STUDENT_ID, "pending");
    harness.seedLink(OTHER_EDUCATOR_ID, OTHER_STUDENT_ID, "granted");

    asUser(EDUCATOR_ID, "educator");
    const own = await call("GET", "/links");
    expect(own.body.links).toHaveLength(1);
    expect(own.body.links?.[0]?.student.id).toBe(STUDENT_ID);

    asUser(ADMIN_ID, "admin");
    const all = await call("GET", "/links");
    expect(all.body.links).toHaveLength(2);
  });

  it("grants a pending link — admin only, and the decision is the recorded human authorization", async () => {
    const linkId = harness.seedLink(EDUCATOR_ID, STUDENT_ID, "pending");

    // An educator — even the link's owner — cannot grant.
    asUser(EDUCATOR_ID, "educator");
    expect((await call("POST", `/links/${linkId}/grant`)).status).toBe(403);
    expect(harness.store.links[0]?.status).toBe("pending");

    asUser(ADMIN_ID, "admin");
    const res = await call("POST", `/links/${linkId}/grant`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("granted");

    const entry = harness.auditLog.find((e) => e.action === "manage_educator_link");
    expect(entry?.decision).toBe("allowed");
    expect(entry?.resourceId).toBe(linkId);
  });

  it("never resurrects a revoked link — grant returns 409", async () => {
    const linkId = harness.seedLink(EDUCATOR_ID, STUDENT_ID, "revoked");

    asUser(ADMIN_ID, "admin");
    const res = await call("POST", `/links/${linkId}/grant`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("link_revoked");
    expect(harness.store.links[0]?.status).toBe("revoked");
  });

  it("revokes: an admin any link, an educator their own only, idempotently", async () => {
    const adminManagedId = harness.seedLink(OTHER_EDUCATOR_ID, STUDENT_ID, "granted");
    const ownLinkId = harness.seedLink(EDUCATOR_ID, STUDENT_ID, "granted");

    asUser(EDUCATOR_ID, "educator");
    // Another educator's link is out of reach — the boundary denies it.
    expect((await call("POST", `/links/${adminManagedId}/revoke`)).status).toBe(403);
    expect(harness.store.links.find((l) => l.id === adminManagedId)?.status).toBe("granted");

    const res = await call("POST", `/links/${ownLinkId}/revoke`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");

    // Idempotent: revoking again returns the revoked link.
    const again = await call("POST", `/links/${ownLinkId}/revoke`);
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("revoked");
  });

  it("404s grant/revoke for unknown link ids", async () => {
    asUser(ADMIN_ID, "admin");
    const unknown = "00000000-0000-4000-8000-0000000000ee";
    expect((await call("POST", `/links/${unknown}/grant`)).status).toBe(404);
    expect((await call("POST", `/links/${unknown}/revoke`)).status).toBe(404);
  });

  // ── Class rollup: granted links only ──────────────────────────────────────

  it("rolls up only students with GRANTED links — pending and revoked contribute nothing", async () => {
    harness.seedLink(EDUCATOR_ID, STUDENT_ID, "granted");
    harness.seedLink(EDUCATOR_ID, OTHER_STUDENT_ID, "pending");

    asUser(EDUCATOR_ID, "educator");
    const res = await call("GET", "/students");

    expect(res.status).toBe(200);
    expect(res.body.students).toHaveLength(1);
    const student = res.body.students?.[0];
    expect(student?.studentId).toBe(STUDENT_ID);
    expect(student?.gapCount).toBe(2);
    expect(student?.masteryCounts).toEqual({
      memorization: 1,
      recognition: 0,
      comprehension: 3,
      application: 1,
      mastery: 0,
    });
    expect(student?.lastActiveAt).toBe(NOW.toISOString());
  });

  it("reads an empty rollup for an educator with no links", async () => {
    asUser(EDUCATOR_ID, "educator");
    const res = await call("GET", "/students");
    expect(res.status).toBe(200);
    expect(res.body.students).toEqual([]);
  });

  // ── Assignments ───────────────────────────────────────────────────────────

  it("creates an assignment for a linked student and lists it back to its educator", async () => {
    harness.grant(EDUCATOR_ID, STUDENT_ID);
    asUser(EDUCATOR_ID, "educator");

    const created = await call("POST", "/assignments", {
      studentId: STUDENT_ID,
      title: "Fraction word problems",
      detail: "Three two-step problems",
      subject: "math",
    });
    expect(created.status).toBe(201);
    expect(created.body.studentId).toBe(STUDENT_ID);
    expect(created.body.status).toBe("open");

    const list = await call("GET", "/assignments");
    expect(list.body.assignments).toHaveLength(1);
    expect(list.body.assignments?.[0]?.title).toBe("Fraction word problems");

    // Another educator holds no link and sees nothing of it.
    asUser(OTHER_EDUCATOR_ID, "educator");
    expect((await call("GET", "/assignments")).body.assignments).toEqual([]);
  });

  it("denies assignments to students the educator holds no granted link to — 404 for unknown ids, 403 for real ones", async () => {
    // Unknown id: 404.
    asUser(EDUCATOR_ID, "educator");
    expect(
      (await call("POST", "/assignments", { studentId: GHOST_STUDENT_ID, title: "x" })).status,
    ).toBe(404);

    // A real student without a granted link: the policy table denies it.
    const res = await call("POST", "/assignments", { studentId: STUDENT_ID, title: "x" });
    expect(res.status).toBe(403);
    expect(harness.auditLog.some((e) => e.action === "assign_work" && e.decision === "denied")).toBe(true);
    expect(harness.store.assignments).toHaveLength(0);
  });

  it("validates assignment bodies against the contract", async () => {
    harness.grant(EDUCATOR_ID, STUDENT_ID);
    asUser(EDUCATOR_ID, "educator");
    expect((await call("POST", "/assignments", { studentId: STUDENT_ID, title: "" })).status).toBe(400);
  });

  it("serves assignments only to educators", async () => {
    asUser(ADMIN_ID, "admin");
    expect((await call("GET", "/assignments")).status).toBe(403);
  });

  // ── Supports configuration ────────────────────────────────────────────────

  it("reads an unsaved support plan as empty, and saves a plan with the human trail", async () => {
    harness.grant(EDUCATOR_ID, STUDENT_ID);
    asUser(EDUCATOR_ID, "educator");

    const empty = await call("GET", `/students/${STUDENT_ID}/supports`);
    expect(empty.status).toBe(200);
    expect(empty.body.supports).toEqual([]);

    const saved = await call("PUT", `/students/${STUDENT_ID}/supports`, {
      supports: ["extra processing time", "visual schedules"],
      notes: "Helps after transitions.",
    });
    expect(saved.status).toBe(200);
    expect(saved.body.studentId).toBe(STUDENT_ID);
    expect(saved.body.supports).toEqual(["extra processing time", "visual schedules"]);
    expect(saved.body.updatedBy).toBe(EDUCATOR_ID);

    const reread = await call("GET", `/students/${STUDENT_ID}/supports`);
    expect(reread.body.supports).toEqual(["extra processing time", "visual schedules"]);
  });

  it("denies supports reads and writes without a granted link", async () => {
    // Real student, no link: 403 from the policy table.
    asUser(EDUCATOR_ID, "educator");
    expect((await call("GET", `/students/${STUDENT_ID}/supports`)).status).toBe(403);
    expect(
      (await call("PUT", `/students/${STUDENT_ID}/supports`, { supports: ["x"] })).status,
    ).toBe(403);
    expect(harness.store.supports.size).toBe(0);

    // Unknown id: 404 without leaking anything else.
    expect((await call("GET", `/students/${GHOST_STUDENT_ID}/supports`)).status).toBe(404);
    expect(
      (await call("PUT", `/students/${GHOST_STUDENT_ID}/supports`, { supports: ["x"] })).status,
    ).toBe(404);
  });

  it("validates supports bodies against the contract", async () => {
    harness.grant(EDUCATOR_ID, STUDENT_ID);
    asUser(EDUCATOR_ID, "educator");
    expect((await call("PUT", `/students/${STUDENT_ID}/supports`, {})).status).toBe(400);
    expect((await call("PUT", `/students/${STUDENT_ID}/supports`, { supports: [42] })).status).toBe(400);
  });

  // ── The no-override invariant ─────────────────────────────────────────────

  it("lets NO role override the authorization layer: an admin who granted a link still cannot read child data", async () => {
    // The admin grants the educator's link — then tries to use the educator
    // surface themself. The policy table has no admin rule for child data,
    // and roles with no rule fall through to deny.
    const linkId = harness.seedLink(EDUCATOR_ID, STUDENT_ID, "pending");
    asUser(ADMIN_ID, "admin");
    expect((await call("POST", `/links/${linkId}/grant`)).status).toBe(200);

    expect((await call("GET", `/students/${STUDENT_ID}/supports`)).status).toBe(403);
    expect((await call("PUT", `/students/${STUDENT_ID}/supports`, { supports: ["x"] })).status).toBe(403);
    expect((await call("POST", "/assignments", { studentId: STUDENT_ID, title: "x" })).status).toBe(403);
    expect((await call("GET", "/students")).status).toBe(403);
    expect(harness.store.supports.size).toBe(0);
    expect(harness.store.assignments).toHaveLength(0);
  });

  it("scopes a granted educator to exactly their linked students — a second student is invisible", async () => {
    harness.grant(EDUCATOR_ID, STUDENT_ID);
    asUser(EDUCATOR_ID, "educator");

    // The linked student works; the unlinked one is denied on every surface.
    expect((await call("GET", `/students/${STUDENT_ID}/supports`)).status).toBe(200);
    expect((await call("GET", `/students/${OTHER_STUDENT_ID}/supports`)).status).toBe(403);
    expect(
      (await call("POST", "/assignments", { studentId: OTHER_STUDENT_ID, title: "x" })).status,
    ).toBe(403);
  });
});
