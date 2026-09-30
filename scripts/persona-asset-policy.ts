import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseFigure2dConfig } from "../src/pet/figure2d";
import { parseRig2dConfig, rig2dTextureFiles } from "../src/pet/rig2d/config";
import { PackAuthoringError } from "./pack-metadata";

// Runtime 3D settings now live in personaCatalog.ts. Provenance belongs in
// docs/assets, outside files served by Vite or copied into a persona pack.
export const RETIRED_PERSONA_METADATA = ["figure3d.json", "provenance.json"] as const;
const AUTHORING_METADATA = new Set(["persona.md", "placeholders.json", "placement.json"]);

/** Select only the renderer's assets and the explicitly supported metadata. */
export async function personaPackageFiles(
  root: string,
  files: readonly string[],
  renderType: "glb" | "gif" | "rig2d",
): Promise<readonly string[]> {
  const required = new Set(["persona.md"]);
  if (renderType === "glb") {
    required.add("figure.glb");
  } else if (renderType === "gif") {
    required.add("figure2d.json");
    const config = parseFigure2dConfig(JSON.parse(await readFile(resolve(root, "figure2d.json"), "utf8")));
    for (const animation of Object.values(config.animations)) required.add(animation.file);
  } else {
    required.add("figure-rig2d.json");
    const config = parseRig2dConfig(JSON.parse(await readFile(resolve(root, "figure-rig2d.json"), "utf8")));
    for (const file of rig2dTextureFiles(config)) required.add(file);
  }
  for (const file of required) {
    if (!files.includes(file)) throw new PackAuthoringError(`Missing ${renderType} persona asset: ${file}`);
  }
  for (const file of files) {
    if (required.has(file) || AUTHORING_METADATA.has(file)) continue;
    if (renderType === "glb" && /^textures\/(?:[^/]+\/)*[^/]+\.png$/i.test(file)) continue;
    throw new PackAuthoringError(`Unsupported ${renderType} persona asset: ${file}; keep notes and provenance outside public/personas`);
  }
  return [...files].sort();
}

/** Apply the current metadata policy to a pinned legacy download or warm cache. */
export async function pruneRetiredPersonaMetadata(personasRoot: string): Promise<number> {
  let removed = 0;
  const entries = await readdir(personasRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const root = resolve(personasRoot, entry.name);
    const files = new Set(await readdir(root));
    for (const file of RETIRED_PERSONA_METADATA) {
      if (!files.has(file)) continue;
      await rm(resolve(root, file));
      removed += 1;
    }
  }
  return removed;
}
