# YUME Design System

## 1. Atmosphere & Identity

YUME is a quiet floating companion: compact, lightly playful, and calm enough to live on the desktop. The default signature is a layered charcoal surface with a blue signal accent, while the settings window also offers mint, peach, and lavender themes for a fresher, cuter mood.

## 2. Color

| Role | Token | Value | Usage |
|---|---|---|---|
| Surface | `--surface` | `#20212b` | Window shell |
| Surface raised | `--surface-raised` | `#2a2c38` | Titlebar, cards, and menus |
| Surface sunken | `--surface-sunken` | `#191a23` | Inputs and selects |
| Surface hover / active / disabled | `--surface-hover`, `--surface-active`, `--surface-disabled` | Theme-specific tonal steps | Interactive, pressed, and disabled surfaces |
| Line | `--line` | `#383a48` | Dividers |
| Line strong | `--line-strong` | `#4a4d5d` | Control borders |
| Text | `--text` | `#f1f0f7` | Primary copy |
| Text dim / disabled | `--text-dim`, `--text-disabled` | Theme-specific readable secondary steps | Secondary and disabled copy |
| Accent | `--accent` | `#819ff7` | Filled controls, toggles, and slider thumbs |
| Accent ink | `--accent-ink` | `#c4d3ff` | Accent text, icons, and focus borders on normal surfaces |
| Text on accent / danger | `--text-on-accent`, `--text-on-danger` | Theme-specific | Text on filled accent and destructive controls; selected separately for each palette |
| Accent soft / hover | `--accent-soft`, `--accent-hover` | Theme-specific tonal steps | Selected surfaces and filled-control hover |
| Media overlay text | `--text-on-media`, `--shadow-pack-title`, `--shadow-pack-count` | Light text with a high-contrast shadow, no label backing | Persona thumbnail title and count, independent of page theme |
| Focus | `--focus-ring` | Theme-specific translucent ring | Keyboard focus around every interactive control |
| Success | `--success` | `#7dd97d` | Successful verification/update copy |
| Danger | `--danger` | `#ff8080` | Destructive or failed state copy |
| Warning | `--warn` | `#ffb066` | Caution copy |

Theme variants keep the same semantic roles and only swap their palette:

| Theme | Surface | Accent | Text | Mood |
|---|---|---|---|---|
| `dark` | Charcoal `#20212b` | Periwinkle `#819ff7` | Soft white `#f1f0f7` | Quiet charcoal default |
| `mint` | Cream `#fbf8ee` | Soft mint `#83c8aa` | Forest `#25443a` | Mint cream |
| `peach` | Cream `#fff8ee` | Soft peach `#f3b096` | Cocoa `#543632` | Peach frosting |
| `lavender` | Cream `#fcf9f1` | Lavender `#b9a4e8` | Plum `#3e3552` | Lavender sugar |

Rules: filled interactive accents use `--accent`, while accent copy, icons, and normal-surface focus use `--accent-ink`; never use one for both roles by default. `--text-on-accent` is selected per palette instead of assuming white. Every theme preserves readable contrast for normal, secondary, disabled, hover, active, selected, focus, menu, and tooltip states. Persona-thumbnail labels use `--text-on-media` on their dedicated dark overlay, never ordinary page text. The settings document and root are transparent outside `--r-window` and clip their contents to the rounded window; native window shadows are disabled so no square corner artifact remains. The 3D model uses the glb-viewer toon shader's authored light ramp rather than UI colors.

Theme scope: `.set-root` and `.chat-root` receive the same palette from `src/theme.css` through their shared `data-theme` value. Settings-only tokens extend that palette locally; conversation/history surfaces therefore use the exact same semantic surface, text, accent, border, focus, disabled, and destructive colors as the settings window.

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

All spacing uses a 4px base: `--s-0-5` 2px, `--s-1` 4px, `--s-2` 8px, `--s-3` 12px, `--s-4` 16px, `--s-5` 20px, `--s-6` 24px, `--s-8` 32px, `--s-14` 56px. Persona pack tiles use the explicit `--pack-tile-size` metric at `60px`; the Desktop pet control group uses `--pet-slider-w` at `140px`, and the lower active-persona selector uses `--active-persona-control-w` at `180px` so labels remain readable in the compact settings panel. The AI usage meter uses `--ai-usage-progress-h` at `6px`. Chat attachments use `--attachment-tray-max-h` at `84px` and `--attachment-name-max-w` at `210px` to keep staged files compact in the composer. The settings sidebar is `160px`; controls are `240px`; the titlebar is `44px`.

## 5. Components

### Settings row
- Structure: label plus right-aligned control inside `.set-row`.
- States: default, hover, active, selected, keyboard focus, disabled where applicable, and loading for async data. Inputs and selects use the sunken layer; disabled controls use their own surface and text tokens rather than a low-opacity accent.
- Accessibility: controls retain visible labels and native keyboard behavior.

