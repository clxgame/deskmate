import { strict as assert } from "node:assert";
import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { messages, prompt, request } from "./client";
import { startRuntime } from "./runtime";
import { startLifecycleProvider } from "./tool-lifecycle-provider";
import { isJsonObject, jsonObject, type JsonObject } from "./types";

const playwrightTools = [
  "browser_navigate",
  "browser_snapshot",
  "browser_fill_form",
  "browser_click",
  "browser_wait_for",
  "browser_close",
] as const;
const windowsTools = ["app", "window_management", "ui_snapshot", "ui_find", "ui_click", "ui_type", "ui_read", "ui_wait", "screenshot_control", "keyboard_control"] as const;

function required(name: string): string {
  const path = Bun.which(name);
  if (path === null) throw new Error(`${name} is required for P5 MCP QA`);
  return path;
}

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 90_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await Bun.sleep(100);
  }
  throw new Error("P5 MCP inventory deadline expired");
}

function namesFromProviderRequest(body: JsonObject): string[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => {
    if (!isJsonObject(tool)) return [];
    const fn = tool.function;
    return isJsonObject(fn) && typeof fn.name === "string" ? [fn.name] : [];
  });
}

function selectedSchemas(body: JsonObject, selected: readonly string[]): JsonObject {
  if (!Array.isArray(body.tools)) return {};
  return Object.fromEntries(body.tools.flatMap((tool) => {
    if (!isJsonObject(tool) || !isJsonObject(tool.function)) return [];
    const name = tool.function.name;
    if (typeof name !== "string" || !selected.includes(name)) return [];
    return [[name, isJsonObject(tool.function.parameters) ? tool.function.parameters : {}]];
  }));
}

const npx = required("npx.cmd");
const windowsMcp = resolve("src-tauri/resources/windows-mcp/1.3.24/Sbroenne.WindowsMcp.exe");
await access(windowsMcp);
const extraPermission = Object.fromEntries([
  ...playwrightTools.map((tool) => [`yume_playwright_${tool}`, "ask"]),
  ...windowsTools.map((tool) => [`yume_windows_${tool}`, "ask"]),
]);
const mcp = {
  yume_playwright: {
    type: "local",
    command: [npx, "--yes", "@playwright/mcp@0.0.82", "--browser", "msedge", "--isolated", "--headless"],
    enabled: true,
    timeout: 60_000,
  },
  yume_windows: {
    type: "local",
    command: [windowsMcp, "--tools", windowsTools.join(",")],
    enabled: true,
    timeout: 60_000,
  },
} satisfies JsonObject;

const runtime = await startRuntime({
  providerFactory: startLifecycleProvider,
  includeTrusted: false,
  continueLoopOnDeny: true,
  mcp,
  extraPermission,
});
let cleanup: JsonObject = {};
let evidence: JsonObject = {};
const sidecarLog: string[] = [];
for (const stream of [runtime.child.stdout, runtime.child.stderr]) {
  stream.on("data", (chunk: Buffer | string) => {
    sidecarLog.push(String(chunk));
    if (sidecarLog.join("").length > 40_000) sidecarLog.shift();
  });
}
try {
  const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
  const statuses = await until(
    async () => {
      try {
        return jsonObject(await request(client, "/mcp", {timeoutMs: 5_000}), "mcp statuses");
      } catch {
        return {};
      }
    },
    (value) => ["yume_playwright", "yume_windows"].every((name) => isJsonObject(value[name]) && value[name].status === "connected"),
    150_000,
  );
  const created = jsonObject(await request(client, "/session", {method: "POST", body: {title: "P5 MCP inventory"}}), "session");
  assert.equal(typeof created.id, "string");
  const sessionId = created.id as string;
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "normal-chat");
  await until(() => messages(client, sessionId), (items) => items.some((item) => {
    const info = item.info;
    return isJsonObject(info) && info.role === "assistant" && isJsonObject(info.time) && typeof info.time.completed === "number";
  }));
  const providerRequest = runtime.provider.requests.at(-1);
  assert.ok(providerRequest !== undefined);
  const names = namesFromProviderRequest(providerRequest);
  const expected = [
    ...playwrightTools.map((tool) => `yume_playwright_${tool}`),
    ...windowsTools.map((tool) => `yume_windows_${tool}`),
  ];
  const schemas = selectedSchemas(providerRequest, expected);
  evidence = {observedProviderTools: names, expectedProviderTools: expected, selectedToolSchemas: schemas, statuses, sessionId};
  assert.ok(expected.every((name) => names.includes(name)));
  assert.ok(!names.includes("yume_windows_process"));
  assert.ok(!names.includes("yume_windows_clipboard"));
  assert.ok(!names.includes("yume_windows_file_open"));
  evidence = {
    versions: {
      opencode: "1.18.21",
      playwrightMcp: "0.0.82",
      windowsMcp: "1.3.24",
    },
    commands: {
      playwright: [npx, "@playwright/mcp@0.0.82"],
      windows: [windowsMcp, "--tools", windowsTools.join(",")],
    },
    statuses,
    sessionId,
    providerToolCount: names.length,
    approvedToolsPresent: expected,
    selectedToolSchemas: schemas,
    dangerousWindowsToolsAbsent: ["process", "clipboard", "mouse_control", "file_open", "file_save"].every((tool) => !names.includes(`yume_windows_${tool}`)),
  };
} finally {
  cleanup = await runtime.close();
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const directory = resolve("artifacts", "opencode-native", `p5-${stamp}-mcp-inventory`);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "mcp-inventory.json");
  await writeFile(path, `${JSON.stringify({...evidence, cleanup}, null, 2)}\n`);
  await writeFile(resolve(directory, "sidecar.log"), sidecarLog.join(""));
  console.log(`evidence=${path}`);
}

assert.ok(Object.values(cleanup).every(Boolean));
console.log("PASS P5 pinned MCP inventory and minimal tool exposure");
