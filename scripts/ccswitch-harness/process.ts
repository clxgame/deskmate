import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { buildSidecarConfig } from "./permissions";
import { HarnessError } from "./types";

type OpenCodeLaunch = {
  readonly binary: string;
  readonly port: number;
  readonly providerBaseUrl: string;
  readonly workspace: string;
  readonly root: string;
  readonly runtimeCanary: string;
};

type ChildEnvironmentInput = {
  readonly root: string;
  readonly providerBaseUrl: string;
  readonly runtimeCanary: string;
};

export type OpenCodeChild = ChildProcessByStdio<null, Readable, Readable>;

export function childEnv(input: ChildEnvironmentInput): NodeJS.ProcessEnv {
  const inheritedKeys = ["ComSpec", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "SystemRoot", "TEMP", "TMP", "WINDIR"] as const;
  const next: NodeJS.ProcessEnv = {};
  for (const key of inheritedKeys) {
    const value = process.env[key];
    if (value !== undefined) next[key] = value;
  }
  next.HOME = input.root;
  next.USERPROFILE = input.root;
  next.APPDATA = join(input.root, "AppData", "Roaming");
  next.LOCALAPPDATA = join(input.root, "AppData", "Local");
  next.XDG_CONFIG_HOME = join(input.root, "xdg-config");
  next.XDG_DATA_HOME = join(input.root, "xdg-data");
  next.XDG_CACHE_HOME = join(input.root, "xdg-cache");
  next.OPENCODE_CONFIG_CONTENT = JSON.stringify(buildSidecarConfig(input.providerBaseUrl));
  next.YUME_TODO8_RUNTIME_CANARY = input.runtimeCanary;
  return next;
}

export async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new HarnessError("could not reserve a TCP port"));
        return;
      }
      server.close(() => resolvePort(address.port));
    });
  });
}

export function startOpenCode(input: OpenCodeLaunch): OpenCodeChild {
  return spawn(input.binary, ["--pure", "serve", "--port", String(input.port), "--hostname", "127.0.0.1", "--print-logs"], {
    cwd: input.workspace,
    env: childEnv(input),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

export async function stopChild(child: OpenCodeChild): Promise<void> {
  const waitForExit = new Promise<void>((resolveStop) => {
    child.once("exit", () => resolveStop());
    setTimeout(() => resolveStop(), 5_000);
  });
  if (process.platform === "win32" && child.pid !== undefined) {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolveStop) => {
      killer.once("exit", () => resolveStop());
      setTimeout(() => resolveStop(), 2_000);
    });
    await waitForExit;
    return;
  }
  if (child.exitCode !== null) return;
  child.kill();
  await waitForExit;
}
