import type { Dict } from "../lib/i18n";
import type { AiProvider } from "../lib/settings";
import type { LocalAiDeploymentStatus } from "./CcSwitchStatus";
import { displayProviderLabel } from "./aiProviderModel";
import type { ProviderVerifyResult } from "./useAiProviderActions";

export type ProviderField = "label" | "baseUrl" | "apiKey";

type AiProviderCardProps = {
  readonly provider: AiProvider;
  readonly index: number;
  readonly active: boolean;
  readonly collapsed: boolean;
  readonly removeDisabled: boolean;
  readonly t: Dict;
  readonly verifying: boolean;
  readonly verifyResult: ProviderVerifyResult | null;
  readonly deployment: LocalAiDeploymentStatus;
  readonly operationLocked: boolean;
  readonly onToggle: () => void;
  readonly onDelete: () => void;
  readonly onFieldChange: (field: ProviderField, value: string) => void;
  readonly onVerify?: (providerId: string) => void;
  readonly onDeploy?: (providerId: string) => void;
};

export function AiProviderCard({
  provider,
  index,
  active,
  collapsed,
  removeDisabled,
  t,
  verifying,
  verifyResult,
  deployment,
  operationLocked,
  onToggle,
  onDelete,
  onFieldChange,
  onVerify,
  onDeploy,
}: AiProviderCardProps) {
  const label = displayProviderLabel(provider, index, t);
  return (
    <article className="set-ai-provider-card" aria-label={label}>
      <div className="set-ai-provider-head">
        <span className="set-ai-provider-name">{label}</span>
        {active && (
          <span className="set-ai-provider-active">{t.aiProviderActive}</span>
        )}
        <div className="set-ai-provider-head-actions">
          <button
            className="set-btn"
            type="button"
            aria-label={`${collapsed ? t.aiProviderExpand : t.aiProviderCollapse} · ${label}`}
            onClick={onToggle}
          >
            {collapsed ? t.aiProviderExpand : t.aiProviderCollapse}
          </button>
          <button
            className="set-btn set-btn-danger set-ai-provider-remove"
            type="button"
            disabled={removeDisabled || operationLocked}
            title={removeDisabled ? t.aiProviderRemoveLast : t.aiProviderRemove}
            aria-label={
              removeDisabled ? t.aiProviderRemoveLast : t.aiProviderRemove
            }
            onClick={onDelete}
          >
            {t.aiProviderRemove}
          </button>
        </div>
      </div>
      {!collapsed && (
        <ProviderBody
          provider={provider}
          label={label}
          t={t}
          verifying={verifying}
          verifyResult={verifyResult}
          deployment={deployment}
          operationLocked={operationLocked}
          onFieldChange={onFieldChange}
          onVerify={onVerify}
          onDeploy={onDeploy}
        />
      )}
    </article>
  );
}

function ProviderBody({
  provider,
  label,
  t,
  verifying,
  verifyResult,
  deployment,
  operationLocked,
  onFieldChange,
  onVerify,
  onDeploy,
}: Omit<
  AiProviderCardProps,
  "index" | "active" | "collapsed" | "removeDisabled" | "onToggle" | "onDelete"
> & { readonly label: string }) {
  const fields = [
    { key: "label", label: t.aiProviderLabel, type: "text" },
    { key: "baseUrl", label: t.aiProviderBaseUrl, type: "text" },
    { key: "apiKey", label: t.aiProviderApiKey, type: "password" },
  ] as const;
  return (
    <div className="set-ai-provider-body">
      {fields.map((field) => (
        <label className="set-ai-provider-field" key={field.key}>
          <span>{field.label}</span>
          <input
            className="set-input"
            type={field.type}
            value={provider[field.key]}
            aria-label={`${field.label} · ${label}`}
            disabled={operationLocked}
            onChange={(event) => onFieldChange(field.key, event.target.value)}
          />
        </label>
      ))}
      <div className="set-ai-provider-actions">
        <button
          className="set-btn"
          type="button"
          disabled={!onVerify || operationLocked || !provider.apiKey.trim()}
          onClick={() => onVerify?.(provider.id)}
        >
          {verifying ? t.verifying : t.aiProviderVerify}
        </button>
        <button
          className="set-btn"
          type="button"
          disabled={
            !onDeploy || operationLocked || !provider.apiKey.trim()
          }
          title={t.aiProviderDeployHint}
          onClick={() => onDeploy?.(provider.id)}
        >
          {deployment.kind === "working" ? t.localAiDeployWorking : t.aiProviderDeploy}
        </button>
      </div>
      {verifyResult && (
        <p
          className={`set-note ${verifyResult.ok ? "set-note-ok" : "set-note-error"}`}
        >
          {verifyResult.message}
        </p>
      )}
    </div>
  );
}
