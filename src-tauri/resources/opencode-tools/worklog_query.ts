import { worklogTool } from "../worklog-bridge";
export default worklogTool("query", "Read explicitly requested work records, or resolve an unknown operation ID before retrying. Query before updating; ambiguous matches require user selection.", {
  start: { type: "string" }, end: { type: "string" }, project: { type: "string" }, operationId: { type: "string" },
});
