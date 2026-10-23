import { describe, expect, it } from "vitest";
import { IMAGES } from "../fixtures/content";
import { GPU_SPECS } from "../fixtures/gpu-specs";
import { seedResources } from "../fixtures/resources";
import { clusterView } from "./runtime";

describe("image compatibility catalog", () => {
  it("separates clean base operating systems from optional Linux runtimes", () => {
    const operatingSystems = IMAGES.filter((image) => image.type === "os");
    const runtimes = IMAGES.filter((image) => image.type === "container");
    expect(operatingSystems.map((image) => image.osFamily)).toContain("Ubuntu");
    expect(operatingSystems.map((image) => image.osVersion)).toContain("26.04 LTS");
    expect(operatingSystems.map((image) => image.osFamily)).toContain("Rocky Linux");
    expect(operatingSystems.map((image) => image.osFamily)).toContain("Debian");
    expect(operatingSystems.filter((image) => image.osFamily === "Windows Server").map((image) => image.id)).toEqual([
      "windows-server-2022", "windows-server-2025",
    ]);
    expect(operatingSystems.every((image) => image.frameworks.length === 0)).toBe(true);
    expect(operatingSystems.every((image) => image.cudaVersion === "13.0")).toBe(true);
    expect(runtimes.every((image) => image.cudaVersion === "13.0")).toBe(true);
    expect(runtimes.every((image) => image.compatibleOsFamilies.length > 0)).toBe(true);
    expect(runtimes.every((image) => image.supportedGpuModels.includes("GB300_NVL72"))).toBe(true);
    expect(IMAGES.find((image) => image.id === "windows-server-2025")?.supportedGpuModels).not.toContain("GB300_NVL72");
  });
});

describe("Kubernetes cluster add-on states", () => {
  it("derives managed GPU and ingress controller readiness without inventing routes", () => {
    const cluster = structuredClone(seedResources().find((item) => item.kind === "vgpu")!);
    if (cluster.kind !== "vgpu") throw new Error("Expected a Kubernetes cluster");
    cluster.status = "running";
    cluster.spec.ingressEnabled = true;
    cluster.spec.ingressClass = "nginx";
    const ready = clusterView(cluster);
    expect(ready.plugins.gpuOperatorReady).toBe(true);
    expect(ready.plugins.devicePluginHealthy).toBe(true);
    expect(ready.plugins.nfdReady).toBe(true);
    expect(ready.plugins.driverDesired).toBe(ready.summary.totalNodes);
    expect(ready.plugins.ingressControllerReady).toBe(true);
    expect(ready.network.ingressQps).toBe(0);
    cluster.status = "provisioning";
    expect(clusterView(cluster).plugins.ingressControllerReady).toBe(false);
    cluster.spec.ingressEnabled = false;
    expect(clusterView(cluster).network.ingressQps).toBeNull();
  });
});

describe("Kubernetes cluster runtime consistency", () => {
  it("derives ingress, PVC, autoscaler and scheduling views from cluster configuration", () => {
    const resource = structuredClone(seedResources().find((item) => item.kind === "vgpu")!);
    if (resource.kind !== "vgpu") throw new Error("Expected a Kubernetes resource");
    resource.status = "running";
    resource.spec.nodePools = [{
      ...resource.spec.nodePools[0],
      nodeCount: 1,
      gpuPerNode: GPU_SPECS[resource.spec.nodePools[0].poolCode].gpusPerNode,
    }];
    resource.spec.gpuCount = resource.spec.nodePools[0].gpuPerNode;
    resource.spec.ingressEnabled = false;
    resource.spec.defaultPvcGb = 0;
    resource.spec.scaling = null;
    resource.labels = [];
    resource.spec.workloads = [{
      id: "test-workload", name: "gpu-trainer", namespace: "training",
      kind: "Deployment", replicas: 2, gpuPerPod: 1,
      cpuPerPod: 4, memoryGbPerPod: 16,
      nodePoolName: resource.spec.nodePools[0].name || "gpu-pool-1",
      tolerateGpuTaint: true,
    }];

    const normal = clusterView(resource);
    expect(normal.network.ingressQps).toBeNull();
    expect(normal.storage).toMatchObject({ bound: 0, pending: 0, provisioned: false, pvCapacityGb: 0 });
    expect(normal.poolStatus).toBe("idle");
    expect(normal.scheduling).toEqual([]);
    expect(normal.workloads[0].pods.every((pod) => pod.phase === "Running")).toBe(true);
    expect(normal.summary.gpuAllocated).toBe(2);
    expect(normal.summary.gpuTotal).toBe(resource.spec.gpuCount);
    expect(normal.nodes[0].allocatedGpu).toBe(2);

    const nodeUuid = normal.nodes[0].nodeUuid;
    resource.labels.push(`cluster-node:${nodeUuid}:cordoned`);
    const cordoned = clusterView(resource);
    expect(cordoned.nodes[0].state).toBe("unschedulable");
    expect(cordoned.workloads[0].pods.every((pod) => pod.phase === "Pending")).toBe(true);
    expect(cordoned.scheduling[0].count).toBe(cordoned.workloads[0].pods.length);

    resource.labels = [];
    const resumed = clusterView(resource);
    expect(resumed.nodes[0].state).toBe("ready");
    expect(resumed.workloads[0].pods.every((pod) => pod.phase === "Running")).toBe(true);
    resource.spec.workloads[0].replicas = 20;
    const constrained = clusterView(resource);
    expect(constrained.summary.gpuAllocated).toBe(constrained.summary.gpuTotal);
    expect(constrained.workloads[0].pods.filter((pod) => pod.phase === "Pending")).toHaveLength(12);
    expect(constrained.scheduling[0].reason).toContain("Insufficient GPU");
    resource.spec.workloads[0].gpuModel = "nonexistent-model";
    const unmatched = clusterView(resource);
    expect(unmatched.summary.gpuAllocated).toBe(0);
    expect(unmatched.workloads[0].pods.every((pod) => pod.phase === "Pending")).toBe(true);
    expect(unmatched.scheduling[0].reason).toContain("selector");
  });
});
