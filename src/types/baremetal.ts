import type { Status } from "./domain";
export interface BaremetalMachine {
  index: number;
  nodeUuid: string;
  name: string;
  hostname: string;
  status: Status;
  gpuModel: string;
  gpuCount: number;
  cpuModel: string;
  vcpu: number;
  memoryGb: number;
  localNvmeGb: number;
  privateIp: string;
  bmcIp: string;
  rack: string;
  network: string;
}
