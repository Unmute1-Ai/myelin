import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  SessionError,
  createSessionCodec,
  sessionSecretFromEnv,
} from "./session";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("session codec", () => {
  it("round-trips claims through sign and verify", () => {
    const codec = createSessionCodec(() => SECRET);
    const token = codec.sign({ userId: USER_ID, role: "student" });

    const claims = codec.verify(token);
    expect(claims.userId).toBe(USER_ID);
    expect(claims.role).toBe("student");
    expect(claims.exp - claims.iat).toBe(SESSION_TTL_SECONDS);
  });

  it("names the session cookie", () => {
    expect(SESSION_COOKIE_NAME).toBe("primer_session");
  });

  it("rejects a tampered payload", () => {
    const codec = createSessionCodec(() => SECRET);
    const token = codec.sign({ userId: USER_ID, role: "student" });
    const [payload, mac] = token.split(".");

    // Flip the role inside the payload; the MAC no longer matches.
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    decoded.role = "admin";
    const forged = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");

    expect(() => codec.verify(`${forged}.${mac}`)).toThrow(SessionError);
  });

  it("rejects a token signed with a different secret", () => {
    const codec = createSessionCodec(() => SECRET);
    const token = codec.sign({ userId: USER_ID, role: "student" });
    const other = createSessionCodec(() => `other-${SECRET.slice(5)}`);
    expect(() => other.verify(token)).toThrow(SessionError);
  });

  it("rejects expired tokens", () => {
    // Negative TTL issues a token that expired before it was issued.
    const expired = createSessionCodec(() => SECRET, -10);
    const token = expired.sign({ userId: USER_ID, role: "student" });
    const codec = createSessionCodec(() => SECRET);
    expect(() => codec.verify(token)).toThrow(SessionError);
  });

  it("rejects structurally invalid tokens", () => {
    const codec = createSessionCodec(() => SECRET);
    expect(() => codec.verify("not-a-token")).toThrow(SessionError);
    expect(() => codec.verify("a.b.c")).toThrow(SessionError);
    expect(() => codec.verify("")).toThrow(SessionError);
  });

  it("rejects claims that do not match the shape", () => {
    // Hand-forge a correctly-signed token whose claims are nonsense.
    const payload = Buffer.from(
      JSON.stringify({ userId: "not-a-uuid", role: "wizard", iat: 1, exp: 2 }),
      "utf8",
    ).toString("base64url");
    const mac = createHmac("sha256", SECRET).update(payload).digest("base64url");
    const codec = createSessionCodec(() => SECRET);
    expect(() => codec.verify(`${payload}.${mac}`)).toThrow(SessionError);
  });
});

describe("sessionSecretFromEnv", () => {
  const original = process.env.SESSION_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  });

  it("throws when the secret is unset (fail closed)", () => {
    delete process.env.SESSION_SECRET;
    expect(() => sessionSecretFromEnv()).toThrow(/SESSION_SECRET/);
  });

  it("throws when the secret is too short", () => {
    process.env.SESSION_SECRET = "short";
    expect(() => sessionSecretFromEnv()).toThrow(/SESSION_SECRET/);
  });

  it("accepts a sufficiently long secret", () => {
    process.env.SESSION_SECRET = SECRET;
    expect(sessionSecretFromEnv()).toBe(SECRET);
  });
});
