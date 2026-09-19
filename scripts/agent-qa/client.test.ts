import { createServer } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, test } from "bun:test";
import { discoverTools } from "./client";
import { ContractError } from "./types";

const closeCallbacks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (closeCallbacks.length > 0) await closeCallbacks.pop()?.();
});

async function responseFixture(status: number, body: string): Promise<{
  readonly baseUrl: string;
  readonly attempts: () => number;
}> {
  let attempts = 0;
  const sockets = new Set<Socket>();
  const server = createServer((_request, response) => {
    attempts += 1;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(body);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  closeCallbacks.push(() => new Promise<void>((resolve) => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  }));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("test port unavailable");
  return { baseUrl: `http://127.0.0.1:${address.port}`, attempts: () => attempts };
}

describe("tool discovery readiness", () => {
  test("cancels a hung early probe and retries the same existing endpoint", async () => {
    let attempts = 0;
    const sockets = new Set<Socket>();
    const server = createServer((request, response) => {
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "x-opencode-directory",
        });
        response.end();
        return;
      }
      attempts += 1;
      if (attempts === 1) {
        setTimeout(() => {
          if (response.destroyed) return;
          response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
          response.end(JSON.stringify(["late"]));
        }, 200);
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      response.end(JSON.stringify(["read", "bash"]));
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    closeCallbacks.push(() => new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    }));
    const address = server.address();
    if (typeof address !== "object" || address === null) throw new Error("test port unavailable");
    const result = await discoverTools(
      { baseUrl: `http://127.0.0.1:${address.port}`, directory: "C:\\agent-qa" },
      { deadlineMs: 1_000, attemptMs: 50 },
    );
    expect(result.ids).toEqual(["read", "bash"]);
    expect(result.attempts).toBe(2);
  });

  test("propagates HTTP failure after exactly one probe", async () => {
    const fixture = await responseFixture(500, "broken");
    let failure: unknown;
    try {
      await discoverTools({ baseUrl: fixture.baseUrl, directory: "C:\\agent-qa" }, { deadlineMs: 500, attemptMs: 50 });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failure = error;
    }
    expect(failure).toBeInstanceOf(ContractError);
    if (!(failure instanceof ContractError)) throw new Error("typed HTTP failure missing");
    expect(failure.code).toBe("HTTP_FAILURE");
    expect(fixture.attempts()).toBe(1);
  });

  test("propagates malformed JSON after exactly one probe", async () => {
    const fixture = await responseFixture(200, "{malformed");
    let failure: unknown;
    try {
      await discoverTools({ baseUrl: fixture.baseUrl, directory: "C:\\agent-qa" }, { deadlineMs: 500, attemptMs: 50 });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failure = error;
    }
    expect(failure).toBeInstanceOf(ContractError);
    if (!(failure instanceof ContractError)) throw new Error("typed JSON failure missing");
    expect(failure.code).toBe("INVALID_DISCOVERY_JSON");
    expect(fixture.attempts()).toBe(1);
  });
});
