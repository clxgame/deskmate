import { randomUUID } from "node:crypto";
import { startMockOpenAiServer } from "./mock-openai-server";

function requestedPort(): number | undefined {
  const index = process.argv.indexOf("--port");
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (value === undefined) throw new Error("--port requires a value");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid --port value: ${value}`);
  return port;
}

const server = await startMockOpenAiServer({
  canary: randomUUID(),
  port: requestedPort(),
  draft: {
    version: 1,
    kind: "opencode_provider_draft",
    providerName: "Todo8 Local",
    baseUrl: "https://todo8.invalid/v1",
    modelHint: "model-a",
  },
});

process.stdout.write(`mock:ccswitch-api listening ${server.baseUrl}\n`);

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

await new Promise(() => {});
