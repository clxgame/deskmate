import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Context = {
  readonly sessionID: string;
  readonly messageID: string;
  readonly callID: string;
  readonly directory: string;
};

export default {
  description: "Synthetic worklog contract probe; observes actual runtime context only.",
  args: {},
  async execute(_args: unknown, context: Context): Promise<string> {
    const path = join(context.directory, "contract-fs-probe.json");
    const value = {
      version: 1,
      sessionID: context.sessionID,
      messageID: context.messageID,
      callID: context.callID,
      contextKeys: Object.keys(context).sort(),
      fsAvailable: true,
    };
    await writeFile(path, JSON.stringify(value), { flag: "wx" });
    return await readFile(path, "utf8");
  },
};
