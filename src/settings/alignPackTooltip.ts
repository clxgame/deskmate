import type { SyntheticEvent } from "react";

export function alignPackTooltip(event: SyntheticEvent<HTMLElement>): void {
  positionPackTooltip(event.currentTarget);
}

export function positionPackTooltip(card: HTMLElement): void {
  const tooltip = card.querySelector<HTMLElement>(".set-pack-tooltip");
  const library = card.closest(".set-packs");
  if (tooltip === null || library === null) return;

  const cardBounds = card.getBoundingClientRect();
  const libraryBounds = library.getBoundingClientRect();
  const width = tooltip.getBoundingClientRect().width;
  const left = Math.max(libraryBounds.left - cardBounds.left,
    Math.min(0, libraryBounds.right - cardBounds.left - width));
  tooltip.style.left = left + "px";
}
