import { worklogTool } from "../worklog-bridge";
export default worklogTool("update", "Update one explicitly requested entry or report using the revision returned by worklog_query. For reports use kind/periodStart/periodEnd/bodyMarkdown/expectedRevision; for entries use id/businessDate/text/status/expectedRevision.", {
  id: { type: "string" }, expectedRevision: { type: "integer" }, businessDate: { type: "string" },
  project: { type: "string" }, text: { type: "string", maxLength: 20000 }, status: { type: "string", enum: ["done", "in_progress", "blocked", "planned"] },
  kind: { type: "string", enum: ["daily", "weekly", "custom"] }, periodStart: { type: "string" }, periodEnd: { type: "string" }, bodyMarkdown: { type: "string", maxLength: 20000 },
});
