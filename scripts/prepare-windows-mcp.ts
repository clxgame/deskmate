import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const version = "1.3.24";
const asset = `windows-mcp-server-${version}-win-x64.zip`;
const archiveSha256 = "4432e34ac4f7483f1e65e4b118b6995368c6d9c323cc50986200279b95dd903f";
const binarySha256 = "6415d0a068280fdf3fdbab75904add3ee974422d56f49f17060da14f8b2f8fcb";
const projectRoot = resolve(import.meta.dir, "..");
const targetDir = resolve(projectRoot, "src-tauri/resources/windows-mcp", version);
const targetBinary = resolve(targetDir, "Sbroenne.WindowsMcp.exe");

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function prepared(): Promise<boolean> {
  const existing = await stat(targetBinary).catch(() => null);
  return existing?.isFile() === true && sha256(await readFile(targetBinary)) === binarySha256;
}

async function main(): Promise<void> {
  if (process.platform !== "win32" || process.arch !== "x64") {
    console.log(`Windows MCP ${version} is only prepared for win32-x64`);
    return;
  }
  if (await prepared()) {
    console.log(`Windows MCP ${version} already prepared`);
    return;
  }
  await mkdir(targetDir, { recursive: true });
  const workDir = resolve(targetDir, ".download");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  try {
    const response = await fetch(`https://github.com/sbroenne/mcp-windows/releases/download/v${version}/${asset}`, { redirect: "follow" });
    if (!response.ok) throw new Error(`Windows MCP download failed: ${response.status}`);
    const archive = new Uint8Array(await response.arrayBuffer());
    const actualArchive = sha256(archive);
    if (actualArchive !== archiveSha256) throw new Error(`Windows MCP archive checksum mismatch: expected ${archiveSha256}, got ${actualArchive}`);
    const archivePath = resolve(workDir, asset);
    await writeFile(archivePath, archive);
    const proc = Bun.spawn([
      "powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
      `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${workDir}' -Force`,
    ], { stdout: "pipe", stderr: "pipe", windowsHide: true });
    if ((await proc.exited) !== 0) throw new Error(`Windows MCP extraction failed: ${await new Response(proc.stderr).text()}`);
    const binary = new Uint8Array(await readFile(resolve(workDir, "Sbroenne.WindowsMcp.exe")));
    const actualBinary = sha256(binary);
    if (actualBinary !== binarySha256) throw new Error(`Windows MCP binary checksum mismatch: expected ${binarySha256}, got ${actualBinary}`);
    await writeFile(targetBinary, binary);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  const sizeMiB = ((await stat(targetBinary)).size / 1024 / 1024).toFixed(1);
  console.log(`Prepared Windows MCP ${version} for win32-x64 (${sizeMiB} MiB)`);
}

await main();
