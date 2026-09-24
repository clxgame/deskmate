import { createServer } from "node:http";
import type { Socket } from "node:net";
import type { Provider } from "./provider";
import { isJsonObject, jsonObject, type JsonObject } from "./types";

type ToolCall = { readonly name: string; readonly input: JsonObject };

function messageList(body: JsonObject): readonly JsonObject[] {
  return Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : [];
}

function userText(body: JsonObject): string {
  const content = messageList(body).findLast((message) => message.role === "user")?.content;
  return typeof content === "string" ? content : JSON.stringify(content ?? "");
}

function toolResults(body: JsonObject): readonly JsonObject[] {
  const list = messageList(body);
  const userIndex = list.findLastIndex((message) => message.role === "user");
  return list.slice(userIndex + 1).filter((message) => message.role === "tool");
}

function token(text: string, name: string): string {
  const value = text.match(new RegExp(`${name}=([^\\s]+)`))?.[1];
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

function resultText(results: readonly JsonObject[]): string {
  return results.map((result) => decodedContent(result.content)).join("\n");
}

function windowHandle(results: readonly JsonObject[]): string {
  const text = resultText(results);
  const match = text.match(/"(?:windowHandle|handle)"\s*:\s*"?(\d+)"?/i)
    ?? text.match(/(?:window handle|hwnd|handle)\D+(\d+)/i);
  if (match?.[1] === undefined) throw new Error(`Windows MCP did not return a window handle: ${text.slice(-2_000)}`);
  return match[1];
}

function browserCall(text: string, count: number): ToolCall | null {
  const url = token(text, "url");
  const marker = token(text, "marker");
  if (text.startsWith("P5_BROWSER_SUCCESS")) {
    return [
      { name: "yume_playwright_browser_navigate", input: { url } },
      { name: "yume_playwright_browser_snapshot", input: {} },
      { name: "yume_playwright_browser_fill_form", input: { fields: [{ target: "#marker", name: "Unique marker", type: "textbox", value: marker }] } },
      { name: "yume_playwright_browser_click", input: { target: "#submit", element: "Submit marker" } },
      { name: "yume_playwright_browser_wait_for", input: { text: marker } },
      { name: "yume_playwright_browser_snapshot", input: {} },
      { name: "yume_playwright_browser_close", input: {} },
    ][count] ?? null;
  }
  if (text.startsWith("P5_BROWSER_REJECT")) {
    return count === 0 ? { name: "yume_playwright_browser_navigate", input: { url } } : null;
  }
  if (text.startsWith("P5_BROWSER_MISSING")) {
    return [
      { name: "yume_playwright_browser_navigate", input: { url } },
      { name: "yume_playwright_browser_snapshot", input: {} },
      { name: "yume_playwright_browser_click", input: { target: "#missing-element", element: "Missing element" } },
    ][count] ?? null;
  }
  if (text.startsWith("P5_BROWSER_TIMEOUT")) {
    return [
      { name: "yume_playwright_browser_navigate", input: { url } },
      { name: "yume_playwright_browser_wait_for", input: { text: `never-${marker}` } },
    ][count] ?? null;
  }
  if (text.startsWith("P5_BROWSER_STOP")) {
    return count === 0 ? { name: "yume_playwright_browser_navigate", input: { url } } : null;
  }
  return null;
}

function windowsCall(text: string, results: readonly JsonObject[]): ToolCall | null {
  const count = results.length;
  const file = token(text, "file");
  const cwd = token(text, "cwd");
  const marker = token(text, "marker");
  const shot = token(text, "shot");
  const directLaunch = process.env.YUME_P5_WINDOWS_DIRECT_LAUNCH === "1";
  const launch = directLaunch
    ? { name: "yume_windows_app", input: { programPath: "C:\\Windows\\System32\\notepad.exe", arguments: `"${file}"`, workingDirectory: cwd, waitForWindow: true, timeoutMs: 10_000 } }
    : { name: "yume_windows_app", input: { programPath: "C:\\Windows\\System32\\runas.exe", arguments: `/trustlevel:0x20000 "C:\\Windows\\System32\\notepad.exe ${file}"`, workingDirectory: cwd, waitForWindow: false, timeoutMs: 10_000 } };
  const filename = file.split(/[\\/]/).at(-1) ?? "Notepad";
  const findWindow = { name: "yume_windows_window_management", input: { action: "wait_for", title: filename.replace(/\.txt$/i, ""), timeoutMs: 10_000 } };
  const handle = count < 2 ? null : windowHandle(results);
  const snapshot = handle === null ? null : { name: "yume_windows_ui_snapshot", input: { windowHandle: handle, mode: "full", maxDepth: 10 } };
  const typeMarker = handle === null ? null : { name: "yume_windows_ui_type", input: { windowHandle: handle, text: marker, controlType: "Document", clearFirst: true, requireUnique: true, inputMode: "auto", withSnapshot: true } };
  const save = handle === null ? null : { name: "yume_windows_keyboard_control", input: { windowHandle: handle, action: "press", key: "s", modifiers: "ctrl" } };
  const read = handle === null ? null : { name: "yume_windows_ui_read", input: { windowHandle: handle, controlType: "Document", includeChildren: true } };
  const screenshot = handle === null ? null : { name: "yume_windows_screenshot_control", input: { action: "capture", target: "window", windowHandle: handle, outputMode: "file", outputPath: shot, imageFormat: "png", includeImage: false, annotate: true } };
  if (text.startsWith("P5_WINDOWS_SUCCESS")) {
    if (count === 0) return launch;
    if (count === 1) return findWindow;
    if (count === 2) return snapshot;
    if (count === 3) return typeMarker;
    if (count === 4) return save;
    if (count === 5) return read;
    if (count === 6) return screenshot;
    return null;
  }
  if (text.startsWith("P5_WINDOWS_REJECT")) return count === 0 ? launch : null;
  if (text.startsWith("P5_WINDOWS_DISAPPEAR")) {
    if (count === 0) return launch;
    if (count === 1) return findWindow;
    if (count === 2) return snapshot;
    if (count === 3) return read;
    return null;
  }
  if (text.startsWith("P5_WINDOWS_SAVE_FAILURE")) {
    if (count === 0) return launch;
    if (count === 1) return findWindow;
    if (count === 2) return snapshot;
    if (count === 3) return typeMarker;
    if (count === 4) return save;
    if (count === 5) return snapshot;
    if (count === 6) return screenshot;
    return null;
  }
  if (text.startsWith("P5_WINDOWS_STOP")) {
    if (count === 0) return launch;
    if (count === 1) return findWindow;
    if (count === 2) return snapshot;
    if (count === 3 && handle !== null) return { name: "yume_windows_ui_wait", input: { windowHandle: handle, mode: "appear", name: `never-${marker}`, timeoutMs: 120_000 } };
    return null;
  }
  return null;
}

function chunks(body: JsonObject): readonly JsonObject[] {
  const text = userText(body);
  const results = toolResults(body);
  const count = results.length;
  const selected = text.startsWith("P5_BROWSER_")
    ? browserCall(text, count)
    : text.startsWith("P5_WINDOWS_") ? windowsCall(text, results) : null;
  const delta: JsonObject = selected === null
    ? { role: "assistant", content: `P5_MCP_COMPLETE:${text.split(" ")[0] ?? "unknown"}` }
    : { role: "assistant", tool_calls: [{ index: 0, id: `call_p5_${count}_${crypto.randomUUID().slice(0, 8)}`, type: "function", function: { name: selected.name, arguments: JSON.stringify(selected.input) } }] };
  const base = { id: `chatcmpl-p5-${count}`, object: "chat.completion.chunk", created: 1, model: "model-a" };
  return [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: selected === null ? "stop" : "tool_calls" }] },
  ];
}

export async function startP5McpProvider(): Promise<Provider> {
  const requests: JsonObject[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url?.endsWith("/models")) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ object: "list", data: [{ id: "model-a", object: "model", owned_by: "agent-qa" }] }));
        return;
      }
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
      const body = jsonObject(JSON.parse(Buffer.concat(parts).toString("utf8")), "P5 provider request");
      requests.push(body);
      const responseChunks = chunks(body);
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      for (const chunk of responseChunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      console.error("P5 provider response error", error instanceof Error ? error.message : String(error));
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("P5 provider address unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    port: address.port,
    requests,
    close: () => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}
