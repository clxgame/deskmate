import { worklogTool } from "../worklog-bridge";
export default worklogTool("query", "Read a direct current-turn request for natural self-work recall or explicitly requested work records. Provide required start and end dates. Returns { entries, reports }. Before updating, query first; ambiguous matches require user selection, and unknown operation IDs can be resolved before retrying.", {
  start: { type: "string" }, end: { type: "string" }, project: { type: "string" }, operationId: { type: "string" },
});
