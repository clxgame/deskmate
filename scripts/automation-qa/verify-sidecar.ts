/** Isolated contract check: bundled OpenCode, local fixture model, no user credentials. */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const root = await mkdtemp(join(tmpdir(), "yume-auto-contract-"));
const binary = resolve("src-tauri/resources/opencode/opencode");
const observations: string[] = [];
let modelCalls = 0;
const requests: any[] = [];
const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/bridge") {
    const data = await request.json(); observations.push(data.kind);
    return Response.json({ ok: true, result: data.kind === "context" ? { block: "<user-memory>fixture</user-memory>" } : {} });
  }
  if (path.endsWith("/chat/completions")) {
    const body = await request.json(); modelCalls++; requests.push(body);
    const internal=JSON.stringify(body.messages).includes("YUME_INTERNAL_MEMORY_V1");
    const content = internal ? JSON.stringify({memories:[],work:[]}) : "fixture reply";
    if (body.stream) {
      const base = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture" };
      const chunks = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] }, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } }];
      return new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ id: "fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } });
  }
  if (path.endsWith("/models")) return Response.json({ data: [{ id: "fixture" }] });
  return new Response("not found", { status: 404 });
} });
const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("probe") });
const port = probe.port; probe.stop(true);
const workspace = join(root, "workspace");
await mkdir(join(workspace, ".opencode", "tools"), { recursive: true });
await writeFile(join(workspace, ".opencode", "tools", "memory_manage.ts"), await Bun.file("src-tauri/resources/opencode-tools/memory_manage.ts").text());
const contextPath = join(root, "context.json");
await writeFile(contextPath, JSON.stringify({ version: 1, block: "fixture persona", fingerprint: "fixture persona", excludeSessions: [], skipWhenHeadIncludes: ["YUME_INTERNAL_MEMORY_V1"], automationEndpoint: `${fixture.url}bridge`, automationToken: "fixture" }));
const env = { ...process.env, npm_config_registry: "https://registry.npmjs.org", npm_config_audit: "false", npm_config_fund: "false" };
delete env.BUN_BE_BUN;
delete env.OPENCODE_PURE;
Object.assign(env, {
 XDG_DATA_HOME: join(root,"data"), XDG_CONFIG_HOME: join(root,"config"), XDG_CACHE_HOME: join(root,"cache"), XDG_STATE_HOME: join(root,"state"),
 OPENCODE_CONFIG_DIR: join(root,"config","opencode"), OPENCODE_DISABLE_DEFAULT_PLUGINS:"true", OPENCODE_DISABLE_MODELS_FETCH:"1", OPENCODE_DISABLE_CLAUDE_CODE:"1", OPENCODE_SERVER_PASSWORD:"fixture", YUME_CONTEXT_FILE:contextPath,
 OPENCODE_CONFIG_CONTENT: JSON.stringify({ plugin:[resolve("src-tauri/src/yume-context-plugin.ts")], model:"fixture/fixture", small_model:"fixture/fixture", provider:{fixture:{npm:"@ai-sdk/openai-compatible",name:"fixture",options:{baseURL:`${fixture.url}v1`,apiKey:"fixture"},models:{fixture:{name:"fixture",limit:{context:16000,output:2000}}}}} }),
});
const child = Bun.spawn([binary,"serve","--print-logs","--hostname","127.0.0.1","--port",String(port)], {cwd:workspace,env,stdout:"pipe",stderr:"pipe"});
const output = new Response(child.stderr).text();
const auth = "Basic " + Buffer.from("opencode:fixture").toString("base64");
async function api(path:string,method="GET",body?:unknown) {
 const url = new URL(`http://127.0.0.1:${port}${path}`);url.searchParams.set("directory",workspace);
 const response=await fetch(url,{method,headers:{authorization:auth,"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
 const text=await response.text();return text?JSON.parse(text):null;
}
try {
 let ready=false;for(let i=0;i<80;i++){try{await api("/global/health");ready=true;break;}catch{await Bun.sleep(250);}}
 if(!ready)throw new Error("sidecar startup timed out");
 console.log("fixture ready");
 const session=await api("/session","POST",{title:"fixture user"});
 console.log("session created");
 const tools=await api("/experimental/tool/ids");
 console.log("tools",tools);
 if(!tools.includes("memory_manage"))throw new Error("memory tool not loaded");
 await api(`/session/${session.id}/prompt_async`,"POST",{messageID:"msg_fixture_user",model:{providerID:"fixture",modelID:"fixture"},parts:[{type:"text",text:"fixture ordinary user"}]});
 let complete=false;for(let i=0;i<100;i++){const messages=await api(`/session/${session.id}/message?limit=32`);if(messages.some((m:any)=>m.info.parentID==="msg_fixture_user"&&m.info.finish==="stop"&&m.info.time.completed)){complete=true;break;}await Bun.sleep(200);}
 if(!complete)throw new Error("native completion missing");
 if(!observations.includes("register")||!observations.includes("context"))throw new Error("managed hooks missing");
 const internal=await api("/session","POST",{parentID:session.id,title:"internal",permission:[{permission:"*",pattern:"*",action:"deny"}]});
 if((await api(`/session/${internal.id}`)).parentID!==session.id)throw new Error("child ownership missing");
 const toolsOff=Object.fromEntries(tools.map((id:string)=>[id,false]));
 await api(`/session/${internal.id}/prompt_async`,"POST",{messageID:"msg_fixture_internal",model:{providerID:"fixture",modelID:"fixture"},tools:toolsOff,system:"YUME_INTERNAL_MEMORY_V1\nReturn JSON only.",parts:[{type:"text",text:"fixture extraction"}]});
 let extracted=false;for(let i=0;i<100;i++){const messages=await api(`/session/${internal.id}/message?limit=32`);const reply=messages.find((m:any)=>m.info.parentID==="msg_fixture_internal"&&m.info.finish==="stop"&&m.info.time.completed);if(reply){const text=reply.parts.filter((p:any)=>p.type==="text").map((p:any)=>p.text).join("");JSON.parse(text);extracted=true;break;}await Bun.sleep(200);}
 if(!extracted)throw new Error("internal structured completion missing");
 const internalMessages=await api(`/session/${internal.id}/message?limit=32`);
 if(!internalMessages.find((m:any)=>m.info.id==="msg_fixture_internal")?.info.system?.includes("YUME_INTERNAL_MEMORY_V1"))throw new Error("native source system provenance missing");
 if(observations.filter(kind=>kind==="register").length!==1)throw new Error("internal extraction registered as a user turn");
 const extractionRequest=requests.find((r:any)=>JSON.stringify(r.messages).includes("YUME_INTERNAL_MEMORY_V1"));
 if(extractionRequest.tools?.length)throw new Error("internal tools were not disabled");
 if(JSON.stringify(extractionRequest.messages).includes("fixture persona"))throw new Error("internal persona contamination");

 await api(`/session/${internal.id}`,"DELETE");
 let missing=false;try{await api(`/session/${internal.id}`);}catch{missing=true;}
 if(!missing)throw new Error("internal session deletion failed");
 console.log(JSON.stringify({passed:true,hooks:[...new Set(observations)],modelCalls,toolLoaded:true,childLifecycle:true}));
} finally {
 child.kill();await Promise.race([child.exited,Bun.sleep(2000)]);if(child.exitCode===null)child.kill("SIGKILL");await child.exited;fixture.stop(true);
 const logs=await output;if(process.exitCode)console.error(logs.slice(-6000));
 await rm(root,{recursive:true,force:true});
}
