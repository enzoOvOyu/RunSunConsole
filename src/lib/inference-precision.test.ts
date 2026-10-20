import { expect, it } from "vitest";
import { compatiblePrecisions, precisionLabel } from "./inference-precision";

const textModel = {
  modality: "text",
  quantizations: ["bf16", "fp8", "awq", "fp4"],
};

it("matches precision variants to model, GPU generation and serving engine", () => {
  expect(compatiblePrecisions(textModel, "H100_SXM", "vllm")).toEqual([
    "bf16",
    "fp8",
    "awq",
  ]);
  expect(compatiblePrecisions(textModel, "B200_NVL72", "vllm")).toEqual([
    "bf16",
    "fp8",
    "awq",
    "fp4",
  ]);
  expect(compatiblePrecisions(textModel, "B200_NVL72", "sglang")).not.toContain(
    "fp4",
  );
  expect(
    compatiblePrecisions({ ...textModel, modality: "image" }, "B300", "vllm"),
  ).not.toContain("awq");
  expect(precisionLabel("fp4")).toBe("NVFP4");
  expect(precisionLabel("awq")).toBe("INT4 AWQ");
});
