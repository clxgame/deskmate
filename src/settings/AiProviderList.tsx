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
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);

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

  const closeDeleteDialog = () => {
    const trigger = deleteTriggerRef.current;
    setPendingDeleteId(null);
    window.requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus();
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

  const toggleProvider = (providerId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const addProvider = () => {
    onChange?.();
    replace(settingsWithAddedProvider(settings, createProviderId()));
  };

  const confirmDelete = () => {
    if (pendingDeleteId === null) return;
    onChange?.();
    replace(settingsWithDeletedProvider(settings, pendingDeleteId));
    closeDeleteDialog();
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
      <div className="set-ai-provider-list">
        {settings.providers.map((provider, index) => {
          const isCollapsed = collapsed.has(provider.id);
          const removeDisabled = settings.providers.length === 1;
          return (
            <AiProviderCard
              key={provider.id}
              provider={provider}
              index={index}
              active={settings.activeProviderId === provider.id}
              collapsed={isCollapsed}
              removeDisabled={removeDisabled}
              t={t}
              onToggle={() => toggleProvider(provider.id)}
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
              onClick={confirmDelete}
            >
              {t.aiProviderRemove}
            </button>
            <button
              ref={cancelButtonRef}
              className="set-btn"
              type="button"
              onClick={closeDeleteDialog}
            >
              {t.aiProviderRemoveCancel}
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}
