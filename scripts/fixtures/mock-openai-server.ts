import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CCSWITCH_TOOL_ID } from "../ccswitch-harness/permissions";
import { expectJsonObject, HarnessError, isJsonObject, type JsonObject, type ProviderDraft } from "../ccswitch-harness/types";

const dangerousToolIds = ["bash", "edit", "write", "patch", "external_directory", "task"] as const;

type MockOpenAiInput = {
  readonly canary: string;
  readonly draft: ProviderDraft;
  readonly port?: number;
};

type MockOpenAiServer = {
  readonly baseUrl: string;
  readonly port: number;
  readonly close: () => Promise<void>;
  readonly observation: () => JsonObject;
};

type CompletionRequest = {
  readonly stream: boolean;
  readonly hasDedicatedTool: boolean;
  readonly dangerousTools: readonly string[];
  readonly hasToolResult: boolean;
};

function addressPort(address: string | AddressInfo | null): number {
  if (typeof address === "object" && address !== null) return address.port;
  throw new HarnessError("mock OpenAI server did not expose a TCP port");
}

function getToolNames(body: JsonObject): readonly string[] {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.flatMap((tool) => {
    if (!isJsonObject(tool) || !isJsonObject(tool.function)) return [];
    return typeof tool.function.name === "string" ? [tool.function.name] : [];
  });
}

function hasToolResult(body: JsonObject): boolean {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  return messages.some((message) => isJsonObject(message) && message.role === "tool");
}

function parseCompletionRequest(rawBody: string, canary: string): CompletionRequest {
  if (rawBody.includes(canary)) throw new HarnessError("runtime canary leaked into provider request");
  const body = expectJsonObject(JSON.parse(rawBody), "OpenAI request");
  const toolNames = getToolNames(body);
  return {
    stream: body.stream === true,
    hasDedicatedTool: toolNames.includes(CCSWITCH_TOOL_ID),
    dangerousTools: toolNames.filter((name) => dangerousToolIds.some((id) => id === name)),
    hasToolResult: hasToolResult(body),
  };
}

function assertHeadersCanaryAbsent(request: IncomingMessage, canary: string): void {
  for (const value of Object.values(request.headers)) {
    const header = Array.isArray(value) ? value.join("\n") : value;
    if (header?.includes(canary)) throw new HarnessError("runtime canary leaked into provider headers", "canary_leak");
  }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveRead, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => resolveRead(Buffer.concat(chunks).toString("utf8")));
  });
}

function writeJson(response: ServerResponse, status: number, body: JsonObject): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function streamChunks(response: ServerResponse, chunks: readonly JsonObject[]): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write("data: [DONE]\n\n");
  response.end();
}

function toolCallChunks(draft: ProviderDraft): readonly JsonObject[] {
  const argumentsJson = JSON.stringify(draft);
  return [
    {
      id: "chatcmpl-yume-tool",
      object: "chat.completion.chunk",
      created: 1787922000,
      model: "model-a",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "call_yume_ccswitch",
                type: "function",
                function: { name: CCSWITCH_TOOL_ID, arguments: argumentsJson },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: "chatcmpl-yume-tool",
      object: "chat.completion.chunk",
      created: 1787922000,
      model: "model-a",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    },
  ];
}

function finalTextChunks(): readonly JsonObject[] {
  return [
    {
      id: "chatcmpl-yume-final",
      object: "chat.completion.chunk",
      created: 1787922001,
      model: "model-a",
      choices: [{ index: 0, delta: { role: "assistant", content: "Draft ready." }, finish_reason: null }],
    },
    {
      id: "chatcmpl-yume-final",
      object: "chat.completion.chunk",
      created: 1787922001,
      model: "model-a",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
}

function toolCallResponse(draft: ProviderDraft): JsonObject {
  return {
    id: "chatcmpl-yume-tool",
    object: "chat.completion",
    created: 1787922000,
    model: "model-a",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_yume_ccswitch",
              type: "function",
              function: { name: CCSWITCH_TOOL_ID, arguments: JSON.stringify(draft) },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function finalTextResponse(): JsonObject {
  return {
    id: "chatcmpl-yume-final",
    object: "chat.completion",
    created: 1787922001,
    model: "model-a",
    choices: [{ index: 0, message: { role: "assistant", content: "Draft ready." }, finish_reason: "stop" }],
  };
}

export async function startMockOpenAiServer(input: MockOpenAiInput): Promise<MockOpenAiServer> {
  const requests: CompletionRequest[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
      writeJson(response, 404, { error: "not found" });
      return;
    }
    try {
      assertHeadersCanaryAbsent(request, input.canary);
      const parsed = parseCompletionRequest(await readRequestBody(request), input.canary);
      requests.push(parsed);
      if (!parsed.hasDedicatedTool && !parsed.hasToolResult) {
        writeJson(response, 400, { error: "dedicated tool missing" });
        return;
      }
      if (parsed.dangerousTools.length > 0) {
        writeJson(response, 400, { error: "dangerous tools exposed" });
        return;
      }
      if (parsed.stream && parsed.hasToolResult) {
        streamChunks(response, finalTextChunks());
        return;
      }
      if (parsed.stream) {
        streamChunks(response, toolCallChunks(input.draft));
        return;
      }
      writeJson(response, 200, parsed.hasToolResult ? finalTextResponse() : toolCallResponse(input.draft));
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolveListen) => server.listen(input.port ?? 0, "127.0.0.1", resolveListen));
  const port = addressPort(server.address());
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    port,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
    observation: () => ({
      requestCount: requests.length,
      sawDedicatedTool: requests.some((request) => request.hasDedicatedTool),
      sawToolResultRoundTrip: requests.some((request) => request.hasToolResult),
      dangerousToolExposureCount: requests.filter((request) => request.dangerousTools.length > 0).length,
      streamRequestCount: requests.filter((request) => request.stream).length,
    }),
  };
}
