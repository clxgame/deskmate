import { afterEach, beforeEach } from "bun:test";
import { cleanup } from "@testing-library/react";

export function installTimePopoverFixture() {
  let restore: (() => void) | undefined;
  beforeEach(() => {
    const originalShow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "showPopover");
    const originalHide = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "hidePopover");
    Object.defineProperties(HTMLElement.prototype, {
      showPopover: { configurable: true, value(this: HTMLElement) { this.style.display = "grid"; } },
      hidePopover: { configurable: true, value(this: HTMLElement) { this.style.display = "none"; } },
    });
    restore = () => {
      if (originalShow === undefined) Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
      else Object.defineProperty(HTMLElement.prototype, "showPopover", originalShow);
      if (originalHide === undefined) Reflect.deleteProperty(HTMLElement.prototype, "hidePopover");
      else Object.defineProperty(HTMLElement.prototype, "hidePopover", originalHide);
    };
  });
  afterEach(() => { cleanup(); restore?.(); });
}
