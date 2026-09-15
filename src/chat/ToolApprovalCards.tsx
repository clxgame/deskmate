import { useState } from "react";
import type { Dict } from "../lib/i18n";
import { permissionKey, type PermissionReply, type PermissionRequest } from "../lib/toolPermissions";
import "./toolPermissions.css";

type Props = {
  readonly requests?: readonly PermissionRequest[];
  readonly error: boolean;
  readonly onReply: (request: PermissionRequest, reply: PermissionReply) => Promise<void>;
  readonly t: Dict;
};
function ApprovalCard({ request, onReply, t }: { readonly request: PermissionRequest; readonly onReply: Props["onReply"]; readonly t: Dict }) {
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = permissionKey(request.permission);
  const metadata = request.metadata;
  const summary = metadata && typeof metadata === "object"
    ? key === "shell" && "command" in metadata ? metadata.command
      : key === "web" && "url" in metadata ? metadata.url : undefined
    : undefined;
  const details = typeof summary === "string" ? summary : request.metadata && typeof request.metadata === "object" && Object.keys(request.metadata).length > 0
    ? JSON.stringify(request.metadata, null, 2) : request.patterns.join("\n");
  const respond = async (decision: PermissionReply) => {
    setSubmitting(true);
    setFailed(false);
    try { await onReply(request, decision); }
    catch (error: unknown) {
      setFailed(true);
      console.error("Tool approval failed", error instanceof Error ? error.message : String(error));
    } finally { setSubmitting(false); }
  };
  return <section className="chat-tool-approval" aria-label={t.permissionConfirm}>
    <strong>{t.permissionConfirm} · {key ? t.permissionLabels[key] : request.permission}</strong>
    <pre>{details}</pre>
    {failed && <p role="alert">{t.permissionFailed}</p>}
    <div className="chat-tool-approval-actions">
      <button disabled={submitting} onClick={() => void respond("once")}>{t.permissionAllowOnce}</button>
      <button disabled={submitting} onClick={() => void respond("reject")}>{t.permissionCancel}</button>
    </div>
  </section>;
}
export function ToolApprovalCards({ requests = [], error, onReply, t }: Props) {
  return <div className="chat-tool-approvals" aria-live="polite">
    {error && <p role="alert">{t.permissionFailed}</p>}
    {requests.map((request) => <ApprovalCard key={request.id} request={request} onReply={onReply} t={t} />)}
  </div>;
}
