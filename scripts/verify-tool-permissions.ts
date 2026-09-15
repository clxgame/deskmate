import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { childEnv, freePort, stopChild } from "./ccswitch-harness/process";
import { removeTempRoot, portClosed, processGone } from "./ccswitch-harness/cleanup";
import { buildSidecarConfig } from "./ccswitch-harness/permissions";
import { requestJson, requestRaw, waitForHealth } from "./ccswitch-harness/transport";
import { expectJsonObject, expectString, HarnessError, isJsonObject } from "./ccswitch-harness/types";
import { findSourceBinary } from "./prepare-opencode";
import { startProvider } from "./worklog/provider";

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new HarnessError(message); }
const binary = await findSourceBinary();
const root = await mkdtemp(join(tmpdir(), "yume-permissions-"));
const workspace = join(root,"workspace");
const ipc = join(workspace,"ipc");
const provider = await startProvider();
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
await mkdir(join(workspace,".opencode/tools"),{recursive:true});
await mkdir(ipc);
await copyFile(resolve("src-tauri/resources/worklog-bridge.ts"),join(workspace,".opencode/worklog-bridge.ts"));
await copyFile(resolve("src-tauri/resources/opencode-tools/worklog_query.ts"),join(workspace,".opencode/tools/worklog_query.ts"));
const env = childEnv({root,providerBaseUrl:provider.baseUrl,runtimeCanary:randomUUID()});
env.YUME_WORKLOG_IPC_DIR=ipc;
env.OPENCODE_CONFIG_CONTENT=JSON.stringify({...buildSidecarConfig(provider.baseUrl),permission:{"*":"deny",bash:"ask",webfetch:"ask",worklog_query:"ask"}});
const child=spawn(binary,["--pure","serve","--port",String(port),"--hostname","127.0.0.1","--print-logs"],{cwd:workspace,env,stdio:["ignore","pipe","pipe"],windowsHide:true});
let output="";
let spawnError: string | undefined;
child.on("error", (error: Error) => { spawnError=error.message; });
child.stdout.on("data",(chunk:Buffer)=>{output=(output+chunk.toString()).slice(-10000);});
child.stderr.on("data",(chunk:Buffer)=>{output=(output+chunk.toString()).slice(-10000);});
const evidence:Record<string,unknown>={};
let nativeTest: ReturnType<typeof Bun.spawn> | undefined;
const eventAbort = new AbortController();
const observedPermissions = new Map<string, Record<string, unknown>>();
async function readEvents(response: Response) {
 if (!response.body) throw new HarnessError("missing event stream");
 const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
 let buffer = "";
 try { while (true) {
  const {value,done}=await reader.read(); if(done)return;
  buffer+=value;
  let end;
  while((end=buffer.indexOf("\n"))>=0) {
   const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
   if(!line.startsWith("data: "))continue;
   const event:unknown=JSON.parse(line.slice(6));
   if(!isJsonObject(event)||!isJsonObject(event.properties))continue;
   if(event.type==="permission.asked"&&typeof event.properties.id==="string")observedPermissions.set(event.properties.id,event.properties);
   if(event.type==="permission.replied"&&typeof event.properties.requestID==="string")observedPermissions.delete(event.properties.requestID);
  }
 } } catch(error:unknown) {if(!eventAbort.signal.aborted)throw error;}
}
async function waitPermission(session:string) {
 const deadline=Date.now()+45000;
 while(Date.now()<deadline){
  const response = await fetch(`${baseUrl}/permission`, {signal:AbortSignal.timeout(5000)});
  const raw = await response.text();
  if(!response.ok)evidence.listError=`permission HTTP ${response.status}: ${raw.slice(0,3000)}`;
  const pending:unknown=response.ok?JSON.parse(raw):[...observedPermissions.values()];
  if(Array.isArray(pending)) { const found=pending.find((item)=>isJsonObject(item)&&item.sessionID===session);if(found)return expectJsonObject(found,"permission"); }
  await Bun.sleep(100);
 }
 throw new HarnessError("permission request never arrived");
}
async function start(tool:string,args:object) {
 provider.selectTool(tool,args);
 const session=expectJsonObject(await requestJson({baseUrl,path:"/session",method:"POST",body:{title:"Isolated permission test"}}),"session");
 const id=expectString(session.id,"id");
 await requestRaw({baseUrl,path:`/session/${id}/prompt_async`,method:"POST",body:{model:{providerID:"yume",modelID:"model-a"},parts:[{type:"text",text:"Run the selected test tool"}]}});
 return id;
}
async function reply(id:string,decision:string) { await requestJson({baseUrl,path:`/permission/${id}/reply`,method:"POST",body:{reply:decision}}); }
try {
 await waitForHealth(baseUrl,()=>({output,exit:spawnError ?? (child.exitCode===null?undefined:String(child.exitCode))}));
 await requestJson({baseUrl,path:"/experimental/tool/ids",timeoutSeconds:120});
 const events=await fetch(`${baseUrl}/event`,{signal:eventAbort.signal});
 void readEvents(events);
 if(!process.argv.includes("--web-only")) {
 for(const decision of ["reject","once"]){
  const session=await start("worklog_query",{input:{start:"2026-09-08",end:"2026-09-08"}});
  const permission=await waitPermission(session);
  check(permission.permission==="worklog_query","wrong worklog permission");
  check((await readdir(ipc)).length===0,"worklog ran before permission");
  await reply(expectString(permission.id,"permission id"),decision);
  if(decision==="once"){
   const deadline=Date.now()+8000;
   while((await readdir(ipc)).length===0&&Date.now()<deadline)await Bun.sleep(50);
   const requestFile=(await readdir(ipc)).find(name=>name.endsWith(".request"));
   check(requestFile,"approved worklog did not reach host IPC");
   const request=expectJsonObject(JSON.parse(await readFile(join(ipc,requestFile),"utf8")),"ipc");
   await writeFile(join(ipc,`${expectString(request.requestId,"request id")}.response`),JSON.stringify({version:1,requestId:request.requestId,status:"completed",result:{entries:[],reports:[]}}));
  } else {
   await Bun.sleep(250);
   check((await readdir(ipc)).length===0,"rejected worklog reached IPC");
  }
  evidence[`worklog_${decision}`]="pass";
  await requestRaw({baseUrl,path:`/session/${session}/abort`,method:"POST"});
 }
 const shell=await start("bash",{command:"echo PERMISSION_ACCEPTANCE",description:"Print a synthetic marker"});
 const shellPermission=await waitPermission(shell);
 check(shellPermission.permission==="bash","wrong shell permission");
 await reply(expectString(shellPermission.id,"shell permission"),"once");
 const deadline=Date.now()+10000;let shellDone=false;
 while(Date.now()<deadline&&!shellDone){
  const messages=JSON.stringify(await requestJson({baseUrl,path:`/session/${shell}/message`}));
  shellDone=messages.includes('"status":"completed"')&&messages.includes("PERMISSION_ACCEPTANCE");
  if(!shellDone)await Bun.sleep(100);
 }
 check(shellDone,"approved shell did not complete");evidence.shell_once="pass";
 }
 const nativeReady=join(root,"native-ready");
 const nativeOutput=join(root,"native-output.log");
 nativeTest=process.argv.includes("--native-events") ? Bun.spawn(["cargo","test","--lib","tool_permissions::events::tests::live_web_permission_without_timeout","--","--ignored","--exact","--nocapture"],{cwd:resolve("src-tauri"),env:{...process.env,YUME_PERMISSION_TEST_BASE:baseUrl,YUME_PERMISSION_TEST_READY:nativeReady},stdout:Bun.file(nativeOutput),stderr:Bun.file(nativeOutput+".stderr"),windowsHide:true}):undefined;
 if(nativeTest) {
  const readyDeadline=Date.now()+180000;
  while(!(await Bun.file(nativeReady).exists())) {check(Date.now()<readyDeadline,"native stream readiness timeout");await Bun.sleep(100);}
 }
 const web=await start("webfetch",{url:provider.baseUrl+"/models",format:"text"});
 if(nativeTest) {
  const exit=await nativeTest.exited;
  evidence.nativeOutput=(await readFile(nativeOutput,"utf8"))+(await readFile(nativeOutput+".stderr","utf8"));
  check(exit===0,"native permission stream test failed");evidence.native_web_reject="pass";
 } else {
  const webPermission=await waitPermission(web);
  check(webPermission.permission==="webfetch","wrong web permission");
  await reply(expectString(webPermission.id,"web permission"),"reject");evidence.web_reject="pass";
 }
 const cancelled=await start("bash",{command:"echo CANCELLED_MARKER",description:"Cancellation fixture"});
 const cancelledPermission=await waitPermission(cancelled);
 await requestRaw({baseUrl,path:`/session/${cancelled}/abort`,method:"POST"});
 await reply(expectString(cancelledPermission.id,"cancelled permission"),"reject");
 const remaining=await requestJson({baseUrl,path:"/permission"});
 check(Array.isArray(remaining)&&!remaining.some((item)=>isJsonObject(item)&&item.sessionID===cancelled),"abort left stale permissions");
 evidence.abort_then_reject="pass";
} catch(error:unknown) { evidence.failure=error instanceof Error?error.message:String(error); evidence.engineLog=output; throw error; }
finally {
 eventAbort.abort();
 if(nativeTest && nativeTest.exitCode===null) { nativeTest.kill(); await nativeTest.exited; }
 await stopChild(child);await provider.close();
 evidence.cleanup={sidecarPortClosed:await portClosed(port),processGone:await processGone(child.pid),providerPortClosed:await portClosed(provider.port)};
 await removeTempRoot(root);
 await mkdir(resolve('.omo/evidence/tool-permissions'),{recursive:true});
 await writeFile(resolve('.omo/evidence/tool-permissions/sidecar.json'),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}
