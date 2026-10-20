import { expect, it } from "vitest";
import { CATALOG_MODELS } from "./model-catalog";
import { MODELS } from "./content";

it("imports all supplied models with researched public metadata and without unverified deployment settings", () => {
  expect(CATALOG_MODELS).toHaveLength(50);
  expect(new Set(CATALOG_MODELS.map((model) => model.modelRef)).size).toBe(50);
  expect(new Set(MODELS.map((model) => model.id)).size).toBe(54);
  expect(
    CATALOG_MODELS.every(
      (model) =>
        model.catalogOnly &&
        model.context > 0 &&
        model.quantizations.length === 0 &&
        !!model.license &&
        !!model.architecture &&
        !!model.sourceUrl,
    ),
  ).toBe(true);
  expect(
    CATALOG_MODELS.find((model) => model.modelRef === "Qwen/Qwen3.8-2.4T-A95B"),
  ).toMatchObject({
    paramsB: 2400,
    activeParamsB: 95,
  });
  expect(
    CATALOG_MODELS.find((model) => model.modelRef === "zai-org/GLM-5.3"),
  ).toMatchObject({
    paramsB: 753,
    parameterEstimate: true,
    context: 1048576,
    license: "glm-5.3",
  });
  expect(
    CATALOG_MODELS.find(
      (model) => model.modelRef === "meta-models/Muse-Spark-Open-816B-A42B",
    ),
  ).toMatchObject({
    context: 1048576,
    modality: "multimodal",
    access: "manual",
  });
  expect(
    CATALOG_MODELS.find(
      (model) =>
        model.modelRef === "mistralai/Mistral-Large-3-675B-Instruct-2512",
    ),
  ).toMatchObject({
    context: 262144,
    modality: "multimodal",
    activeParamsB: 41,
  });
});

it("pins NVIDIA and Meta catalog entries ahead of the default model list", () => {
  const featured = CATALOG_MODELS.filter((model) => model.featuredRank).sort(
    (left, right) => (left.featuredRank || 0) - (right.featuredRank || 0),
  );
  expect(featured).toHaveLength(7);
  expect(featured.map((model) => model.publisher)).toEqual([
    "nvidia",
    "meta-models",
    "nvidia",
    "meta-llama",
    "nvidia",
    "meta-llama",
    "nvidia",
  ]);
  expect(featured[0].modelRef).toBe(
    "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16",
  );
});
