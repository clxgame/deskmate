import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { spawn } from "node:child_process";
import { expectJsonObject, HarnessError, isJsonObject } from "../ccswitch-harness/types";
import { processGone } from "../ccswitch-harness/cleanup";

export const requiredScenarios = ["record-restart", "daily-weekly", "manual-version", "schedule-catchup", "failure-retry", "cancel-late-result", "copy-export", "delete-links", "chat-tool-authorization", "natural-readback"] as const;
const projectRoot = resolve(import.meta.dir,"../..");
const receiptPath = resolve(projectRoot,".omo/evidence/task-6-worklog-natural-recall-native.json");

function check(value: unknown,message:string): asserts value { if (!value) throw new HarnessError(`full-flow: ${message}`); }
function normalized(path:string):string { return path.replaceAll(/\\+/g,"/"); }
function owned(path:string,root=projectRoot):string {
  const absolute=resolve(root,normalized(path));
  const rel=relative(root,absolute);
  check(rel!==".."&&!rel.startsWith(`..${process.platform==="win32"?"\\":"/"}`)&&!isAbsolute(rel),"evidence path escapes owned root");
  return absolute;
}
async function digest(path:string):Promise<string> {
  const hash=createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex").toUpperCase();
}
function text(value:unknown,label:string):string { check(typeof value==="string"&&value.length>0,`${label} missing`); return value; }
function array(value:unknown,label:string):readonly unknown[] { check(Array.isArray(value),`${label} missing`); return value; }
function containsText(values:readonly unknown[],needle:string,label:string):void {
  check(values.some((value)=>typeof value==="string"&&value.includes(needle)),`${label} missing ${needle}`);
}

export function validateNativeReceipt(value:unknown):void {
  const receipt=expectJsonObject(value,"native receipt");
  check(receipt.version===1&&receipt.status==="pass","native flow is missing, failed or incomplete");
  const native=expectJsonObject(receipt.native,"native host");
  check(native.identity==="com.deskmate.worklogqa"&&native.guardPassed===true,"native isolation guard not proven");
  check(typeof native.appPid==="number"&&Number.isInteger(native.appPid)&&native.appPid>0,"native PID missing");
  check(Array.isArray(native.screenshots)&&native.screenshots.length>=2,"native screenshots missing");
  const scenarios=receipt.scenarios;
  check(Array.isArray(scenarios),"native scenarios missing");
  for (const id of requiredScenarios) {
    const scenario=scenarios.find(item=>isJsonObject(item)&&item.id===id);
    check(isJsonObject(scenario)&&scenario.status==="pass",`scenario ${id} not passed`);
    check(Array.isArray(scenario.evidence)&&scenario.evidence.length>0,`scenario ${id} has no native evidence`);
  }
  const natural=scenarios.find(item=>isJsonObject(item)&&item.id==="natural-readback");
  check(isJsonObject(natural),"scenario natural-readback not passed");
  const details=expectJsonObject(natural.details,"natural-readback details");
  check(details.exactPhrase==="昨天我做了什么","natural-readback exact phrase missing");
  check(details.toolName==="worklog_query","natural-readback did not call worklog_query");
  check(details.start==="2026-09-08"&&details.end==="2026-09-08","natural-readback date scope incorrect");
  for (const key of ["sessionId","messageId","callId"]) check(typeof details[key]==="string"&&details[key].length>0,`natural-readback ${key} missing`);
  containsText(array(details.answerFacts,"natural-readback answer facts"),"完成 2026-09-08 自然回查原生验证","natural-readback answer");
  containsText(array(details.answerFacts,"natural-readback answer facts"),"日报正文：自然回查读取完整归档报告","natural-readback answer");
  check(array(details.mutationEvents,"natural-readback mutation events").length===0,"natural-readback emitted mutation events");
  check(details.emptyBehavior==="no-records"&&details.failureBehavior==="query-failed","natural-readback empty/failure distinction missing");
  const manualQa=expectJsonObject(receipt.manualQa,"manualQa");
  check(array(manualQa.surfaceEvidence,"manualQa surfaceEvidence").length>0,"manualQa surfaceEvidence empty");
  check(array(manualQa.adversarialCases,"manualQa adversarialCases").length>0,"manualQa adversarialCases empty");
  check(array(manualQa.artifactRefs,"manualQa artifactRefs").length>0,"manualQa artifactRefs empty");
  const cleanup=expectJsonObject(receipt.cleanup,"native cleanup");
  for(const key of ["appProcessesGone","providerPortClosed","ownedRootsRemoved","credentialCleanup","exportCleanup"]) check(cleanup[key]===true,`cleanup ${key} incomplete`);
}

