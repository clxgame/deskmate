import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { crc32, inflateSync } from "node:zlib";
import { parseRig2dConfig, rig2dTextureFiles } from "../src/pet/rig2d/config";
import { PackAuthoringError } from "./pack-metadata";

export function validateRig2dPng(data: Buffer): void {
  const invalid = () => new PackAuthoringError("Invalid rig2d PNG: expected complete 512x512 RGB8/RGBA8 image");
  if (data.length < 57 || data.length > 8 * 1024 * 1024 || !data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw invalid();
  const compressed: Buffer[] = [];
  let offset = 8;
  let ended = false;
  let dataEnded = false;
  while (offset + 12 <= data.length) {
    const size = data.readUInt32BE(offset);
    const end = offset + size + 12;
    if (end > data.length) throw invalid();
    const kind = data.toString("ascii", offset + 4, offset + 8);
    const payload = data.subarray(offset + 8, end - 4);
    if (crc32(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && kind !== "IHDR") throw invalid();
    switch (kind) {
      case "IHDR":
        if (offset !== 8 || size !== 13 || payload.readUInt32BE(0) !== 512 || payload.readUInt32BE(4) !== 512
          || payload[8] !== 8 || ![2, 6].includes(payload[9]) || !payload.subarray(10).equals(Buffer.from([0,0,0]))) throw invalid();
        break;
      case "IDAT":
        if (dataEnded) throw invalid();
        compressed.push(payload);
        break;
      case "IEND":
        if (size !== 0 || end !== data.length || compressed.length === 0) throw invalid();
        ended = true;
        break;
      case "PLTE":
        if (compressed.length > 0 || size === 0 || size > 768 || size % 3 !== 0) throw invalid();
        break;
      default:
        if (!/^[a-z][A-Za-z][A-Z][A-Za-z]$/.test(kind) || ["acTL", "fcTL", "fdAT"].includes(kind)) throw invalid();
        if (compressed.length > 0) dataEnded = true;
    }
    offset = end;
  }
  if (!ended || offset !== data.length) throw invalid();
  const rowSize = 512 * (data[25] === 6 ? 4 : 3) + 1;
  let decoded: Buffer;
  try { decoded = inflateSync(Buffer.concat(compressed), { maxOutputLength: rowSize * 512 }); }
  catch (error) { if (error instanceof Error) throw invalid(); throw error; }
  if (decoded.length !== rowSize * 512) throw invalid();
  for (let row = 0; row < 512; row += 1) if (decoded[row * rowSize] > 4) throw invalid();
}

export async function validateRig2dPersona(root: string, files: readonly string[]): Promise<void> {
  if ((await stat(resolve(root, "figure-rig2d.json"))).size > 128 * 1024) throw new PackAuthoringError("rig2d config too large");
  const config = parseRig2dConfig(JSON.parse(await readFile(resolve(root, "figure-rig2d.json"), "utf8")));
  if (!files.includes("persona.md")) throw new PackAuthoringError("rig2d persona requires persona.md");
  for (const file of rig2dTextureFiles(config)) {
    if (!files.includes(file)) throw new PackAuthoringError(`Missing rig2d PNG: ${file}`);
    if ((await stat(resolve(root, file))).size > 8 * 1024 * 1024) throw new PackAuthoringError("rig2d PNG too large");
    validateRig2dPng(await readFile(resolve(root, file)));
  }
}
