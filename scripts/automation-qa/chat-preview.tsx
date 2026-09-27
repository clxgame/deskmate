/** Browser-only fixture for the real chat UI. Never included in production entries. */
import React from "react";
import { createRoot } from "react-dom/client";
import { nativeHistoryFixture, registeredHistoryFixture, catalogPageFixture } from "../../src/testing/historyCatalogFixtures";
import "../../src/theme.css";
const win = window as any;
let callback = 0;
const session = "ses_preview";
const messages: any[] = [];
let events: ReadableStreamDefaultController<Uint8Array> | undefined;
win.__TAURI_INTERNALS__ = {
 metadata: { currentWindow: { label: "chat" }, currentWebview: { label: "chat" } },
 transformCallback: (fn: Function) => { const id = ++callback; win[`_${id}`] = fn; return id; },
 unregisterCallback: () => {}, convertFileSrc: (path: string) => path,
 invoke: async (command: string, args: any = {}) => {
  switch(command) {
   case "get_settings": return {language:"zh-CN",theme:"lavender",personaId:"xiaozhu",userName:"",providerId:"fixture",modelId:"fixture",memoryAutoExtract:true,memoryAiUse:true,worklogAutoArchive:true,scheduledTasks:[],providers:[],mouseFollow:false};
   case "load_persona": return {persona:"你是小著。",skills:null,placeholders:null};
   case "chat_model_resolve": return {configuredProviderId:"fixture",sidecarId:"fixture",modelId:"fixture",modelName:"预览模型"};
   case "history_model_selection_get": return {mode:"inherit"};
   case "history_recent_workspaces":
   case "tool_permission_pending": return [];
   case "history_register_native_session": return registeredHistoryFixture(args);
   case "history_catalog_list": return catalogPageFixture([]);
   case "history_catalog_load": return {entry:nativeHistoryFixture(session,"."),messages:[]};
   case "sidecar_base_url": return location.origin;
   case "memory_context": return {memories:[],promptBlock:""};
   case "memory_automation_status": return {pending:0,failed:0};
   case "agent_run_read": return {active:null,recent:[]};
   case "plugin:event|listen": return ++callback;
   default:return undefined;
  }
 }
};
win.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
const originalFetch=window.fetch.bind(window);
window.fetch=async(input: any,init?:RequestInit)=>{
 const url=new URL(String(input),location.href);
 if(url.pathname==="/event")return new Response(new ReadableStream<Uint8Array>({start(controller){events=controller;}}),{headers:{"Content-Type":"text/event-stream"}});
 if(url.pathname==="/session") return Response.json(init?.method==="POST"?{id:session,title:"预览",directory:"."}:[]);
 if(url.pathname.endsWith("/prompt_async")){
  const body=JSON.parse(String(init?.body));const user=body.parts.find((p:any)=>p.type==="text")?.text??"";
  messages.push({info:{id:body.messageID,sessionID:session,role:"user",time:{created:Date.now()}},parts:[{type:"text",text:user}]});
  messages.push({info:{id:`msg_reply_${messages.length}`,sessionID:session,role:"assistant",parentID:body.messageID,finish:"stop",time:{created:Date.now(),completed:Date.now()}},parts:[{type:"text",text:user.includes("模型")?"这是界面预览。模型信息会由当前会话配置决定。":"好，我们继续。以后会按你的偏好简短回答，工作进展也会在后台整理。"}]});
  setTimeout(()=>{
   const reply=messages[messages.length-1];
   for(const event of [
    {type:"message.updated",properties:{info:reply.info}},
    {type:"message.part.updated",properties:{part:{...reply.parts[0],id:`part_${reply.info.id}`,messageID:reply.info.id,sessionID:session}}},
    {type:"session.idle",properties:{sessionID:session}}
   ])events?.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  },120);
  return new Response(null,{status:204});
 }
 if(url.pathname.endsWith("/message"))return Response.json(messages.map(m=>({...m,parts:m.parts.map((p:any,index:number)=>({...p,id:`part_${m.info.id}_${index}`,messageID:m.info.id,sessionID:session}))})));
 if(url.pathname.endsWith("/abort"))return new Response(null,{status:204});
 if(url.pathname==="/session/status")return Response.json({});
 return originalFetch(input,init);
};
const {default:ChatApp}=await import("../../src/chat/ChatApp");
createRoot(document.getElementById("root")!).render(<ChatApp/>);
