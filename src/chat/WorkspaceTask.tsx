import { ToolApprovalCards } from "./ToolApprovalCards";
import type { AgentRunController } from "./useAgentRun";
import { dict } from "../lib/i18n";

type Props = { readonly language: string; readonly agent: AgentRunController };
export function WorkspaceTask({ language, agent }: Props) {
  const t = dict(language);
  const active = agent.projection.active;
  const recent = agent.projection.recent[0];
  const recentLabel = recent?.errorSummary === "scheduled_agent_busy" ? t.agentScheduledBusy : recent?.errorSummary === "scheduled_submission_failed" ? t.agentScheduledFailed : recent?.outcome ?? "—";
  return <section className="workspace-task" aria-label={t.agentStart}>
    <div className="workspace-task-head">
      <button type="button" className="workspace-task-folder" onClick={() => void agent.choose()} disabled={agent.busy}>{t.agentChooseFolder}</button>
      {agent.workspace && !agent.busy && <button type="button" className="workspace-task-clear" onClick={agent.clear} aria-label={t.close}>×</button>}
    </div>
    {agent.workspace ? <p className="workspace-task-path"><strong>{t.agentCurrentFolder}</strong><span title={agent.workspace}>{agent.workspace}</span></p> : <p className="workspace-task-note">{t.agentEmpty}</p>}
    {active && <div className="workspace-task-status"><span>{active.workspacePath}</span><button type="button" onClick={() => void agent.stop()}>{t.chatStop}</button></div>}
    {agent.error && <p className="workspace-task-error" role="alert">{agent.error}</p>}
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
