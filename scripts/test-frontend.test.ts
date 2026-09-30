import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boundedBudget, discoverTests, runFile } from "./test-frontend";

test("discovery depends only on current source roots, including ignored source tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "yume-test-discovery-"));
  try {
    for (const dir of ["src/nested", "scripts", "output/src", "src/node_modules"]) await mkdir(join(root, dir), { recursive: true });
    await expect(discoverTests(root)).rejects.toThrow("No current-source");
    for (const file of ["src/nested/a.test.tsx", "scripts/b.test.ts", "vite.config.test.ts"]) await writeFile(join(root, file), "");
    const clean = await discoverTests(root);
    for (const file of ["output/src/old.test.ts", "src/node_modules/vendor.test.ts", "other.test.ts"]) await writeFile(join(root, file), "");
    expect(await discoverTests(root)).toEqual(clean);
    expect(clean).toHaveLength(3);
    expect(clean).toEqual([...clean].sort());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolated child failures, startup errors and timeout cannot report success", async () => {
  const root = await mkdtemp(join(tmpdir(), "yume-test-runner-"));
  try {
    await writeFile(join(root, "fixture.test.ts"), 'import {test,expect} from "bun:test"; test("controlled failure",()=>expect(1).toBe(2));');
    const failed = await runFile(join(root, "fixture.test.ts"), root, process.execPath, 10_000);
    expect(failed.status).toBe("failed");
    expect(failed.code).not.toBe(0);
    expect(failed.fail).toBe(1);
    expect((await runFile(join(root, "fixture.test.ts"), root, join(root, "missing-bun"), 100)).status).toBe("startup_error");
    await writeFile(join(root, "fixture.test.ts"), "setInterval(()=>{}, 1000); await new Promise(()=>{});");
    expect((await runFile(join(root, "fixture.test.ts"), root, process.execPath, 100)).status).toBe("timeout");
    expect(() => boundedBudget("600001")).toThrow();
    expect(() => boundedBudget("NaN")).toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the complete CLI returns failure even when another child passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "yume-test-cli-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(root, "scripts"));
    const runner = join(root, "scripts/test-frontend.ts");
    await writeFile(runner, await readFile(new URL("./test-frontend.ts", import.meta.url)));
    await writeFile(join(root, "src/a.test.ts"), 'import {test,expect} from "bun:test";test("pass",()=>expect(1).toBe(1));');
    await writeFile(join(root, "src/b.test.ts"), 'import {test,expect} from "bun:test";test("fail",()=>expect(1).toBe(2));');
    const child = Bun.spawn([process.execPath, runner], { stdout: "pipe", stderr: "pipe" });
    const [code, , stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).toBe(1);
    expect(stderr).toContain("Expected: 2");
    const summary = JSON.parse(await readFile(join(root, "output/audit-remediation/frontend/summary.json"), "utf8"));
    expect(summary.results.map((result: { status: string }) => result.status)).toEqual(["passed", "failed"]);
    expect(summary.unfinished).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
