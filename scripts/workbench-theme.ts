import { THEME_IDS } from "../src/settings/theme";

export function buildWorkbenchThemeCss(source: string): string {
  const blocks = [...source.matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  const requiredTokens = [...new Set([...WORKBENCH_TOKEN_MAP.matchAll(/var\(--([a-z-]+)\)/g)].map((match) => match[1]))];
  const paletteCss = THEME_IDS.map((id) => {
    const block = blocks.find((match) => id === "dark"
      ? match[1]?.includes(".set-root,") && !match[1]?.includes("data-theme")
      : match[1]?.includes(`.set-root[data-theme="${id}"]`));
    if (!block) throw new Error(`YUME palette ${id} is missing`);
    for (const token of requiredTokens) {
      if (!new RegExp(`--${token}:\\s*[^;]+;`).test(block[2] ?? "")) {
        throw new Error(`YUME palette ${id} is missing --${token}`);
      }
    }
    return `html[data-yume-theme="${id}"] {${block[2]}}`;
  }).join("\n");

  return `${paletteCss}\n${WORKBENCH_TOKEN_MAP}`;
}

export function injectWorkbenchThemeAssets(html: string): string {
  if (html.includes("yume-theme-bridge.js")) return html;
  if (!html.includes("</head>")) throw new Error("workbench index has no head");
  return html.replace("</head>", '  <link rel="stylesheet" href="./yume-theme.css" />\n    <script src="./yume-theme-bridge.js"></script>\n  </head>');
}

const WORKBENCH_TOKEN_MAP = `
html[data-yume-theme] {
  background-color: var(--surface) !important;
  color-scheme: inherit;
  --background-base: var(--surface);
  --background-weak: var(--surface-sunken);
  --background-strong: var(--surface);
  --background-stronger: var(--surface-raised);
  --surface-base: var(--surface);
  --surface-base-hover: var(--surface-hover);
  --surface-base-active: var(--surface-active);
  --surface-inset-base: var(--surface-sunken);
  --surface-raised-base: var(--surface-raised);
  --surface-raised-base-hover: var(--surface-hover);
  --surface-raised-base-active: var(--surface-active);
  --surface-float-base: var(--surface-raised);
  --surface-float-base-hover: var(--surface-hover);
  --surface-weak: var(--surface-hover);
  --surface-weaker: var(--surface-active);
  --surface-strong: var(--surface-raised);
  --surface-interactive-base: var(--accent);
  --surface-interactive-hover: var(--accent-hover);
  --surface-interactive-weak: var(--accent-soft);
  --text-strong: var(--text);
  --text-base: var(--text);
  --text-weak: var(--text-dim);
  --text-weaker: var(--text-disabled);
  --text-interactive-base: var(--accent-ink);
  --icon-base: var(--text-dim);
  --icon-weak-base: var(--text-disabled);
  --border-base: var(--line);
  --border-weak-base: var(--line);
  --border-weaker-base: var(--line-subtle);
  --border-strong-base: var(--line-strong);
  --v2-background-bg-base: var(--surface);
  --v2-background-bg-deep: var(--surface);
  --v2-background-bg-layer-01: var(--surface-raised);
  --v2-background-bg-layer-02: var(--surface-sunken);
  --v2-background-bg-layer-03: var(--surface-active);
  --v2-background-bg-layer-04: var(--surface-track);
  --v2-background-bg-button-neutral: var(--surface-raised);
  --v2-background-bg-accent: var(--accent);
  --v2-text-text-base: var(--text);
  --v2-text-text-muted: var(--text-dim);
  --v2-text-text-faint: var(--text-disabled);
  --v2-text-text-accent: var(--accent-ink);
  --v2-text-text-accent-hover: var(--accent-ink-hover);
  --v2-text-text-code-accent: var(--accent-ink);
  --v2-icon-icon-base: var(--text-dim);
  --v2-icon-icon-muted: var(--text-disabled);
  --v2-icon-icon-accent: var(--accent-ink);
  --v2-icon-icon-accent-hover: var(--accent-ink-hover);
  --v2-border-border-muted: var(--line-subtle);
  --v2-border-border-base: var(--line);
  --v2-border-border-strong: var(--line-strong);
  --v2-border-border-focus: var(--accent);
  --v2-overlay-simple-overlay-hover: var(--surface-hover);
  --v2-overlay-simple-overlay-pressed: var(--surface-active);
  --v2-overlay-simple-overlay-scrim: var(--dialog-backdrop);
  --v2-state-fg-success: var(--success);
  --v2-state-fg-warning: var(--warn);
  --v2-state-fg-danger: var(--danger);
  --v2-blue-200: var(--accent-soft);
  --v2-blue-400: var(--accent);
  --v2-blue-500: var(--accent-hover);
  --v2-blue-600: var(--accent-ink);
  --v2-blue-700: var(--accent-ink-hover);
}
html[data-yume-theme="dark"] {
  --v2-background-bg-inverse: var(--text);
  --v2-background-bg-contrast: var(--surface-track);
  --v2-text-text-inverse: var(--surface);
  --v2-text-text-contrast: var(--text);
  --v2-icon-icon-inverse: var(--surface);
  --v2-border-border-inverse: var(--text);
  --v2-grey-100: var(--text);
  --v2-grey-200: color-mix(in srgb, var(--text) 85%, var(--surface));
  --v2-grey-300: color-mix(in srgb, var(--text) 68%, var(--surface));
  --v2-grey-400: color-mix(in srgb, var(--text) 52%, var(--surface));
  --v2-grey-500: var(--text-dim);
  --v2-grey-600: var(--text-disabled);
  --v2-grey-700: var(--surface-track);
  --v2-grey-800: var(--surface-raised);
  --v2-grey-900: var(--surface-disabled);
  --v2-grey-1000: var(--surface-raised);
  --v2-grey-1100: var(--surface);
  --v2-grey-1200: var(--surface-sunken);
}
html[data-yume-theme="mint"], html[data-yume-theme="peach"], html[data-yume-theme="lavender"] {
  --v2-background-bg-inverse: var(--text);
  --v2-background-bg-contrast: var(--text-dim);
  --v2-text-text-inverse: var(--surface-raised);
  --v2-text-text-contrast: var(--surface-raised);
  --v2-icon-icon-inverse: var(--surface-raised);
  --v2-border-border-inverse: var(--text);
  --v2-grey-100: var(--surface-raised);
  --v2-grey-200: var(--surface);
  --v2-grey-300: var(--surface-sunken);
  --v2-grey-400: color-mix(in srgb, var(--text) 14%, var(--surface));
  --v2-grey-500: color-mix(in srgb, var(--text) 28%, var(--surface));
  --v2-grey-600: var(--text-disabled);
  --v2-grey-700: var(--text-dim);
  --v2-grey-800: color-mix(in srgb, var(--text) 78%, var(--surface));
  --v2-grey-900: var(--text);
  --v2-grey-1000: var(--text);
  --v2-grey-1100: var(--text);
  --v2-grey-1200: var(--text);
}
`;
