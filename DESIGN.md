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
| `--t-countdown` | `40px` | Pomodoro remaining time, tabular figures, medium weight and 1.2 line height |

## 4. Spacing & Layout

All spacing uses a 4px base: `--s-0-5` 2px, `--s-1` 4px, `--s-2` 8px, `--s-3` 12px, `--s-4` 16px, `--s-5` 20px, `--s-6` 24px, `--s-8` 32px, `--s-14` 56px. Persona pack tiles use the explicit `--pack-tile-size` metric at `60px`; the Desktop pet control group uses `--pet-slider-w` at `140px`, and the lower active-persona selector uses `--active-persona-control-w` at `180px` so labels remain readable in the compact settings panel. The AI usage meter uses `--ai-usage-progress-h` at `6px`. Chat attachments use `--attachment-tray-max-h` at `84px` and `--attachment-name-max-w` at `210px` to keep staged files compact in the composer. The settings sidebar is `160px`; controls are `240px`; the titlebar is `44px`.

Widget selection uses `--widget-tile-size` at `88px`, with `--s-3` gaps and `--s-2` internal icon-to-label spacing. Time menus use `--time-picker-width` at `240px`, `--time-picker-column-height` at `176px`, `--time-picker-option-height` at `32px`, and `--time-picker-viewport-gutter` at `12px`; available viewport space always overrides preferred popup dimensions. New controls reuse the existing control radius, surface, border, focus and spacing tokens.

## 5. Components

### Functional icons
- Structure: `AppIcon` uses individually imported official `@phosphor-icons/react` 2.1.10 CSR components. Its semantic names map to Regular icons: `general` GearSix, `ai` Sparkle, `widget` SquaresFour, `shortcuts` Keyboard, `pet` PawPrint, `memory` Brain, `about` Info, `close` X, `history` ClockCounterClockwise, `attachment` Paperclip, `pack` Package, `add` Plus, `delete` Trash, `clock` Clock, `timer` Timer, `play` Play, `pause` Pause, `reset` ArrowCounterClockwise, and `caretDown` CaretDown.
- Size tokens: `.app-icon-16` is 16px for attachments, activity markers, the history new-action prefix, and history/widget delete controls; `.app-icon-18` is 18px for header and close controls; `.app-icon-20` is 20px for navigation and package uninstall; `.app-icon-24` is 24px for package fallbacks and import actions; `.app-icon-32` is 32px for widget selection tiles. The default is 20px. Every icon has explicit width and height, block display, and no flex shrinking, including beneath a font-size:0 compact navigation parent. The inline activity marker may use inline-block display to preserve status-text wrapping. Existing controls retain their hit areas.
- States: icons inherit `currentColor` from the existing control in default, hover, selected, focus, disabled, and busy states. Regular weight and official fill/path geometry stay fixed; do not add stroke or fill overrides, extra animation, or page-wide SVG selectors.
- Accessibility: SVGs are decorative (`aria-hidden="true"`, `focusable="false"`) with no title or event handlers. Accessible names, keyboard behavior, focus rings, and actions remain on the enclosing native controls. Content images, character artwork, branding, and text-only actions follow their existing rules.
- Delivery: Vite bundles the selected modules for offline rendering. The MIT notice ships at `public/licenses/Phosphor-Icons-LICENSE.txt`; do not use an icon font, runtime icon host, or dynamically imported catalog.

### Update footer
- Structure: version, a persistent check-for-updates button, then inline status text on its right, using the existing footer spacing and typography tokens.
- States: checking, downloading and installing keep the button visible but disabled; completion and error restore it. Version and button do not shrink. Status uses the remaining single-line space, ellipsizes when necessary, and exposes its full text through the native title and accessible text so it cannot move the button or resize the footer.
### Settings row
- Structure: label plus right-aligned control inside `.set-row`.
- States: default, hover, active, selected, keyboard focus, disabled where applicable, and loading for async data. Inputs and selects use the sunken layer; disabled controls use their own surface and text tokens rather than a low-opacity accent.
- Accessibility: controls retain visible labels and native keyboard behavior.

