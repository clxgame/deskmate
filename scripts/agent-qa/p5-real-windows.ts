import { strict as assert } from "node:assert";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { messages, replyPermission, request, type Client } from "./client";
import type { Provider } from "./provider";
import { startRuntime, type Runtime } from "./runtime";
import { ContractError, isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

const modelId = "gpt-6-luna";
const allowedTools = ["app", "window_management", "ui_snapshot", "ui_type", "keyboard_control", "ui_read", "screenshot_control"] as const;
const apiKey = process.env.YUME_P5_LIVE_KEY;
delete process.env.YUME_P5_LIVE_KEY;
if (!apiKey) throw new ContractError("MISSING_CREDENTIAL", "YUME_P5_LIVE_KEY is required");

function toolParts(snapshot: readonly JsonObject[]): JsonObject[] {
  return snapshot.flatMap((item) => Array.isArray(item.parts) ? item.parts.filter(isJsonObject) : [])
    .filter((part) => part.type === "tool");
}

function toolStatus(part: JsonObject): string {
  return isJsonObject(part.state) && typeof part.state.status === "string" ? part.state.status : "unknown";
}

function windowIdentity(parts: readonly JsonObject[]): { readonly pid: number; readonly handle: string } | null {
  for (const part of parts) {
    if (part.tool !== "yume_windows_app" || toolStatus(part) !== "completed" || !isJsonObject(part.state) || typeof part.state.output !== "string") continue;
    try {
      const output = JSON.parse(part.state.output);
      if (isJsonObject(output) && isJsonObject(output.window) && Number.isSafeInteger(output.window.pid) && typeof output.window.handle === "string") {
        return { pid: Number(output.window.pid), handle: output.window.handle };
      }
    } catch { continue; }
  }
  return null;
}

function permitted(item: JsonObject, parts: readonly JsonObject[], file: string, shot: string, marker: string): boolean {
  const name = item.permission;
  if (typeof name !== "string" || !allowedTools.some((tool) => name === `yume_windows_${tool}`)) return false;
  const part = parts.findLast((candidate) => candidate.tool === name && ["pending", "running"].includes(toolStatus(candidate)));
  if (part === undefined || !isJsonObject(part.state) || !isJsonObject(part.state.input)) return false;
  const input = part.state.input;
  const identity = windowIdentity(parts);
  if (name === "yume_windows_app") {
    return input.programPath === "C:\\Windows\\System32\\notepad.exe"
      && (input.arguments === `"${file}"` || input.arguments === file)
      && input.workingDirectory === dirname(file) && input.waitForWindow === true;
  }
  if (name === "yume_windows_window_management") return input.action === "wait_for" && input.title === basename(file, ".txt");
  if (identity === null || input.windowHandle !== identity.handle) return false;
  if (name === "yume_windows_ui_type") return input.text === marker && input.controlType === "Document";
  if (name === "yume_windows_keyboard_control") return input.action === "press" && input.key === "s" && input.modifiers === "ctrl";
  if (name === "yume_windows_screenshot_control") return (input.action === "capture" || input.action === undefined) && input.target === "window" && input.outputMode === "file" && input.outputPath === shot;
  return true;
}

async function terminateOwnedNotepad(pid: number | null): Promise<boolean> {
  if (pid === null || !Number.isSafeInteger(pid) || pid <= 0) return true;
  try { process.kill(pid); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await Bun.sleep(100);
  }
  return false;
}

async function run(): Promise<void> {
  const directory = resolve("artifacts", "opencode-native", "p5-live-2026-09-23");
  await mkdir(directory, { recursive: true });
  const marker = `YUME-P5-LIVE-WINDOWS-${crypto.randomUUID()}`;
  const file = resolve(directory, `notepad-${crypto.randomUUID()}.txt`);
  const shot = resolve(directory, `notepad-${crypto.randomUUID()}.png`);
  await writeFile(file, "");
  const executable = resolve("src-tauri", "resources", "windows-mcp", "1.3.24", "Sbroenne.WindowsMcp.exe");
  await access(executable);
  const provider: Provider = { baseUrl: "https://ai-gateway.kurogames.com/v1", port: 0, requests: [], close: async () => {} };
  const mcp = { yume_windows: { type: "local", command: [executable, "--tools", allowedTools.join(",")], enabled: true, timeout: 120_000 } } satisfies JsonObject;
  const extraPermission = Object.fromEntries(allowedTools.map((tool) => [`yume_windows_${tool}`, "ask"]));
  let runtime: Runtime | undefined;
  let pid: number | null = null;
  let evidence: JsonObject = { marker, file, shot };
  let cleanup: JsonObject = {};
  let notepadGone = false;
  try {
    runtime = await startRuntime({ providerFactory: async () => provider, authenticatedModel: { id: modelId, apiKey }, includeTrusted: false, mcp, extraPermission });
    const client: Client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
    const created = jsonObject(await request(client, "/session", { method: "POST", body: { title: "P5 real model Windows Notepad" } }), "session");
    const sessionId = stringField(created, "id");
    const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
    const prompt = `Use only yume_windows tools. This is an isolated local Notepad test. Launch C:\\Windows\\System32\\notepad.exe with arguments "${file}", workingDirectory "${dirname(file)}", waitForWindow true. Wait for the window with title ${basename(file, ".txt")}. Inspect its UI. Type exactly ${marker} into the Document control of that window (clearFirst true). Press Ctrl+S in the same window. Read the Document text to verify the marker. Capture that window screenshot as PNG to ${shot} with outputMode file. Do not touch any other window, file, or application. Report the observed readback.`;
    await request(client, `/session/${sessionId}/prompt_async`, { method: "POST", body: { messageID: messageId, model: { providerID: "yume", modelID: modelId }, parts: [{ type: "text", text: prompt }] } });
    const approvals: JsonObject[] = [];
    let snapshot: readonly JsonObject[] = [];
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      snapshot = await messages(client, sessionId);
      const parts = toolParts(snapshot);
      pid = windowIdentity(parts)?.pid ?? pid;
      const pending = await request(client, "/permission");
      if (!Array.isArray(pending)) throw new ContractError("INVALID_WIRE", "permission list unavailable");
      for (const item of pending.filter(isJsonObject).filter((value) => value.sessionID === sessionId)) {
        const id = stringField(item, "id");
        const permission = stringField(item, "permission");
        const reply = permitted(item, parts, file, shot, marker) ? "once" : "reject";
        approvals.push({ id, permission, reply, ...(reply === "reject" ? { identity: windowIdentity(parts), pendingInput: parts.findLast((part) => part.tool === permission)?.state, observedTools: parts.map((part) => ({ tool: part.tool, status: toolStatus(part) })) } : {}) });
        await replyPermission(client, id, reply);
      }
      const statuses = jsonObject(await request(client, "/session/status"), "statuses");
      const status = statuses[sessionId];
      const idle = !isJsonObject(status) || status.type === "idle";
      const terminal = snapshot.some((item) => isJsonObject(item.info) && item.info.role === "assistant" && isJsonObject(item.info.time) && typeof item.info.time.completed === "number");
      if (idle && terminal) break;
      await Bun.sleep(150);
    }
    snapshot = await messages(client, sessionId);
    const parts = toolParts(snapshot);
    pid = windowIdentity(parts)?.pid ?? pid;
    const tools = parts.map((part) => ({ callId: part.callID ?? null, tool: part.tool ?? null, status: toolStatus(part), input: isJsonObject(part.state) ? part.state.input ?? null : null, output: isJsonObject(part.state) && typeof part.state.output === "string" ? part.state.output.slice(0, 3_000) : null, error: isJsonObject(part.state) && typeof part.state.error === "string" ? part.state.error.slice(0, 3_000) : null }));
    const mcpStatus = await request(client, "/mcp");
    evidence = { gateway: "ai-gateway.kurogames.com", modelId, marker, file, shot, sessionId, messageId, approvals, tools, mcpStatus, pid,
      readbackInNativeTool: parts.some((part) => part.tool === "yume_windows_ui_read" && toolStatus(part) === "completed" && isJsonObject(part.state) && typeof part.state.output === "string" && part.state.output.includes(marker)) };
    assert.equal(approvals.some((item) => item.reply === "reject"), false);
    for (const tool of allowedTools) assert.ok(parts.some((part) => part.tool === `yume_windows_${tool}` && toolStatus(part) === "completed"), `missing completed ${tool}`);
    assert.equal(evidence.readbackInNativeTool, true);
    assert.equal(await readFile(file, "utf8"), marker);
    await access(shot);
  } finally {
    let cleanupError: unknown;
    try {
      notepadGone = await terminateOwnedNotepad(pid);
      if (runtime !== undefined) {
        await runtime.stopSidecar();
        cleanup = await runtime.close();
      }
    } catch (error) { cleanupError = error; }
    finally {
      await writeFile(resolve(directory, "windows-real-model.json"), `${JSON.stringify({ ...evidence, cleanup, notepadGone, cleanupError: cleanupError instanceof Error ? cleanupError.name : null }, null, 2)}\n`);
    }
    if (cleanupError !== undefined) throw cleanupError;
  }
  assert.equal(notepadGone, true);
  assert.ok(Object.values(cleanup).every(Boolean));
  console.log("PASS P5 real-model Windows Notepad selection and readback");
}

await run().catch((error: unknown) => {
  console.error("P5 real-model Windows failed", error instanceof Error ? error.message.replaceAll(apiKey, "[redacted]") : "unknown");
  process.exitCode = 1;
});
