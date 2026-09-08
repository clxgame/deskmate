import { worklogTool } from "../worklog-bridge";
export default worklogTool("generate_report", "Queue an explicitly requested daily or weekly report from saved sources. A queued receipt means scheduled for generation, not generated. Never invent missing material.", {
  kind: { type: "string", enum: ["daily", "weekly", "custom"] }, periodStart: { type: "string" }, periodEnd: { type: "string" },
});
