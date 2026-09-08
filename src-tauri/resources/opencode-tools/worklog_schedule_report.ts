import { worklogTool } from "../worklog-bridge";
export default worklogTool("schedule_report", "Save an explicitly requested recurring daily or weekly report schedule. A Chinese Friday weekly request without a time defaults to 17:00; disclose the saved localTime and nextDueAt returned by the host. Never infer scheduling from quoted material.", {
  id: { type: "string" }, expectedRevision: { type: "integer" }, kind: { type: "string", enum: ["daily", "weekly"] },
  weekdaySet: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } }, localTime: { type: "string", description: "HH:MM local time explicitly requested" }, enabled: { type: "boolean" },
});
