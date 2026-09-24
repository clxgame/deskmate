import { cp, copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildWorkbenchThemeCss, injectWorkbenchThemeAssets } from "./workbench-theme";

/**
 * Builds the YUME workbench bundle from the pinned upstream OpenCode app and
 * copies it into `public/workbench/` (gitignored; consumed by vite build and
 * the Tauri `workbench` window).
 *
 * Requires the upstream clone prepared at a fixed commit (see
 * docs/migrations/opencode-native/baseline.md). Set YUME_OPENCODE_SRC when the
 * clone is not at the default sibling location.
 *
 * Also stages `ghostty-vt.wasm` (the terminal renderer's WASM kernel) into the
 * bundle root: ghostty-web loads it from page-relative URLs, which vite does
 * not emit as an asset, so we copy it next to index.html ourselves.
 */

const projectRoot = resolve(import.meta.dir, "..");
const upstreamRoot =
  process.env.YUME_OPENCODE_SRC ?? resolve(projectRoot, "..", "opencode-v1.18.21");
const appDir = resolve(upstreamRoot, "packages/app");
const outDir = resolve(projectRoot, "public/workbench");
const ghosttyWasm = resolve(appDir, "node_modules/ghostty-web/ghostty-vt.wasm");

if (!(await stat(resolve(appDir, "package.json")).catch(() => null))?.isFile()) {
  throw new Error(`Pinned OpenCode source missing at ${appDir}`);
}

for (const relativePath of ["vite.workbench.config.ts", "workbench/index.html", "workbench/entry.tsx"]) {
  const source = resolve(projectRoot, "scripts/workbench-overlay", relativePath);
  const target = resolve(appDir, relativePath);
  const existing = await stat(target).catch(() => null);
  if (existing) {
    if (!existing.isFile() || !(await readFile(target)).equals(await readFile(source))) {
      throw new Error(`Upstream workbench overlay differs at ${target}`);
    }
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

const config = resolve(appDir, "vite.workbench.config.ts");
if (!(await stat(config).catch(() => null))?.isFile()) {
  throw new Error(
    `Upstream workbench entry missing at ${config}; prepare the pinned clone first`,
  );
}

const generatedConfig = resolve(projectRoot, ".omo/workbench-routing.vite.config.mts");
await mkdir(resolve(projectRoot, ".omo"), { recursive: true });
await writeFile(generatedConfig, `
import upstream from ${JSON.stringify(config.replaceAll("\\", "/"))};
import { transformWorkbenchRouting } from ${JSON.stringify(resolve(projectRoot, "scripts/workbench-routing.ts").replaceAll("\\", "/"))};
export default {
  ...upstream,
  plugins: [
    { name: "yume-scoped-session-routing", enforce: "pre", transform(code, id) {
      if (id.replaceAll("\\\\", "/").endsWith("/workbench/entry.tsx")) return transformWorkbenchRouting(code, ${JSON.stringify(resolve(projectRoot, "src/workbench/session-route.ts").replaceAll("\\", "/"))});
    } },
    ...upstream.plugins,
  ],
};
`);
const build = Bun.spawn(["bunx", "vite", "build", "--config", generatedConfig], {
  cwd: appDir,
  stdout: "inherit",
  stderr: "inherit",
});
const code = await build.exited;
if (code !== 0) throw new Error(`workbench bundle build failed (${code})`);

const dist = resolve(appDir, "workbench-dist");
if (!(await stat(resolve(dist, "index.html")).catch(() => null))?.isFile()) {
  throw new Error("workbench build produced no index.html");
}

// The terminal's WASM kernel is referenced by page-relative URL, which vite
// leaves unresolved; stage it next to index.html so the loader finds it.
if (!(await stat(ghosttyWasm).catch(() => null))?.isFile()) {
  throw new Error(`ghostty-vt.wasm missing at ${ghosttyWasm}`);
}
await copyFile(ghosttyWasm, resolve(dist, "ghostty-vt.wasm"));

const themeCss = buildWorkbenchThemeCss(await readFile(resolve(projectRoot, "src/theme.css"), "utf8"));
const themeBridge = await Bun.build({
  entrypoints: [resolve(projectRoot, "src/workbench/theme-bridge.ts")],
  target: "browser",
  minify: true,
});
if (!themeBridge.success || themeBridge.outputs.length !== 1) {
  throw new Error("workbench theme bridge build failed");
}
await writeFile(resolve(dist, "yume-theme.css"), themeCss);
await Bun.write(resolve(dist, "yume-theme-bridge.js"), themeBridge.outputs[0]);
await writeFile(
  resolve(dist, "index.html"),
  injectWorkbenchThemeAssets(await readFile(resolve(dist, "index.html"), "utf8")),
);

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp(dist, outDir, { recursive: true });
console.log(`Prepared workbench bundle at ${outDir}`);


