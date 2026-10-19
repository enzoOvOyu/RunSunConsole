import type { ColumnDef } from '@tanstack/react-table';
import type { ResourceOf } from '../../../types/domain';
import { ResourceListShell,ResourceName } from '../shared/ResourceListShell';
import {money} from '../../../lib/money';
import { Badge } from '../../../components/ui';
import { t } from '../../../i18n';
export default function InferencePage(){const columns:ColumnDef<ResourceOf<'inference'>>[]=[{accessorKey:'name',header:t('common.name'),cell:({row})=><ResourceName resource={row.original}/>},{accessorKey:'status',header:t('common.status'),cell:({row})=><Badge status={row.original.deletedAt?'released':row.original.status}/>},{accessorKey:'region',header:t('common.region'),cell:({row})=>t(`common.${row.original.region}`)},{id:'model',header:t('resource.model'),cell:({row})=>row.original.spec.modelRef},{id:'engine',header:t('resource.engine'),cell:({row})=>row.original.spec.engine},{id:'replicas',header:t('resource.replicas'),cell:({row})=>row.original.spec.replicas},{id:'gpu',header:t('resource.gpu'),cell:({row})=>`${row.original.nodePool} × ${row.original.spec.gpuPerReplica}`},{id:'port',header:t('common.endpoint'),cell:({row})=>row.original.spec.port},{id:'hourly',header:t('resource.hourly'),cell:({row})=>money(row.original.cost?.perHour||0)}];return <ResourceListShell kind="inference" columns={columns}/>;}
