import { describe, expect, test } from "bun:test";
import { isBuiltinPack, personaAssets, type AssetHost } from "./personaAssets";

/**
 * Built-in personas load from the bundled frontend; imported packs must go
 * through the asset protocol, whose scope only covers `<appData>/packs`.
 * Getting this wrong means an imported persona silently fails to render, so the
 * split is pinned here.
 */

function fakeHost(): AssetHost & { converted: string[] } {
  const converted: string[] = [];
  return {
    converted,
    appDataDir: () => Promise.resolve("C:\\data\\com.deskmate.desktop"),
    join: (...parts) => Promise.resolve(parts.join("\\")),
    convertFileSrc: (path) => {
      converted.push(path);
      return `asset://localhost/${encodeURIComponent(path)}`;
    },
  };
}

describe("persona asset resolution", () => {
  test("serves the built-in pack from the app's own origin", async () => {
    const host = fakeHost();
    const assets = await personaAssets("xiaozhu", host);

    expect(assets.modelUrl).toBe("/personas/xiaozhu/figure.glb");
    expect(await assets.textureUrl("Hair")).toBe(
      "/personas/xiaozhu/textures/Hair/baseColor.png",
    );
    // Bundled assets need no disk access at all.
    expect(host.converted).toEqual([]);
  });

  test("reads imported packs through the asset protocol", async () => {
    const host = fakeHost();
    const assets = await personaAssets("changli", host);

    expect(assets.modelUrl).toStartWith("asset://localhost/");
    expect(host.converted[0]).toBe(
      "C:\\data\\com.deskmate.desktop\\packs\\aki\\personas\\changli\\figure.glb",
    );
  });

  test("resolves each texture as its own path instead of appending to a root", async () => {
    // convertFileSrc percent-encodes, so concatenating a slot onto an already
    // encoded root would produce an unfetchable URL.
    const host = fakeHost();
    const assets = await personaAssets("changli", host);
    const url = await assets.textureUrl("Hair");

    expect(host.converted).toContain(
      "C:\\data\\com.deskmate.desktop\\packs\\aki\\personas\\changli\\textures\\Hair\\baseColor.png",
    );
    expect(url).not.toContain("/Hair/baseColor.png");
  });

  test("keeps imported assets inside the packs directory the scope allows", async () => {
    const host = fakeHost();
    await personaAssets("changli", host);

    for (const path of host.converted) {
      expect(path).toStartWith("C:\\data\\com.deskmate.desktop\\packs\\");
    }
  });

  test("knows which packs are bundled", () => {
    expect(isBuiltinPack("ai-substitute")).toBe(true);
    expect(isBuiltinPack("aki")).toBe(false);
  });

  test("falls back to the built-in persona for unknown ids", async () => {
    const assets = await personaAssets("does-not-exist", fakeHost());
    expect(assets.modelUrl).toBe("/personas/xiaozhu/figure.glb");
  });
});