### Settings content identity
- The titlebar identifies Settings and the sidebar identifies each category. Main content is labelled by the selected sidebar button, without repeating its category as a top-of-panel heading. Internal section headings remain visible and semantic.

### Widget selector
- Structure: a compact grid of labelled 88px square buttons with centred 32px functional icons, using the existing quiet surface treatment. Scheduled tasks, Pomodoro and Work journal (工作日志) are three peer widgets selecting one configuration region; the common Always on top control remains outside that region. Work journal contains the complete entries, daily reports, weekly reports and report schedules workspace, with no independent sidebar category or master enable switch.
- Behavior: scheduled-task drafts survive switching widgets. Work journal mounts only after its first visit, then retains filters and editor drafts while inactive; hidden content and popovers cannot receive focus. Receipt links and legacy worklog events select Widgets → Work journal, including repeated entity requests. A generic opening returns to the entries list and clears obsolete detail targets; selecting a peer tile preserves the current draft instead.
- States: the selected tile uses `--accent-soft`, `--accent-ink` and an accent border; hover uses `--surface-hover`; keyboard focus uses `--focus-ring`; disabled uses the shared disabled tokens. Every tile remains square at narrow widths, with wrapping between tiles rather than stretching or shrinking the icon.
- Accessibility: native labelled buttons expose their selected state through `aria-pressed` and link to the configuration region. The full tile is clickable and labels stay visible.

- Responsive work journal filters: at window widths of 600px or less, use two equal date columns and place Project on the next row spanning both columns. Retain existing spacing/control tokens and keep complete date values readable beside the native calendar icon.

### Time chooser
- Structure: a labelled HH:MM button opens a top-layer native popover containing custom themed DOM, with separate hour (00–23) and minute (00–59) listboxes plus explicit Confirm and Cancel actions. Use `--surface-raised`, `--line-strong`, `--text`, the existing control radius and `--shadow-tooltip`; selected options use the shared accent pair, while hover and focus use their existing tokens. The menu inherits all four themes.
- Behavior: changes are a local draft until Confirm. Escape, Cancel and outside dismissal discard the draft. Opening selects the current time; arrow keys and Home/End move within the active listbox. Tab follows the logical popup order and can exit without a trap. Escape and Confirm restore trigger focus; outside dismissal respects the user's new focus target.
- Layout: preferred dimensions come from the time-picker metrics. Clamp all sides within a 12px viewport gutter, constrain list height to available space and recompute or close safely on resize/scroll. No platform-owned time dropdown is used.

### Pomodoro
- Shared countdown: both surfaces use `PomodoroCountdown`, an SVG text display with the existing Segoe UI tabular numerals (40-unit type, 48-unit view height), inherited color and stable width, including three-digit minutes.
- Pet overlay: after Start, show shared SVG digits and icon-only pause/resume above the model; retain ready and hide idle. Timer scale clamps to 0.5–2 independently from model scale (0.1–2). At 0.5 the digits are 24px, button 32px, gap/padding 4px, width 144px; all grow proportionally up to 2.0. Anchor the lower edge at 80% of model canvas height from the bottom. The native transparent host has a 160×210 minimum; the model canvas remains bottom-centred at its selected size. No timer or default-button backing; white media text/icons use a 1px dark drop shadow (85% black) for desktop contrast. Hover/active use accent-soft/ink and keyboard focus retains the theme focus ring. Busy disables actions; errors expose retry.
- Structure: one compact raised configuration surface with Focus/Break selectors, a `--t-countdown` tabular remaining-time display, labelled start/resume, pause and reset controls, and focus/break duration fields. Default durations are 25/5 minutes; allowed integer ranges are 1–180 and 1–60 minutes. Use the existing body/label/small typography for every supporting element.
- Behavior: the native timer continues while settings are hidden or another widget is selected. Start/resume preserves the current phase; pause holds remaining time; reset restores the current phase's full duration; explicitly selecting a phase stops and resets that phase. At completion the next phase becomes ready and waits for Start. Only preferences persist across app restarts.
- States: idle, running, paused and next-phase-ready have localized status. Loading and errors are inline, with a Retry action. Busy commands prevent duplicate actions; duration fields are disabled while running or paused. Ready status survives switching away and back. Completion is shown in the widget without generating an AI task.
- Accessibility: remaining time uses tabular figures and a stable layout, without announcing every second. Phase changes, completion and recoverable errors use appropriate live status; all controls retain visible text, native semantics and shared focus treatment.

