import { worklogTool } from "../worklog-bridge";
export default worklogTool("record", "Save an explicitly requested work journal entry. A completed host receipt is required before claiming saved.", {
  businessDate: { type: "string", description: "ISO YYYY-MM-DD date from user request" },
  project: { type: "string" }, text: { type: "string", maxLength: 20000 },
  status: { type: "string", enum: ["done", "in_progress", "blocked", "planned"] },
  kind: { type: "string", enum: ["daily"] }, periodStart: { type: "string" }, periodEnd: { type: "string" },
  bodyMarkdown: { type: "string", description: "For a complete daily report supplied by user, preserve its full text instead of reducing it to an entry", maxLength: 20000 }, expectedRevision: { type: "integer" },
});
