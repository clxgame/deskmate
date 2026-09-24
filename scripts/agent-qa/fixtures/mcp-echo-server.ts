/**
 * Minimal stdio MCP server for permission-harness verification.
 * Speaks newline-delimited JSON-RPC 2.0 with the MCP initialize /
 * tools-list / tools-call protocol.
 */

import { appendFileSync, writeFileSync } from "node:fs";

type JsonRpc = {
  readonly jsonrpc: "2.0";
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
};

const ECHO_TOOL = {
  name: "yume_qa_echo",
  description: "Echo back the given text with a QA marker",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
} as const;

const UNAPPROVED_ECHO_TOOL = {
  name: "yume_qa_echo_unapproved",
  description: "Echo back the given text with a QA marker",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
} as const;

const logPath = process.argv[2] ?? process.env.MCP_ECHO_SERVER_LOG;
const log = (line: string): void => {
  if (logPath !== undefined) appendFileSync(logPath, `${line}\n`);
};

if (logPath !== undefined) writeFileSync(logPath, `mcp server started pid=${process.pid}\n`);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonRpc(line: string): JsonRpc | undefined {
  try {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value) || value.jsonrpc !== "2.0") return undefined;
    const id = value.id;
    if (id !== undefined && typeof id !== "number" && typeof id !== "string") return undefined;
    return {
      jsonrpc: "2.0",
      ...(id === undefined ? {} : { id }),
      ...(typeof value.method === "string" ? { method: value.method } : {}),
      ...(value.params === undefined ? {} : { params: value.params }),
    };
  } catch (error) {
    log(`!! parse error: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function reply(id: JsonRpc["id"], result: unknown): void {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  log(`>> ${body}`);
  process.stdout.write(`${body}\n`);
}

function textArgument(params: unknown): string {
  if (!isRecord(params) || !isRecord(params.arguments) || typeof params.arguments.text !== "string") {
    return "";
  }
  return params.arguments.text;
}

let buffer = "";
process.stdin.on("data", (chunk: Uint8Array) => {
  const raw = Buffer.from(chunk).toString("utf8");
  log(`<< raw: ${JSON.stringify(raw)}`);
  buffer += raw;
  let boundary = buffer.indexOf("\n");
  while (boundary >= 0) {
    const line = buffer.slice(0, boundary).trim();
    buffer = buffer.slice(boundary + 1);
    boundary = buffer.indexOf("\n");
    if (!line) continue;
    log(`<< line: ${line}`);
    const message = parseJsonRpc(line);
    if (message === undefined) continue;
    log(`method: ${message.method} id: ${message.id}`);
    if (message.method === "initialize") {
      reply(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "yume_qa_mcp", version: "0.0.1" },
      });
    } else if (message.method === "notifications/initialized") {
      // no reply
    } else if (message.method === "tools/list") {
      reply(message.id, { tools: [ECHO_TOOL, UNAPPROVED_ECHO_TOOL] });
    } else if (message.method === "tools/call") {
      const params = isRecord(message.params) ? message.params : {};
      const name = typeof params.name === "string" ? params.name : undefined;
      const text = textArgument(params);
      if (name === ECHO_TOOL.name) {
        reply(message.id, { content: [{ type: "text", text: `YUME_MCP_ECHO:${text}` }], isError: false });
      } else if (name === UNAPPROVED_ECHO_TOOL.name) {
        reply(message.id, {
          content: [{ type: "text", text: `YUME_MCP_ECHO_UNAPPROVED:${text}` }],
          isError: false,
        });
      } else {
        reply(message.id, { content: [{ type: "text", text: "unknown tool" }], isError: true });
      }
    } else if (message.method === "ping") {
      reply(message.id, {});
    }
  }
});
