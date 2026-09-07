import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { KeyboardIcon } from "@phosphor-icons/react/dist/csr/Keyboard";
import { PackageIcon } from "@phosphor-icons/react/dist/csr/Package";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PawPrintIcon } from "@phosphor-icons/react/dist/csr/PawPrint";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import "./icons.css";

const ICONS = {
  general: GearSixIcon,
  ai: SparkleIcon,
  widget: SquaresFourIcon,
  shortcuts: KeyboardIcon,
  pet: PawPrintIcon,
  memory: BrainIcon,
  about: InfoIcon,
  close: XIcon,
  history: ClockCounterClockwiseIcon,
  attachment: PaperclipIcon,
  pack: PackageIcon,
  add: PlusIcon,
  delete: TrashIcon,
} as const;

export type AppIconName = keyof typeof ICONS;
export type AppIconSize = 16 | 18 | 20 | 24;

type AppIconProps = {
  readonly name: AppIconName;
  readonly size?: AppIconSize;
  readonly className?: string;
};

export function AppIcon({ name, size = 20, className }: AppIconProps) {
  const Icon = ICONS[name];
  const iconClassName = `app-icon app-icon-${size}`;

  return (
    <Icon
      className={className ? `${iconClassName} ${className}` : iconClassName}
      size={size}
      weight="regular"
      color="currentColor"
      aria-hidden="true"
      focusable="false"
    />
  );
}
