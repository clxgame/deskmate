import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { messages, replyPermission, request, type Client } from "./client";
import type { Provider } from "./provider";
import { startRuntime, type Runtime } from "./runtime";
import { ContractError, isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

const modelId = "gpt-6-luna";
const allowedTools = ["browser_navigate", "browser_snapshot", "browser_fill_form", "browser_click", "browser_wait_for", "browser_close"] as const;
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

async function startFixture(): Promise<{ readonly url: string; readonly submissions: readonly string[]; readonly close: () => Promise<void> }> {
  const submissions: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (incoming, outgoing) => {
    if (incoming.method === "POST" && incoming.url === "/submit") {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const marker = new URLSearchParams(Buffer.concat(chunks).toString("utf8")).get("marker") ?? "";
      submissions.push(marker);
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify({ marker }));
      return;
    }
    outgoing.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    outgoing.end('<!doctype html><title>Yume P5 Live Browser Fixture</title><h1>P5 Browser Fixture</h1><form id="form"><label>Unique marker <input id="marker" name="marker"></label><button id="submit">Submit marker</button></form><output id="result"></output><script>document.querySelector("#form").addEventListener("submit",async(event)=>{event.preventDefault();const marker=document.querySelector("#marker").value;const response=await fetch("/submit",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({marker})});document.querySelector("#result").textContent="Saved "+(await response.json()).marker;});</script>');
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new ContractError("FIXTURE_START", "browser fixture address unavailable");
  return {
    url: `http://127.0.0.1:${address.port}/`,
    submissions,
    close: () => new Promise<void>((resolveClose) => { for (const socket of sockets) socket.destroy(); server.close(() => resolveClose()); }),
  };
}

function allowedPermission(permission: JsonObject, parts: readonly JsonObject[], url: string, marker: string): boolean {
  const name = permission.permission;
  if (typeof name !== "string" || !allowedTools.some((tool) => name === `yume_playwright_${tool}`)) return false;
  const part = parts.findLast((item) => item.tool === name && ["pending", "running"].includes(toolStatus(item)));
  if (part === undefined || !isJsonObject(part.state) || !isJsonObject(part.state.input)) return false;
  const input = part.state.input;
  if (name === "yume_playwright_browser_navigate") return input.url === url;
  if (name === "yume_playwright_browser_fill_form") return JSON.stringify(input).includes(marker);
  return true;
}

async function run(): Promise<void> {
  const fixture = await startFixture();
  const npx = Bun.which("npx.cmd");
  if (npx === null) throw new ContractError("MISSING_BINARY", "npx.cmd is required");
  const provider: Provider = { baseUrl: "https://ai-gateway.kurogames.com/v1", port: 0, requests: [], close: async () => {} };
  const mcp = {
    yume_playwright: {
      type: "local", command: [npx, "--yes", "@playwright/mcp@0.0.82", "--browser", "msedge", "--isolated", "--headless"],
      enabled: true, timeout: 60_000,
    },
  } satisfies JsonObject;
  const extraPermission = Object.fromEntries(allowedTools.map((tool) => [`yume_playwright_${tool}`, "ask"]));
  let runtime: Runtime | undefined;
  let evidence: JsonObject = {};
  let cleanup: JsonObject = {};
  try {
    runtime = await startRuntime({ providerFactory: async () => provider, authenticatedModel: { id: modelId, apiKey }, includeTrusted: false, mcp, extraPermission });
    const client: Client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
    const marker = `YUME-P5-LIVE-BROWSER-${crypto.randomUUID()}`;
    const created = jsonObject(await request(client, "/session", { method: "POST", body: { title: "P5 real model browser" } }), "session");
    const sessionId = stringField(created, "id");
    const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
    const prompt = `Use only the yume_playwright browser tools. Open ${fixture.url}, inspect the page, fill the Unique marker field with ${marker}, click Submit marker, then inspect the page and confirm it says Saved ${marker}. This is a local test page. Do not visit any other URL.`;
    await request(client, `/session/${sessionId}/prompt_async`, { method: "POST", body: { messageID: messageId, model: { providerID: "yume", modelID: modelId }, parts: [{ type: "text", text: prompt }] } });
    const approvals: JsonObject[] = [];
    let snapshot: readonly JsonObject[] = [];
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      snapshot = await messages(client, sessionId);
      const parts = toolParts(snapshot);
      const pending = await request(client, "/permission");
      if (!Array.isArray(pending)) throw new ContractError("INVALID_WIRE", "permission list unavailable");
      for (const item of pending.filter(isJsonObject).filter((value) => value.sessionID === sessionId)) {
        const id = stringField(item, "id");
        const permission = stringField(item, "permission");
        const reply = allowedPermission(item, parts, fixture.url, marker) ? "once" : "reject";
        approvals.push({ id, permission, reply });
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
    const toolEvidence = parts.map((part) => ({ callId: part.callID ?? null, tool: part.tool ?? null, status: toolStatus(part) }));
    const assistants = snapshot.filter((item) => isJsonObject(item.info) && item.info.role === "assistant").map((item) => ({
      error: isJsonObject(item.info) ? JSON.stringify(item.info.error ?? null).replaceAll(apiKey, "[redacted]").slice(0, 2_000) : null,
      text: Array.isArray(item.parts) ? item.parts.filter(isJsonObject).filter((part) => part.type === "text").map((part) => String(part.text ?? "").slice(0, 2_000)) : [],
    }));
    const mcpStatus = await request(client, "/mcp");
    evidence = { gateway: "ai-gateway.kurogames.com", modelId, sessionId, messageId, marker, fixtureUrl: fixture.url, approvals, tools: toolEvidence, assistants, mcpStatus, submissions: [...fixture.submissions], savedInSnapshot: parts.some((part) => part.tool === "yume_playwright_browser_snapshot" && isJsonObject(part.state) && typeof part.state.output === "string" && part.state.output.includes(`Saved ${marker}`)) };
    assert.deepEqual(fixture.submissions, [marker]);
    assert.equal(approvals.some((item) => item.reply === "reject"), false);
    assert.equal(parts.some((part) => part.tool === "yume_playwright_browser_navigate" && toolStatus(part) === "completed"), true);
    assert.equal(parts.some((part) => part.tool === "yume_playwright_browser_fill_form" && toolStatus(part) === "completed"), true);
    assert.equal(parts.some((part) => part.tool === "yume_playwright_browser_click" && toolStatus(part) === "completed"), true);
    assert.equal(evidence.savedInSnapshot, true);
  } finally {
    let cleanupError: unknown;
    try {
      if (runtime !== undefined) {
        await runtime.stopSidecar();
        cleanup = await runtime.close();
      }
    } catch (error) {
      cleanupError = error;
    } finally {
      await fixture.close();
      const directory = resolve("artifacts", "opencode-native", "p5-live-2026-09-23");
      await mkdir(directory, { recursive: true });
      await writeFile(resolve(directory, "browser-real-model.json"), `${JSON.stringify({ ...evidence, cleanup, cleanupError: cleanupError instanceof Error ? cleanupError.name : null }, null, 2)}\n`);
    }
    if (cleanupError !== undefined) throw cleanupError;
  }
  assert.ok(Object.values(cleanup).every(Boolean));
  console.log("PASS P5 real-model browser selection and local readback");
}

await run().catch((error: unknown) => {
  console.error("P5 real-model browser failed", error instanceof Error ? error.message.replaceAll(apiKey, "[redacted]") : "unknown");
  process.exitCode = 1;
});
