import { createServer } from "node:http";
import type { Socket } from "node:net";
import { jsonObject, isJsonObject, type JsonObject } from "./types";
import type { Provider } from "./provider";

export const lateCommand = "Set-Content -LiteralPath probe.pid -Value $PID; Start-Sleep -Seconds 3; Set-Content -LiteralPath late.txt -Value LATE";
const descendantCommand = "Set-Content -LiteralPath probe.pid -Value $PID; powershell.exe -NoProfile -NonInteractive -Command 'Set-Content -LiteralPath child.pid -Value $PID; Start-Sleep -Seconds 3; Set-Content -LiteralPath timeout-child-late.txt -Value LATE'";

function chunks(body: JsonObject): readonly JsonObject[] {
  const history = Array.isArray(body.messages) ? body.messages.filter(isJsonObject) : [];
  const user = history.findLastIndex((item) => item.role === "user");
  const scenario = String(history[user]?.content);
  const results = history.slice(user + 1).filter((item) => item.role === "tool");
  const isReport = scenario.includes("REPORT_KIND");
  const isNormalChat = scenario === "normal-chat";
  let commands: readonly string[] = [];
  if (results.length === 0 && !isReport && !isNormalChat) {
    commands = scenario.includes("multi")
      ? ["Get-ChildItem -Force | Select-Object Mode, LastWriteTime, Length, Name", "Get-Location"]
      : [scenario.includes("failure") ? 'Write-Error "YUME_EXPECTED_FAILURE"; exit 17'
        : scenario === "timeout-child" ? descendantCommand
          : scenario === "cancel-child" ? descendantCommand.replace("timeout-child-late.txt", "cancel-child-late.txt")
          : scenario.includes("timeout") ? lateCommand.replace("late.txt", "timeout-late.txt")
          : scenario.includes("cancel") ? lateCommand : "Get-Location"];
  } else if (scenario === "multi" && results.length === 2) commands = ["Get-Location"];
  const calls = commands.map((command, index) => ({
    index, id: `call_${scenario}_${results.length + index}`, type: "function",
    function: { name: "bash", arguments: JSON.stringify({ command, ...(scenario.startsWith("timeout") ? { timeout: scenario === "timeout-child" ? 1500 : 500 } : {}) }) },
  }));
  const reportSources = [...scenario.matchAll(/SOURCE ([^\s]+)/g)].map((match) => match[1] ?? "").filter(Boolean);
  const report = JSON.stringify({ blocks: [
    { heading: "本周成果（按项目）", text: "完成共享服务并发验收", sources: reportSources },
    { heading: "进展", text: "待补充", sources: [] },
    { heading: "风险", text: "待补充", sources: [] },
    { heading: "下周计划", text: "待补充", sources: [] },
  ] });
  const content = isReport ? report : `LIFECYCLE_COMPLETE:${scenario}`;
  const delta: JsonObject = calls.length > 0 ? { role: "assistant", tool_calls: calls } : { role: "assistant", content };
  const base = { id: "chatcmpl-lifecycle", object: "chat.completion.chunk", created: 1, model: "model-a" };
  return [
    { ...base, choices: [{ index: 0, delta, finish_reason: null }] },
    { ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }] },
  ];
}

export async function startLifecycleProvider(): Promise<Provider> {
  const requests: JsonObject[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    try {
      const parts: Buffer[] = [];
      for await (const part of request) parts.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
      const body = jsonObject(JSON.parse(Buffer.concat(parts).toString("utf8")), "provider request");
      requests.push(body);
      const serialized = JSON.stringify(body);
      if (serialized.includes("network-loss")) {
        await Bun.sleep(5_000);
        request.socket.destroy();
        return;
      }
      if (serialized.includes("REPORT_KIND")) await Bun.sleep(5_000);
      else if (serialized.includes("normal-chat")) await Bun.sleep(2_500);
      else if (serialized.includes("failure-cancel") && serialized.includes('"role":"tool"')) await Bun.sleep(5_000);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const chunk of chunks(body)) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end("data: [DONE]\n\n");
    } catch (error) {
      response.writeHead(500);
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("Provider address unavailable");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`, port: address.port, requests,
    close: () => new Promise<void>((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); }),
  };
}
