import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./desktop.ps1", import.meta.url)), ...process.argv.slice(2)], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
