import { createHash } from "node:crypto";
import { lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Context = { readonly sessionID: string; readonly messageID: string; readonly callID: string; readonly abort: AbortSignal };
type Args = { readonly input: unknown };
class BridgeError extends Error {}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
async function absentOnly(error: unknown): Promise<void> {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
  throw error;
}
export function worklogTool(action: string, description: string, properties: Record<string, unknown>) {
  return {
    description,
    args: { input: { type: "object", properties, additionalProperties: false, description: "Work journal operation fields. Identity and authorization come only from the host." } },
    async execute(args: Args, context: Context): Promise<string> {
      let publishedRequest: string | undefined;
      try {
      if (!object(args.input)) throw new BridgeError("Work journal input must be an object");
      const directory = process.env.YUME_WORKLOG_IPC_DIR;
      if (!directory) return JSON.stringify({ version: 1, status: "rejected", error: { code: "BRIDGE_UNAVAILABLE", message: "Work records are unavailable" } });
      const metadata = await lstat(directory);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new BridgeError("Invalid work journal bridge directory");
      const hash = createHash("sha256").update(JSON.stringify([context.sessionID, context.messageID, context.callID, action])).digest("hex").slice(0,32);
      const requestId = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20)}`;
      const body = JSON.stringify({ version: 1, requestId, sessionId: context.sessionID, messageId: context.messageID, callId: context.callID, action, args: args.input });
      if (Buffer.byteLength(body) > 256 * 1024) throw new BridgeError("Work journal request exceeds 256 KiB");
      const temporary = join(directory, `${requestId}.tmp`);
      const request = join(directory, `${requestId}.request`);
      const response = join(directory, `${requestId}.response`);
      await writeFile(temporary, body, { flag: "wx" });
      await rename(temporary, request);
      publishedRequest = requestId;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && !context.abort.aborted) {
        try {
          const metadata = await lstat(response);
          if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256 * 1024) throw new BridgeError("Invalid bridge response file");
          const raw = await readFile(response, "utf8");
          const value: unknown = JSON.parse(raw);
          if (!object(value) || value.version !== 1 || value.requestId !== requestId || !["completed", "rejected"].includes(String(value.status))) throw new BridgeError("Invalid bridge response");
          await unlink(response);
          return raw;
        } catch (error) { await absentOnly(error); }
        await new Promise<void>((resolve) => setTimeout(resolve,100));
      }
      return JSON.stringify({ version: 1, status: "pending", requestId, message: "Result is unknown; query this operation ID before trying again." });
      } catch (error) {
        if (publishedRequest) return JSON.stringify({ version: 1, status: "pending", requestId: publishedRequest, message: "Result is unknown; query this operation ID before trying again." });
        const message = error instanceof BridgeError ? error.message : "Work journal transport is unavailable; no save receipt was received";
        return JSON.stringify({ version: 1, status: "rejected", error: { code: "BRIDGE_IO_ERROR", message } });
      }
    },
  };
}
