import { createServer } from "node:http";
import { expectJsonObject, isJsonObject, HarnessError } from "../ccswitch-harness/types";

export const probeTool = "worklog_contract_probe";

type Observation = {
  readonly tools: readonly string[];
  readonly toolResult: boolean;
  readonly systemText: string;
  readonly userText: string;
  readonly toolText: string;
};

function messageText(messages: readonly unknown[], role: string): string {
  return messages
    .flatMap((message) => {
      if (!isJsonObject(message) || message.role !== role) return [];
      return typeof message.content === "string" ? [message.content] : [];
    })
    .join("\n");
}

export async function startProvider() {
  let selectedTool = probeTool;
  let selectedArgs: object = {};
  let completionText = "Synthetic completed report. Claimed save is not a host receipt.";
  const observations: Observation[] = [];
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET") {
        response.end(JSON.stringify({ object: "list", data: [{ id: "model-a", object: "model" }] }));
        return;
      }
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const body = expectJsonObject(JSON.parse(Buffer.concat(buffers).toString()), "provider request");
      const toolNames = (Array.isArray(body.tools) ? body.tools : []).flatMap((tool) =>
        isJsonObject(tool) && isJsonObject(tool.function) && typeof tool.function.name === "string" ? [tool.function.name] : []);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const toolResult = messages.some((message) => isJsonObject(message) && message.role === "tool");
      observations.push({
        tools: toolNames,
        toolResult,
        systemText: messageText(messages, "system"),
        userText: messageText(messages, "user"),
        toolText: messageText(messages, "tool"),
      });
      const invoke = toolNames.includes(selectedTool) && !toolResult;
      const delta = invoke ? { role: "assistant", tool_calls: [{ index: 0, id: "call_worklog_contract", type: "function", function: { name: selectedTool, arguments: JSON.stringify(selectedArgs) } }] }
        : { role: "assistant", content: completionText };
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: invoke ? "tool_calls" : "stop" }]) {
        response.write(`data: ${JSON.stringify({ id: "chatcmpl-contract", object: "chat.completion.chunk", created: 1, model: "model-a", choices: [choice] })}\n\n`);
      }
      response.end("data: [DONE]\n\n");
    } catch (error) {
      response.writeHead(400);
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new HarnessError("provider has no port");
  return { port: address.port, baseUrl: `http://127.0.0.1:${address.port}/v1`, observations,
    selectTool: (name: string, args: object) => { selectedTool = name; selectedArgs = args; },
    setCompletionText: (text: string) => { completionText = text; },
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
