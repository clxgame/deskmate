import { describe, expect, test } from "bun:test";
import { request } from "node:http";
import { CCSWITCH_TOOL_ID } from "../ccswitch-harness/permissions";
import { startMockOpenAiServer } from "./mock-openai-server";
import type { ProviderDraft } from "../ccswitch-harness/types";

const draft: ProviderDraft = {
  version: 1,
  kind: "opencode_provider_draft",
  providerName: "Todo9 Local",
  baseUrl: "http://127.0.0.1:47892/v1",
  modelHint: "model-a",
};

type HttpFixtureResponse = {
  readonly status: number;
  readonly body: unknown;
};

function requestJson(
  url: string,
  input: { readonly method?: "GET" | "POST"; readonly body?: unknown; readonly headers?: Record<string, string> } = {},
): Promise<HttpFixtureResponse> {
  return new Promise((resolveRequest, reject) => {
    const rawBody = input.body === undefined ? undefined : JSON.stringify(input.body);
    const headers =
      rawBody === undefined ? input.headers : { ...input.headers, "Content-Type": "application/json" };
    const req = request(
      url,
      {
        method: input.method ?? "GET",
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          try {
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            resolveRequest({
              status: response.statusCode ?? 0,
              body,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.once("error", reject);
    if (rawBody !== undefined) req.write(rawBody);
    req.end();
  });
}

describe("mock OpenAI server", () => {
  test("serves an OpenAI-compatible models catalog", async () => {
    const server = await startMockOpenAiServer({ canary: "runtime-canary", draft });
    try {
      const response = await requestJson(`${server.baseUrl}/models`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        object: "list",
        data: [expect.objectContaining({ id: "model-a", object: "model" })],
      });
      expect(server.observation()).toEqual({
        requestCount: 0,
        sawDedicatedTool: false,
        sawToolResultRoundTrip: false,
        dangerousToolExposureCount: 0,
        streamRequestCount: 0,
      });
    } finally {
      await server.close();
    }
  });

  test("returns 404 for unknown routes", async () => {
    const server = await startMockOpenAiServer({ canary: "runtime-canary", draft });
    try {
      const response = await requestJson(`${server.baseUrl}/unknown`);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not found" });
    } finally {
      await server.close();
    }
  });

  test("rejects runtime canaries before dispatching model and unknown routes", async () => {
    const canary = "runtime-canary";
    const server = await startMockOpenAiServer({ canary, draft });
    try {
      const modelHeaderLeak = await requestJson(`${server.baseUrl}/models`, {
        headers: { "X-Yume-Canary": canary },
      });
      const modelUrlLeak = await requestJson(`${server.baseUrl}/models?token=${encodeURIComponent(canary)}`);
      const unknownHeaderLeak = await requestJson(`${server.baseUrl}/unknown`, {
        headers: { "X-Yume-Canary": canary },
      });

      for (const response of [modelHeaderLeak, modelUrlLeak, unknownHeaderLeak]) {
        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body)).not.toContain(canary);
      }
    } finally {
      await server.close();
    }
  });

  test("keeps chat completions behavior unchanged", async () => {
    const server = await startMockOpenAiServer({ canary: "runtime-canary", draft });
    try {
      const response = await requestJson(`${server.baseUrl}/chat/completions`, {
        method: "POST",
        body: {
          model: "model-a",
          stream: false,
          messages: [{ role: "user", content: "configure cc switch" }],
          tools: [{ type: "function", function: { name: CCSWITCH_TOOL_ID, parameters: {} } }],
        },
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        object: "chat.completion",
        model: "model-a",
        choices: [{ finish_reason: "tool_calls" }],
      });
      expect(server.observation()).toMatchObject({
        requestCount: 1,
        sawDedicatedTool: true,
        sawToolResultRoundTrip: false,
        dangerousToolExposureCount: 0,
        streamRequestCount: 0,
      });
    } finally {
      await server.close();
    }
  });
});
