# deskmate Design System

## 1. Atmosphere & Identity

deskmate is a quiet floating companion: compact, lightly playful, and calm enough to live on the desktop. The default signature is a layered charcoal surface with a blue signal accent, while the settings window also offers mint, peach, and lavender themes for a fresher, cuter mood.

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

## 4. Spacing & Layout

All spacing uses a 4px base: `--s-1` 4px, `--s-2` 8px, `--s-3` 12px, `--s-4` 16px, `--s-5` 20px, `--s-6` 24px, `--s-8` 32px. The settings sidebar is `160px`; controls are `240px`; the titlebar is `44px`.

## 5. Components

### Settings row
- Structure: label plus right-aligned control inside `.set-row`.
- States: default, hover/focus on control, disabled where applicable, loading for async data.
- Accessibility: controls retain visible labels and native keyboard behavior.

### Persona select
- Structure: a native `.set-select` in the Persona tab, with one option per bundled persona.
- States: default, focused, disabled while persona catalog is unavailable.
- Accessibility: native `select` label, persisted selection, and immediate settings-changed feedback.

### Character render tuning
- The Role tab exposes native sliders for outline width (`0..0.03`, default `0.0073`), rim-light width (`0..1`, default `0.4`), rim-light intensity (`0..2`, default `1`), and toon specular (`0..2`, default `0.5`).
- Values are persisted with the persona settings and pushed to the active glb-viewer toon shader immediately after a debounced save; switching personas reapplies the saved tuning.
- Slider values show a compact numeric readout and retain keyboard/native range-input accessibility.

### Mouse-follow interaction
- The Role tab includes an independent `mouseFollow` switch. When enabled, the desktop pet turns toward the global cursor with a bounded yaw/pitch response; when disabled, it eases back to its authored forward pose.
- Cursor polling is throttled to 25Hz and the model rotation uses exponential smoothing so the interaction feels responsive without jitter or excessive IPC traffic.

### Tab button
- Structure: icon glyph plus label in `.set-tab`.
- States: default, hover, active, keyboard focus.

## 6. Motion & Interaction

Use `140ms ease` for control transitions. Persona changes are stateful but not animated in the settings surface; the pet renderer fades through a model swap only if a future transition is added. Mouse-follow rotation eases at a bounded rate and returns to neutral when disabled. Respect reduced-motion preferences for any future model transition.

## 7. Depth & Surface

Strategy: mixed tonal layers with subtle borders. The settings shell uses `--surface`, raised titlebar/sidebar layers, sunken controls, and low-contrast divider lines; it avoids heavy drop shadows so the translucent desktop pet remains visually separate from the UI.
