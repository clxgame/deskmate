import { describe, expect, test } from "bun:test";
import type { ProviderModel } from "../lib/settings";
import { groupModelsByManufacturer } from "./modelManufacturer";

function model(modelId: string, modelName = modelId): ProviderModel {
  return { sidecarId: "yume", providerName: "Gateway", modelId, modelName };
}

describe("model manufacturer groups", () => {
  test("collects manufacturers without losing model IDs or changing model order", () => {
    const models = [model("claude-sonnet-5"), model("gpt-5.5"), model("gemini-3.1-pro"), model("gpt-5.4")];
    const groups = groupModelsByManufacturer(models, "其他厂商");

    expect(groups.map(group => group.label)).toEqual(["OpenAI", "Anthropic", "Google"]);
    expect(groups[0]?.models).toEqual([models[1], models[3]]);
    expect(groups.flatMap(group => group.models)).toHaveLength(models.length);
  });

  test.each([
    ["openai/gpt-5.5", "OpenAI"],
    ["o3-mini", "OpenAI"],
    ["text-embedding-3-large", "OpenAI"],
    ["text-embedding-ada-002", "OpenAI"],
    ["anthropic/claude-opus-5", "Anthropic"],
    ["gemma-4-31b", "Google"],
    ["deepseek-v4-pro", "DeepSeek"],
    ["qwen3.7-max", "Alibaba"],
    ["doubao-seed-2.1-pro", "ByteDance"],
    ["glm-5.3", "Zhipu"],
    ["kimi-k3", "Moonshot AI"],
    ["MiniMax-M3", "MiniMax"],
    ["grok-4.6", "xAI"],
    ["cohere-rerank-v3.5", "Cohere"],
    ["hunyuan-large", "Tencent"],
  ])("recognizes %s as %s", (id, manufacturer) => {
    expect(groupModelsByManufacturer([model(id)], "Other")[0]?.label).toBe(manufacturer);
  });

  test("uses a recognizable display name for an opaque ID", () => {
    expect(groupModelsByManufacturer([model("opaque-id", " GPT 5.5 ")], "Other")[0]?.label).toBe("OpenAI");
  });

  test("prefers model ID over a conflicting display alias", () => {
    expect(groupModelsByManufacturer([model("claude-sonnet-5", "GPT 5.5")], "Other")[0]?.label).toBe("Anthropic");
  });

  test("keeps ambiguous models in the localized fallback group after known manufacturers", () => {
    const unknown = [model("text-embedding-v4"), model("gptish-custom"), model("custom-model")];
    const groups = groupModelsByManufacturer([...unknown, model("gpt-5.5")], "其他厂商");
    expect(groups.map(group => group.label)).toEqual(["OpenAI", "其他厂商"]);
    expect(groups[1]?.models).toEqual(unknown);
  });

  test("omits empty manufacturer groups", () => {
    expect(groupModelsByManufacturer([], "Other")).toEqual([]);
  });
});
