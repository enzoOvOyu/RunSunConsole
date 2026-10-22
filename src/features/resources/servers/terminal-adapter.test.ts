import { describe, expect, it } from "vitest";
import type { ResourceOf } from "../../../types/domain";
import { runSafeCommand } from "./terminal-adapter";

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

const context = {
  resource,
  osName: "Ubuntu 22.04 LTS",
  osFamily: "Ubuntu",
  driverVersion: "615.71.10",
  cudaVersion: "13.0",
};

describe("Server terminal safe command map", () => {
  it("derives hardware, memory, storage and network output from the selected resource", () => {
    expect(runSafeCommand("nvidia-smi", context)).toContain("GPU count: 4");
    expect(runSafeCommand("free -h", context)).toContain("256Gi");
    expect(runSafeCommand("df -h", context)).toContain("280G");
    expect(runSafeCommand("ip addr", context)).toContain("region jp");
    expect(runSafeCommand("hostname", context)).toBe(resource.displayId);
    expect(runSafeCommand("whoami", context)).toBe("root");
    expect(runSafeCommand("pwd", context)).toBe("/root");
    expect(runSafeCommand("id", context)).toContain("uid=0(root)");
    expect(runSafeCommand("cat /etc/os-release", context)).toContain(
      "Ubuntu 22.04 LTS",
    );
  });

  it("does not execute unknown command input", () => {
    expect(runSafeCommand("rm -rf /", context)).toContain("command not found");
  });

  it("only clears for the exact clear command", () => {
    expect(runSafeCommand("clear", context)).toBe("__CLEAR__");
    expect(runSafeCommand("clear /tmp", context)).toContain(
      "command not found",
    );
  });
});
