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
  test("resolves rig2d assets from the installed pack and rejects path traversal", async () => {
    const host = fakeHost();
    const assets = await personaAssets("baobao", host);
    if (assets.renderType !== "rig2d") throw new Error("Expected rig2d assets");
    await assets.textureUrl("assets/sleep-0.png");
    expect(host.converted[0]).toEndWith("packs\\baobao\\personas\\baobao\\figure-rig2d.json");
    expect(host.converted[1]).toEndWith("packs\\baobao\\personas\\baobao\\assets\\sleep-0.png");
    await expect(assets.textureUrl("../outside.png")).rejects.toThrow("unsafe PNG path");
  });
  test("serves the built-in pack from the app's own origin", async () => {
    const host = fakeHost();
    const assets = await personaAssets("xiaozhu", host);

    if (assets.renderType !== "glb") throw new Error("Expected GLB assets");
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

    if (assets.renderType !== "glb") throw new Error("Expected GLB assets");
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
    if (assets.renderType !== "glb") throw new Error("Expected GLB assets");
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
    if (assets.renderType !== "glb") throw new Error("Expected GLB assets");
    expect(assets.modelUrl).toBe("/personas/xiaozhu/figure.glb");
  });
});

test("resolves GIF config and safe animations for imported xiaoxiongchong", async () => {
  const host = fakeHost();
  const assets = await personaAssets("xiaoxiongchong", host);
  if (assets.renderType !== "gif") throw new Error("Expected GIF assets");
  expect(assets.configUrl).toContain("figure2d.json");
  await assets.animationUrl("animations/idle.gif");
  expect(host.converted.at(-1)).toEndWith("packs\\xiaoxiongchong\\personas\\xiaoxiongchong\\animations\\idle.gif");
  await expect(assets.animationUrl("../bad.gif")).rejects.toThrow();
});
