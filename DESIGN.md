# YUME Design System

## 1. Atmosphere & Identity

YUME is a quiet floating companion: compact, lightly playful, and calm enough to live on the desktop. The default signature is a layered charcoal surface with a blue signal accent, while the settings window also offers mint, peach, and lavender themes for a fresher, cuter mood.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Surface | `--surface` | `#1c1c26` | Window shell |
| Surface raised | `--surface-raised` | `#252531` | Titlebar and active layers |
| Surface sunken | `--surface-sunken` | `#12121a` | Inputs and selects |
| Surface hover | `--surface-hover` | `rgba(255, 255, 255, 0.07)` | Hover state |
| Line | `--line` | `rgba(255, 255, 255, 0.08)` | Dividers |
| Line strong | `--line-strong` | `rgba(255, 255, 255, 0.12)` | Control borders |
| Text | `--text` | `#eee` | Primary copy |
| Text dim | `--text-dim` | `#aaa` | Secondary copy |
| Accent | `--accent` | `#4a7dff` | Active tab and focus |
| Accent soft | `--accent-soft` | `rgba(74, 125, 255, 0.16)` | Active tab surface |
| Accent hover | `--accent-hover` | `#6b93ff` | Hover state for accent buttons |
| Success | `--success` | `#7dd97d` | Successful verification/update copy |
| Danger | `--danger` | `#ff8080` | Destructive or failed state copy |
| Warning | `--warn` | `#ffb066` | Caution copy |

Theme variants keep the same semantic roles and only swap their palette:

| Theme | Surface | Accent | Text | Mood |
|---|---|---|---|---|
| `dark` | `#1c1c26` | `#4a7dff` | `#eee` | Quiet charcoal default |
| `mint` | `#f6fcf9` | `#57b89a` | `#244338` | Mint cream |
| `peach` | `#fff8f5` | `#e89a7d` | `#4e2f2b` | Peach frosting |
| `lavender` | `#faf8ff` | `#a58be0` | `#352c4f` | Lavender sugar |

Rules: interactive accents use `--accent`; new colors extend this table first. Every theme must preserve readable contrast and native control focus. The settings document and root are transparent outside `--r-window` and clip their contents to the rounded window; native window shadows are disabled so no square corner artifact remains. The 3D model uses the glb-viewer toon shader's authored light ramp rather than UI colors.

Theme scope: `.set-root`, `.chat-root`, and `.pet-root` carry the same `data-theme` value so a selected palette applies to settings, conversation/history surfaces, and the desktop pet shell together.

## 3. Typography

Primary font: `"Segoe UI", "Microsoft YaHei", system-ui, sans-serif`.

| Token | Value | Usage |
|---|---|---|
| `--t-title` | `14px` | Window title |
| `--t-body` | `13px` | Body and controls |
| `--t-label` | `13px` | Row labels and tabs |
| `--t-small` | `11px` | Notes and metadata |
| `--t-head` | `15px` | Panel headings |
| `--t-count` | `24px` | Persona pack count |

## 4. Spacing & Layout

All spacing uses a 4px base: `--s-0-5` 2px, `--s-1` 4px, `--s-2` 8px, `--s-3` 12px, `--s-4` 16px, `--s-5` 20px, `--s-6` 24px, `--s-8` 32px, `--s-14` 56px. Persona pack tiles use the explicit `--pack-tile-size` metric at `60px`; the Desktop pet control group uses `--pet-slider-w` at `140px`, and the lower active-persona selector uses `--active-persona-control-w` at `180px` so labels remain readable in the compact settings panel. The settings sidebar is `160px`; controls are `240px`; the titlebar is `44px`.

## 5. Components

### Settings row
- Structure: label plus right-aligned control inside `.set-row`.
- States: default, hover/focus on control, disabled where applicable, loading for async data.
- Accessibility: controls retain visible labels and native keyboard behavior.

### Desktop pet controls
- Structure: the Desktop pet tab starts with a compact raised group for pet scale and visibility, followed by nickname, pack management, mouse-follow, and render tuning.
- The duplicate top-of-panel persona selector is intentionally omitted; the pack section keeps paired `角色包` and `角色` selectors below the grid so the active character is always chosen within one pack.
- Accessibility: native range and switch controls retain visible labels and immediate settings-changed feedback.

