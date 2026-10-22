import type { ResourceOf } from "../../../../types/domain";

export type VncConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed"
  | "instance-stopped"
  | "restarting";

/** Transport boundary for the viewer. A future noVNC adapter can implement this interface. */
export interface VncAdapter {
  connect(resource: ResourceOf<"gpu_vm">): Promise<void>;
  disconnect(): Promise<void>;
}

/** Local-only adapter. It never opens a socket or contacts a guest OS. */
export class MockVncAdapter implements VncAdapter {
  async connect(resource: ResourceOf<"gpu_vm">): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    if (resource.status !== "running") {
      throw new Error("INSTANCE_UNAVAILABLE");
    }
  }

  async disconnect(): Promise<void> {}
}

export type MockCommandContext = {
  resource: ResourceOf<"gpu_vm">;
  now?: Date;
};

/** Exact command allowlist; user input is never passed to a shell. */
export function runMockCommand(
  input: string,
  context: MockCommandContext,
): string {
  const command = input.trim();
  const simple: Record<string, string> = {
    pwd: "/home/ubuntu",
    whoami: "ubuntu",
    help: [
      "Available commands:",
      "  pwd           Print the current directory",
      "  ls [ -la ]    List demo files",
      "  whoami        Show the demo user",
      "  nvidia-smi    Show GPU information from this instance",
      "  date          Show the local demo time",
      "  hostname      Show this resource ID",
      "  ip addr       Show the resource network address",
      "  free -h       Show configured instance memory",
      "  df -h         Show configured storage",
      "  cat /etc/os-release  Show the selected base image",
      "  uname -a      Show the demo kernel information",
      "  clear         Clear the terminal",
    ].join("\n"),
    date: (context.now ?? new Date()).toString(),
    "uname -a":
      "Linux runsun-gpu 5.15.0-105-generic #115-Ubuntu SMP x86_64 GNU/Linux",
    hostname: context.resource.displayId,
    "ip addr": `2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9000\n    inet ${context.resource.privateIp ?? "10.0.0.10"}/24 scope global eth0\n    region ${context.resource.region} · VPC ${context.resource.spec.vpc || "—"}`,
    "free -h": `               total        used        free\nMem:           ${context.resource.spec.memoryGb}Gi        4Gi        ${Math.max(0, context.resource.spec.memoryGb - 4)}Gi`,
    "df -h": `Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1    ${context.resource.spec.storageGb}G   12G  ${Math.max(0, context.resource.spec.storageGb - 12)}G   8% /`,
    "cat /etc/os-release": `PRETTY_NAME="${context.resource.spec.imageRef}"\nID=${context.resource.spec.imageRef.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  };
  if (command === "clear") return "__CLEAR__";
  if (command === "ls" || command === "ls -la") {
    return command === "ls -la"
      ? "total 24\ndrwxr-xr-x 4 ubuntu ubuntu 4096 .\ndrwxr-xr-x 3 root   root   4096 ..\n-rw-r--r-- 1 ubuntu ubuntu  220 .bash_logout\ndrwxr-xr-x 2 ubuntu ubuntu 4096 .cache\ndrwxr-xr-x 2 ubuntu ubuntu 4096 workspace"
      : "workspace  .cache  .bash_logout";
  }
  if (command === "nvidia-smi") {
    const { gpuModel, gpuCount } = context.resource.spec;
    const rows = Array.from(
      { length: gpuCount },
      (_, index) =>
        `| ${String(index).padStart(2, " ")}  ${gpuModel.padEnd(18, " ")}  Mock Device  |`,
    );
    return [
      "NVIDIA-SMI 550.90.07    Driver Version: 550.90.07    CUDA Version: 12.4",
      "+---------------------------------------------------------------+",
      "| GPU   Name                 Persistence-M | Bus-Id        Disp.A |",
      "+---------------------------------------------------------------+",
      ...rows,
      "+---------------------------------------------------------------+",
      `| GPU count: ${gpuCount}  (values are simulated for this demo)`,
    ].join("\n");
  }
  if (simple[command]) return simple[command];
  return `bash: ${command || ""}: command not found in Mock VNC. Type 'help' for available commands.`;
}
