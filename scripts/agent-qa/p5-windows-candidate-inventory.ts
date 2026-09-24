import { strict as assert } from "node:assert";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { messages, prompt, request } from "./client";
import { startRuntime } from "./runtime";
import { startLifecycleProvider } from "./tool-lifecycle-provider";
import { isJsonObject, jsonObject, type JsonObject } from "./types";

const tools = ["app", "window_management", "ui_snapshot", "ui_find", "ui_click", "ui_type", "ui_read", "ui_wait", "screenshot_control", "keyboard_control"] as const;

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await Bun.sleep(100);
  }
  throw new Error("Windows MCP candidate inventory deadline expired");
}

const executable = resolve(process.argv[2] ?? ".tmp/sbroenne-windows-mcp-1.3.24/expanded/Sbroenne.WindowsMcp.exe");
await access(executable);
const mcp = {
  yume_windows: { type: "local", command: [executable, "--tools", tools.join(",")], enabled: true, timeout: 30_000 },
} satisfies JsonObject;
const extraPermission = Object.fromEntries(tools.map((tool) => [`yume_windows_${tool}`, "ask"]));
const runtime = await startRuntime({ providerFactory: startLifecycleProvider, includeTrusted: false, continueLoopOnDeny: true, mcp, extraPermission });
let cleanup: JsonObject = {};
let evidence: JsonObject = {};
const sidecarLog: string[] = [];
for (const stream of [runtime.child.stdout, runtime.child.stderr]) stream.on("data", (chunk: Buffer | string) => sidecarLog.push(String(chunk)));
try {
  const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
  const statuses = await until(
    async () => {
      try { return jsonObject(await request(client, "/mcp", { timeoutMs: 5_000 }), "mcp statuses"); }
      catch { return {}; }
    },
    (value) => isJsonObject(value.yume_windows) && value.yume_windows.status === "connected",
  );
  const created = jsonObject(await request(client, "/session", { method: "POST", body: { title: "P5 Windows candidate inventory" } }), "session");
  assert.equal(typeof created.id, "string");
  const sessionId = created.id as string;
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "normal-chat");
  await until(() => messages(client, sessionId), (items) => items.some((item) => isJsonObject(item.info) && item.info.role === "assistant" && isJsonObject(item.info.time) && typeof item.info.time.completed === "number"));
  const providerRequest = runtime.provider.requests.at(-1);
  assert.ok(providerRequest !== undefined && Array.isArray(providerRequest.tools));
  const available = providerRequest.tools.filter(isJsonObject).flatMap((tool) => {
    const fn = tool.function;
    return isJsonObject(fn) && typeof fn.name === "string" ? [{ name: fn.name, parameters: fn.parameters }] : [];
  });
  const expected = tools.map((tool) => `yume_windows_${tool}`);
  assert.ok(expected.every((name) => available.some((tool) => tool.name === name)));
  evidence = {
    selected: { repo: "sbroenne/mcp-windows", version: "1.3.24", commit: "b90485c3d1a228fc4f5341bc2bdfc7be7672c6d0", license: "MIT" },
    executable,
    statuses,
    sessionId,
    expectedTools: expected,
    selectedToolSchemas: Object.fromEntries(available.filter((tool) => expected.includes(tool.name)).map((tool) => [tool.name, tool.parameters])),
    dangerousToolsAbsent: ["process", "clipboard", "mouse_control", "file_open", "file_save"].every((tool) => !available.some((item) => item.name === `yume_windows_${tool}`)),
  };
} finally {
  cleanup = await runtime.close();
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const directory = resolve("artifacts", "opencode-native", `p5-${stamp}-windows-candidate`);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "windows-candidate.json");
  await writeFile(path, `${JSON.stringify({ ...evidence, cleanup }, null, 2)}\n`);
  await writeFile(resolve(directory, "sidecar.log"), sidecarLog.join(""));
  console.log(`evidence=${path}`);
}
assert.ok(Object.values(cleanup).every(Boolean));
console.log("PASS P5 replacement Windows MCP inventory");
