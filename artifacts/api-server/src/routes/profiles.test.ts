// Route tests for the learning-profile endpoints (spec §6.2, §7 rows 2/3/10).
// The profile data port, guardian access, and audit run as in-memory fakes and
// the session boundary is substituted — the real requireAuth/codec and the
// drizzle data layer are covered by the auth and db suites; what is proven
// here is the profile policy and the entry rules at the API boundary. No
// database, so they run everywhere.

import express, { type Express, type RequestHandler } from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LearningProfile, ProfileEntry, User } from "@workspace/db/schema";
import type { GuardianAccessPort } from "../auth/authorize";
import type { AuditEntry, AuditPort } from "../auth/audit";
import type { AuthedRequest } from "../auth/middleware";
import { createProfileRoutes, type ProfileDeps } from "./profiles";
import {
  ProfileEvidenceError,
  UnlicensedInterpretationError,
  type ProfileDataPort,
  type ProfilePatch,
} from "../profiles/profile-service";
import { errorHandler } from "../middlewares/errorHandler";

const STUDENT_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_STUDENT_ID = "00000000-0000-4000-8000-000000000002";
const PARENT_ID = "00000000-0000-4000-8000-000000000003";
const EDUCATOR_ID = "00000000-0000-4000-8000-000000000004";
const ASSESSMENT_ID = "00000000-0000-4000-8000-0000000000a1";
const ENTRY_ID = "00000000-0000-4000-8000-0000000000c1";
// Registered in no fake account store — exercises the 404 path.
const GHOST_STUDENT_ID = "00000000-0000-4000-8000-0000000000ff";

const NOW = new Date("2026-11-01T10:00:00.000Z");

