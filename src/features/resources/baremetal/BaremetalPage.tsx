import type { ColumnDef } from '@tanstack/react-table';
import type { ResourceOf } from '../../../types/domain';
import { ResourceListShell,ResourceName } from '../shared/ResourceListShell';
import {money} from '../../../lib/money';
import { Badge } from '../../../components/ui';
import { t } from '../../../i18n';
import { size } from '../../../lib/money';
export default function BaremetalPage(){const columns:ColumnDef<ResourceOf<'gpu_baremetal'>>[]=[{accessorKey:'name',header:t('common.name'),cell:({row})=><ResourceName resource={row.original}/>},{accessorKey:'status',header:t('common.status'),cell:({row})=><Badge status={row.original.deletedAt?'released':row.original.status}/>},{accessorKey:'region',header:t('common.region'),cell:({row})=>t(`common.${row.original.region}`)},{id:'machine',header:t('resource.machineType'),cell:({row})=>row.original.spec.machineType},{id:'count',header:t('resource.machineCount'),cell:({row})=>row.original.spec.machineCount},{id:'gpu',header:t('resource.totalGpu'),cell:({row})=>row.original.spec.gpuCount},{id:'cpu',header:t('resource.cpu'),cell:({row})=>`${row.original.spec.cpuModel} / ${size(row.original.spec.memoryGb)}`},{id:'rack',header:t('resource.rack'),cell:({row})=>row.original.placement?.rackId||'—'},{id:'nvme',header:t('resource.nvme'),cell:({row})=>size(row.original.spec.localNvmeGb)},{id:'hourly',header:t('common.price')+' / '+t('unit.per_machine_hour'),cell:({row})=>money(row.original.cost?.unitPrice||0)}];return <ResourceListShell kind="gpu_baremetal" columns={columns}/>;}
