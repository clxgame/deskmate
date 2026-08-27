import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { buildSidecarConfig } from "./permissions";
import { HarnessError } from "./types";

type OpenCodeLaunch = {
  readonly binary: string;
  readonly port: number;
  readonly workspace: string;
  readonly root: string;
};

export function childEnv(root: string): NodeJS.ProcessEnv {
  const next = { ...process.env };
  delete next.OPENCODE_SERVER_PASSWORD;
  delete next.OPENCODE_SERVER_USERNAME;
  next.HOME = root;
  next.USERPROFILE = root;
  next.APPDATA = join(root, "AppData", "Roaming");
  next.LOCALAPPDATA = join(root, "AppData", "Local");
  next.XDG_CONFIG_HOME = join(root, "xdg-config");
  next.XDG_DATA_HOME = join(root, "xdg-data");
  next.XDG_CACHE_HOME = join(root, "xdg-cache");
  next.OPENCODE_CONFIG_CONTENT = JSON.stringify(buildSidecarConfig());
  delete next.OPENCODE_AUTH_CONTENT;
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

export function startOpenCode(input: OpenCodeLaunch): ChildProcessWithoutNullStreams {
  return spawn(input.binary, ["--pure", "serve", "--port", String(input.port), "--hostname", "127.0.0.1", "--print-logs"], {
    cwd: input.workspace,
    env: childEnv(input.root),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

export async function stopChild(child: ChildProcessWithoutNullStreams): Promise<void> {
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
