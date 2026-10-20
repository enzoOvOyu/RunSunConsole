import { StorageRows } from "./shared/StorageRows";
import { z } from "zod";
import type { VgpuSpec } from "../../types/domain";
import { t } from "../../i18n";
import { Button, Field, Panel } from "../../components/ui";
import {
  vgpuSchema,
  nodePoolSchema,
  isCidr,
  storageSelectionsSchema,
} from "../../lib/schema";
import { WizardLayout, PoolCards } from "./shared/WizardLayout";
import {
  useSpec,
  SpecNumber,
  SpecCheck,
  SpecSelect,
  DeploymentOptionSelect,
  SpecText,
  NetworkFields,
  Review,
  ScalingToggle,
  type FormContext,
  type WizardValues,
} from "./shared/fields";
function validate(v: WizardValues, step: number) {
  const s = v.spec as VgpuSpec;
  if (step === 1)
    return (
      ["1.28", "1.29", "1.30", "1.31"].includes(s.k8sVersion) &&
      (!s.apiServerPublic || isCidr(s.authorizedCidr))
    );
  if (step === 2)
    return z.array(nodePoolSchema).min(1).max(5).safeParse(s.nodePools).success;
  if (step === 3)
    return (
      !!s.networkPlugin &&
      !!s.storageClass &&
      storageSelectionsSchema.safeParse(s.storageSelections || []).success
    );
  return vgpuSchema.safeParse(s).success;
}
function VgpuForm({ step, pools }: FormContext) {
  const { spec, update, form } = useSpec<VgpuSpec>();
  const updatePool = (
    i: number,
    part: Partial<VgpuSpec["nodePools"][number]>,
  ) => {
    const nodePools = spec.nodePools.map((p, index) =>
      index === i ? { ...p, ...part } : p,
    );
    update({
      nodePools,
      gpuCount: nodePools.reduce((a, p) => a + p.nodeCount * p.gpuPerNode, 0),
    });
  };
  return step === 1 ? (
    <div className="stack">
      <DeploymentOptionSelect name="k8sVersion" label={t("resource.k8s")} />
      <SpecSelect
        name="controlPlaneTier"
        label={t("wizard.controlPlane")}
        options={["standard", "ha"]}
      />
      <SpecCheck name="apiServerPublic" label={t("wizard.apiPublic")} />
      {spec.apiServerPublic && (
        <SpecText name="authorizedCidr" label={t("wizard.cidr")} />
      )}
    </div>
  ) : step === 2 ? (
    <div className="stack">
      {spec.nodePools.map((p, i) => (
        <Panel
          key={i}
          title={`${t("resource.pool")} ${i + 1}`}
          action={
            spec.nodePools.length > 1 ? (
              <Button
                onClick={() => {
                  const nodePools = spec.nodePools.filter(
                    (_, idx) => idx !== i,
                  );
                  update({
                    nodePools,
                    gpuCount: nodePools.reduce(
                      (a, p) => a + p.nodeCount * p.gpuPerNode,
                      0,
                    ),
                  });
                }}
              >
                {t("wizard.removePool")}
              </Button>
            ) : undefined
          }
        >
          <div className="stack">
            <PoolCards
              kind="vgpu"
              pools={pools}
              selected={p.poolCode}
              onSelect={(pool) => {
                if (i === 0) form.setValue("nodePool", pool.code);
                updatePool(i, {
                  poolCode: pool.code,
                  gpuPerNode: pool.gpusPerNode,
                  migProfile: pool.migProfile,
                });
              }}
            />
            <div className="form-grid">
              <Field label={t("resource.nodeCount") + " · 1–64"}>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={64}
                  value={p.nodeCount}
                  onChange={(e) =>
                    updatePool(i, { nodeCount: Number(e.target.value) })
                  }
                />
              </Field>
              <Field label={t("resource.slicing")}>
                <select
                  value={p.slicingPolicy}
                  onChange={(e) =>
                    updatePool(i, { slicingPolicy: e.target.value })
                  }
                >
                  {["none", "mig", "time_slicing", "mps"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </Field>
              {p.slicingPolicy === "mig" && (
                <Field label="MIG Profile">
                  <select
                    value={p.migProfile}
                    onChange={(e) =>
                      updatePool(i, { migProfile: e.target.value })
                    }
                  >
                    <option>
                      {
                        pools.find((pool) => pool.code === p.poolCode)
                          ?.migProfile
                      }
                    </option>
                  </select>
                </Field>
              )}
              {p.slicingPolicy === "time_slicing" && (
                <Field label="Time slice · 2–8">
                  <input
                    className="input"
                    type="number"
                    min={2}
                    max={8}
                    value={p.timeSliceShare}
                    onChange={(e) =>
                      updatePool(i, { timeSliceShare: Number(e.target.value) })
                    }
                  />
                </Field>
              )}
            </div>
            <small>
              {t("wizard.license", {
                count:
                  pools.find((pool) => pool.code === p.poolCode)
                    ?.licenseAvailable || 0,
              })}
            </small>
          </div>
        </Panel>
      ))}
      <Button
        disabled={spec.nodePools.length >= 5}
        onClick={() => {
          const p = spec.nodePools[0];
          const nodePools = [...spec.nodePools, { ...p, nodeCount: 1 }];
          update({
            nodePools,
            gpuCount: nodePools.reduce(
              (a, p) => a + p.nodeCount * p.gpuPerNode,
              0,
            ),
          });
        }}
      >
        {t("wizard.addPool")}
      </Button>
      <ScalingToggle kind="vgpu" />
    </div>
  ) : step === 3 ? (
    <div className="stack">
      <NetworkFields />
      <div className="form-grid">
        <SpecSelect
          name="networkPlugin"
          label="CNI"
          options={["cilium", "calico"]}
        />
        <SpecCheck name="ingressEnabled" label="Ingress" />
        {spec.ingressEnabled && (
          <SpecSelect
            name="ingressClass"
            label="Ingress Class"
            options={["nginx", "traefik"]}
          />
        )}
        <SpecSelect
          name="storageClass"
          label="Storage Class"
          options={["ssd", "nvme", "shared-fs"]}
        />
        <SpecNumber name="defaultPvcGb" label="PVC · GB" min={0} max={32768} />
      </div>
      <StorageRows />
    </div>
  ) : (
    <div className="stack">
      <SpecSelect
        name="kubeconfigAccess"
        label={t("wizard.accessConfirm")}
        options={["download", "managed-console"]}
      />
      <SpecCheck name="rbacDefaultAdmin" label="RBAC Admin" />
      <Review />
    </div>
  );
}
export default function VgpuWizard() {
  return (
    <WizardLayout
      kind="vgpu"
      steps={[
        "projectRegion",
        "controlPlane",
        "nodePools",
        "networkStorage",
        "accessConfirm",
      ]}
      validateStep={validate}
      render={(ctx) => <VgpuForm {...ctx} />}
    />
  );
}