### Desktop pet controls
- Structure: the Desktop pet tab starts with a compact raised group for pet scale and visibility, followed by nickname, pack management, mouse-follow, and render tuning.
- The duplicate top-of-panel persona selector is omitted. Package icons select the current pack; below the grid there is one native `角色` selector containing only that pack's compatible roles.
- Accessibility: native range and switch controls retain visible labels and immediate settings-changed feedback.

### Persona library
- Structure: a heading and live availability summary followed by a compact grid of 60px square persona-pack tiles. Each tile keeps the name, semantic status, numeric count, and contextual action over the thumbnail; the name and count are unbacked text, while the grid remains dense on narrow settings windows.
- The grid consists of built-in packs, every installed pack, and one independent import tile that always remains last. Importing another pack inserts its card before the plus; importing the same pack id updates its existing card. Removing a pack removes only that card. The plus has no name, image, status badge, or count. Imported names and covers come from installed pack.json metadata; metadata-less legacy packs use their id and a neutral glyph.
- Pack tiles prioritize the supplied transparent thumbnail, pack name, status, and one numeric character count. Loaded thumbnails render at normal brightness. The empty slot uses a full-tile plus button on the existing sunken surface with a dashed border and an accent-ink focus ring. There is no thumbnail in the empty state. Descriptions and import-format guidance are not persistent copy; they appear in a delayed tooltip on hover or focus.

### Persona pack card
- Structure: a 60px square tile with a full-bleed transparent PNG thumbnail, pack name, semantic status badge, one numeric character count, and one contextual action layered inside the tile. Name and count use `--text-on-media` plus their dedicated text shadows with no border, padding, or background; import/remove icons are likewise unbacked so the thumbnail stays visually clear. Labels remain available through each button's accessible name and title.
- Variants: `builtin`, `installed`, and the separate empty import tile. Clicking a package selects it with a persistent accent-ink ring. A full-tile native button exposes aria-pressed and keyboard activation; the remove button is a sibling above it, so removal never selects a different pack. Clicking the current pack preserves its role; switching packs selects its first compatible role. No compatible role means a disabled role selector with a localized zero-available option, never an invented fallback role. All states retain the same 60px geometry.
- Counts for installed packs use the intersection of installed `personaIds` and authored compatible roles, never the static manifest total. Unknown packs remain manageable with zero compatible roles. Delayed tooltips align within the package section when a card receives pointer hover or keyboard focus.
- States: default, import busy, uninstall busy, keyboard focus, delayed hover tooltip, success, and error. Motion is limited to action affordances, status changes, and the tooltip reveal.

### Character render tuning
- The Desktop pet tab exposes native sliders for outline width (`0..0.03`, default `0.0008`), rim-light width (`0..1`, default `0.1`), rim-light intensity (`0..2`, default `0.3`), and toon specular (`0..2`, default `0.05`).
- Values are persisted with the persona settings and pushed to the active glb-viewer toon shader immediately after a debounced save; switching personas reapplies the saved tuning.
- Slider values show a compact numeric readout and retain keyboard/native range-input accessibility.

