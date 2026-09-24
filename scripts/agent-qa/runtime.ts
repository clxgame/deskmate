import { spawn, type ChildProcessByStdio } from "node:child_process";
import { lstat, mkdtemp, realpath, unlink } from "node:fs/promises";
import type { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { childEnv, freePort, stopChild } from "../ccswitch-harness/process";
import { pathMissing, portClosed, processGone, removeTempRoot } from "../ccswitch-harness/cleanup";
import { findSourceBinary } from "../prepare-opencode";
import { stageFixture } from "./fixture";
import { startProvider, type Provider } from "./provider";
import { ContractError, jsonObject, type CleanupReceipt, type JsonObject } from "./types";

type OwnedChild = ChildProcessByStdio<null, Readable, Readable>;
async function stopRuntimeChild(child: OwnedChild): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const exited = new Promise<void>((resolveExit, reject) => {
    child.once("exit", () => resolveExit());
    deadline = setTimeout(() => reject(new ContractError("STOP_TIMEOUT", `OpenCode ${child.pid} did not exit after termination`)), 15_000);
  });
  try { await stopChild(child); await exited; }
  finally { clearTimeout(deadline); }
}
type RuntimeOptions = {
  readonly injectSpawnFailure?: boolean;
  readonly includeTrusted?: boolean;
  readonly flowTools?: boolean;
  readonly providerFactory?: () => Promise<Provider>;
  readonly continueLoopOnDeny?: boolean;
  readonly processToolsDirectory?: string;
  readonly mcp?: JsonObject;
  readonly extraPermission?: JsonObject;
  readonly authenticatedModel?: { readonly id: string; readonly apiKey: string };
};
type SetupFailure = {
  readonly cleanup: CleanupReceipt;
  readonly root: string;
  readonly providerPort: number;
  readonly sidecarPort: number;
};
type CleanupInput = {
  readonly root: string;
  readonly provider?: Provider;
  readonly port?: number;
  readonly child?: OwnedChild;
};

export type Runtime = {
  readonly root: string;
  readonly workspaceA: string;
  readonly workspaceB: string;
  readonly baseUrl: string;
  readonly provider: Provider;
  readonly port: number;
  readonly child: OwnedChild;
  readonly pid: number;
  readonly restartSidecar: () => Promise<number>;
  readonly stopSidecar: () => Promise<void>;
  readonly close: () => Promise<CleanupReceipt>;
};

export class RuntimeSetupError extends ContractError {
  readonly cleanup: CleanupReceipt;
  readonly root: string;
  readonly providerPort: number;
  readonly sidecarPort: number;

  constructor(message: string, failure: SetupFailure) {
    super("RUNTIME_SETUP_FAILED", message);
    this.cleanup = failure.cleanup;
    this.root = failure.root;
    this.providerPort = failure.providerPort;
    this.sidecarPort = failure.sidecarPort;
  }
}

async function health(baseUrl: string): Promise<JsonObject> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/global/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return jsonObject(await response.json(), "health");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", "OpenCode health endpoint did not become ready");
}

async function removeOwnedCacheJunction(root: string): Promise<void> {
  const link = join(root, "AppData", "Local", "Microsoft", "Windows", "INetCache", "Content.IE5");
  const entry = await lstat(link).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  });
  if (entry === null) return;
  if (!entry.isSymbolicLink()) throw new ContractError("UNEXPECTED_CACHE_ENTRY", "QA cache entry is not a junction");
  const canonicalRoot = await realpath(root);
  const canonicalTarget = await realpath(link);
  if (!canonicalTarget.toLowerCase().startsWith(`${canonicalRoot.toLowerCase()}\\`)) {
    throw new ContractError("UNSAFE_CACHE_JUNCTION", "QA cache junction points outside the owned root");
  }
  await unlink(link);
}

