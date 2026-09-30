import { readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set(["node_modules", "output", "dist", "target", ".git", ".omo"]);
const isTest = (name: string) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);

export async function discoverTests(base: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !ignored.has(entry.name)) await walk(resolve(directory, entry.name));
      else if (entry.isFile() && isTest(entry.name)) files.push(resolve(directory, entry.name));
    }
  }
  await walk(resolve(base, "src"));
  await walk(resolve(base, "scripts"));
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (entry.isFile() && /^vite.*\.(test|spec)\.[cm]?[jt]s$/.test(entry.name)) files.push(resolve(base, entry.name));
  }
  files.sort();
  if (!files.length) throw new Error("No current-source tests discovered");
  return files;
}

export function boundedBudget(value: string | undefined): number {
  const budget = Number(value ?? 120_000);
  if (!Number.isInteger(budget) || budget < 100 || budget > 600_000) throw new Error("YUME_TEST_TIMEOUT_MS must be 100..600000");
  return budget;
}

type Result = { file: string; status: string; code: number | null; signal: string | null; pass: number; fail: number; skip: number; output: string };
const active = new Set<ReturnType<typeof spawn>>();
let interrupted = false;
function killChild(child: ReturnType<typeof spawn>) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    // Only descendants of the exact child created by this runner.
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill("SIGKILL"));
  } else {
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}
function stop() {
  interrupted = true;
  for (const child of active) killChild(child);
}

export async function runFile(file: string, base: string, executable: string, budget: number): Promise<Result> {
  return new Promise((done) => {
    const child = spawn(executable, ["test", resolve(file)], { cwd: base, env: { ...process.env, FORCE_COLOR: "0" }, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    active.add(child);
    let output = "";
    let timedOut = false;
    let startError = false;
    const timer = setTimeout(() => { timedOut = true; killChild(child); }, budget);
    child.stdout?.on("data", (chunk) => { output += chunk; });
    child.stderr?.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => { startError = true; output += String(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      active.delete(child);
      const count = (label: string) => Number(output.match(new RegExp(`^\\s*(\\d+) ${label}\\b`, "m"))?.[1] ?? 0);
      const pass = count("pass"), fail = count("fail"), skip = count("skip");
      const hasSummary = /^\s*\d+ pass\b/m.test(output) && /^\s*\d+ fail\b/m.test(output);
      const status = interrupted ? "interrupted" : timedOut ? "timeout" : startError ? "startup_error" : code === 0 && hasSummary && fail === 0 ? "passed" : "failed";
      done({ file, status, code, signal, pass, fail, skip, output });
    });
  });
}

async function main() {
  const files = await discoverTests(root);
  if (process.argv.includes("--list")) { console.log(files.join("\n")); return; }
  const budget = boundedBudget(process.env.YUME_TEST_TIMEOUT_MS);
  const executable = process.env.YUME_TEST_BUN ?? process.execPath;
  const outputDir = resolve(root, "output/audit-remediation/frontend");
  await mkdir(outputDir, { recursive: true });
  await writeFile(resolve(outputDir, "manifest.json"), JSON.stringify(files, null, 2));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const results: Result[] = [];
  for (const file of files) {
    if (interrupted) break;
    const result = await runFile(file, root, executable, budget);
    results.push(result);
    await writeFile(resolve(outputDir, `${results.length}.log`), result.output);
    console.log(`${result.status}: ${relative(root, file)} (${result.pass} pass, ${result.fail} fail, ${result.skip} skip; exit ${result.code})`);
  }
  const unfinished = files.slice(results.length);
  const summary = { runtime: Bun.version, budget, results: results.map(({ output: _, ...result }) => result), unfinished };
  await writeFile(resolve(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`${results.filter(r => r.status === "passed").length}/${files.length} files passed; ${unfinished.length} unfinished`);
  process.exitCode = unfinished.length || results.some(r => r.status !== "passed") ? 1 : 0;
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}

if (import.meta.main) await main();
