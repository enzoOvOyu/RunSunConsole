import type { BaremetalMachine } from "../../../types/baremetal";
import type { ResourceOf } from "../../../types/domain";
import type { HardwareSnapshot } from "../../../types/monitoring";
import { gpuModelDisplayName } from "../../../lib/gpu-labels";
import { EP, query } from "../../../lib/api-client";
import { useData } from "../../shared/hooks";
import { t } from "../../../i18n";
import { size } from "../../../lib/money";
import {
  Panel,
  DataTable,
  Badge,
  Loading,
  ErrorState,
  KeyValues,
} from "../../../components/ui";
export function MachineInventory({
  machines,
  onSelect,
}: {
  machines: BaremetalMachine[];
  onSelect: (machine: BaremetalMachine) => void;
}) {
  return (
    <Panel title={t("baremetal.devices")} hint={t("baremetal.devicesHint")}>
      <DataTable
        data={machines}
        paginate={false}
        onRow={onSelect}
        columns={[
          {
            accessorKey: "name",
            header: t("baremetal.device"),
            cell: ({ row }) => (
              <div>
                <strong>{row.original.name}</strong>
                <div className="muted">{row.original.hostname}</div>
              </div>
            ),
          },
          {
            accessorKey: "status",
            header: t("common.status"),
            cell: ({ row }) => <Badge status={row.original.status} />,
          },
          {
            accessorKey: "gpuCount",
            header: "GPU",
            cell: ({ row }) => (
              <span>
                {row.original.gpuCount} ×{" "}
                {gpuModelDisplayName(row.original.gpuModel)}
              </span>
            ),
          },
          {
            accessorKey: "memoryGb",
            header: t("baremetal.memory"),
            cell: ({ row }) => size(row.original.memoryGb),
          },
          {
            accessorKey: "localNvmeGb",
            header: t("resource.nvme"),
            cell: ({ row }) => size(row.original.localNvmeGb),
          },
          { accessorKey: "privateIp", header: t("baremetal.privateIp") },
          { accessorKey: "bmcIp", header: t("baremetal.bmcIp") },
        ]}
      />
    </Panel>
  );
}
export function MachineFirmware({
  resource: r,
  machine,
}: {
  resource: ResourceOf<"gpu_baremetal">;
  machine: BaremetalMachine;
}) {
  const q = useData<HardwareSnapshot>(
    ["hardware", r.resourceUuid, machine.index],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/hardware${query({ node: machine.index })}`,
    { poll: true },
  );
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <Panel title={`${machine.name} · ${t("tab.firmware")}`}>
      <KeyValues
        items={[
          ["VBIOS", q.data.firmware.vbios],
          ["NVIDIA Driver", q.data.firmware.driver],
          ["CUDA", q.data.firmware.cuda],
          [
            t("baremetal.compliance"),
            q.data.firmware.compliance ? t("common.ready") : t("common.error"),
          ],
        ]}
      />
    </Panel>
  );
}
