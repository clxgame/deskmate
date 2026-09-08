import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const child = spawn(process.execPath, [resolve(import.meta.dir, "provider.js")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let receipt;
let checks = 0;
const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
try {
  receipt = await new Promise((resolveReady, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Provider readiness timed out")), 10000);
    child.once("error", reject);
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Provider exited ${code}`)); });
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("\n")) { clearTimeout(timeout); resolveReady(JSON.parse(output.split("\n")[0])); }
    });
  });
  const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const models = await (await fetch(`${receipt.baseUrl}/models`)).json();
  check(models.data[0].id === "model-a", "Synthetic catalog missing");
  check((await post(receipt.controlUrl, { nextTool: { name: "bash", input: {} } })).status === 400, "Forbidden tool accepted");
  await post(receipt.controlUrl, { nextTool: { name: "worklog_record", input: { text: "合成事项" } } });
  const plain = await (await post(`${receipt.baseUrl}/chat/completions`, { messages: [], tools: [], stream: false })).json();
  check(plain.choices[0].finish_reason === "stop", "Absent tool was invoked");
  const tool = await (await post(`${receipt.baseUrl}/chat/completions`, { messages: [], tools: [{ function: { name: "worklog_record" } }], stream: false })).json();
  check(tool.choices[0].message.tool_calls[0].function.name === "worklog_record", "Offered worklog tool missing");
  const status = await (await fetch(receipt.statusUrl)).json();
  check(status.pendingTool === null, "One-shot tool was retained");
  await post(receipt.controlUrl, { mode: "unauthorized" });
  check((await post(`${receipt.baseUrl}/chat/completions`, { messages: [], stream: false })).status === 401, "Authentication failure fixture missing");
  await post(receipt.controlUrl, { mode: "error" });
  check((await post(`${receipt.baseUrl}/chat/completions`, { messages: [], stream: false })).status === 503, "Transient failure fixture missing");
  await post(receipt.controlUrl, { mode: "success", report: "# 合成回读" });
  const stream = await (await post(`${receipt.baseUrl}/chat/completions`, { messages: [], stream: true })).text();
  check(stream.includes("[DONE]") && stream.includes("合成回读"), "SSE output incomplete");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise(resolveExit => child.once("exit", resolveExit));
    child.kill();
    await exited;
  }
  let portClosed = true;
  if (receipt) { try { await fetch(receipt.statusUrl, { signal: AbortSignal.timeout(1000) }); portClosed = false; } catch { /* A closed owned fixture port must reject the connection. */ } }
  await writeFile(resolve(import.meta.dir, "../../.omo/evidence/work-journal-reports-qa/provider-selftest.json"), JSON.stringify({ checks, pid: child.pid, exited: child.exitCode !== null || child.signalCode !== null, portClosed, appLaunched: false }, null, 2));
  if (!portClosed) throw new Error("Owned fixture port remains open");
}
console.log(`${checks} fixture assertions passed; owned provider stopped; no desktop app launched.`);
