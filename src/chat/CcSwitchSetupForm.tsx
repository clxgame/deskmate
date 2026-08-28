import type { Dict } from "../lib/i18n";
import type { CcSwitchSetupController } from "./CcSwitchSetupCardTypes";

type CcSwitchSetupFormProps = {
  readonly t: Dict;
  readonly controller: CcSwitchSetupController;
};

export function CcSwitchSetupForm({ t, controller }: CcSwitchSetupFormProps) {
  return (
    <form className="ccswitch-form" onSubmit={(event) => void controller.actions.validate(event)}>
      <label>
        <span>{t.ccSwitchSetupProviderName}</span>
        <input
          value={controller.providerName}
          onChange={(event) => controller.actions.setProviderName(event.target.value)}
          autoComplete="off"
        />
      </label>
      <label>
        <span>{t.baseUrl}</span>
        <input
          value={controller.endpoint}
          onChange={(event) => controller.actions.setEndpoint(event.target.value)}
          placeholder="https://api.example.com/v1"
          autoComplete="url"
        />
      </label>
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
      {controller.error && <p className="ccswitch-error">{controller.error}</p>}
      <button
        type="submit"
        className="ccswitch-primary"
        disabled={!controller.canValidate || controller.submitting}
      >
        {t.ccSwitchSetupValidate}
      </button>
    </form>
  );
}