### Desktop pet controls
- Structure: the Desktop pet tab starts with a compact raised group for pet scale and visibility, followed by nickname, pack management, mouse-follow, and render tuning.
- The duplicate top-of-panel persona selector is intentionally omitted; the pack section keeps paired `角色包` and `角色` selectors below the grid so the active character is always chosen within one pack.
- Accessibility: native range and switch controls retain visible labels and immediate settings-changed feedback.

### Persona library
- Structure: a heading and live availability summary followed by a compact grid of 60px square persona-pack tiles. Each tile keeps the name, semantic status, numeric count, and contextual action over the thumbnail; the name and count are unbacked text, while the grid remains dense on narrow settings windows.
- Availability is derived from the backend: built-in packs are always ready, installed packs show their installed version and actual on-disk persona subset, and absent packs show their manifest capacity as an offline option.
- Pack tiles prioritize the supplied transparent thumbnail, pack name, status, and one numeric character count. Loaded thumbnails render at normal brightness; not-installed thumbnails are dimmed. Descriptions and import-format guidance are not persistent copy; they appear in a delayed tooltip on hover or focus.

### Persona pack card
- Structure: a 60px square tile with a full-bleed transparent PNG thumbnail, pack name, semantic status badge, one numeric character count, and one contextual action layered inside the tile. Name and count use `--text-on-media` plus their dedicated text shadows with no border, padding, or background; import/remove icons are likewise unbacked so the thumbnail stays visually clear. Labels remain available through each button's accessible name and title.
- Variants: `builtin`, `installed`, and `available`; only installed removable packs expose the destructive action.
- Counts for installed packs use the backend's actual `personaIds`, never the static manifest total. Each tile shows only the total character count; detailed descriptions and import guidance remain available through the delayed tooltip.
- States: default, import busy, uninstall busy, keyboard focus, delayed hover tooltip, success, and error. Motion is limited to action affordances, status changes, and the tooltip reveal.

### Character render tuning
- The Desktop pet tab exposes native sliders for outline width (`0..0.03`, default `0.0008`), rim-light width (`0..1`, default `0.1`), rim-light intensity (`0..2`, default `0.3`), and toon specular (`0..2`, default `0.05`).
- Values are persisted with the persona settings and pushed to the active glb-viewer toon shader immediately after a debounced save; switching personas reapplies the saved tuning.
- Slider values show a compact numeric readout and retain keyboard/native range-input accessibility.

### AI providers and usage cards
- Structure: the AI tab starts with a list of provider cards. Each card owns its label, Base URL, API key, verification, and deployment actions, and can be collapsed or removed. The selected model identifies both the sidecar provider and model; changing it updates the active provider and routing fields together. A compact usage card for every configured provider follows the YOLO and CC Switch sections, with its own refresh action, weekly remaining versus total, semantic progress meter, reset timing, today's consumption, and up to three most expensive models.
- States: provider cards cover editable, collapsed, active, verifying, deploying, verified, and recoverable-error states. Usage cards independently cover loading, missing API key, usage-permission unavailable, unavailable, ready, refresh in progress, and keyboard focus, so one gateway's failure never replaces another gateway's data. Deleting a provider requires a modal confirmation that explains its saved credential and cached model catalog are permanently removed; the final provider cannot be removed.
- Accessibility: provider actions and the delete dialog use native labelled controls with deterministic focus. Each usage meter exposes `role="progressbar"` with the numeric percentage, refresh is a native labelled button, and status text is a polite live region. No API key or raw server error is rendered.

### Local AI deployment card (settings)
- Structure: a compact deployment card sits below the YOLO warning and above the provider usage list. The shared primary action targets the active provider, while every provider card also exposes a scoped deploy action. Both install or repair the per-user CC Switch and OpenCode clients and apply the provider/model pair only after verification succeeds.
- Behavior: pressing a deploy action persists the edited provider without changing the current route, verifies that provider's API and catalog, then atomically selects its sidecar provider and model before running one idempotent native deployment transaction. Progress advances through verification, client installation, provider import, final configuration verification, and expansion of the imported OpenCode provider to the full verified model catalog. CC Switch's official confirmation surface may appear briefly, but YUME completes only the exact import whose provider name, endpoint, and model match the verified request. When CC Switch still needs to ingest the expanded catalog, the success state tells the user whether to restart or wait for the next launch. No coordinate or cursor automation is used.
- States: ready-to-deploy, working with a named stage, verified success, and recoverable failure. The action remains present when CC Switch is missing so a fresh machine never dead-ends on a status-only card; repeated use repairs the same installation instead of creating duplicate clients.
- Accessibility: the action is a native button with a busy state, progress and completion use a polite live region, failures use an alert, and keyboard focus remains on the action. The API key never appears in progress, errors, events, or rendered deployment status.

