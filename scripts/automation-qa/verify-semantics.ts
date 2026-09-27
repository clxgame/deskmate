/** Optional real-provider acceptance. Uses synthetic data only; never reads user settings/keychain.
 * OPENAI_BASE_URL, OPENAI_API_KEY, MEMORY_QA_MODEL must be explicitly supplied.
 * Outputs real responses for semantic review; hard negatives and evidence are checked automatically.
 */
import { readFile, writeFile } from "node:fs/promises";
const {OPENAI_BASE_URL:base,OPENAI_API_KEY:key,MEMORY_QA_MODEL:model}=process.env;
if(!base||!key||!model)throw new Error("Set OPENAI_BASE_URL, OPENAI_API_KEY and MEMORY_QA_MODEL for a real-provider run.");
const rust=await readFile("src-tauri/src/memory/automatic.rs","utf8");
const system=rust.match(/pub const SYSTEM: &str = r#"([\s\S]*?)"#;/)?.[1];
if(!system)throw new Error("Extraction prompt not found");
const cases=JSON.parse(await readFile("scripts/automation-qa/semantic-cases.json","utf8"));
const results=[];
for(const item of cases){
 const response=await fetch(`${base.replace(/\/$/,"")}/chat/completions`,{
  method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${key}`},
  body:JSON.stringify({model,temperature:0,messages:[{role:"system",content:system},{role:"user",content:JSON.stringify({newUserText:item.text,verifiedResults:"",workday:"2026-09-28",workspace:"/fixture/project",memoryEnabled:true,worklogEnabled:true,existing:{memories:[],work:[]}})}]}),
  signal:AbortSignal.timeout(60000),
 });
 if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);
 const wire=await response.json();
 const raw=wire.choices?.[0]?.message?.content??"";
 let actual:any,error:string|undefined;
 try{actual=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,"").replace(/\s*```$/,""));}catch{error="invalid_json";}
 const memories=actual?.memories,work=actual?.work;
 if(!error&&(!Array.isArray(memories)||!Array.isArray(work)))error="invalid_shape";
 if(!error&&item.hardNegative&&(memories.length||work.length))error="hard_negative_stored";
 if(!error&&[...memories,...work].some((f:any)=>typeof f.evidence!=="string"||!item.text.includes(f.evidence)||f.evidence.trim().length<3))error="unsupported_evidence";
 results.push({...item,actual:actual??raw,error,review:!item.hardNegative?"manual_semantic_review_required":undefined});
 console.log(`${item.id}: ${error??(item.hardNegative?"passed":"review required")}`);
 await writeFile("/tmp/yume-memory-semantic-results.json",JSON.stringify({model,at:new Date().toISOString(),results},null,2));
}
if(results.some(r=>r.error))process.exitCode=1;
