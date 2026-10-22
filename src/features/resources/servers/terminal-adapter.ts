import type { ResourceOf } from "../../../types/domain";

export type ConsoleConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "failed"
  | "instance-stopped"
  | "restarting";

/** Connection boundary for a future remote terminal transport. */
export interface ConsoleConnectionAdapter {
  connect(resource: ResourceOf<"gpu_vm">): Promise<void>;
  disconnect(): Promise<void>;
}

/** Local connection boundary; it never opens a guest connection. */
export class LocalConsoleAdapter implements ConsoleConnectionAdapter {
  async connect(resource: ResourceOf<"gpu_vm">): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    if (resource.status !== "running") {
      throw new Error("INSTANCE_UNAVAILABLE");
    }
  }

  async disconnect(): Promise<void> {}
}

export type SafeCommandContext = {
  resource: ResourceOf<"gpu_vm">;
  osName: string;
  osFamily: string;
  username: string;
  driverVersion?: string;
  cudaVersion?: string;
  now?: Date;
};

/** Commands are matched exactly against this mapping; input never reaches a shell. */
export function runSafeCommand(
  input: string,
  context: SafeCommandContext,
): string {
  const command = input.trim();
  const { resource, osName, osFamily, username } = context;
  const isWindows = /windows/i.test(osFamily);
  const hostname = resource.displayId;
  const home = isWindows
    ? "C:\\Users\\" + username
    : username === "root"
      ? "/root"
      : "/home/" + username;
  const systemRelease = isWindows
    ? "Microsoft Windows NT " + osName + " x64"
    : "Linux " + hostname + " 6.8.0-52-generic #53 SMP x86_64 GNU/Linux";
  const osRelease = isWindows
    ? "Caption=" + osName + "\nOSArchitecture=x64"
    : 'NAME="' +
      osFamily +
      '"\nVERSION="' +
      osName.replace(osFamily, "").trim() +
      '"\nPRETTY_NAME="' +
      osName +
      '"';
  const help = isWindows
    ? [
        "Available commands:",
        "  pwd / Get-Location       Show the current directory",
        "  ls / Get-ChildItem       List files",
        "  whoami                   Show the current user",
        "  hostname                 Show this server name",
        "  Get-ComputerInfo         Show operating system information",
        "  Get-NetIPAddress         Show network information",
        "  nvidia-smi               Show GPU information",
        "  date / Get-Date          Show the current date and time",
        "  clear / Clear-Host       Clear the terminal",
      ].join("\n")
    : [
        "Available commands:",
        "  pwd                  Print the current directory",
        "  ls [ -la ]           List files",
        "  whoami               Show the current user",
        "  id                   Show user and group IDs",
        "  hostname             Show this server name",
        "  nvidia-smi           Show GPU information",
        "  ip addr              Show network information",
        "  free -h               Show configured memory",
        "  df -h                 Show configured storage",
        "  cat /etc/os-release  Show operating system information",
        "  uname -a              Show kernel information",
        "  date                  Show the current date and time",
        "  clear                 Clear the terminal",
      ].join("\n");
  const simple: Record<string, string> = {
    pwd: home,
    "Get-Location": home,
    whoami: username,
    id: "uid=0(root) gid=0(root) groups=0(root)",
    hostname,
    date: (context.now ?? new Date()).toString(),
    "Get-Date": (context.now ?? new Date()).toString(),
    help,
    "uname -a": systemRelease,
    "Get-ComputerInfo":
      osName +
      "\nSystem type: " +
      (isWindows ? "x64-based PC" : "64-bit operating system"),
    "Get-NetIPAddress":
      "InterfaceAlias: Ethernet0\nIPAddress: " +
      (resource.privateIp ?? "10.0.0.10") +
      "\nRegion: " +
      resource.region +
      "\nVPC: " +
      (resource.spec.vpc || "—"),
    "ip addr":
      "2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 9000\n    inet " +
      (resource.privateIp ?? "10.0.0.10") +
      "/24 scope global eth0\n    region " +
      resource.region +
      " · VPC " +
      (resource.spec.vpc || "—"),
    "free -h":
      "               total        used        free\nMem:           " +
      resource.spec.memoryGb +
      "Gi        4Gi        " +
      Math.max(0, resource.spec.memoryGb - 4) +
      "Gi",
    "df -h":
      "Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1    " +
      resource.spec.storageGb +
      "G   12G  " +
      Math.max(0, resource.spec.storageGb - 12) +
      "G   8% /",
    "cat /etc/os-release": osRelease,
  };
  if (command === "clear" || command === "Clear-Host") return "__CLEAR__";
  if (command === "ls" || command === "ls -la" || command === "Get-ChildItem") {
    return command === "ls -la"
      ? "total 24\ndrwxr-xr-x 4 " +
          username +
          " " +
          username +
          " 4096 .\ndrwxr-xr-x 3 root root 4096 ..\ndrwxr-xr-x 2 " +
          username +
          " " +
          username +
          " 4096 workspace"
      : isWindows
        ? "Directory: " + home + "\nworkspace  Documents  Downloads"
        : "workspace  .cache  .profile";
  }
  if (command === "nvidia-smi") {
    const { gpuModel, gpuCount } = resource.spec;
    const rows = Array.from(
      { length: gpuCount },
      (_, index) =>
        "| " +
        String(index).padStart(2, " ") +
        "  " +
        gpuModel.padEnd(18, " ") +
        "  " +
        hostname +
        " |",
    );
    return [
      "NVIDIA-SMI    Driver Version: " +
        (context.driverVersion || "N/A") +
        "    CUDA Version: " +
        (context.cudaVersion || "N/A"),
      "+---------------------------------------------------------------+",
      "| GPU   Name                 Persistence-M | Bus-Id        Disp.A |",
      "+---------------------------------------------------------------+",
      ...rows,
      "+---------------------------------------------------------------+",
      "| GPU count: " + gpuCount,
    ].join("\n");
  }
  if (simple[command]) return simple[command];
  return (
    (isWindows ? "CommandNotFoundException" : "bash") +
    ": " +
    (command || "") +
    ": command not found. Type 'help' for available commands."
  );
}
