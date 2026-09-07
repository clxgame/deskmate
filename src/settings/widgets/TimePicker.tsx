import { useCallback, useId, useRef, useState, type RefObject } from "react";
import type { Dict } from "../../lib/i18n";
import { AppIcon } from "../../ui/AppIcon";
import { TimeColumn } from "./TimeColumn";
import { useTimePopover } from "./useTimePopover";
import "./time-picker.css";

interface TimePickerProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly t: Dict;
}

interface TimePickerPopupProps extends TimePickerProps {
  readonly id: string;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly onDismiss: (restoreFocus: boolean) => void;
}

function TimePickerPopup({ value, onChange, t, id, triggerRef, onDismiss }: TimePickerPopupProps) {
  const [hour, setHour] = useState(Number(value.slice(0, 2)));
  const [minute, setMinute] = useState(Number(value.slice(3, 5)));
  const popupRef = useTimePopover({ triggerRef, onDismiss });
  return (
    <div id={id} className="set-time-picker" role="dialog" aria-labelledby={`${id}-title`}
      popover="manual" ref={popupRef}>
      <span id={`${id}-title`} className="set-time-picker-title">{t.timePickerTitle}</span>
      <div className="set-time-picker-columns">
        <TimeColumn label={t.timePickerHour} count={24} value={hour} onChange={setHour} />
        <TimeColumn label={t.timePickerMinute} count={60} value={minute} onChange={setMinute} />
      </div>
      <div className="set-time-picker-actions">
        <button type="button" className="set-time-picker-cancel" onClick={() => onDismiss(true)}>
          {t.timePickerCancel}
        </button>
        <button type="button" className="set-time-picker-confirm" onClick={() => {
          onChange(`${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`);
          onDismiss(true);
        }}>{t.timePickerConfirm}</button>
      </div>
    </div>
  );
}

export function TimePicker({ value, onChange, t }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupId = useId();
  const dismiss = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  return (
    <div className="set-time-picker-field">
      <button type="button" className="set-time-picker-trigger" ref={triggerRef}
        aria-label={t.taskTime} aria-haspopup="dialog" aria-controls={popupId} aria-expanded={open}
        onPointerDown={(event) => { if (open) event.preventDefault(); }}
        onClick={() => { if (open) dismiss(true); else setOpen(true); }}>
        <span>{value}</span><AppIcon name="caretDown" size={16} />
      </button>
      {open && <TimePickerPopup id={popupId} value={value} onChange={onChange} t={t}
        triggerRef={triggerRef} onDismiss={dismiss} />}
    </div>
  );
}
