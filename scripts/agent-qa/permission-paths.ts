import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startRuntime, type Runtime } from "./runtime";
import { check, ContractError, isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

type Encoding = "query" | "header";
type Scope = { readonly directory: string; readonly encoding: Encoding };
type Action = "read" | "edit" | "write";

async function scopedRequest(baseUrl: string, path: string, scope: Scope, method = "GET", body?: JsonObject): Promise<unknown> {
  const target = new URL(path, baseUrl);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (scope.encoding === "query") target.searchParams.set("directory", scope.directory);
  else headers["x-opencode-directory"] = encodeURIComponent(scope.directory);
  const response = await fetch(target, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new ContractError("HTTP_FAILURE", `${method} ${path} (${scope.encoding}) -> ${response.status}`);
  return response.status === 204 ? null : response.json();
}

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", label);
}

function pending(value: unknown, sessionId: string): JsonObject | undefined {
  return Array.isArray(value) ? value.find((item): item is JsonObject => isJsonObject(item) && item.sessionID === sessionId) : undefined;
}

function toolParts(snapshot: readonly JsonObject[]): readonly JsonObject[] {
  return snapshot.flatMap((envelope) => Array.isArray(envelope.parts)
    ? envelope.parts.filter((part): part is JsonObject => isJsonObject(part) && part.type === "tool") : []);
}

function opencodeWireDirectory(directory: string): string {
  // Match agent/workspace.rs: filesystem-only extended prefixes never enter HTTP requests.
  return directory.startsWith("\\\\?\\UNC\\") ? `\\\\${directory.slice(8)}`
    : directory.startsWith("\\\\?\\") ? directory.slice(4) : directory;
}

async function runScenario(runtime: Runtime, scope: Scope, action: Action, label: string): Promise<JsonObject> {
  const opposite: Scope = { directory: scope.directory, encoding: scope.encoding === "query" ? "header" : "query" };
  const created = jsonObject(await scopedRequest(runtime.baseUrl, "/session", scope, "POST", {
    title: `permission paths ${label} ${action}`,
    permission: [
      { permission: "read", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "ask" },
      { permission: "write", pattern: "*", action: "ask" },
    ],
  }), "created session");
  const sessionId = stringField(created, "id");
  const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  const original = await readFile(join(scope.directory, "same.txt"));
  await scopedRequest(runtime.baseUrl, `/session/${sessionId}/prompt_async`, scope, "POST", {
    messageID: messageId, model: { providerID: "yume", modelID: "model-a" },
    parts: [{ type: "text", text: `QA_${action.toUpperCase()}` }],
  });
  const permission = await until(
    async () => pending(await scopedRequest(runtime.baseUrl, "/permission", scope), sessionId),
    (value) => value !== undefined, `missing ${action} permission for ${label}`,
  );
  if (permission === undefined) throw new ContractError("INVALID_WIRE", "permission missing");
  const permissionId = stringField(permission, "id");
  const alternate = pending(await scopedRequest(runtime.baseUrl, "/permission", opposite), sessionId);
  check("header/query share permission identity", alternate?.id === permissionId, label);
  const unrelated = pending(await scopedRequest(runtime.baseUrl, "/permission", { directory: runtime.workspaceB, encoding: scope.encoding }), sessionId);
  check("pending request stays in owned directory", unrelated === undefined, label);
  // OpenCode's write tool uses edit permission in some API versions; its tool part is still write.
  check("permission matches tool action", permission.permission === action || action === "write" && permission.permission === "edit", String(permission.permission));
  check("approval pending leaves original bytes unchanged", (await readFile(join(scope.directory, "same.txt"))).equals(original), label);
  check("approval pending does not create write target", !(await Bun.file(join(scope.directory, "new.txt")).exists()), label);
  const reply = action === "read" ? "once" : "reject";
  await scopedRequest(runtime.baseUrl, `/permission/${permissionId}/reply`, opposite, "POST", { reply });
  const snapshot = await until(async () => {
    const value = await scopedRequest(runtime.baseUrl, `/session/${sessionId}/message`, opposite);
    if (!Array.isArray(value)) throw new ContractError("INVALID_WIRE", "message list missing");
    return value.map((item) => jsonObject(item, "message"));
  }, (items) => items.some((item) => isJsonObject(item.info) && item.info.parentID === messageId
    && isJsonObject(item.info.time) && typeof item.info.time.completed === "number"), `unterminated ${action} for ${label}`);
  const tool = toolParts(snapshot).find((part) => part.tool === action);
  if (tool === undefined || !isJsonObject(tool.state)) throw new ContractError("INVALID_WIRE", `${action} tool part missing`);
  check("tool terminal reflects approval", tool.state.status === (action === "read" ? "completed" : "error"), `${label}: ${String(tool.state.status)}`);
  if (action === "read") check("approved read returns owned fixture", JSON.stringify(tool.state.output).includes("ORIGINAL_A"), label);
  const originalStable = (await readFile(join(scope.directory, "same.txt"))).equals(original);
  const newFileAbsent = !(await Bun.file(join(scope.directory, "new.txt")).exists());
  check("read/rejected mutation preserves fixture bytes", originalStable && newFileAbsent, label);
  const stillPending = pending(await scopedRequest(runtime.baseUrl, "/permission", scope), sessionId);
  check("reply clears owned pending request", stillPending === undefined, label);
  return { label, encoding: scope.encoding, directory: scope.directory, action, sessionId, messageId,
    permissionId, nativePermission: permission.permission ?? null, callId: tool.callID ?? null,
    reply, terminal: tool.state.status, originalStable, newFileAbsent, headerQuerySamePermission: true, unrelatedDirectoryEmpty: true };
}

export async function runPermissionPathContract(evidenceDirectory: string): Promise<void> {
  const runtime = await startRuntime({ includeTrusted: false, flowTools: true });
  const directory = await realpath(runtime.root);
  const workspace = join(directory, "中文 工作区");
  const scenarios: JsonObject[] = [];
  let failure: string | undefined;
  const rawExtendedHttpAlias: JsonObject = { status: "not-tested", reason: "Production host normalizes filesystem aliases before HTTP; raw extended HTTP alias support is unverified" };
  let windowsExtended: JsonObject = { status: "skipped", scope: "host wire normalization", reason: "Windows filesystem alias identity requires a Windows host", rawExtendedHttpAlias };
  const interrupt = (): void => { void runtime.close().finally(() => process.exit(130)); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await mkdir(workspace);
    await writeFile(join(workspace, "same.txt"), "ORIGINAL_A", "utf8");
    for (const encoding of ["query", "header"] as const) {
      for (const action of ["read", "edit", "write"] as const) {
        console.log(`stage=permission-paths encoding=${encoding} action=${action}`);
        scenarios.push(await runScenario(runtime, { directory: workspace, encoding }, action, "unicode-space"));
      }
    }
    if (process.platform === "win32") {
      const canonical = await realpath(workspace);
      const ordinary = opencodeWireDirectory(canonical);
      const extended = ordinary.startsWith("\\\\") ? `\\\\?\\UNC\\${ordinary.slice(2)}` : `\\\\?\\${ordinary}`;
      const aliases: JsonObject[] = [];
      for (const alias of [
        { filesystemAlias: "ordinary", directory: ordinary },
        { filesystemAlias: "extended", directory: extended },
      ] as const) {
        const resolved = await realpath(alias.directory);
        const wireDirectory = opencodeWireDirectory(alias.directory);
        check("filesystem aliases resolve to same owned directory", opencodeWireDirectory(resolved).toLowerCase() === ordinary.toLowerCase(), alias.filesystemAlias);
        check("filesystem aliases use same host wire directory", wireDirectory === ordinary, alias.filesystemAlias);
        aliases.push({ ...alias, realpath: resolved, wireDirectory });
        for (const encoding of ["query", "header"] as const) {
          for (const action of ["read", "edit", "write"] as const) {
            const scenario = await runScenario(runtime, { directory: wireDirectory, encoding }, action, `windows-host-wire-normalization-${alias.filesystemAlias}`);
            scenarios.push({ ...scenario, filesystemAlias: alias.filesystemAlias, filesystemDirectory: alias.directory });
          }
        }
      }
      windowsExtended = { status: "passed", scope: "host wire normalization", canonical, filesystemAliases: aliases,
        realpathIdentitySame: true, hostWireDirectorySame: true, rawExtendedHttpAlias };
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    const cleanup = await runtime.close();
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(join(evidenceDirectory, "permission-paths.json"), `${JSON.stringify({
      case: "permission-paths", status: failure === undefined ? "passed" : "failed", version: "1.18.21",
      platform: process.platform, pid: runtime.pid, sidecarPort: runtime.port, providerPort: runtime.provider.port,
      root: runtime.root, workspace, scenarios, windowsExtended, providerRequestCount: runtime.provider.requests.length,
      cleanup, ...(failure === undefined ? {} : { failure }),
    }, null, 2)}\n`);
    check("permission paths runtime cleanup", Object.values(cleanup).every(Boolean), JSON.stringify(cleanup));
    console.log(`evidence=${join(evidenceDirectory, "permission-paths.json")}`);
  }
}
