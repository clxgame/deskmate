import type { Dict } from "../lib/i18n";
import { CcSwitchSetupForm } from "./CcSwitchSetupForm";
import type {
  CcSwitchSetupController,
  RecoveryReturnStep,
} from "./CcSwitchSetupCardTypes";

type PanelProps = {
  readonly t: Dict;
  readonly controller: CcSwitchSetupController;
};

function assertNever(value: never): never {
  throw new Error(`Unhandled CC Switch setup step: ${value}`);
}

function recoveryFailureText(t: Dict, controller: CcSwitchSetupController): string {
  if (controller.step === "external-timeout") return t.ccSwitchSetupTimeout;
  if (controller.step === "changed-invalid") {
    const reason =
      controller.verification?.kind === "changedInvalid" ? controller.verification.reason : "unknown";
    return t.ccSwitchSetupChangedInvalid(reason);
  }
  return controller.error ?? t.ccSwitchSetupGenericFailure;
}

function ConfirmationPanel({ t, controller }: PanelProps) {
  return (
    <div
      ref={controller.dialogRef}
      className="ccswitch-state-panel"
      role="alertdialog"
      aria-labelledby="ccswitch-card-title"
      tabIndex={-1}
    >
      <p>{t.ccSwitchSetupDisclosure}</p>
      <p>{t.ccSwitchSetupRecoveryDisclosure}</p>
      <div className="ccswitch-actions">
        <button
          type="button"
          className="ccswitch-primary"
          onClick={() => void controller.actions.launch()}
          disabled={controller.submitting}
        >
          {t.ccSwitchSetupLaunch}
        </button>
        <button type="button" className="ccswitch-secondary" onClick={() => void controller.actions.cancel()}>
          {t.ccSwitchSetupCancel}
        </button>
      </div>
    </div>
  );
}

function ModelReadyPanel({ t, controller }: PanelProps) {
  const catalog = controller.catalog;
  if (!catalog) return null;
  return (
    <div className="ccswitch-state-panel">
      <p>{t.ccSwitchSetupModelReady(catalog.models.length)}</p>
      <label>
        <span>{t.model}</span>
        <select
          value={controller.selectedModelId}
          onChange={(event) => controller.actions.setSelectedModelId(event.target.value)}
          autoComplete="off"
        >
          {catalog.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ccswitch-check">
        <input
          type="checkbox"
          checked={controller.switchImmediately}
          onChange={(event) => controller.actions.setSwitchImmediately(event.target.checked)}
        />
        {t.ccSwitchSetupSwitchImmediately}
      </label>
      <button
        type="button"
        className="ccswitch-primary"
        onClick={() => void controller.actions.selectModel()}
        disabled={!controller.selectedModelId || controller.submitting}
      >
        {t.ccSwitchSetupContinue}
      </button>
    </div>
  );
}

function RecoveryActions({ t, controller, from }: PanelProps & { readonly from: RecoveryReturnStep }) {
  if (!controller.recoveryAvailable) return null;
  return (
    <div className="ccswitch-actions">
      <button
        type="button"
        className="ccswitch-secondary"
        onClick={() => controller.actions.showRestoreConfirmation(from)}
      >
        {t.ccSwitchSetupRestore}
      </button>
      <button
        type="button"
        className="ccswitch-secondary"
        onClick={() => controller.actions.showDiscardConfirmation(from)}
      >
        {t.ccSwitchSetupDiscard}
      </button>
    </div>
  );
}

function RecoveryFailurePanel({ t, controller, from }: PanelProps & { readonly from: RecoveryReturnStep }) {
  return (
    <div className="ccswitch-state-panel">
      <p>{recoveryFailureText(t, controller)}</p>
      <RecoveryActions t={t} controller={controller} from={from} />
    </div>
  );
}

function RestoreConfirmationPanel({ t, controller }: PanelProps) {
  return (
    <div
      ref={controller.dialogRef}
      className="ccswitch-state-panel"
      role="alertdialog"
      aria-labelledby="ccswitch-card-title"
      tabIndex={-1}
    >
      <p>{t.ccSwitchSetupRestoreDisclosure}</p>
      <div className="ccswitch-actions">
        <button
          type="button"
          className="ccswitch-primary"
          onClick={() => void controller.actions.restore()}
          disabled={controller.submitting}
        >
          {t.ccSwitchSetupRestore}
        </button>
        <button type="button" className="ccswitch-secondary" onClick={controller.actions.returnToRecoveryStep}>
          {t.ccSwitchSetupCancel}
        </button>
      </div>
    </div>
  );
}

function DiscardConfirmationPanel({ t, controller }: PanelProps) {
  return (
    <div
      ref={controller.dialogRef}
      className="ccswitch-state-panel"
      role="alertdialog"
      aria-labelledby="ccswitch-card-title"
      tabIndex={-1}
    >
      <p>{t.ccSwitchSetupDiscardDisclosure}</p>
      <div className="ccswitch-actions">
        <button
          type="button"
          className="ccswitch-primary"
          onClick={() => void controller.actions.discard()}
          disabled={controller.submitting}
        >
          {t.ccSwitchSetupDiscard}
        </button>
        <button type="button" className="ccswitch-secondary" onClick={controller.actions.returnToRecoveryStep}>
          {t.ccSwitchSetupCancel}
        </button>
      </div>
    </div>
  );
}

export function CcSwitchSetupCardBody(props: PanelProps) {
  const { t, controller } = props;
  switch (controller.step) {
    case "draft":
    case "unavailable":
    case "invalid":
      return <CcSwitchSetupForm t={t} controller={controller} />;
    case "validating":
      return <div className="ccswitch-state-panel" role="status" aria-live="polite">{t.ccSwitchSetupValidating}</div>;
    case "model-ready":
      return <ModelReadyPanel {...props} />;
    case "confirming":
      return <ConfirmationPanel {...props} />;
    case "launching":
    case "waiting-external-confirmation":
      return (
        <div className="ccswitch-state-panel" role="status" aria-live="polite">
          {controller.step === "launching" ? t.ccSwitchSetupLaunching : t.ccSwitchSetupWaiting}
        </div>
      );
    case "verified":
      return <div className="ccswitch-state-panel ccswitch-good" role="status">{t.ccSwitchSetupVerified}</div>;
    case "external-timeout":
    case "changed-invalid":
    case "failure":
      return <RecoveryFailurePanel {...props} from={controller.step} />;
    case "restore-confirmation":
      return <RestoreConfirmationPanel {...props} />;
    case "discard-confirmation":
      return <DiscardConfirmationPanel {...props} />;
    case "stale-conflict":
      return <div className="ccswitch-state-panel ccswitch-error" role="alert">{t.ccSwitchSetupStaleConflict}</div>;
    case "user-cancelled":
      return <div className="ccswitch-state-panel" role="status">{t.ccSwitchSetupCancelled}</div>;
    default:
      return assertNever(controller.step satisfies never);
  }
}