### AI providers and usage cards
- Structure: the AI tab starts with a horizontally scrollable row of provider disclosure buttons styled as tabs and visually joined to one configuration region inside a shared border and surface. There is no gap or second floating card between the selected provider and its fields. Configuration starts collapsed. Clicking a provider opens it; clicking the same expanded provider collapses it; clicking another switches and opens. Adding a provider opens its new editor. Display selection preserves edits and never changes the model route. The editor owns its label, Base URL, API key, verification, deployment, and removal actions. The selected model identifies both the sidecar provider and model; changing it updates the active provider and routing fields together. Usage cards follow the YOLO and CC Switch sections in two equal columns, using `--s-3` gaps; at window widths of 600px or less they stack for readability. A single usage card retains the compact `--control-w` width. Each provider has its own refresh action, weekly remaining versus total, semantic progress meter, reset timing, today's consumption, and up to three most expensive models.
- States: provider selectors cover collapsed, expanded, hover, keyboard focus and busy using the existing surface and accent tokens. The selected expanded button visually attaches to the editor beneath it. Collapsed fields unmount while parent-controlled drafts survive. Collapsing a verifying or deploying provider does not cancel work; its selector retains a compact localized busy indication, and results reappear when reopened without forcing it open. Provider editors cover editable, active, verifying, deploying, verified, and recoverable-error states. Usage cards independently cover loading, missing API key, usage-permission unavailable, unavailable, ready, refresh in progress, and keyboard focus. Deleting a provider requires a modal confirmation that explains its saved credential and cached model catalog are permanently removed; the final provider cannot be removed. Removing the displayed provider selects a surviving provider.
- Accessibility: provider disclosures form a labelled group, with native buttons using `aria-expanded` and `aria-controls` and a linked labelled region. Left/Right and Home/End move roving focus only; Enter/Space/click activates. Long labels ellipsize with their full name available in a title, and the rail scrolls without widening the page. Provider actions and the delete dialog use native labelled controls; closing the modal restores its connected trigger or a surviving provider/add button. Collapsed fields are absent from keyboard navigation and their shortcuts safely do nothing. Each usage meter exposes `role="progressbar"` with the numeric percentage, refresh is a native labelled button, and status text is a polite live region. No API key or raw server error is rendered in status or selector labels.

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
- Structure: a 20px `AppIcon` plus label in `.set-tab`.
- States: default, hover, active/selected, and keyboard focus. Selected label and icon use `--accent-ink` on `--accent-soft` so light-theme text stays readable.

### Work journal receipt (chat)
- Reuses the memory receipt strip, inline button and focus tokens for committed work entry, scheduled rule, queued report, pending, failure and deleted states. The label is derived from host operation lookup; report completion requires persisted run success. Pending includes an explicit result query action; committed entries offer Undo and all states link to the work journal.
- User-message actions offer saving the visible text and scheduling a Friday 17:00 weekly report. These are explicit user actions, keyboard reachable, and do not run merely because text resembles an instruction. Next occurrence includes a full local date and timezone; refresh never steals focus.

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

GIF desktop pets use the supplied transparent 240×240 images in a square, bottom-centred display inside the existing pet footprint. Per-action scale and vertical offset preserve authored close-up/full-body framing. Seven native images preload before switching; loading keeps the previous ready image. GIF pets expose shared scale, chat, dragging and settings controls; mouse-follow, shader tuning and poke are absent. A load failure uses the themed alert surface and an actionable Settings button.

Explicit GIF departure lasts 910ms: translate left by 50% of the displayed image width (legacy packs may retain 35%) with ease-in-out, while opacity decreases linearly. A fixed host reserves 50% of the display width on each side for horizontal travel and preserves the pet's desktop centre and bottom anchor. Transparent travel space passes mouse input through; the image footprint and timer controls remain interactive. Show cancels departure and resets transform/opacity before the native window becomes visible. GIF playback itself keeps the original loop and is not synchronized to load events.

Use `--ease` for control transitions and `--tooltip-delay` (`420ms`) for persona-pack tooltip reveals. Tooltip depth uses `--shadow-tooltip`. Persona changes are stateful but not animated in the settings surface; the pet renderer fades through a model swap only if a future transition is added. Mouse-follow rotation eases at a bounded rate and returns to neutral when disabled. Respect reduced-motion preferences for any future model transition.

## 7. Depth & Surface

Strategy: mixed tonal layers with subtle borders. The settings shell uses `--surface`, raised titlebar/sidebar layers, sunken controls, and low-contrast divider lines; it avoids heavy drop shadows so the translucent desktop pet remains visually separate from the UI.

小著（三代目）保留素材内嵌的 PBR 材质与七套独立骨骼、表情贴图；每帧仅显示当前动作的模型。普通五状态对应等待、思考、打招呼、跳舞、哭。右键‘戳’按 60% / 20% / 20% 选择打招呼、开心、争辩，单次播放结束恢复最新普通状态。角色选择沿用现有角色包卡片和选择控件。
