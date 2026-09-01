import type { Dict } from "../lib/i18n";
import type { CcSwitchSetupController } from "./CcSwitchSetupCardTypes";

type CcSwitchSetupFormProps = {
  readonly t: Dict;
  readonly controller: CcSwitchSetupController;
};

export function CcSwitchSetupForm({ t, controller }: CcSwitchSetupFormProps) {
  const usesSavedCredential = controller.credentialMode === "saved-settings";
  return (
    <form className="ccswitch-form" onSubmit={(event) => void controller.actions.validate(event)}>
      <label>
        <span>{t.ccSwitchSetupProviderName}</span>
        <input
          ref={controller.providerNameInputRef}
          value={controller.providerName}
          onChange={(event) => controller.actions.setProviderName(event.target.value)}
          autoComplete="off"
        />
      </label>
      <label>
        <span>{t.baseUrl}</span>
        <input
          value={controller.endpoint}
          readOnly={usesSavedCredential}
          onChange={(event) => controller.actions.setEndpoint(event.target.value)}
          placeholder="https://api.example.com/v1"
          autoComplete="url"
        />
      </label>
      {usesSavedCredential ? (
        <p className="ccswitch-note">{t.ccSwitchSetupSavedCredentialHint}</p>
      ) : (
        <label>
          <span>{t.apiKey}</span>
          <input
            ref={controller.apiKeyInputRef}
            onChange={(event) =>
              controller.actions.setHasApiKey(event.target.value.trim().length > 0)
            }
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      )}
      {controller.error && <p className="ccswitch-error">{controller.error}</p>}
      <button
        type="submit"
        className="ccswitch-primary"
        disabled={!controller.canValidate || controller.submitting}
      >
        {usesSavedCredential ? t.ccSwitchSetupUseSavedCredential : t.ccSwitchSetupValidate}
      </button>
    </form>
  );
}