### CC Switch setup card (chat)
- Structure: settings-launched setup uses the provider name plus a read-only endpoint from Settings and an inline note that the saved verified API key will be reused. It never renders an API-key input in this mode; manual chat-launched setup keeps the existing provider, endpoint, and API-key fields.
- Behavior: Settings verification remains the only network model-catalog check for the saved-credential path. The chat card calls the native saved-settings prepare command with provider name only, enters the same model-selection and confirmation steps as manual setup, and only launches CC Switch after the user presses the final launch button. The renderer cannot supply an API key, endpoint, model catalog, or saved-credential flag through tool output.
- Accessibility: focus moves deterministically from provider name, to model select, to the launch button as setup state advances. Settings keyboard shortcuts reserve Ctrl+Shift+B for Base URL, Ctrl+Shift+V for Verify, and Ctrl+Shift+C for CC Switch before number-tab navigation.

### Mouse-follow interaction
- The Desktop pet tab includes an independent `mouseFollow` switch. When enabled, the desktop pet turns toward the global cursor with a bounded yaw/pitch response; when disabled, it eases back to its authored forward pose.
- Cursor polling is throttled to 25Hz and the model rotation uses exponential smoothing so the interaction feels responsive without jitter or excessive IPC traffic.

### Tab button
- Structure: icon glyph plus label in `.set-tab`.
- States: default, hover, active/selected, and keyboard focus. Selected label and icon use `--accent-ink` on `--accent-soft` so light-theme text stays readable.

### Memory receipt (chat)
- Structure: `.chat-memory-receipt` — an accent-tinted strip under the message, holding the remembered text and an inline Undo link.
- States: default; the Undo link disappears once the memory is no longer freshly saved.
- The controls that produce it (`.chat-msg-actions`) stay at zero opacity until the message is hovered or focused, so a conversation never turns into a row of buttons.
- Accessibility: the receipt is a `role="status"` live region so a save is announced; every control is a real focusable button with a visible focus ring.

### Sensitive-storage confirmation (chat)
- Structure: `.chat-memory-confirm` — a `--warn` bordered card with a title, the local-storage disclosure, and confirm/decline buttons.
- States: only rendered while a decision is pending; dismissing it stores nothing.
- Accessibility: `role="alertdialog"`; both actions are keyboard reachable and the wording states where the data will live before the user commits.

### Attachment tray (chat)
- Structure: `.chat-attachment-tray` holds compact `.chat-attachment-chip` items above the composer. Each chip shows type, safe display filename, size when known, state label, and an explicit remove action. NCM confirmation expands inline as `.chat-attachment-confirm` rather than opening a modal or sending anything to the model.
- States: staging uses dashed `--accent` on `--accent-soft`; ready uses the normal sunken surface; failed uses `--danger`; NCM awaiting confirmation uses a `--warn` bordered alert dialog; processing is a polite status with a retryable failure path. Remove, Convert, Cancel, and Retry controls use the shared button/focus treatment and never rely on symbol-only text.
- Accessibility: the tray is a polite live region; NCM confirmation is `role="alertdialog"` with labelled Convert and Cancel buttons; failed items expose their error message and Retry by accessible name; every action has a visible `:focus-visible` ring and survives the 320px chat width without horizontal overflow.

### Generated artifact card (chat)
- Structure: `.chat-artifact-row` is a dedicated local conversation row for generated files. `.chat-artifact-card` contains filename, formatted byte size, native audio controls for MP3/FLAC previews, an explicit Download button, and inline export feedback.
- States: idle, exporting, exported, and export failed. Exported uses a polite status naming the saved filename; failed uses an alert and leaves Retry available. Rendering or conversion success never writes to Downloads; only the user-activated Download or Retry action may call export.
- Accessibility: audio has a filename-based accessible name, Download/Retry are native buttons with visible focus, save success is `role="status" aria-live="polite"`, and save failure is `role="alert"`.

### Memory list row (settings)
- Structure: `.set-memory-item` — content, then a `.set-memory-meta` line carrying type, scope, date, and the reason the memory exists, then per-row edit/forget actions.
- States: default; replaced and expired rows drop to 0.6 opacity and gain a `--warn` status label; the edit state swaps the content for a textarea.
- Destructive actions never fire directly — they open `.set-memory-confirm`, which names what will be deleted and that it cannot be undone.

## 6. Motion & Interaction

Use `--ease` for control transitions and `--tooltip-delay` (`420ms`) for persona-pack tooltip reveals. Tooltip depth uses `--shadow-tooltip`. Persona changes are stateful but not animated in the settings surface; the pet renderer fades through a model swap only if a future transition is added. Mouse-follow rotation eases at a bounded rate and returns to neutral when disabled. Respect reduced-motion preferences for any future model transition.

## 7. Depth & Surface

Strategy: mixed tonal layers with subtle borders. The settings shell uses `--surface`, raised titlebar/sidebar layers, sunken controls, and low-contrast divider lines; it avoids heavy drop shadows so the translucent desktop pet remains visually separate from the UI.