### Persona library
- Structure: a heading and live availability summary followed by a compact grid of 60px square persona-pack tiles. Each tile keeps the name, semantic status, numeric count, and contextual action as a compact overlay; the grid remains dense on narrow settings windows.
- Availability is derived from the backend: built-in packs are always ready, installed packs show their installed version and actual on-disk persona subset, and absent packs show their manifest capacity as an offline option.
- Pack tiles prioritize the supplied transparent thumbnail, pack name, status, and one numeric character count. Loaded thumbnails render at normal brightness; not-installed thumbnails are dimmed. Descriptions and import-format guidance are not persistent copy; they appear in a delayed tooltip on hover or focus.

### Persona pack card
- Structure: a 60px square tile with a full-bleed transparent PNG thumbnail, pack name, semantic status badge, one numeric character count, and one contextual action layered inside the tile. Available packs use a borderless, backgroundless 24px SVG plus action; installed packs use the same treatment with a minus action. Labels remain available through each button's accessible name and title.
- Variants: `builtin`, `installed`, and `available`; only installed removable packs expose the destructive action.
- Counts for installed packs use the backend's actual `personaIds`, never the static manifest total. Each tile shows only the total character count; detailed descriptions and import guidance remain available through the delayed tooltip.
- States: default, import busy, uninstall busy, keyboard focus, delayed hover tooltip, success, and error. Motion is limited to action affordances, status changes, and the tooltip reveal.

### Character render tuning
- The Desktop pet tab exposes native sliders for outline width (`0..0.03`, default `0.0008`), rim-light width (`0..1`, default `0.1`), rim-light intensity (`0..2`, default `0.3`), and toon specular (`0..2`, default `0.05`).
- Values are persisted with the persona settings and pushed to the active glb-viewer toon shader immediately after a debounced save; switching personas reapplies the saved tuning.
- Slider values show a compact numeric readout and retain keyboard/native range-input accessibility.

### Mouse-follow interaction
- The Desktop pet tab includes an independent `mouseFollow` switch. When enabled, the desktop pet turns toward the global cursor with a bounded yaw/pitch response; when disabled, it eases back to its authored forward pose.
- Cursor polling is throttled to 25Hz and the model rotation uses exponential smoothing so the interaction feels responsive without jitter or excessive IPC traffic.

### Tab button
- Structure: icon glyph plus label in `.set-tab`.
- States: default, hover, active, keyboard focus.

### Memory receipt (chat)
- Structure: `.chat-memory-receipt` — an accent-tinted strip under the message, holding the remembered text and an inline Undo link.
- States: default; the Undo link disappears once the memory is no longer freshly saved.
- The controls that produce it (`.chat-msg-actions`) stay at zero opacity until the message is hovered or focused, so a conversation never turns into a row of buttons.
- Accessibility: the receipt is a `role="status"` live region so a save is announced; every control is a real focusable button with a visible focus ring.

### Sensitive-storage confirmation (chat)
- Structure: `.chat-memory-confirm` — a `--warn` bordered card with a title, the local-storage disclosure, and confirm/decline buttons.
- States: only rendered while a decision is pending; dismissing it stores nothing.
- Accessibility: `role="alertdialog"`; both actions are keyboard reachable and the wording states where the data will live before the user commits.

### Memory list row (settings)
- Structure: `.set-memory-item` — content, then a `.set-memory-meta` line carrying type, scope, date, and the reason the memory exists, then per-row edit/forget actions.
- States: default; replaced and expired rows drop to 0.6 opacity and gain a `--warn` status label; the edit state swaps the content for a textarea.
- Destructive actions never fire directly — they open `.set-memory-confirm`, which names what will be deleted and that it cannot be undone.

## 6. Motion & Interaction

Use `--ease` for control transitions and `--tooltip-delay` (`420ms`) for persona-pack tooltip reveals. Tooltip depth uses `--shadow-tooltip`. Persona changes are stateful but not animated in the settings surface; the pet renderer fades through a model swap only if a future transition is added. Mouse-follow rotation eases at a bounded rate and returns to neutral when disabled. Respect reduced-motion preferences for any future model transition.

## 7. Depth & Surface

Strategy: mixed tonal layers with subtle borders. The settings shell uses `--surface`, raised titlebar/sidebar layers, sunken controls, and low-contrast divider lines; it avoids heavy drop shadows so the translucent desktop pet remains visually separate from the UI.
