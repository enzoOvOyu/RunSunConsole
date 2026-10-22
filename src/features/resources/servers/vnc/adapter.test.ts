import { describe, expect, it } from "vitest";
import type { ResourceOf } from "../../../../types/domain";
import { runMockCommand } from "./adapter";

const resource = {
  resourceUuid: "vm-test",
  displayId: "vm-0123456789abcdef",
  name: "demo",
  region: "jp",
  nodePool: "H100_SXM",
  projectId: "project-1",
  status: "running",
  createdAt: "2026-01-01T00:00:00.000Z",
  runningSince: null,
  stoppedAt: null,
  deletedAt: null,
  mode: "on_demand",
  labels: [],
  orderUuid: "order-1",
  kind: "gpu_vm",
  spec: {
    gpuModel: "H100 SXM",
    gpuCount: 4,
    vcpu: 32,
    memoryGb: 256,
    imageRef: "ubuntu-22.04",
    quantity: 1,
    gpuPerInstance: 4,
    systemDiskGb: 80,
    dataDiskGb: 200,
    storageGb: 280,
    systemDiskType: "ssd",
    dataDiskType: "ssd",
    publicIp: false,
    scaling: null,
    vpc: "vpc-demo",
    subnet: "subnet-demo",
    securityGroups: [],
    sshPubkey: "",
    bandwidthMbps: 1000,
    autoShutdownIdleMin: 0,
    entrypoint: "",
  },
} as unknown as ResourceOf<"gpu_vm">;

describe("Mock VNC safe command map", () => {
  it("derives hardware, memory, storage and network output from the selected resource", () => {
    expect(runMockCommand("nvidia-smi", { resource })).toContain(
      "GPU count: 4",
    );
    expect(runMockCommand("free -h", { resource })).toContain("256Gi");
    expect(runMockCommand("df -h", { resource })).toContain("280G");
    expect(runMockCommand("ip addr", { resource })).toContain("region jp");
    expect(runMockCommand("hostname", { resource })).toBe(resource.displayId);
  });

  it("does not execute unknown command input", () => {
    expect(runMockCommand("rm -rf /", { resource })).toContain(
      "command not found",
    );
  });

  it("only clears for the exact clear command", () => {
    expect(runMockCommand("clear", { resource })).toBe("__CLEAR__");
    expect(runMockCommand("clear /tmp", { resource })).toContain(
      "command not found",
    );
  });
});