// Response schemas validate ids as UUIDs at the boundary — fixtures must be
// real UUIDs or the route's response parse throws before the assertion runs.
let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `00000000-0000-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
}

function fakeUser(id: string, role: User["role"]): User {
  return {
    id,
    email: `${role}@primer.test`,
    passwordHash: "test-hash",
    role,
    displayName: `Test ${role}`,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** In-memory ProfileDataPort — records what the routes wrote. */
function fakeProfileData() {
  const students = new Set<string>([STUDENT_ID, OTHER_STUDENT_ID]);
  const profiles = new Map<string, LearningProfile>();
  const entries: ProfileEntry[] = [];
  const updates: Array<{ studentId: string; patch: ProfilePatch }> = [];

  const port: ProfileDataPort = {
    async studentExists(studentId) {
      return students.has(studentId);
    },
    async ensureProfile(studentId) {
      let profile = profiles.get(studentId);
      if (!profile) {
        profile = {
          id: nextId(),
          studentId,
          subjects: [],
          preferredStrategy: null,
          pacing: "standard",
          createdAt: NOW,
          updatedAt: NOW,
        } as unknown as LearningProfile;
        profiles.set(studentId, profile);
      }
      return profile;
    },
    async updateProfile(studentId, patch) {
      updates.push({ studentId, patch });
      const profile = await port.ensureProfile(studentId);
      return { ...profile, ...patch, updatedAt: NOW };
    },
    async createProfileEntry(studentId, input) {
      const profile = await port.ensureProfile(studentId);
      const entry = {
        id: nextId(),
        profileId: profile.id,
        kind: input.kind,
        subject: input.subject ?? null,
        detail: input.detail,
        whyChanged: input.whyChanged ?? null,
        sourceAssessmentId: input.sourceAssessmentId ?? null,
        sourceTurnId: input.sourceTurnId ?? null,
        invalidatedAt: null,
        invalidatedReason: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as unknown as ProfileEntry;
      entries.push(entry);
      return { entry, replayed: false };
    },
    async listProfileEntries(studentId, kind) {
      const profile = profiles.get(studentId);
      if (!profile) return [];
      return entries.filter(
        (e) =>
          e.profileId === profile.id && (kind === undefined || e.kind === kind),
      );
    },
    async deleteProfileEntry(studentId, entryId) {
      const profile = profiles.get(studentId);
      if (!profile) return false;
      const index = entries.findIndex(
        (e) => e.id === entryId && e.profileId === profile.id,
      );
      if (index === -1) return false;
      entries.splice(index, 1);
      return true;
    },
  };

  return { port, profiles, entries, updates };
}

interface FakeDeps {
  deps: ProfileDeps;
  currentUser: { value: User | undefined };
  grantedLinks: Set<string>;
  auditLog: AuditEntry[];
  data: ReturnType<typeof fakeProfileData>;
}

function fakeDeps(): FakeDeps {
  const data = fakeProfileData();
  const currentUser: { value: User | undefined } = { value: undefined };
  const grantedLinks = new Set<string>();
  const auditLog: AuditEntry[] = [];

  const guardianAccess: GuardianAccessPort = {
    async hasGrantedGuardianAccess(parentId, studentId) {
      return grantedLinks.has(`${parentId}:${studentId}`);
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

  // Test-only session boundary: the real requireAuth (codec + user lookup) is
  // covered by the auth suite; here the policy under test is authorize().
  const authenticate: RequestHandler = (req, _res, next) => {
    if (currentUser.value) (req as AuthedRequest).user = currentUser.value;
    next();
  };

  return {
    deps: {
      db: () => undefined as never,
      codec: undefined as never,
      // Never exercised here — password hashing belongs to the auth suite.
      passwords: {
        hash: async () => "unused",
        verify: async () => false,
      },
      audit,
      guardianAccess,
      // Educator paths are not exercised here; the deny stub keeps the
      // fail-closed default visible in the fixture.
      educatorAccess: {
        hasActiveEducatorLink: async () => false,
        getEducatorLink: async () => undefined,
      },
      data: data.port,
      authenticate,
    },
    currentUser,
    grantedLinks,
    auditLog,
    data,
  };
}

interface JsonBody {
  code?: string;
  message?: string;
  profile?: {
    id: string;
    studentId: string;
    subjects: string[];
    preferredStrategy: string | null;
    pacing: string;
  };
  // The PATCH response is the bare profile object (not wrapped).
  subjects?: string[];
  preferredStrategy?: string | null;
  pacing?: string;
  entries?: Array<{ id: string; kind: string; whyChanged: string | null }>;
}

type Result = { status: number; body: JsonBody };

describe("profile routes (in-memory fakes, spec §6.2)", () => {
  let server: http.Server;
  let baseUrl: string;
  let harness: FakeDeps;

  beforeAll(async () => {
    harness = fakeDeps();
    const app: Express = express();
    app.use(express.json());
    app.use("/profiles", createProfileRoutes(harness.deps));
    // Same boundary as the real app: typed auth errors become 401/403 JSON.
    app.use(errorHandler);
    server = http.createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/profiles`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    // In-memory fakes are shared by every request in this file — reset state
    // so tests stay order-independent.
    harness.currentUser.value = undefined;
    harness.grantedLinks.clear();
    harness.auditLog.length = 0;
    harness.data.entries.length = 0;
    harness.data.updates.length = 0;
    harness.data.profiles.clear();
  });

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: JsonBody;
    try {
      json = text === "" ? {} : (JSON.parse(text) as JsonBody);
    } catch {
      throw new Error(
        `non-JSON ${res.status} for ${method} ${path}: ${text.slice(0, 600)}`,
      );
    }
    return { status: res.status, body: json };
  }

  function asStudent(id = STUDENT_ID) {
    harness.currentUser.value = fakeUser(id, "student");
  }

  describe("student-readable profile", () => {
    it("returns a lazily created default profile for a first read", async () => {
      asStudent();
      const res = await call("GET", `/${STUDENT_ID}`);
      expect(res.status).toBe(200);
      expect(res.body.profile?.studentId).toBe(STUDENT_ID);
      expect(res.body.profile?.subjects).toEqual([]);
      expect(res.body.profile?.preferredStrategy).toBeNull();
    });

    it("lets the student read their own entry record", async () => {
      asStudent();
      await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "preference",
        subject: "math",
        detail: "Pictures before words.",
      });
      const res = await call("GET", `/${STUDENT_ID}/entries`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries?.[0]?.kind).toBe("preference");
    });
  });

  describe("student-editable profile with explicit preferences honored", () => {
    it("applies only the explicit choices the student sent", async () => {
      asStudent();
      const res = await call("PATCH", `/${STUDENT_ID}`, {
        subjects: ["math", "science"],
        preferredStrategy: "visual",
        pacing: "gentle",
      });
      expect(res.status).toBe(200);
      expect(res.body.subjects).toEqual(["math", "science"]);
      expect(res.body.preferredStrategy).toBe("visual");
      expect(res.body.pacing).toBe("gentle");
      expect(harness.data.updates[0]?.patch).toEqual({
        subjects: ["math", "science"],
        preferredStrategy: "visual",
        pacing: "gentle",
      });
      expect(
        harness.auditLog.some(
          (e) =>
            e.action === "update_learning_profile" && e.decision === "allowed",
        ),
      ).toBe(true);
    });

    it("treats preferredStrategy: null as a deliberate clear", async () => {
      asStudent();
      const res = await call("PATCH", `/${STUDENT_ID}`, {
        preferredStrategy: null,
      });
      expect(res.status).toBe(200);
      expect(res.body.preferredStrategy).toBeNull();
      expect(harness.data.updates[0]?.patch).toEqual({
        preferredStrategy: null,
      });
    });
  });

  describe("who may read and write whose profile (fail-closed policy)", () => {
    it("denies a student another student's profile", async () => {
      asStudent(STUDENT_ID);
      const res = await call("GET", `/${OTHER_STUDENT_ID}`);
      expect(res.status).toBe(403);
      expect(harness.auditLog.some((e) => e.decision === "denied")).toBe(true);
    });

    it("denies a parent without granted consent, allows a parent with it — read only", async () => {
      harness.currentUser.value = fakeUser(PARENT_ID, "parent");

      const denied = await call("GET", `/${STUDENT_ID}`);
      expect(denied.status).toBe(403);

      harness.grantedLinks.add(`${PARENT_ID}:${STUDENT_ID}`);
      const allowed = await call("GET", `/${STUDENT_ID}`);
      expect(allowed.status).toBe(200);

      const edit = await call("PATCH", `/${STUDENT_ID}`, { pacing: "gentle" });
      expect(edit.status).toBe(403);
    });

    it("denies an educator — no one overrides the authorization layer", async () => {
      harness.currentUser.value = fakeUser(EDUCATOR_ID, "educator");
      const read = await call("GET", `/${STUDENT_ID}`);
      expect(read.status).toBe(403);
      const edit = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "preference",
        detail: "Educator override attempt.",
      });
      expect(edit.status).toBe(403);
    });

    it("404s a student account that no longer exists, for an authorized reader", async () => {
      // A student querying a foreign id is denied (403) before existence is
      // ever consulted; the 404 path needs an actor who passes authorization.
      harness.currentUser.value = fakeUser(PARENT_ID, "parent");
      harness.grantedLinks.add(`${PARENT_ID}:${GHOST_STUDENT_ID}`);
      const res = await call("GET", `/${GHOST_STUDENT_ID}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("student_not_found");
    });
  });

  describe("evidence-only gaps through the API (no fabrication path)", () => {
    beforeEach(() => asStudent());

    it("rejects a gap with no evidence reference", async () => {
      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "gap",
        detail: "Nobody observed this anywhere.",
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(harness.data.entries).toHaveLength(0);
    });

    it("accepts a gap citing assessment evidence and passes the reference through", async () => {
      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "gap",
        subject: "math",
        detail: "Regrouping across zeros stalls.",
        sourceAssessmentId: ASSESSMENT_ID,
      });
      expect(res.status).toBe(201);
      expect(harness.data.entries[0]?.sourceAssessmentId).toBe(ASSESSMENT_ID);
      expect(harness.data.entries[0]?.whyChanged).toBeNull();
    });
  });

  describe("why_changed on every strategy change through the API", () => {
    beforeEach(() => asStudent());

    it("rejects a strategy change without a learner-readable note", async () => {
      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "strategy_change",
        detail: "Switching to visual.",
      });
      expect(res.status).toBe(400);
      expect(harness.data.entries).toHaveLength(0);
    });

    it("records the strategy change with its whyChanged note", async () => {
      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "strategy_change",
        subject: "math",
        detail: "Trying pictures for fractions.",
        whyChanged:
          "The last two step-by-step tries stalled, so let's draw it instead.",
      });
      expect(res.status).toBe(201);
      expect(harness.data.entries[0]?.whyChanged).toContain("draw it instead");
    });
  });

  describe("the student curates their own record", () => {
    beforeEach(async () => {
      asStudent();
      await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "preference",
        detail: "Pictures before words.",
      });
    });

    it("deletes their own entry", async () => {
      const deleted = await call(
        "DELETE",
        `/${STUDENT_ID}/entries/${harness.data.entries[0]?.id}`,
      );
      expect(deleted.status).toBe(204);
      expect(harness.data.entries).toHaveLength(0);
    });

    it("404s an entry that is not theirs without leaking its existence", async () => {
      const res = await call("DELETE", `/${STUDENT_ID}/entries/${ENTRY_ID}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("entry_not_found");
    });
  });

  describe("entry filtering", () => {
    it("filters the record by kind", async () => {
      asStudent();
      await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "gap",
        detail: "Regrouping stalls.",
        sourceAssessmentId: ASSESSMENT_ID,
      });
      await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "preference",
        detail: "Pictures before words.",
      });
      const res = await call("GET", `/${STUDENT_ID}/entries?kind=gap`);
      expect(res.status).toBe(200);
      expect(res.body.entries).toHaveLength(1);
      expect(res.body.entries?.[0]?.kind).toBe("gap");
    });
  });

  describe("the governed write path at the boundary (spec §6.0)", () => {
    // The route's own governance responsibility is the mapping: a governed
    // port rejection must surface as 400 invalid_request (never a 500), and
    // a replayed proposal must return the original entry — not 201. The
    // governed logic itself is proven against real storage in
    // profiles/evidence-governance.test.ts; here the port is substituted.
    let originalCreate: ProfileDataPort["createProfileEntry"];

    beforeAll(() => {
      originalCreate = harness.data.port.createProfileEntry.bind(
        harness.data.port,
      );
    });

    afterEach(() => {
      harness.data.port.createProfileEntry = originalCreate;
    });

    beforeEach(() => asStudent());

    it("maps an unlicensed interpretation to 400 without writing or auditing a row", async () => {
      harness.data.port.createProfileEntry = async () => {
        throw new UnlicensedInterpretationError(
          "a misconception requires a repeated error pattern, not a single miss",
        );
      };

      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "misconception",
        detail: "The port rejects this conclusion.",
        sourceAssessmentId: ASSESSMENT_ID,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
      expect(res.body.message).toContain("repeated error pattern");
      expect(harness.data.entries).toHaveLength(0);
      expect(
        harness.auditLog.filter((e) => e.action === "create_profile_entry"),
      ).toHaveLength(0);
    });

    it("maps a fabricated citation to 400 the same way", async () => {
      harness.data.port.createProfileEntry = async () => {
        throw new ProfileEvidenceError(
          "The referenced assessment does not exist for this student.",
          "sourceAssessmentId",
        );
      };

      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "gap",
        detail: "Cites a record that resolves to nothing.",
        sourceAssessmentId: ASSESSMENT_ID,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("invalid_request");
    });

    it("returns 200 with the original entry when the port reports a replay", async () => {
      const original = harness.data.port.ensureProfile(STUDENT_ID);
      const existingEntry = {
        id: ENTRY_ID,
        profileId: (await original).id,
        kind: "gap",
        subject: "math",
        detail: "Regrouping across zeros stalls.",
        whyChanged: null,
        sourceAssessmentId: ASSESSMENT_ID,
        sourceTurnId: null,
        invalidatedAt: null,
        invalidatedReason: null,
        createdAt: NOW,
        updatedAt: NOW,
      } as unknown as ProfileEntry;
      harness.data.port.createProfileEntry = async () => ({
        entry: existingEntry,
        replayed: true,
      });

      const res = await call("POST", `/${STUDENT_ID}/entries`, {
        kind: "gap",
        subject: "math",
        detail: "Regrouping across zeros stalls.",
        sourceAssessmentId: ASSESSMENT_ID,
      });
      expect(res.status).toBe(200);
      expect(res.body.entries).toBeUndefined();
      const audited = harness.auditLog.find(
        (e) => e.action === "create_profile_entry",
      );
      expect(audited?.resourceId).toBe(ENTRY_ID);
      expect(
        (audited?.authorizationEvidence as { replayed?: boolean }).replayed,
      ).toBe(true);
      // The replay wrote no second row through the fake either.
      expect(harness.data.entries).toHaveLength(0);
    });
  });
});
