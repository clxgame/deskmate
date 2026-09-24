import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { mergeMacUpdater } from "./merge-updater-manifest";

const root = resolve(import.meta.dir, "..");
const run = async (args: string[]) => {
  const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { code, text: out + err };
};

test("CI stores unsigned Mac candidates only in Actions, never in Releases", async () => {
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  const mac = workflow.slice(workflow.indexOf("\n  macos:"));
  expect(mac).toContain("actions/upload-artifact@");
  expect(mac).toContain("YUME.unsigned.app.zip");
  expect(mac).not.toMatch(/gh release upload|tauri-apps\/tauri-action|scripts\/package-macos.sh/);
});

test("Mac finalizer uses the repository updater key and can only modify a draft", async () => {
  const workflow = await readFile(
    join(root, ".github/workflows/finalize-macos-release.yml"), "utf8",
  );
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}");
  expect(workflow).toContain('isDraft --jq .isDraft)\" = true');
  expect(workflow).toContain("scripts/merge-updater-manifest.ts");
  expect(workflow).not.toMatch(/MACOS_SIGNING_IDENTITY|MACOS_NOTARY_PROFILE|notarytool/);
});

test("CI Mac checks use the deterministic updater/release suite", async () => {
  const workflow = await readFile(join(root, ".github/workflows/release.yml"), "utf8");
  expect(workflow).toContain("bun test scripts/macos-release.test.ts");
  expect(workflow).not.toMatch(/^\s*bun test\s*$/m);
});