async function cleanupOwned(input: CleanupInput): Promise<CleanupReceipt> {
  const pid = input.child?.pid;
  if (input.child !== undefined) await stopRuntimeChild(input.child);
  if (input.provider !== undefined) await input.provider.close();
  await removeOwnedCacheJunction(input.root);
  await removeTempRoot(input.root);
  return {
    processGone: await processGone(pid),
    providerClosed: input.provider === undefined || await portClosed(input.provider.port),
    sidecarClosed: input.port === undefined || await portClosed(input.port),
    tempRootRemoved: await pathMissing(input.root),
  };
}

export async function startRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const root = await mkdtemp(join(tmpdir(), "yume-agent-contract-"));
  let provider: Provider | undefined;
  let port: number | undefined;
  let child: OwnedChild | undefined;
  try {
    provider = await (options.providerFactory ?? startProvider)();
    const fixture = await stageFixture(root, provider.baseUrl, options.includeTrusted ?? true, options.flowTools ?? false);
    port = await freePort();
    const binary = await findSourceBinary();
    if (options.injectSpawnFailure === true) throw new ContractError("INJECTED_SPAWN_FAILURE", "injected before child handle creation");
    const env = childEnv({ root, providerBaseUrl: provider.baseUrl, runtimeCanary: crypto.randomUUID() });
    if (options.processToolsDirectory !== undefined) {
      env.PATH = `${options.processToolsDirectory}${delimiter}${env.PATH ?? ""}`;
      env.NoDefaultCurrentDirectoryInExePath = "1";
    }
    env.OPENCODE_CONFIG_DIR = fixture.configDirectory;
    if (options.authenticatedModel !== undefined) {
      env.OPENCODE_AUTH_CONTENT = JSON.stringify({ yume: { type: "api", key: options.authenticatedModel.apiKey } });
    }
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      permission: { "*": "deny", read: "allow", trusted_probe: "allow", edit: "ask", bash: "ask", webfetch: "ask", ...(options.flowTools === true ? { write: "ask" } : {}), ...options.extraPermission },
      provider: { yume: { npm: "@ai-sdk/openai-compatible", name: "YUME Agent QA", options: { baseURL: provider.baseUrl }, models: { [options.authenticatedModel?.id ?? "model-a"]: { name: options.authenticatedModel?.id ?? "Model A" } } } },
      ...(options.mcp === undefined ? {} : { mcp: options.mcp }),
      ...(options.continueLoopOnDeny === true ? { experimental: { continue_loop_on_deny: true } } : {}),
    });
    const launch = (): OwnedChild => spawn(binary, ["--pure", "serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"], {
      cwd: fixture.workspaceA, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    child = launch();
    const pid = child.pid;
    if (pid === undefined) throw new ContractError("SIDECAR_START", "sidecar PID unavailable");
    const healthValue = await health(`http://127.0.0.1:${port}`);
    if (healthValue.version !== "1.18.21") throw new ContractError("VERSION_MISMATCH", JSON.stringify(healthValue));
    return {
      root, workspaceA: fixture.workspaceA, workspaceB: fixture.workspaceB,
      baseUrl: `http://127.0.0.1:${port}`, provider, port, child, pid,
      restartSidecar: async () => {
        if (child !== undefined) await stopRuntimeChild(child);
        child = launch();
        const restartedPid = child.pid;
        if (restartedPid === undefined) throw new ContractError("SIDECAR_START", "restarted sidecar PID unavailable");
        const restartedHealth = await health(`http://127.0.0.1:${port}`);
        if (restartedHealth.version !== "1.18.21") throw new ContractError("VERSION_MISMATCH", JSON.stringify(restartedHealth));
        return restartedPid;
      },
      stopSidecar: async () => {
        if (child !== undefined) await stopRuntimeChild(child);
      },
      close: () => cleanupOwned({ root, provider, port, child }),
    };
  } catch (error) {
    const cleanup = await cleanupOwned({ root, provider, port, child });
    throw new RuntimeSetupError(error instanceof Error ? error.message : String(error), {
      cleanup,
      root,
      providerPort: provider?.port ?? 0,
      sidecarPort: port ?? 0,
    });
  }
}
