import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Bucket, StorageObject } from "../../types/domain";
import type { Vpc } from "../../types/network";
import { EP, api, query, remove } from "../../lib/api-client";
import { formatResourceId } from "../../lib/ids";
import { filePathIssue, fileScopePrefix } from "../../lib/s3-files";
import { vpcNetworkType } from "../../lib/network";
import { date } from "../../lib/date";
import { sizeBytes } from "../../lib/money";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { t } from "../../i18n";
import { useAction, useData } from "../shared/hooks";
import { confirmAction } from "../../components/ui/ConfirmAction";
import {
  Button,
  DataTable,
  Field,
  KeyValues,
  Panel,
} from "../../components/ui";

type FileRow = StorageObject & {
  issue: "empty" | "component" | "length" | "archive" | null;
};

export function S3FilesPanel({
  bucket,
  onBrowse,
}: {
  bucket: Bucket;
  onBrowse: (prefix: string) => void;
}) {
  const role = useAuth((state) => state.role);
  const { run, busy } = useAction();
  const [prefix, setPrefix] = useState("");
  const [vpcId, setVpcId] = useState("");
  const [showAll, setShowAll] = useState(false);
  const vpcs = useData<Vpc[]>(
    ["network-list", "vpcs", bucket.region, bucket.projectId],
    `${EP.network}/vpcs${query({ region: bucket.region, project_id: bucket.projectId })}`,
  );
  const availableVpcs = (vpcs.data || []).filter(
    (vpc) => vpcNetworkType(vpc) === "standard",
  );
  useEffect(() => {
    setPrefix("");
    setVpcId("");
    setShowAll(false);
  }, [bucket.id]);
  const config = bucket.fileInterface;
  const scope = config?.prefix || "";
  const fileRows: FileRow[] = bucket.objects
    .filter(
      (object) => object.key.startsWith(scope) && !object.key.endsWith("/"),
    )
    .map((object) => ({
      ...object,
      issue: ["STANDARD", "IA"].includes(object.storageClass)
        ? filePathIssue(object.key)
        : "archive",
    }));
  const accessible = fileRows.filter((object) => !object.issue).length;
  const incompatible = fileRows.length - accessible;
  const selectedVpc = availableVpcs.find((vpc) => vpc.id === config?.vpcId);
  const normalizedPrefix = fileScopePrefix(prefix);

  return (
    <div className="stack">
      {!config ? (
        <Panel title={t("storage.s3FilesSetup")}>
          <div className="stack">
            {!bucket.versioning && (
              <div className="notice warning">
                {t("storage.s3FilesVersioningRequired")}
                <div className="row">
                  <Button
                    disabled={!canWrite(role) || busy}
                    onClick={() =>
                      void run(() =>
                        api(`${EP.buckets}/${bucket.id}/settings`, {
                          method: "PUT",
                          body: JSON.stringify({
                            blockPublicAccess:
                              bucket.blockPublicAccess !== false,
                            defaultEncryption:
                              bucket.defaultEncryption !== false,
                            versioning: true,
                            access: bucket.access,
                            tags: bucket.tags || {},
                          }),
                        }),
                      )
                    }
                  >
                    {t("storage.s3FilesEnableVersioning")}
                  </Button>
                </div>
              </div>
            )}
            <div className="form-grid">
              <Field
                label={t("storage.s3FilesPrefix")}
                hint={t("storage.s3FilesPrefixHint")}
              >
                <input
                  className="input"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                  placeholder="datasets/"
                />
                {normalizedPrefix === null && (
                  <small className="field-error">
                    {t("storage.s3FilesInvalidPrefix")}
                  </small>
                )}
              </Field>
              <Field
                label={t("storage.s3FilesVpc")}
                hint={t("storage.s3FilesVpcHint")}
              >
                <select
                  value={vpcId}
                  onChange={(event) => setVpcId(event.target.value)}
                >
                  <option value="">{t("storage.s3FilesChooseVpc")}</option>
                  {availableVpcs.map((vpc) => (
                    <option key={vpc.id} value={vpc.id}>
                      {vpc.name} · {formatResourceId("vpc", vpc.id)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {!availableVpcs.length && (
              <Link to="/network/vpcs">{t("storage.fileCreateVpc")}</Link>
            )}
            <small>{t("storage.s3FilesSetupHint")}</small>
            <Button
              variant="primary"
              disabled={
                !canWrite(role) ||
                busy ||
                !bucket.versioning ||
                !vpcId ||
                normalizedPrefix === null
              }
              onClick={() =>
                void run(() =>
                  api(`${EP.buckets}/${bucket.id}/file-interface`, {
                    method: "PUT",
                    body: JSON.stringify({ prefix: normalizedPrefix, vpcId }),
                  }),
                )
              }
            >
              {t("storage.s3FilesCreatePreview")}
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          <Panel
            title={t("storage.s3FilesConfiguration")}
            action={
              <Button
                variant="danger"
                disabled={!canWrite(role) || busy}
                onClick={async () => {
                  if (await confirmAction(t("storage.s3FilesRemoveConfirm")))
                    void run(() =>
                      remove(`${EP.buckets}/${bucket.id}/file-interface`),
                    );
                }}
              >
                {t("common.delete")}
              </Button>
            }
          >
            <KeyValues
              items={[
                ["ID", formatResourceId("sfi", config.id)],
                [t("common.status"), t("storage.s3FilesPreviewOnly")],
                [
                  t("storage.s3FilesSource"),
                  `s3://${bucket.name}/${config.prefix}`,
                ],
                [
                  t("storage.s3FilesVpc"),
                  selectedVpc
                    ? `${selectedVpc.name} · ${formatResourceId("vpc", selectedVpc.id)}`
                    : formatResourceId("vpc", config.vpcId),
                ],
                [t("common.createdAt"), date(config.createdAt)],
                [
                  t("storage.s3FilesMountTarget"),
                  t("storage.s3FilesNotProvisioned"),
                ],
                [t("storage.s3FilesSync"), t("storage.s3FilesNotProvisioned")],
              ]}
            />
            <small>{t("storage.s3FilesConfigHint")}</small>
          </Panel>
        </>
      )}
      <Panel
        title={t("storage.s3FilesAccessibleObjects")}
        action={
          <Button onClick={() => onBrowse(scope)}>
            {t("storage.s3FilesBrowseObjects")}
          </Button>
        }
      >
        <div className="row">
          <strong>
            {accessible} {t("storage.s3FilesAccessible")}
          </strong>
          <small>
            {incompatible} {t("storage.s3FilesIncompatible")}
          </small>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
          />
          {t("storage.s3FilesShowIncompatible")}
        </label>
        <DataTable
          data={showAll ? fileRows : fileRows.filter((object) => !object.issue)}
          columns={[
            {
              accessorKey: "key",
              header: t("storage.s3FilesPath"),
              cell: ({ row }) => row.original.key.slice(scope.length),
            },
            {
              accessorKey: "size",
              header: t("storage.s3FilesFileSize"),
              cell: ({ row }) => sizeBytes(row.original.size),
            },
            { accessorKey: "storageClass", header: t("storage.tier") },
            {
              id: "compatibility",
              header: t("common.status"),
              cell: ({ row }) =>
                row.original.issue
                  ? t(`storage.s3FilesIssue.${row.original.issue}`)
                  : t("storage.s3FilesCompatible"),
            },
          ]}
        />
      </Panel>
      <Panel title={t("storage.s3FilesLimitations")}>
        <ul className="stack">
          <li>{t("storage.s3FilesLimitPaths")}</li>
          <li>{t("storage.s3FilesLimitArchive")}</li>
          <li>{t("storage.s3FilesLimitNfs")}</li>
          <li>{t("storage.s3FilesLimitSync")}</li>
          <li>{t("storage.s3FilesLimitBilling")}</li>
        </ul>
      </Panel>
    </div>
  );
}
