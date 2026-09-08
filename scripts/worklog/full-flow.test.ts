import { expect,test } from "bun:test";
import { validateNativeReceipt } from "./full-flow";

test("missing native flow cannot be promoted from synthetic tool evidence",()=> {
  expect(()=>validateNativeReceipt({version:1,status:"pass",productionResourceTransport:{syntheticReceipt:{status:"saved"}}})).toThrow();
});
test("not-run native scenario cannot pass full-flow",()=> {
  expect(()=>validateNativeReceipt({version:1,status:"pass",native:{identity:"com.deskmate.worklogqa",guardPassed:true,appPid:1,screenshots:[{},{}]},scenarios:[{id:"record-restart",status:"not_run",evidence:["fixture"]}]})).toThrow("not passed");
});
