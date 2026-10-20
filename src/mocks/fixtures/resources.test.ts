import { expect, it } from "vitest";
import { seedResources } from "./resources";
import { poolsFor } from "./gpu-specs";
import { REGIONS, KINDS } from "../../types/domain";
import {
  serverSchema,
  baremetalSchema,
  vgpuSchema,
  inferenceSchema,
} from "../../lib/schema";

it("offers diverse valid resource specifications in every region and kind", () => {
  const resources = seedResources();
  expect(resources).toHaveLength(41);
  expect(resources.some((resource) => resource.status === "error")).toBe(false);
  expect(resources.every((resource) => resource.spec.gpuCount >= 0)).toBe(true);
  for (const region of REGIONS)
    for (const kind of KINDS)
      expect(
        resources.filter((r) => r.region === region && r.kind === kind).length,
      ).toBeGreaterThanOrEqual(2);
  for (const resource of resources) {
    const schema =
      resource.kind === "gpu_vm"
        ? serverSchema
        : resource.kind === "gpu_baremetal"
          ? baremetalSchema
          : resource.kind === "vgpu"
            ? vgpuSchema
            : inferenceSchema;
    expect(schema.safeParse(resource.spec).success).toBe(true);
  }
  expect(
    new Set(
      resources
        .filter((r) => r.kind === "gpu_vm")
        .map((r) => r.spec.gpuPerInstance),
    ),
  ).toEqual(new Set([1, 2, 4, 8]));
  expect(
    new Set(
      resources
        .filter((r) => r.kind === "gpu_baremetal")
        .map((r) => r.spec.machineType),
    ).size,
  ).toBeGreaterThanOrEqual(3);
  expect(
    new Set(
      resources
        .filter((r) => r.kind === "vgpu")
        .map((r) => r.spec.nodePools[0].slicingPolicy),
    ),
  ).toEqual(new Set(["mig", "time_slicing", "mps"]));
  expect(
    new Set(
      resources
        .filter((r) => r.kind === "inference")
        .map((r) => r.spec.modelRef),
    ),
  ).toEqual(new Set(["llama8", "llama70", "qwen32"]));
});

it("keeps active seeded allocations within each regional pool catalog", () => {
  const resources = seedResources().filter((resource) =>
    ["running", "provisioning"].includes(resource.status),
  );
  for (const region of REGIONS)
    for (const pool of poolsFor(region)) {
      const allocated = resources
        .filter((resource) => resource.region === region)
        .reduce(
          (sum, resource) =>
            sum +
            (resource.kind === "vgpu"
              ? resource.spec.nodePools
                  .filter((nodePool) => nodePool.poolCode === pool.code)
                  .reduce(
                    (nodes, nodePool) =>
                      nodes + nodePool.nodeCount * nodePool.gpuPerNode,
                    0,
                  )
              : resource.nodePool === pool.code
                ? resource.spec.gpuCount
                : 0),
          0,
        );
      expect(allocated, `${region}/${pool.code}`).toBeLessThanOrEqual(
        pool.availableGpu,
      );
    }
});
