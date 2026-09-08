import { frozenReport } from "./report-output.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const evidence = resolve(import.meta.dir, "../../.omo/evidence/work-journal-reports-qa");
await mkdir(evidence, { recursive: true });
const state = { mode: "success", delayMs: 0, nextTool: null, report: "# 合成工作报告\n\n## 今日完成\n完成测试项目界面核对。\n\n## 进行中\n待补充\n\n## 问题与阻塞\n待补充\n\n## 下一步\n待补充", requests: [] };
const permitted = new Set(["worklog_record", "worklog_query", "worklog_update", "worklog_generate_report", "worklog_schedule_report"]);
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v1/models") return Response.json({ object: "list", data: [{ id: "model-a", object: "model", owned_by: "synthetic-qa" }] });
    if (request.method === "GET" && url.pathname === "/qa/status") return Response.json({ mode: state.mode, delayMs: state.delayMs, pendingTool: state.nextTool?.name ?? null, requests: state.requests });
    if (request.method === "POST" && url.pathname === "/qa/control") {
      const input = await request.json();
      if (!input || typeof input !== "object") return new Response("Invalid control", { status: 400 });
      if (input.mode !== undefined && !["success", "error", "unauthorized"].includes(input.mode)) return new Response("Invalid mode", { status: 400 });
      if (input.delayMs !== undefined && (!Number.isInteger(input.delayMs) || input.delayMs < 0 || input.delayMs > 310000)) return new Response("Invalid delay", { status: 400 });
      if (input.nextTool !== undefined && input.nextTool !== null && (!permitted.has(input.nextTool.name) || !input.nextTool.input || typeof input.nextTool.input !== "object")) return new Response("Invalid tool", { status: 400 });
      if (input.report !== undefined && (typeof input.report !== "string" || input.report.length > 30000)) return new Response("Invalid report", { status: 400 });
      for (const key of ["mode", "delayMs", "nextTool", "report"]) if (input[key] !== undefined) state[key] = input[key];
      return Response.json({ configured: true });
    }
    if (request.method !== "POST" || !["/v1/chat/completions", "/chat/completions"].includes(url.pathname)) return new Response("Not found", { status: 404 });
    const body = await request.json();
    const offered = (body.tools ?? []).flatMap(tool => typeof tool?.function?.name === "string" ? [tool.function.name] : []);
    const messages = body.messages ?? [];
    const latestTool = messages.findLast(message => message.role === "tool");
    const pending = state.nextTool;
    const invoke = pending && offered.includes(pending.name);
    const mode = state.mode;
    const delayMs = state.delayMs;
    state.requests.push({ at: new Date().toISOString(), tools: offered, toolResult: Boolean(latestTool), mode, delayMs });
    if (delayMs) await Bun.sleep(delayMs);
    if (mode !== "success") return Response.json({ error: { message: "Synthetic QA provider failure", type: mode === "unauthorized" ? "authentication_error" : "server_error" } }, { status: mode === "unauthorized" ? 401 : 503 });
    if (invoke) state.nextTool = null;
    const content = latestTool ? `合成模型工具回执：${typeof latestTool.content === "string" ? latestTool.content : JSON.stringify(latestTool.content)}` : (frozenReport(messages) ?? state.report);
    const toolCalls = invoke ? [{ index: 0, id: `call_qa_${crypto.randomUUID().replaceAll("-", "")}`, type: "function", function: { name: pending.name, arguments: JSON.stringify({ input: pending.input }) } }] : undefined;
    const message = invoke ? { role: "assistant", tool_calls: toolCalls } : { role: "assistant", content };
    const finishReason = invoke ? "tool_calls" : "stop";
    const base = { id: `chatcmpl-${crypto.randomUUID()}`, created: Math.floor(Date.now() / 1000), model: "model-a" };
    if (!body.stream) return Response.json({ ...base, object: "chat.completion", choices: [{ index: 0, message, finish_reason: finishReason }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
    const chunks = [{ index: 0, delta: message, finish_reason: null }, { index: 0, delta: {}, finish_reason: finishReason }];
    return new Response(chunks.map(choice => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [choice] })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  }
});
const receipt = { pid: process.pid, baseUrl: `http://127.0.0.1:${server.port}/v1`, controlUrl: `http://127.0.0.1:${server.port}/qa/control`, statusUrl: `http://127.0.0.1:${server.port}/qa/status`, model: "model-a", syntheticKey: "synthetic-worklog-qa", started: new Date().toISOString() };
await writeFile(resolve(evidence, "provider-receipt.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
async function shutdown() {
  server.stop(true);
  await writeFile(resolve(evidence, "provider-cleanup.json"), JSON.stringify({ pid: process.pid, port: server.port, stopped: true, requests: state.requests }, null, 2));
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
