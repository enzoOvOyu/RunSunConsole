import { expect, it } from "vitest";
import { gpuModelDisplayName, poolDisplayName } from "./gpu-labels";

it("shows B200 consistently while retaining its legacy pool code", () => {
  expect(poolDisplayName("B200_NVL72")).toBe("B200");
  expect(gpuModelDisplayName("B200 NVL72 (GB200)")).toBe("B200");
  expect(gpuModelDisplayName("B200 SXM")).toBe("B200");
});
