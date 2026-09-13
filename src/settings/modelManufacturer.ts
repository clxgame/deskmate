import type { ProviderModel } from "../lib/settings";

const MANUFACTURERS = [
  { label: "OpenAI", pattern: /^(?:gpt(?:[- .]|\d)|chatgpt(?:[- .]|$)|o[1-9](?:[- .]|$)|text-embedding-(?:3-|ada-)|whisper(?:-|$)|tts-[12](?:-|$))/i },
  { label: "Anthropic", pattern: /^claude(?:[- .]|$)/i },
  { label: "Google", pattern: /^(?:gemini|gemma)(?:[- .]|$)/i },
  { label: "DeepSeek", pattern: /^deepseek(?:[- .]|$)/i },
  { label: "Alibaba", pattern: /^qwen(?:[- .]|\d|$)/i },
  { label: "ByteDance", pattern: /^doubao(?:[- .]|$)/i },
  { label: "Zhipu", pattern: /^glm(?:[- .]|\d|$)/i },
  { label: "Moonshot AI", pattern: /^(?:kimi|moonshot)(?:[- .]|$)/i },
  { label: "MiniMax", pattern: /^minimax(?:[- .]|$)/i },
  { label: "xAI", pattern: /^grok(?:[- .]|$)/i },
  { label: "Cohere", pattern: /^(?:cohere(?:[- .]|$)|command-r(?:[- .+]|$))/i },
  { label: "Tencent", pattern: /^hunyuan(?:[- .]|$)/i },
] as const;

type ManufacturerModelGroup = {
  readonly label: string;
  readonly models: readonly ProviderModel[];
};

/** The gateway exposes no manufacturer field; infer known families and retain unknown models. */
export function groupModelsByManufacturer(
  models: readonly ProviderModel[],
  otherLabel: string,
): readonly ManufacturerModelGroup[] {
  const byManufacturer = new Map<string, ProviderModel[]>();
  for (const model of models) {
    const id = model.modelId.trim().split("/").at(-1) ?? "";
    const name = model.modelName.trim();
    const manufacturer = MANUFACTURERS.find(rule => rule.pattern.test(id))
      ?? MANUFACTURERS.find(rule => rule.pattern.test(name));
    const label = manufacturer?.label ?? otherLabel;
    const bucket = byManufacturer.get(label) ?? [];
    bucket.push(model);
    byManufacturer.set(label, bucket);
  }

  return [...MANUFACTURERS.map(rule => rule.label), otherLabel].flatMap(label => {
    const grouped = byManufacturer.get(label);
    return grouped ? [{ label, models: grouped }] : [];
  });
}
