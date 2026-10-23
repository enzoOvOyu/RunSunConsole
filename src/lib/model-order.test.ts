import { expect, it } from "vitest";
import { CATALOG_MODELS } from "../mocks/fixtures/model-catalog";
import { compareFeaturedModels } from "./model-order";

it("keeps the six requested publishers first despite saved legacy ranks", () => {
  const models = CATALOG_MODELS.map((model) => ({
    ...model,
    featuredRank: model.publisher === "nvidia" ? 1 : model.featuredRank,
  }));
  const firstSix = models.sort(compareFeaturedModels).slice(0, 6);
  expect(firstSix.map((model) => model.publisher)).toEqual([
    "nvidia",
    "meta-models",
    "mistralai",
    "moonshotai",
    "deepseek-ai",
    "Qwen",
  ]);
});
