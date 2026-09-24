import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import type { Socket } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { messages, prompt, replyPermission, request, type Client } from "./client";
import { startP5McpProvider } from "./p5-mcp-provider";
import { startRuntime } from "./runtime";
import { isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

type Scenario = "success" | "reject" | "missing" | "timeout" | "stop";
type PermissionReceipt = { readonly id: string; readonly permission: string; readonly reply: "once" | "reject" };

const playwrightTools = ["browser_navigate", "browser_snapshot", "browser_fill_form", "browser_click", "browser_wait_for", "browser_close"] as const;

function required(name: string): string {
  const path = Bun.which(name);
  if (path === null) throw new Error(`${name} is required for P5 browser QA`);
  return path;
}

async function startFixture(): Promise<{ readonly baseUrl: string; readonly submissions: readonly string[]; readonly close: () => Promise<void> }> {
  const submissions: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/submit") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
      submissions.push(body.get("marker") ?? "");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ marker: submissions.at(-1) }));
      return;
    }
    if (request.url === "/hang") return;
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><html><head><title>Yume P5 Browser Fixture</title></head><body><h1>P5 Browser Fixture</h1><form id="form"><label>Unique marker <input id="marker" name="marker"></label><button id="submit" type="submit">Submit marker</button></form><output id="result"></output><script>document.querySelector('#form').addEventListener('submit',async(event)=>{event.preventDefault();const marker=document.querySelector('#marker').value;const response=await fetch('/submit',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({marker})});const data=await response.json();document.querySelector('#result').textContent='Saved '+data.marker;});</script></body></html>`);
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("browser fixture address unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    submissions,
    close: () => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}

function toolParts(snapshot: readonly JsonObject[]): JsonObject[] {
  return snapshot.flatMap((item) => Array.isArray(item.parts) ? item.parts.filter(isJsonObject) : []).filter((part) => part.type === "tool");
}

function statusName(part: JsonObject): string {
  return isJsonObject(part.state) && typeof part.state.status === "string" ? part.state.status : "unknown";
}

function statusFor(statuses: JsonObject, sessionId: string): string {
  const status = statuses[sessionId];
  return isJsonObject(status) && typeof status.type === "string" ? status.type : "idle";
}

async function pending(client: Client, sessionId: string): Promise<JsonObject | undefined> {
  const value = await request(client, "/permission");
  assert.ok(Array.isArray(value));
  return value.filter(isJsonObject).find((item) => item.sessionID === sessionId);
}

async function runScenario(client: Client, scenario: Scenario, url: string, marker: string): Promise<JsonObject> {
  const created = jsonObject(await request(client, "/session", { method: "POST", body: { title: `P5 browser ${scenario}` } }), "session");
  const sessionId = stringField(created, "id");
  const permissions: PermissionReceipt[] = [];
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, `P5_BROWSER_${scenario.toUpperCase()} url=${encodeURIComponent(url)} marker=${encodeURIComponent(marker)}`);
  const deadline = Date.now() + 90_000;
  let aborted = false;
  let snapshot: readonly JsonObject[] = [];
  while (Date.now() < deadline) {
    snapshot = await messages(client, sessionId);
    const parts = toolParts(snapshot);
    const permission = await pending(client, sessionId);
    if (permission !== undefined) {
      const id = stringField(permission, "id");
      const name = stringField(permission, "permission");
      const reply = scenario === "reject" && permissions.length === 0 ? "reject" : "once";
      permissions.push({ id, permission: name, reply });
      await replyPermission(client, id, reply);
    }
    if (scenario === "stop" && !aborted && parts.some((part) => statusName(part) === "running" || statusName(part) === "pending")) {
      await request(client, `/session/${sessionId}/abort`, { method: "POST" });
      aborted = true;
    }
    const statuses = jsonObject(await request(client, "/session/status"), "statuses");
    const idle = statusFor(statuses, sessionId) === "idle";
    const completed = snapshot.some((item) => isJsonObject(item.info) && item.info.role === "assistant" && isJsonObject(item.info.time) && typeof item.info.time.completed === "number");
    if (idle && (completed || aborted)) break;
    await Bun.sleep(100);
  }
  const statuses = jsonObject(await request(client, "/session/status"), "statuses");
  assert.equal(statusFor(statuses, sessionId), "idle");
  const parts = toolParts(snapshot);
  const compactParts = parts.map((part) => ({
    callId: typeof part.callID === "string" ? part.callID : null,
    tool: typeof part.tool === "string" ? part.tool : null,
    status: statusName(part),
    state: part.state,
  }));
  if (scenario === "success") {
    assert.equal(url.endsWith("/hang"), false);
    assert.ok(parts.length >= 7);
    assert.ok(parts.every((part) => statusName(part) === "completed"));
  } else if (scenario === "reject") {
    assert.equal(permissions[0]?.reply, "reject");
  } else if (scenario === "stop") {
    assert.equal(aborted, true);
    assert.ok(parts.length >= 1);
  } else {
    assert.ok(parts.some((part) => statusName(part) === "error"), `${scenario} must produce a native tool error`);
  }
  return { scenario, sessionId, permissions, tools: compactParts, aborted, status: "idle" };
}

const fixture = await startFixture();
const npx = required("npx.cmd");
const mcp = {
  yume_playwright: {
    type: "local",
    command: [npx, "--yes", "@playwright/mcp@0.0.82", "--browser", "msedge", "--isolated", "--headless", "--timeout-action", "5000", "--timeout-navigation", "15000"],
    enabled: true,
    timeout: 30_000,
  },
} satisfies JsonObject;
const extraPermission = Object.fromEntries(playwrightTools.map((tool) => [`yume_playwright_${tool}`, "ask"]));
const runtime = await startRuntime({ providerFactory: startP5McpProvider, includeTrusted: false, continueLoopOnDeny: true, mcp, extraPermission });
let cleanup: JsonObject = {};
let evidence: JsonObject = {};
try {
  const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
  const marker = `YUME-P5-${crypto.randomUUID()}`;
  const success = await runScenario(client, "success", `${fixture.baseUrl}/`, marker);
  assert.deepEqual(fixture.submissions, [marker]);
  const reject = await runScenario(client, "reject", `${fixture.baseUrl}/`, `${marker}-reject`);
  const missing = await runScenario(client, "missing", `${fixture.baseUrl}/`, `${marker}-missing`);
  const timeout = await runScenario(client, "timeout", `${fixture.baseUrl}/`, `${marker}-timeout`);
  const stop = await runScenario(client, "stop", `${fixture.baseUrl}/hang`, `${marker}-stop`);
  assert.deepEqual(fixture.submissions, [marker]);
  evidence = {
    versions: { opencode: "1.18.21", playwrightMcp: "0.0.82" },
    marker,
    fixtureUrl: fixture.baseUrl,
    submissions: fixture.submissions,
    scenarios: [success, reject, missing, timeout, stop],
    providerRequestCount: runtime.provider.requests.length,
  };
} finally {
  cleanup = await runtime.close();
  await fixture.close();
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const directory = resolve("artifacts", "opencode-native", `p5-${stamp}-browser-e2e`);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "browser-e2e.json");
  await writeFile(path, `${JSON.stringify({ ...evidence, cleanup }, null, 2)}\n`);
  console.log(`evidence=${path}`);
}
assert.ok(Object.values(cleanup).every(Boolean));
console.log("PASS P5 browser MCP success, rejection, missing element, timeout, and stop");
