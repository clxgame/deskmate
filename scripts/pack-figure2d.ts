import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseFigure2dConfig } from "../src/pet/figure2d";
import { PackAuthoringError } from "./pack-metadata";
import { validateRig2dPersona } from "./pack-rig2d";

export async function personaRenderType(root: string, files: readonly string[]): Promise<"glb" | "gif" | "rig2d"> {
  if (files.includes("figure-rig2d.json")) {
    if (files.includes("figure2d.json") || files.includes("figure.glb")) throw new PackAuthoringError("Persona has conflicting renderer configs");
    await validateRig2dPersona(root, files);
    return "rig2d";
  }
  if (!files.includes("figure2d.json")) {
    if (files.some(file => file.endsWith(".gif"))) throw new PackAuthoringError("GIF assets require figure2d.json");
    return "glb";
  }
  const config = parseFigure2dConfig(JSON.parse(await readFile(resolve(root, "figure2d.json"), "utf8")));
  if (!files.includes("persona.md")) throw new PackAuthoringError("GIF persona requires persona.md");
  for (const animation of Object.values(config.animations)) {
    if (!files.includes(animation.file)) throw new PackAuthoringError(`Missing GIF animation: ${animation.file}`);
    const data = await readFile(resolve(root, animation.file));
    const signature = data.subarray(0, 6).toString("ascii");
    if (data.length < 14 || (signature !== "GIF87a" && signature !== "GIF89a") || data.readUInt16LE(6) !== config.canvas.width || data.readUInt16LE(8) !== config.canvas.height || data.at(-1) !== 0x3b) {
      throw new PackAuthoringError(`Invalid GIF animation: ${animation.file}`);
    }
  }
  return "gif";
}
