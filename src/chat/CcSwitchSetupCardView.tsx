import type { Dict } from "../lib/i18n";
import { CcSwitchSetupCardBody } from "./CcSwitchSetupCardPanels";
import type { CcSwitchSetupController } from "./CcSwitchSetupCardTypes";

type CcSwitchSetupCardViewProps = {
  readonly t: Dict;
  readonly controller: CcSwitchSetupController;
};

export function CcSwitchSetupCardView({ t, controller }: CcSwitchSetupCardViewProps) {
  return (
    <section className="ccswitch-card" aria-label={t.ccSwitchSetupTitle}>
      <div className="ccswitch-card-head">
        <div>
          <div id="ccswitch-card-title" className="ccswitch-card-title">
            {t.ccSwitchSetupTitle}
          </div>
          <div className="ccswitch-card-status" role="status" aria-live="polite">
            {t.ccSwitchSetupState(controller.step)}
          </div>
        </div>
        <button
          type="button"
          className="ccswitch-close"
          onClick={() => void controller.actions.close()}
          aria-label={t.close}
        >
          ×
        </button>
      </div>
      <CcSwitchSetupCardBody t={t} controller={controller} />
    </section>
  );
}
