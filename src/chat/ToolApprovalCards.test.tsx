import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ToolApprovalCards } from "./ToolApprovalCards";
import { dict } from "../lib/i18n";
import type { PermissionRequest } from "../lib/toolPermissions";

afterEach(cleanup);
const request: PermissionRequest={id:"p1",sessionID:"ses_a",permission:"bash",patterns:["echo fixture"],metadata:{command:"echo fixture"}};
test("allow and cancel target only the requested call", async()=>{
  const calls:unknown[]=[];
  const ui=render(<ToolApprovalCards requests={[request]} error={false} onReply={async(item,reply)=>{calls.push({item,reply});}} t={dict("zh-CN")} />);
  fireEvent.click(ui.getByRole("button",{name:"允许这一次"}));
  await waitFor(()=>expect(calls).toEqual([{item:request,reply:"once"}]));
});
test("cancel sends rejection, and failed submission stays retryable",async()=>{
  let fail=true;const replies:string[]=[];
  const ui=render(<ToolApprovalCards requests={[request]} error={false} onReply={async(_,reply)=>{replies.push(reply);if(fail)throw new Error("synthetic offline");}} t={dict("zh-CN")} />);
  fireEvent.click(ui.getByRole("button",{name:"取消"}));
  await waitFor(()=>expect(ui.getByRole("alert").textContent).toContain("处理失败"));
  fail=false;fireEvent.click(ui.getByRole("button",{name:"取消"}));
  await waitFor(()=>expect(replies).toEqual(["reject","reject"]));
});
