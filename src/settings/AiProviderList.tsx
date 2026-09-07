import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Dict } from "../lib/i18n";
import type { Settings } from "../lib/settings";
import type { LocalAiDeploymentStatus } from "./CcSwitchStatus";
import {
  settingsWithAddedProvider,
  settingsWithDeletedProvider,
  settingsWithUpdatedProvider,
} from "./aiProviderModel";
import { AiProviderCard, type ProviderField } from "./AiProviderCard";
import { AiProviderTabs } from "./AiProviderTabs";
import type { ReplaceSettings } from "./settingsPrimitives";
import type { ProviderVerifyResult } from "./useAiProviderActions";

type AiProviderListProps = {
  readonly settings: Settings;
  readonly replace: ReplaceSettings;
  readonly t: Dict;
  readonly createProviderId?: () => string;
  readonly onChange?: () => void;
  readonly onVerify?: (providerId: string) => void;
  readonly onDeploy?: (providerId: string) => void;
  readonly verifyingProviderId?: string | null;
  readonly verifyResultFor?: (providerId: string) => ProviderVerifyResult | null;
  readonly deploymentFor?: (providerId: string) => LocalAiDeploymentStatus;
  readonly operationBusy?: boolean;
};

export function AiProviderList({
  settings,
  replace,
  t,
  createProviderId = () => crypto.randomUUID(),
  onChange,
  onVerify,
  onDeploy,
  verifyingProviderId,
  verifyResultFor,
  deploymentFor,
  operationBusy = false,
}: AiProviderListProps) {
  const [selectedId, setSelectedId] = useState(settings.activeProviderId);
  const [expanded, setExpanded] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const selectedProvider =
    settings.providers.find((provider) => provider.id === selectedId)
    ?? settings.providers.find((provider) => provider.id === settings.activeProviderId)
    ?? settings.providers[0];

  useEffect(() => {
    if (pendingDeleteId === null) return;
    const dialog = deleteDialogRef.current;
    if (dialog === null) return;

    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    cancelButtonRef.current?.focus();

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
    };
  }, [pendingDeleteId]);

  const closeDeleteDialog = (fallbackId = selectedProvider?.id) => {
    const trigger = deleteTriggerRef.current;
    setPendingDeleteId(null);
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
      else if (fallbackId) document.getElementById(`ai-provider-disclosure-${fallbackId}`)?.focus();
      else addButtonRef.current?.focus();
    });
  };

  const updateProvider = (
    providerId: string,
    field: ProviderField,
    value: string,
  ) => {
    onChange?.();
    replace(settingsWithUpdatedProvider(settings, providerId, { [field]: value }));
  };

  const addProvider = () => {
    const providerId = createProviderId();
    onChange?.();
    replace(settingsWithAddedProvider(settings, providerId));
    setSelectedId(providerId);
    setExpanded(true);
    window.requestAnimationFrame(() => {
      document.getElementById(`ai-provider-disclosure-${providerId}`)?.focus();
    });
  };

  const confirmDelete = () => {
    if (pendingDeleteId === null || operationBusy) return;
    onChange?.();
    const next = settingsWithDeletedProvider(settings, pendingDeleteId);
    const survivor = next.providers.find((provider) => provider.id === selectedProvider?.id)
      ?? next.providers.find((provider) => provider.id === next.activeProviderId)
      ?? next.providers[0];
    replace(next);
    setSelectedId(survivor?.id ?? next.activeProviderId);
    closeDeleteDialog(survivor?.id);
  };

  const trapDeleteDialogFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === confirmButtonRef.current) {
      event.preventDefault();
      cancelButtonRef.current?.focus();
    } else if (
      !event.shiftKey &&
      document.activeElement === cancelButtonRef.current
    ) {
      event.preventDefault();
      confirmButtonRef.current?.focus();
    }
  };

  return (
    <section aria-labelledby="ai-provider-section">
      <div className="set-ai-provider-title-row">
        <h3 id="ai-provider-section" className="set-section-head">
          {t.aiProviderSection}
        </h3>
        <button
          ref={addButtonRef}
          className="set-btn"
          type="button"
          disabled={operationBusy}
          onClick={addProvider}
        >
          {t.aiProviderAdd}
        </button>
      </div>
      <div className="set-ai-provider-list" data-expanded={expanded}>
        <AiProviderTabs
          providers={settings.providers}
          selectedId={selectedProvider?.id}
          expanded={expanded}
          onSelect={(providerId) => {
            setExpanded(providerId !== selectedProvider?.id || !expanded);
            setSelectedId(providerId);
          }}
          busyFor={(providerId) => verifyingProviderId === providerId
            || deploymentFor?.(providerId).kind === "working"}
          t={t}
        />
        {settings.providers.map((provider, index) => {
          const selected = expanded && provider.id === selectedProvider?.id;
          return (
            <div
              key={provider.id}
              id={`ai-provider-panel-${provider.id}`}
              className="set-ai-provider-panel"
              role="region"
              aria-labelledby={`ai-provider-disclosure-${provider.id}`}
              hidden={!selected}
            >
              {selected && (
                <AiProviderCard
                  key={provider.id}
                  provider={provider}
                  index={index}
                  active={settings.activeProviderId === provider.id}
                  removeDisabled={settings.providers.length === 1}
                  t={t}
                  onDelete={() => {
                    deleteTriggerRef.current =
                      document.activeElement instanceof HTMLButtonElement
                        ? document.activeElement
                        : null;
                    setPendingDeleteId(provider.id);
                  }}
                  onFieldChange={(field, value) =>
                    updateProvider(provider.id, field, value)
                  }
                  onVerify={onVerify}
                  onDeploy={onDeploy}
                  verifying={verifyingProviderId === provider.id}
                  verifyResult={verifyResultFor?.(provider.id) ?? null}
                  deployment={deploymentFor?.(provider.id) ?? { kind: "idle" }}
                  operationLocked={operationBusy}
                />
              )}
            </div>
          );
        })}
      </div>
      {pendingDeleteId !== null && (
        <dialog
          ref={deleteDialogRef}
          className="set-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ai-provider-remove-confirm-title"
          onKeyDown={trapDeleteDialogFocus}
          onCancel={(event) => {
            event.preventDefault();
            closeDeleteDialog();
          }}
        >
          <p
            id="ai-provider-remove-confirm-title"
            className="set-confirm-body"
          >
            {t.aiProviderRemoveConfirm}
          </p>
          <div className="set-confirm-actions">
            <button
              ref={confirmButtonRef}
              className="set-btn set-btn-danger"
              type="button"
              disabled={operationBusy}
              onClick={confirmDelete}
            >
              {t.aiProviderRemove}
            </button>
            <button
              ref={cancelButtonRef}
              className="set-btn"
              type="button"
              onClick={() => closeDeleteDialog()}
            >
              {t.aiProviderRemoveCancel}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
