import { createServer } from "node:http";
import type { Socket } from "node:net";
import { ContractError, isJsonObject, type JsonObject } from "./types";

type ToolCall = { readonly name: string; readonly input: JsonObject };
export type Provider = {
  readonly baseUrl: string;
  readonly port: number;
  readonly requests: readonly JsonObject[];
  readonly close: () => Promise<void>;
};

function messages(body: JsonObject): readonly JsonObject[] {
  const value = body.messages;
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function userText(body: JsonObject): string {
  const users = messages(body).filter((message) => message.role === "user");
  const latest = users.at(-1)?.content;
  return typeof latest === "string" ? latest : JSON.stringify(latest ?? "");
}

function hasToolResult(body: JsonObject): boolean {
  const history = messages(body);
  const userIndex = history.findLastIndex((message) => message.role === "user");
  return history.slice(userIndex + 1).some((message) => message.role === "tool");
}

function toolResultCount(body: JsonObject): number {
  return messages(body).filter((message) => message.role === "tool").length;
}

function callFor(text: string): ToolCall | null {
  if (text.includes("QA_TRUSTED")) return { name: "trusted_probe", input: { expected: "private-config" } };
  if (text.includes("QA_READ")) return { name: "read", input: { filePath: "same.txt" } };
  if (text.includes("QA_WRITE")) return { name: "write", input: { filePath: "new.txt", content: "NEW_FILE" } };
  if (text.includes("QA_EDIT")) return { name: "edit", input: { filePath: "same.txt", oldString: "ORIGINAL_A", newString: "EDITED_A" } };
  if (text.includes("QA_SHELL")) return { name: "bash", input: { command: "bun -e \"await Bun.write('command.exit','0')\"", description: "Write synthetic exit receipt" } };
  if (text.includes("QA_ESCAPE")) return { name: "read", input: { filePath: "../workspace-a/same.txt" } };
  if (text.includes("QA_UNKNOWN")) return { name: "unknown_agent_tool", input: {} };
  if (text.includes("QA_WEBFETCH")) return { name: "webfetch", input: { url: "http://127.0.0.1:9/not-running", format: "text" } };
  return null;
}

function flowCall(body: JsonObject, text: string): ToolCall | null {
  const count = toolResultCount(body);
  if (text.includes("FLOW_DOCUMENT")) {
    if (count === 0) return { name: "read", input: { filePath: "notes.txt" } };
    if (count === 1) return { name: "write", input: { filePath: "summary.md", content: "## 已完成\n- 完成需求梳理\n- 确认接口方案\n\n## 待办\n- 补充边界测试\n" } };
  }
  if (text.includes("FLOW_CODE")) {
    if (count === 0) return { name: "bash", input: { command: "bun test sum.test.ts", description: "Run failing test" } };
    if (count === 1) return { name: "edit", input: { filePath: "sum.ts", oldString: "return a - b", newString: "return a + b" } };
    if (count === 2) return { name: "bash", input: { command: "bun test sum.test.ts", description: "Run fixed test" } };
  }
  return null;
}

function chunks(body: JsonObject): readonly JsonObject[] {
  const text = userText(body);
  const selected = flowCall(body, text) ?? callFor(text);
  if (selected !== null && (text.includes("FLOW_") || !hasToolResult(body))) {
    return [{
      id: "chatcmpl-agent-tool", object: "chat.completion.chunk", created: 1, model: "model-a",
      choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${selected.name}`, type: "function", function: { name: selected.name, arguments: JSON.stringify(selected.input) } }] }, finish_reason: null }],
    }, {
      id: "chatcmpl-agent-tool", object: "chat.completion.chunk", created: 1, model: "model-a",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    }];
  }
  const content = text.includes("QA_MISLEADING") ? "PASS" : "fixture complete";
  return [{
    id: "chatcmpl-agent-final", object: "chat.completion.chunk", created: 2, model: "model-a",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  }, {
    id: "chatcmpl-agent-final", object: "chat.completion.chunk", created: 2, model: "model-a",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  }];
}

async function requestBody(request: import("node:http").IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(parts).toString("utf8");
}

export async function startProvider(): Promise<Provider> {
  const requests: JsonObject[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    try {
    if (request.method === "GET" && request.url?.endsWith("/models")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "model-a", object: "model", owned_by: "agent-qa" }] }));
      return;
    }
    const raw = await requestBody(request);
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) {
      if (error instanceof SyntaxError) { response.writeHead(400); response.end("bad json"); return; }
      throw error;
    }
    if (!isJsonObject(parsed)) { response.writeHead(400); response.end("bad envelope"); return; }
    requests.push(parsed);
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const text = userText(parsed);
    if (text.includes("QA_BAD_RESPONSE")) { response.end("data: {malformed\n\n"); return; }
    if (text.includes("QA_ABORT")) return;
    for (const chunk of chunks(parsed)) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.end("data: [DONE]\n\n");
    } catch (error) {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (typeof address !== "object" || address === null || typeof address.port !== "number") {
    throw new ContractError("PROVIDER_START", "provider port unavailable");
  }
  const port = address.port;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`, port, requests,
    close: () => new Promise<void>((resolveClose) => { for (const socket of sockets) socket.destroy(); server.close(() => resolveClose()); }),
  };
}