test("Mac bundle excludes Windows-only MCP resources", async () => {
  const base = JSON.parse(await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const mac = JSON.parse(await readFile(join(root, "src-tauri/tauri.macos.conf.json"), "utf8"));
  expect(mac.bundle.resources).toEqual(
    base.bundle.resources.filter((path: string) => !path.startsWith("resources/windows-mcp/")),
  );
});

test("Mac updater metadata is merged without losing signed Windows targets", () => {
  const windows = {
    version: "0.4.4",
    notes: "release",
    platforms: {
      "windows-x86_64": { signature: "windows-signature", url: "https://example.test/yume.exe" },
      "windows-x86_64-nsis": { signature: "windows-signature", url: "https://example.test/yume.exe" },
    },
  };
  const merged = mergeMacUpdater(windows, "0.4.4", "clxgame/deskmate", "mac-signature\n");
  expect(merged.platforms["windows-x86_64"]).toEqual(windows.platforms["windows-x86_64"]);
  expect(merged.platforms["darwin-aarch64"]).toEqual({
    signature: "mac-signature",
    url: "https://github.com/clxgame/deskmate/releases/download/v0.4.4/YUME_0.4.4_aarch64.app.tar.gz",
  });
});

test("Mac updater metadata refuses mismatched releases and unexpected platforms", () => {
  expect(() => mergeMacUpdater({ version: "0.4.3", platforms: {} },
    "0.4.4", "clxgame/deskmate", "sig")).toThrow();
  expect(() => mergeMacUpdater({
    version: "0.4.4",
    platforms: { "darwin-aarch64": { signature: "old", url: "https://example.test/old" } },
  }, "0.4.4", "clxgame/deskmate", "sig")).toThrow();
});

describe.skipIf(process.platform !== "darwin")("macOS release fail-closed guards", () => {
  let work: string;
  let plain: string;
  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), "yume-release-tests."));
    await writeFile(join(work, "main.c"), "int main(void) { return 0; }\n");
    await writeFile(join(work, "lib.c"), "int answer(void) { return 42; }\n");
    await writeFile(join(work, "linked.c"), "extern int answer(void); int main(void) { return answer(); }\n");
    plain = join(work, "plain");
    const result = await run(["xcrun", "clang", "-arch", "arm64", join(work, "main.c"), "-o", plain]);
    expect(result.code, result.text).toBe(0);
  });
  afterAll(async () => { if (work) await rm(work, { recursive: true, force: true }); });

  async function fixture(name: string) {
    const app = join(work, name, "YUME.app");
    await mkdir(join(app, "Contents/MacOS"), { recursive: true });
    await cp(plain, join(app, "Contents/MacOS/yume"));
    await writeFile(join(app, "Contents/Info.plist"), `<?xml version="1.0"?>
      <plist version="1.0"><dict>
      <key>CFBundleExecutable</key><string>yume</string>
      <key>CFBundleIdentifier</key><string>com.deskmate.release-test</string>
      <key>CFBundlePackageType</key><string>APPL</string>
      <key>CFBundleShortVersionString</key><string>0.0.1</string>
      </dict></plist>`);
    return app;
  }

  async function checkRejected(app: string) {
    const output = `${app}.downloads`;
    const result = await run(["bash", "scripts/package-macos.sh", app, output]);
    expect(result.code, result.text).not.toBe(0);
    expect(await Bun.file(join(output, "YUME_0.0.1_aarch64.dmg")).exists()).toBe(false);
    expect(await Bun.file(join(output, "YUME_0.0.1_aarch64.app.zip")).exists()).toBe(false);
    return result.text;
  }

  test("rejects linker-only bundle signatures before producing downloads", async () => {
    const message = await checkRejected(await fixture("linker-only"));
    expect(message).toMatch(/signature|signed|resources/i);
  });

  test("rejects valid ad-hoc bundle signatures, even if codesign verification passes", async () => {
    const app = await fixture("adhoc");
    expect((await run(["codesign", "--force", "--sign", "-", app])).code).toBe(0);
    expect((await run(["codesign", "--verify", "--deep", "--strict", app])).code).toBe(0);
    expect(await checkRejected(app)).toContain("Developer ID Application signature is required");
  });

  test("rejects resource modifications after signing", async () => {
    const app = await fixture("tampered");
    await mkdir(join(app, "Contents/Resources"));
    const resource = join(app, "Contents/Resources/test.txt");
    await writeFile(resource, "original");
    expect((await run(["codesign", "--force", "--sign", "-", app])).code).toBe(0);
    await writeFile(resource, "tampered");
    expect(await checkRejected(app)).toMatch(/modified|invalid/i);
  });

  async function linkedFixture(name: string, installName: string) {
    const app = await fixture(name);
    await mkdir(join(app, "Contents/Frameworks"));
    const library = join(app, "Contents/Frameworks/test.dylib");
    for (const args of [
      ["xcrun", "clang", "-arch", "arm64", "-dynamiclib", join(work, "lib.c"), "-install_name", installName, "-o", library],
      ["xcrun", "clang", "-arch", "arm64", join(work, "linked.c"), library, "-o", join(app, "Contents/MacOS/yume")],
    ]) {
      const result = await run(args);
      expect(result.code, result.text).toBe(0);
    }
    return { app, library };
  }

  test("rejects a build-machine Homebrew dependency", async () => {
    const { app } = await linkedFixture("homebrew", "/opt/homebrew/opt/taglib/lib/libtag.2.dylib");
    const result = await run(["bash", "scripts/verify-macos-dependencies.sh", app]);
    expect(result.code).not.toBe(0);
    expect(result.text).toContain("Non-portable dependency");
  });

  test("accepts bundled loader-relative dependencies, then rejects a missing library", async () => {
    const { app, library } = await linkedFixture("portable", "@loader_path/../Frameworks/test.dylib");
    const good = await run(["bash", "scripts/verify-macos-dependencies.sh", app]);
    expect(good.code, good.text).toBe(0);
    await rm(library);
    const bad = await run(["bash", "scripts/verify-macos-dependencies.sh", app]);
    expect(bad.code).not.toBe(0);
    expect(bad.text).toContain("Missing dependency");
  });

  test("does not accept a checksum manifest that omits a download", async () => {
    const directory = join(work, "bad-manifest");
    await mkdir(directory);
    await writeFile(join(directory, "YUME_0.0.1_aarch64.dmg"), "not a dmg");
    await writeFile(join(directory, "YUME_0.0.1_aarch64.app.zip"), "not a zip");
    await writeFile(join(directory, "SHA256SUMS-macos.txt"), "");
    expect((await run(["bash", "scripts/verify-macos-downloads.sh", directory, "0.0.1"])).code).not.toBe(0);
  });
});
