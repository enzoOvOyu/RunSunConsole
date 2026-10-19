import type { ResourceUuid, ScalingPolicy } from "./domain";
export interface InferenceGatewaySettings {
  qpsLimit: number;
  timeoutMs: number;
}
export interface InferenceGovernanceSettings extends InferenceGatewaySettings {
  canaryPercent: number;
}
export interface InferenceGovernance extends InferenceGovernanceSettings {
  resourceUuid: ResourceUuid;
  endpoint: string;
  modelRef: string;
  modelName: string;
  authEnabled: boolean;
  active: boolean;
  versions: {
    id: "stable" | "canary";
    version: string;
    modelRef: string;
    engine: string;
    trafficPercent: number;
    ready: boolean;
  }[];
  scalingPolicy: Pick<ScalingPolicy, "id" | "status" | "config"> | null;
}
