import type { BaremetalMachine } from "../../../types/baremetal";
import type { ResourceOf } from "../../../types/domain";
import type { HardwareSnapshot } from "../../../types/monitoring";
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
  CopyButton,
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
                {row.original.gpuCount} × {row.original.gpuModel}
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
export function MachineAccess({
  resource: r,
  machine,
  firmware = false,
}: {
  resource: ResourceOf<"gpu_baremetal">;
  machine: BaremetalMachine;
  firmware?: boolean;
}) {
  const q = useData<HardwareSnapshot>(
    ["hardware", r.resourceUuid, machine.index],
    `${EP.metrics}/${r.kind}/${r.resourceUuid}/hardware${query({ node: machine.index })}`,
    { poll: true },
  );
  if (q.isPending) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const data = q.data;
  return (
    <Panel
      title={`${machine.name} · ${firmware ? t("tab.firmware") : "BMC / IPMI"}`}
    >
      {firmware ? (
        <KeyValues
          items={[
            ["VBIOS", data.firmware.vbios],
            ["NVIDIA Driver", data.firmware.driver],
            ["CUDA", data.firmware.cuda],
            [
              t("baremetal.compliance"),
              data.firmware.compliance ? t("common.ready") : t("common.error"),
            ],
          ]}
        />
      ) : (
        <KeyValues
          items={[
            [t("baremetal.hostname"), machine.hostname],
            [
              t("baremetal.privateIp"),
              <span className="row">
                <code>{machine.privateIp}</code>
                <CopyButton value={machine.privateIp} />
              </span>,
            ],
            [
              t("baremetal.bmcIp"),
              <span className="row">
                <code>{data.bmc.ip}</code>
                <CopyButton value={data.bmc.ip} />
              </span>,
            ],
            [
              t("common.status"),
              data.bmc.reachable ? t("common.ready") : t("common.unavailable"),
            ],
            [t("tab.firmware"), data.bmc.firmware],
            [
              "SEL",
              `${data.bmc.selLogCount} · ${data.bmc.lastSelEntry || t("common.noData")}`,
            ],
          ]}
        />
      )}
    </Panel>
  );
}