async function currentSources():Promise<readonly string[]> {
  const child=spawn("rg",["--files","--no-ignore","src","src-tauri/src","src-tauri/resources","public","scripts/worklog-qa"],{cwd:projectRoot,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let stdout="";
  child.stdout.on("data",(chunk:Buffer)=>{stdout+=chunk.toString();});
  child.stderr.resume();
  const code=await new Promise<number|null>((resolveExit,reject)=>{child.once("error",reject);child.once("exit",resolveExit);});
  check(code===0,"source enumeration failed");
  return [...stdout.trim().split(/\r?\n/),"src-tauri/Cargo.toml","src-tauri/Cargo.lock","src-tauri/tauri.conf.json","package.json","bun.lock","vite.config.ts","tsconfig.json","pet.html","chat.html","settings.html"].map(normalized);
}

export async function runFullFlow():Promise<void> {
  let raw:string;
  try { raw=await readFile(receiptPath,"utf8"); }
  catch(error) { if(error instanceof Error) throw new HarnessError("full-flow: native QA receipt missing; run isolated desktop scenarios before this gate"); throw error; }
  const receipt=expectJsonObject(JSON.parse(raw.replace(/^\uFEFF/,"")),"native receipt");
  validateNativeReceipt(receipt);
  const build=expectJsonObject(receipt.build,"native build");
  const buildHash=text(build.sha256,"build SHA256").toUpperCase();
  const created=Date.parse(text(build.created,"build timestamp"));
  check(Number.isFinite(created),"build timestamp invalid");
  const sources:unknown=typeof build.sourceHashes==="string"?JSON.parse(build.sourceHashes):build.sourceHashes;
  check(Array.isArray(sources)&&sources.length>0,"source hash manifest missing");
  const manifest=new Map<string,string>();
  for(const value of sources) {
    const entry=expectJsonObject(value,"source hash entry");
    const path=normalized(text(entry.path,"source path"));
    const hash=text(entry.sha256,"source hash").toUpperCase();
    check(!manifest.has(path),"duplicate source manifest path");
    manifest.set(path,hash);
    check(await digest(owned(path))===hash,`stale source evidence: ${path}`);
  }
  const current=new Set(await currentSources());
  check(current.size===manifest.size&&[...current].every(path=>manifest.has(path)),"source file inventory changed since native build");
  check(await digest(resolve(projectRoot,"src-tauri/target/debug/yume.exe"))===buildHash,"native binary hash changed since capture");
  const native=expectJsonObject(receipt.native,"native host");
  check(Array.isArray(native.screenshots),"screenshots missing");
  for(const value of native.screenshots) {
    const screenshot=expectJsonObject(value,"screenshot");
    const path=owned(text(screenshot.path,"screenshot path"));
    check(screenshot.buildSha256===build.sha256,"screenshot belongs to another build");
    check(Date.parse(text(screenshot.capturedAt,"capture timestamp"))>=created,"screenshot predates build");
    check(await digest(path)===text(screenshot.sha256,"screenshot hash").toUpperCase(),"screenshot bytes changed");
    check((await stat(path)).size>128,"screenshot empty");
    const bytes=await readFile(path);
    check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||(bytes[0]===255&&bytes[1]===216),"native capture is not PNG/JPEG data");
  }
  check(Array.isArray(receipt.scenarios),"scenarios missing");
  for(const value of receipt.scenarios) {
    const scenario=expectJsonObject(value,"scenario");
    check(scenario.status==="pass"&&Array.isArray(scenario.evidence)&&scenario.evidence.length>0,"native scenario incomplete");
    for(const value of scenario.evidence) {
      const metadata=await stat(owned(text(value,"scenario evidence")));
      check(metadata.size>0&&metadata.mtimeMs>=created,"scenario evidence empty or predates native build");
    }
  }
  const manualQa=expectJsonObject(receipt.manualQa,"manualQa");
  for(const value of array(manualQa.artifactRefs,"manualQa artifactRefs")) {
    const artifact=expectJsonObject(value,"manualQa artifact");
    const metadata=await stat(owned(text(artifact.path,"manualQa artifact path")));
    check(metadata.size>0&&metadata.mtimeMs>=created,"manualQa artifact empty or predates native build");
  }
  check(typeof native.appPid==="number"&&await processGone(native.appPid),"owned native app remains alive");
  console.log(`PASS worklog full-flow: ${requiredScenarios.length} native scenarios, ${manifest.size} current source hashes, ${native.screenshots.length} native captures, owned cleanup verified`);
}
