import { createServer } from "node:http";
import type { Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TEST_MCP_APPROVED_TOOL_ID } from "../ccswitch-harness/mcp-permissions";

/**
 * Synthetic OpenAI-compatible provider for workbench QA (P1).
 *
 * - GET  /v1/models                  -> model-a catalog (YUME settings catalog check)
 * - POST /v1/chat/completions        -> scripted SSE responses (see scenarios below)
 * - GET  /control/requests           -> every recorded request body (system + messages)
 * - POST /control/reset              -> clear recorded requests
 *
 * Scenarios (keyed on the LAST user message text):
 * - "cancel-flow": one bash call that records its PID, starts a Start-Job child
 *   that appends child-counter.txt every second, then appends counter.txt every
 *   second itself. Both must stop when the session is aborted.
 * - otherwise: one bash `Get-Location` call, then a final text message once the
 *   tool result arrives.
 *
 * The provider never calls external services. It writes a receipt JSON with the
 * bound port and writes every recorded request to <runDir>/requests.json on
 * demand via the control endpoint.
 */

type JsonObject = Record<string, unknown>;

const CANCEL_COMMAND = [
  "Set-Content -LiteralPath probe.pid -Value $PID",
  "$job = Start-Job -ScriptBlock { Set-Content -LiteralPath child.pid -Value $PID; 1..120 | ForEach-Object { Add-Content -LiteralPath child-counter.txt -Value $_; Start-Sleep -Seconds 1 } }",
  "1..120 | ForEach-Object { Add-Content -LiteralPath counter.txt -Value $_; Start-Sleep -Seconds 1 }",
].join("; ");

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MCP_ECHO_TRIGGER = "call mcp echo";

