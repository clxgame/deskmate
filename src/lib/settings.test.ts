import { describe, expect, test } from "bun:test";
import { modelsMatchVerification, type ProviderModel } from "./settings";

const yumeModel: ProviderModel = {
  providerId: "yume",
  providerName: "YUME",
  modelId: "model-a",
  modelName: "Model A",
};

describe("verified model catalog", () => {
  test("requires a refreshed YUME provider when the API reports models", () => {
    expect(modelsMatchVerification([], 2)).toBe(false);
    expect(modelsMatchVerification([{ ...yumeModel, providerId: "kuro" }], 2)).toBe(
      false,
    );
    expect(modelsMatchVerification([yumeModel], 2)).toBe(true);
  });

  test("rejects an empty refreshed catalog", () => {
    expect(modelsMatchVerification([], 0)).toBe(false);
  });
});
