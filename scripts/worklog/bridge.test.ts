import { test, expect } from "bun:test";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worklogTool } from "../../src-tauri/resources/worklog-bridge";

test("malformed input fails without exposing bridge paths", async () => {
  const result = JSON.parse(await worklogTool("record","fixture",{}).execute({input:"claimed save"}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_fixture",abort:AbortSignal.abort()}));
  expect(result.status).toBe("rejected");
  expect(result.result).toBeUndefined();
  expect(result.error.message).toBe("Work journal input must be an object");
});

test("stale resource directory errors do not disclose local IPC paths", async () => {
  const previous = process.env.YUME_WORKLOG_IPC_DIR;
  const missing = join(tmpdir(),"worklog-missing-resource-fixture",crypto.randomUUID());
  process.env.YUME_WORKLOG_IPC_DIR = missing;
  try {
    const raw = await worklogTool("record","fixture",{}).execute({input:{}}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_fixture",abort:AbortSignal.abort()});
    expect(JSON.parse(raw).status).toBe("rejected");
    expect(raw.includes(missing)).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.YUME_WORKLOG_IPC_DIR; else process.env.YUME_WORKLOG_IPC_DIR = previous;
  }
});

test("returns pending rather than saved when aborted before host acknowledgment", async () => {
  const directory = await mkdtemp(join(tmpdir(),"worklog-transport-test-"));
  const previous = process.env.YUME_WORKLOG_IPC_DIR;
  process.env.YUME_WORKLOG_IPC_DIR = directory;
  try {
    const result = JSON.parse(await worklogTool("record","fixture",{}).execute({input:{text:"synthetic"}}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_fixture",abort:AbortSignal.abort()}));
    expect(result.status).toBe("pending");
    expect(result.result).toBeUndefined();
    const files = await readdir(directory);
    expect(files.filter(file=>file.endsWith(".request"))).toHaveLength(1);
  } finally {
    if (previous === undefined) delete process.env.YUME_WORKLOG_IPC_DIR; else process.env.YUME_WORKLOG_IPC_DIR = previous;
    await rm(directory,{recursive:true});
  }
});

test("returns only the matching host receipt and removes consumed acknowledgment", async () => {
  const directory = await mkdtemp(join(tmpdir(),"worklog-transport-test-"));
  const previous = process.env.YUME_WORKLOG_IPC_DIR;
  process.env.YUME_WORKLOG_IPC_DIR = directory;
  try {
    const pending = worklogTool("record","fixture",{}).execute({input:{text:"synthetic"}}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_receipt",abort:new AbortController().signal});
    let filename: string | undefined;
    const deadline = Date.now()+1000;
    while (!filename && Date.now()<deadline) { filename=(await readdir(directory)).find(file=>file.endsWith(".request")); if (!filename) await Bun.sleep(10); }
    expect(filename).toBeDefined();
    if (!filename) return;
    const request = JSON.parse(await readFile(join(directory,filename),"utf8"));
    const response = {version:1,requestId:request.requestId,status:"completed",result:{receipt:{entityId:"entry_fixture",status:"saved"}}};
    await writeFile(join(directory,`${request.requestId}.response`),JSON.stringify(response));
    expect(JSON.parse(await pending)).toEqual(response);
    expect((await readdir(directory)).filter(file=>file.endsWith(".response"))).toHaveLength(0);
  } finally {
    if (previous === undefined) delete process.env.YUME_WORKLOG_IPC_DIR; else process.env.YUME_WORKLOG_IPC_DIR = previous;
    await rm(directory,{recursive:true});
  }
});

test("query returns entries and reports from the matching host response", async () => {
  const directory = await mkdtemp(join(tmpdir(),"worklog-transport-test-"));
  const previous = process.env.YUME_WORKLOG_IPC_DIR;
  process.env.YUME_WORKLOG_IPC_DIR = directory;
  try {
    const pending = worklogTool("query","fixture",{}).execute({input:{start:"2026-09-08",end:"2026-09-08"}}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_query",abort:new AbortController().signal});
    let filename: string | undefined;
    const deadline = Date.now()+1000;
    while (!filename && Date.now()<deadline) { filename=(await readdir(directory)).find(file=>file.endsWith(".request")); if (!filename) await Bun.sleep(10); }
    expect(filename).toBeDefined();
    if (!filename) return;
    const request = JSON.parse(await readFile(join(directory,filename),"utf8"));
    expect(request.action).toBe("query");
    expect(request.args).toEqual({start:"2026-09-08",end:"2026-09-08"});
    const response = {version:1,requestId:request.requestId,status:"completed",result:{entries:[{id:"entry_yesterday_fixture"}],reports:[{id:"report_yesterday_fixture",bodyMarkdown:"full bodyMarkdown natural recall fixture"}]}};
    await writeFile(join(directory,`${request.requestId}.response`),JSON.stringify(response));
    expect(JSON.parse(await pending)).toEqual(response);
  } finally {
    if (previous === undefined) delete process.env.YUME_WORKLOG_IPC_DIR; else process.env.YUME_WORKLOG_IPC_DIR = previous;
    await rm(directory,{recursive:true});
  }
});

test("query rejection is not converted into an empty result", async () => {
  const directory = await mkdtemp(join(tmpdir(),"worklog-transport-test-"));
  const previous = process.env.YUME_WORKLOG_IPC_DIR;
  process.env.YUME_WORKLOG_IPC_DIR = directory;
  try {
    const pending = worklogTool("query","fixture",{}).execute({input:{start:"2026-09-07",end:"2026-09-07"}}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_query_rejected",abort:new AbortController().signal});
    let filename: string | undefined;
    const deadline = Date.now()+1000;
    while (!filename && Date.now()<deadline) { filename=(await readdir(directory)).find(file=>file.endsWith(".request")); if (!filename) await Bun.sleep(10); }
    expect(filename).toBeDefined();
    if (!filename) return;
    const request = JSON.parse(await readFile(join(directory,filename),"utf8"));
    const response = {version:1,requestId:request.requestId,status:"rejected",error:{code:"NEEDS_EXPLICIT_REQUEST",message:"Query needs an explicit current-turn request"}};
    await writeFile(join(directory,`${request.requestId}.response`),JSON.stringify(response));
    const result = JSON.parse(await pending);
    expect(result.status).toBe("rejected");
    expect(result.result).toBeUndefined();
    expect(result.error.code).toBe("NEEDS_EXPLICIT_REQUEST");
  } finally {
    if (previous === undefined) delete process.env.YUME_WORKLOG_IPC_DIR; else process.env.YUME_WORKLOG_IPC_DIR = previous;
    await rm(directory,{recursive:true});
  }
});

test("query unavailable is not converted into an empty result", async () => {
  const previous = process.env.YUME_WORKLOG_IPC_DIR;
  delete process.env.YUME_WORKLOG_IPC_DIR;
  try {
    const raw = await worklogTool("query","fixture",{}).execute({input:{start:"2026-09-08",end:"2026-09-08"}}, {sessionID:"ses_fixture",messageID:"msg_fixture",callID:"call_query_unavailable",abort:AbortSignal.abort()});
    const result = JSON.parse(raw);
    expect(result.status).toBe("rejected");
    expect(result.result).toBeUndefined();
    expect(result.error.code).toBe("BRIDGE_UNAVAILABLE");
  } finally {
    if (previous === undefined) delete process.env.YUME_WORKLOG_IPC_DIR; else process.env.YUME_WORKLOG_IPC_DIR = previous;
  }
});
