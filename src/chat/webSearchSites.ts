import type { ToolPart } from "../lib/opencode";

const WEB_URL_PATTERN = /https?:\/\/[^\s<>"'`)\]}]+/giu;
const NON_SITE_SUFFIXES = new Set([
  "css",
  "js",
  "jsx",
  "json",
  "md",
  "pdf",
  "py",
  "rs",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);
const SITE_LIMIT = 8;

function siteFromCandidate(candidate: string, allowBareDomain: boolean): string | undefined {
  const trimmed = candidate
    .replace(/^[([{<"'`]+/u, "")
    .replace(/[)\]}>.,;!?"'`]+$/u, "");
  if (!trimmed || trimmed.includes("@")) return undefined;
  const hasScheme = /^https?:\/\//iu.test(trimmed);
  if (!hasScheme && !allowBareDomain) return undefined;

  try {
    const url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const hostname = url.hostname.toLowerCase().replace(/^www\./u, "").replace(/\.$/u, "");
    const labels = hostname.split(".");
    const suffix = labels.at(-1) ?? "";
    if (
      labels.length < 2 ||
      (!/^[a-z]{2,63}$/u.test(suffix) && !/^xn--[a-z0-9-]{2,59}$/u.test(suffix)) ||
      (!hasScheme && NON_SITE_SUFFIXES.has(suffix))
    ) {
      return undefined;
    }
    return hostname;
  } catch {
    return undefined;
  }
}

function inputFields(input: unknown): readonly string[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return [];
  const fields = input as Readonly<Record<string, unknown>>;
  return [fields.query, fields.url].filter((value): value is string => typeof value === "string");
}

export function webSearchSites(part: ToolPart): readonly string[] {
  const sites = new Set<string>();
  const add = (candidate: string, allowBareDomain: boolean) => {
    const site = siteFromCandidate(candidate, allowBareDomain);
    if (site) sites.add(site);
  };

  for (const field of inputFields(part.state.input)) {
    for (const token of field.split(/\s+/u)) add(token, true);
  }

  if ("output" in part.state && typeof part.state.output === "string") {
    for (const match of part.state.output.matchAll(WEB_URL_PATTERN)) add(match[0], false);
  }

  return [...sites].slice(0, SITE_LIMIT);
}
