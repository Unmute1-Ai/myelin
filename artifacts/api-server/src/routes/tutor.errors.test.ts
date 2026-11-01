// Route-level provider-failure tests: an injected provider proves the
// dependency seam, and typed provider failures map onto contract-safe
// statuses (429 rate limit, 502 everything else) that never echo learner
// input back to the client.

import express, { type Express } from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { createTutorRoutes } from "./tutor";
import { SessionStore } from "../tutor/session-store";
import type { SessionContext, TurnEvent, TutorProvider } from "../tutor/types";
import { ProviderRateLimitError } from "../tutor/provider/errors";

function failingProvider(thrower: () => unknown, name = "failing"): TutorProvider {
  return {
    name,
    async *turn(_ctx: SessionContext): AsyncIterable<TurnEvent> {
      void _ctx;
      throw thrower(); // a provider that always fails
    },
  };
}

function echoProvider(): TutorProvider {
  return {
    name: "echo",
    async *turn(ctx: SessionContext): AsyncIterable<TurnEvent> {
      yield { type: "text", delta: `You said: ${ctx.input}` };
      yield { type: "done", spoken: ctx.input };
    },
  };
}

function buildApp(provider: TutorProvider): Express {
  const app = express();
  app.use(express.json());
  app.use("/api/tutor", createTutorRoutes(new SessionStore(), provider));
  return app;
}

interface Listening {
  server: Server;
  baseUrl: string;
}

/** listen() returns before the kernel assigns the port — await the event. */
async function listenAsync(app: Express): Promise<Listening> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/tutor` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("tutor route provider failure mapping", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const listening = await listenAsync(
      buildApp(failingProvider(() => new ProviderRateLimitError(), "rate-limited")),
    );
    server = listening.server;
    baseUrl = listening.baseUrl;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  async function createSession(): Promise<string> {
    const res = await fetch(`${baseUrl}/session`, { method: "POST" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionId: string };
    return body.sessionId;
  }

  async function sendTurn(target: string, sessionId: string, input: string): Promise<Response> {
    return fetch(`${target}/turn`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, input }),
    });
  }

  it("a rate-limited provider yields a 429 with the provider_error code", async () => {
    const sessionId = await createSession();
    const res = await sendTurn(baseUrl, sessionId, "what is 2 dollars");
    expect(res.status).toBe(429);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("provider_error");
    expect(body.message).toMatch(/catching its breath/i);
  });

  it("error bodies never echo learner input", async () => {
    const sessionId = await createSession();
    const secret = "my-private-note-42";
    const res = await sendTurn(baseUrl, sessionId, secret);
    const text = await res.text();
    expect(text).not.toContain(secret);
  });

  it("any other provider failure yields a 502 with the provider_error code", async () => {
    const listening = await listenAsync(buildApp(failingProvider(() => new Error("boom"), "broken")));
    try {
      const sessionRes = await fetch(`${listening.baseUrl}/session`, { method: "POST" });
      const { sessionId } = (await sessionRes.json()) as { sessionId: string };
      const res = await sendTurn(listening.baseUrl, sessionId, "hello");
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("provider_error");
      expect(body.message).not.toContain("boom"); // internals stay internal
    } finally {
      await closeServer(listening.server);
    }
  });

  it("the injected provider is actually used (injection seam works)", async () => {
    const listening = await listenAsync(buildApp(echoProvider()));
    try {
      const sessionRes = await fetch(`${listening.baseUrl}/session`, { method: "POST" });
      const { sessionId } = (await sessionRes.json()) as { sessionId: string };
      const res = await sendTurn(listening.baseUrl, sessionId, "pineapple");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { reply: string };
      expect(body.reply).toBe("You said: pineapple");
    } finally {
      await closeServer(listening.server);
    }
  });
});