function requestToolNames(body: JsonObject): readonly string[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => {
    if (!isJsonObject(tool)) return [];
    const fn = tool.function;
    if (isJsonObject(fn) && typeof fn.name === "string") return [fn.name];
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}

function userScenario(body: JsonObject): string {
  const history = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : [];
  const user = history.findLastIndex((item) => item.role === "user");
  return String(user >= 0 ? history[user]?.content : "");
}

function toolResults(body: JsonObject): readonly JsonObject[] {
  const history = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : [];
  const user = history.findLastIndex((item) => item.role === "user");
  return history.slice(user + 1).filter((item) => item.role === "tool");
}

function scenarioToken(scenario: string, name: string): string {
  const value = scenario.match(new RegExp(`${name}=([^\\s]+)`))?.[1];
  if (value === undefined) throw new Error(`missing ${name}`);
  return decodeURIComponent(value);
}

function decodedContent(value: unknown): string {
  if (typeof value === "string") {
    try { return decodedContent(JSON.parse(value)); }
    catch { return value; }
  }
  if (Array.isArray(value) || isJsonObject(value)) return JSON.stringify(value);
  return value === undefined || value === null ? "" : String(value);
}

function windowsHandle(results: readonly JsonObject[]): string {
  const text = results.map((result) => decodedContent(result.content)).join("\n");
  const match = text.match(/"(?:windowHandle|handle)"\s*:\s*"?(\d+)"?/i);
  if (match?.[1] === undefined) throw new Error("Windows MCP did not return a window handle");
  return match[1];
}

function desktopWindowsCall(body: JsonObject): JsonObject | undefined {
  const scenario = userScenario(body);
  if (!scenario.startsWith("P5_DESKTOP_")) return undefined;
  const results = toolResults(body);
  const count = results.length;
  if (scenario.startsWith("P5_DESKTOP_FAIL")) {
    return count === 0
      ? { name: "yume_windows_ui_read", input: { windowHandle: "1", controlType: "Document" } }
      : undefined;
  }
  const file = scenarioToken(scenario, "file");
  const shot = scenarioToken(scenario, "shot");
  const marker = scenarioToken(scenario, "marker");
  const title = file.split(/[\\/]/).at(-1)?.replace(/\.txt$/i, "") ?? "p5-desktop";
  if (count === 0) return { name: "yume_windows_app", input: { programPath: "C:\\Windows\\System32\\notepad.exe", arguments: `"${file}"`, workingDirectory: file.replace(/[\\/][^\\/]+$/, ""), waitForWindow: true, timeoutMs: 10_000 } };
  if (count === 1) return { name: "yume_windows_window_management", input: { action: "wait_for", title, timeoutMs: 10_000 } };
  const handle = windowsHandle(results);
  if (count === 2) return { name: "yume_windows_ui_snapshot", input: { windowHandle: handle, mode: "full", maxDepth: 10 } };
  if (scenario.startsWith("P5_DESKTOP_STOP")) {
    return count === 3 ? { name: "yume_windows_ui_wait", input: { windowHandle: handle, mode: "appear", name: `never-${marker}`, timeoutMs: 120_000 } } : undefined;
  }
  if (count === 3) return { name: "yume_windows_ui_type", input: { windowHandle: handle, text: marker, controlType: "Document", clearFirst: true, requireUnique: true, inputMode: "auto", withSnapshot: true } };
  if (count === 4) return { name: "yume_windows_keyboard_control", input: { windowHandle: handle, action: "press", key: "s", modifiers: "ctrl" } };
  if (count === 5) return { name: "yume_windows_screenshot_control", input: { action: "capture", target: "window", windowHandle: handle, outputMode: "file", outputPath: shot, imageFormat: "png", includeImage: false, annotate: true } };
  return undefined;
}

// Additive P3 MCP branch: only fires when the caller exposes the approved MCP
// tool AND the user text carries the trigger phrase; every other request keeps
// the original bash/DONE behavior.
function mcpEchoCall(body: JsonObject, scenario: string) {
  if (!scenario.includes(MCP_ECHO_TRIGGER)) return undefined;
  if (!requestToolNames(body).includes(TEST_MCP_APPROVED_TOOL_ID)) return undefined;
  const rest = scenario.slice(scenario.indexOf(MCP_ECHO_TRIGGER) + MCP_ECHO_TRIGGER.length).trim();
  const marker = rest.split(/\s+/)[0] ?? "";
  return {
    index: 0,
    id: `call_mcp_echo_${marker.slice(0, 24) || "0"}`,
    type: "function",
    function: { name: TEST_MCP_APPROVED_TOOL_ID, arguments: JSON.stringify({ text: marker }) },
  };
}

function chunksFor(body: JsonObject): readonly JsonObject[] {
  const history = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : [];
  const user = history.findLastIndex((item) => item.role === "user");
  const scenario = String(user >= 0 ? history[user].content : "");
  const toolResults = history.slice(user + 1).filter((item) => item.role === "tool");

  const base = { id: "chatcmpl-workbench-qa", object: "chat.completion.chunk", created: 1, model: "model-a" };
  if (scenario.startsWith("P5_DESKTOP_FAIL") && toolResults.length > 0) throw new Error("P5_DESKTOP_EXPECTED_FAILURE");
  const desktopCall = desktopWindowsCall(body);
  if (desktopCall !== undefined) {
    const call = { index: 0, id: `call_p5_desktop_${toolResults.length}`, type: "function", function: { name: desktopCall.name, arguments: JSON.stringify(desktopCall.input) } };
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
  }
  if (scenario.includes("P6_TASK_CHILD")) {
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", content: "WORKBENCH_QA_CHILD_DONE" }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
  }
  if (toolResults.length > 0) {
    const delta = { role: "assistant", content: `WORKBENCH_QA_DONE:${scenario}` };
    return [
      { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
  }

  const mcpCall = mcpEchoCall(body, scenario);
  if (mcpCall !== undefined) {
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [mcpCall] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
  }

  if (scenario.startsWith("P6_QUESTION") && requestToolNames(body).includes("question")) {
    const call = {
      index: 0,
      id: "call_p6_question",
      type: "function",
      function: {
        name: "question",
        arguments: JSON.stringify({
          questions: [{
            question: "请选择本地 QA 答案",
            header: "P6 确认",
            options: [
              { label: "通过", description: "继续本地测试" },
              { label: "拒绝", description: "停止本地测试" },
            ],
          }],
        }),
      },
    };
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
  }

  if (scenario.startsWith("P6_EDIT") && requestToolNames(body).includes("edit")) {
    const filePath = scenarioToken(scenario, "file");
    const existing = scenario.startsWith("P6_EDIT_REVERT");
    const call = {
      index: 0,
      id: "call_p6_edit",
      type: "function",
      function: {
        name: "edit",
        arguments: JSON.stringify({
          filePath,
          oldString: existing ? "P6_EDIT_AFTER" : "",
          newString: existing ? "P6_EDIT_SECOND" : "P6_EDIT_AFTER\n",
        }),
      },
    };
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
  }

  if (scenario.startsWith("P6_TASK") && requestToolNames(body).includes("task")) {
    const call = {
      index: 0,
      id: "call_p6_task",
      type: "function",
      function: {
        name: "task",
        arguments: JSON.stringify({
          description: "Check isolated child reply",
          prompt: "P6_TASK_CHILD Reply with the fixture completion marker.",
          subagent_type: "explore",
        }),
      },
    };
    return [
      { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [call] }, finish_reason: null }] },
      { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
  }

  const command = scenario.includes("cancel-flow") ? CANCEL_COMMAND : "Get-Location";
  const calls = [
    {
      index: 0,
      id: `call_${scenario.slice(0, 24) || "default"}_0`,
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command }) },
    },
  ];
  return [
    { ...base, choices: [{ index: 0, delta: { role: "assistant", tool_calls: calls }, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
  ];
}

export async function startWorkbenchProvider(runDir: string) {
  const requests: JsonObject[] = [];
  const sockets = new Set<Socket>();
  await mkdir(runDir, { recursive: true });

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
      if (request.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            object: "list",
            data: [{ id: "model-a", object: "model", created: 0, owned_by: "yume-workbench-qa" }],
          }),
        );
        return;
      }
      if (request.method === "GET" && url.pathname === "/control/requests") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(requests));
        return;
      }
      if (request.method === "POST" && url.pathname === "/control/reset") {
        requests.length = 0;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ reset: true }));
        return;
      }
      if (
        request.method === "POST" &&
        (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")
      ) {
        const parts: Buffer[] = [];
        for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
        const body = JSON.parse(Buffer.concat(parts).toString("utf8")) as JsonObject;
        requests.push(body);
        await writeFile(join(runDir, "requests.json"), JSON.stringify(requests, null, 2), "utf8");
        const chunks = chunksFor(body);
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
        response.end("data: [DONE]\n\n");
        return;
      }
      response.writeHead(404);
      response.end("unknown endpoint");
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const requestedPort = Number(process.env.YUME_QA_PROVIDER_PORT ?? "0");
  await new Promise<void>((resolve) => server.listen(requestedPort, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("provider address unavailable");

  const receipt = {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    pid: process.pid,
    runDir,
    started: new Date().toISOString(),
  };
  await writeFile(join(runDir, "provider-receipt.json"), JSON.stringify(receipt, null, 2), "utf8");
  console.log(`workbench-qa provider listening at ${receipt.baseUrl}`);
  return receipt;
}

if (import.meta.main) {
  const runDir = process.argv[2];
  if (!runDir) throw new Error("usage: bun scripts/workbench-qa/provider.ts <run-dir>");
  await startWorkbenchProvider(runDir);
}
