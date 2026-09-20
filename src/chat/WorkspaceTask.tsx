import { ToolApprovalCards } from "./ToolApprovalCards";
import type { AgentRunController } from "./useAgentRun";
import { dict } from "../lib/i18n";
import type { AgentHistoryDetails } from "../lib/history";

type Props = { readonly language: string; readonly agent: AgentRunController; readonly historyDetails?: AgentHistoryDetails; readonly onWorkspaceSelected?: () => void };
export function WorkspaceTask({ language, agent, historyDetails, onWorkspaceSelected }: Props) {
  const t = dict(language);
  const active = agent.projection.active;
  const recent = agent.projection.recent[0];
  const recentLabel = recent?.errorSummary === "scheduled_agent_busy" ? t.agentScheduledBusy : recent?.errorSummary === "scheduled_submission_failed" ? t.agentScheduledFailed : recent?.outcome ?? "—";
  const visibleWorkspace = agent.workspace ?? historyDetails?.workspacePath;
  const detailError = historyDetails?.availability === "retryable" ? t.agentHistoryDetailsRetryable : historyDetails?.availability === "missing" ? t.agentHistoryDetailsMissing : historyDetails?.availability === "workspace_missing" ? t.agentHistoryWorkspaceMissing : null;
  const chooseWorkspace = async () => {
    if (await agent.choose()) onWorkspaceSelected?.();
  };
  return <section className="workspace-task" aria-label={t.agentStart}>
    <div className="workspace-task-head">
      <button type="button" className="workspace-task-folder" onClick={() => void chooseWorkspace()} disabled={agent.busy}>{t.agentChooseFolder}</button>
      {agent.workspace && !agent.busy && <button type="button" className="workspace-task-clear" onClick={agent.clear} aria-label={t.close}>×</button>}
    </div>
    {visibleWorkspace ? <p className="workspace-task-path"><strong>{t.agentCurrentFolder}</strong><span title={visibleWorkspace}>{visibleWorkspace}</span></p> : <p className="workspace-task-note">{t.agentEmpty}</p>}
    {historyDetails && <p className="workspace-task-recent"><strong>{historyDetails.source === "scheduled" ? t.agentHistoryScheduled : t.agentHistoryInteractive}</strong> · {historyDetails.status}</p>}
    {active && <div className="workspace-task-status"><span>{active.workspacePath}</span><button type="button" onClick={() => void agent.stop()}>{t.chatStop}</button></div>}
    {agent.error && <p className="workspace-task-error" role="alert">{agent.error}</p>}
    {detailError && <p className="workspace-task-error" role="alert">{detailError}</p>}
    <ToolApprovalCards requests={agent.requests} error={false} onReply={agent.reply} t={t} />
    {agent.projection.artifacts.length > 0 && <div className="workspace-task-artifacts">
      <strong>{t.agentArtifacts}</strong>
      {agent.projection.artifacts.map((artifact) => <div className="workspace-task-artifact" key={artifact.reference}>
        <span title={artifact.path ?? artifact.command ?? artifact.label}>{artifact.path ?? artifact.command ?? artifact.label}</span>
        <small>{artifact.verified ? t.agentVerified : t.agentUnverified}</small>
        {artifact.kind === "file" && artifact.verified && <button type="button" onClick={() => void agent.locate(artifact)}>{t.agentOpenArtifact}</button>}
      </div>)}
    </div>}
    {!active && recent && <p className="workspace-task-recent"><strong>{t.agentRecent}</strong> · {recentLabel}</p>}
  </section>;
}
