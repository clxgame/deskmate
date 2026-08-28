import { useCcSwitchSetupController } from "./CcSwitchSetupCardState";
import type { CcSwitchSetupCardProps } from "./CcSwitchSetupCardTypes";
import { CcSwitchSetupCardView } from "./CcSwitchSetupCardView";

export type { CcSwitchSetupCardProps, SetupStep } from "./CcSwitchSetupCardTypes";

export function CcSwitchSetupCard(props: CcSwitchSetupCardProps) {
  const controller = useCcSwitchSetupController(props);
  return <CcSwitchSetupCardView t={props.t} controller={controller} />;
}
