import { useUrlState } from "../shared/useUrlState";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Star, Box, Brain } from "lucide-react";
import type { Image, Model } from "../../types/domain";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { EP, patch } from "../../lib/api-client";
import { useAction, useData } from "../shared/hooks";
import { t } from "../../i18n";
import { number } from "../../lib/money";
import {
  PageHeader,
  Button,
  Panel,
  Tabs,
  Modal,
  KeyValues,
  Check,
  Empty,
  Loading,
  ErrorState,
} from "../../components/ui";
import "./model-catalog.css";

function parameters(value: number, approximate = false) {
  const formatted =
    value >= 1000 ? `${number(value / 1000, 2)}T` : `${number(value, 1)}B`;
  return `${approximate ? "≈" : ""}${formatted}`;
}

function contextLabel(value: number) {
  if (!value) return "—";
  return value >= 1048576
    ? `${number(value / 1048576, 2)}M`
    : `${number(value / 1024, 1)}K`;
}

function publisherName(model: Model) {
  const publisher = model.publisher || "";
  if (publisher === "meta-models" || publisher === "meta-llama") return "Meta";
  if (publisher === "nvidia") return "NVIDIA";
  if (publisher === "Qwen") return "Qwen";
  return publisher || t("images.verified");
}

export default function ImagesPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "models");
  const [search, setSearch] = useUrlState("q");
  const [modality, setModality] = useUrlState("modality");
  const [license, setLicense] = useUrlState("license");
  const [paramsSize, setParamsSize] = useUrlState("params");
  const [publisher, setPublisher] = useUrlState("publisher");
  const [sort, setSort] = useUrlState("sort");
  const [favorite, setFavorite] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [image, setImage] = useState<Image | null>(null);
  const models = useData<Model[]>(["models"], EP.models);
  const images = useData<Image[]>(["images"], EP.images);
  const { run, busy } = useAction();
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  const model = models.data?.find((item) => item.id === modelId) || null;
  const allModels = models.data || [];
  const publishers = [...new Set(allModels.map(publisherName))].sort();
  const filtered = allModels
    .filter((item) => {
      const needle = search.trim().toLowerCase();
      return (
        (!needle ||
          `${item.name} ${item.modelRef || ""} ${publisherName(item)}`
            .toLowerCase()
            .includes(needle)) &&
        (!modality ||
          (modality === "unknown"
            ? item.modality === "unknown"
            : item.modality === modality)) &&
        (!license ||
          (license === "unknown" ? !item.license : item.license === license)) &&
        (!paramsSize ||
          (paramsSize === "small"
            ? item.paramsB < 30
            : paramsSize === "medium"
              ? item.paramsB < 100 && item.paramsB >= 30
              : item.paramsB >= 100)) &&
        (!publisher || publisherName(item) === publisher) &&
        (!favorite || item.favorite)
      );
    })
    .sort((left, right) => {
      if (sort === "params") return right.paramsB - left.paramsB;
      if (sort === "name") return left.name.localeCompare(right.name);
      if (sort === "publisher")
        return publisherName(left).localeCompare(publisherName(right));
      return (left.featuredRank || 999) - (right.featuredRank || 999);
    });
  const readyCount = allModels.length;
  return (
    <>
      <PageHeader
        title={t("nav.images")}
        subtitle={t("pageDescription.images")}
      />
      <Tabs
        items={["models", "images"].map((id) => ({
          id,
          label: t("images." + id),
        }))}
        value={tab}
        onChange={setTab}
      />
      {tab === "models" && (
        <div className="model-catalog-summary">
          <div>
            <strong>{number(allModels.length)}</strong>
            <span>{t("images.catalogCount")}</span>
          </div>
          <div>
            <strong>{number(readyCount)}</strong>
            <span>{t("images.deployableCount")}</span>
          </div>
          <p>{t("images.catalogNotice")}</p>
        </div>
      )}
      <div className="toolbar model-catalog-filters">
        <input
          className="input search"
          aria-label={t("common.search")}
          placeholder={t("images.searchPlaceholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {tab === "models" && (
          <>
            <select
              aria-label={t("images.publisher")}
              value={publisher}
              onChange={(event) => setPublisher(event.target.value)}
            >
              <option value="">{t("images.allPublishers")}</option>
              {publishers.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              aria-label={t("images.modality")}
              value={modality}
              onChange={(event) => setModality(event.target.value)}
            >
              <option value="">{t("images.allModalities")}</option>
              <option value="text">{t("images.modality.text")}</option>
              <option value="image">{t("images.modality.image")}</option>
              <option value="multimodal">
                {t("images.modality.multimodal")}
              </option>
              <option value="unknown">{t("images.unknown")}</option>
            </select>
            <select
              aria-label={t("images.license")}
              value={license}
              onChange={(event) => setLicense(event.target.value)}
            >
              <option value="">{t("images.allLicenses")}</option>
              {[
                ...new Set(
                  allModels.map((item) => item.license).filter(Boolean),
                ),
              ]
                .sort()
                .map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              <option value="unknown">{t("images.unknown")}</option>
            </select>
            <select
              aria-label={t("images.params")}
              value={paramsSize}
              onChange={(event) => setParamsSize(event.target.value)}
            >
              <option value="">{t("images.allSizes")}</option>
              <option value="small">&lt; 30B</option>
              <option value="medium">30–99B</option>
              <option value="large">≥ 100B</option>
            </select>
            <select
              aria-label={t("images.sort")}
              value={sort}
              onChange={(event) => setSort(event.target.value)}
            >
              <option value="">{t("images.sortFeatured")}</option>
              <option value="params">{t("images.sortParameters")}</option>
              <option value="publisher">{t("images.sortPublisher")}</option>
              <option value="name">{t("images.sortName")}</option>
            </select>
            <Check
              label={t("images.favorite")}
              checked={favorite}
              onChange={setFavorite}
            />
          </>
        )}
      </div>
      {models.isPending || images.isPending ? (
        <Loading />
      ) : models.error || images.error ? (
        <ErrorState error={models.error || images.error} />
      ) : tab === "models" ? (
        filtered.length ? (
          <div className="model-catalog-grid">
            {filtered.map((item) => (
              <article
                className="catalog-card model-catalog-card"
                key={item.id}
              >
                <div className="between model-catalog-card-top">
                  <div className="row">
                    <span className="model-catalog-icon">
                      <Brain size={20} />
                    </span>
                    <span className="model-catalog-publisher">
                      {publisherName(item)}
                    </span>
                  </div>
                  <div className="row">
                    <span className="model-catalog-status ready">
                      {t("images.deployable")}
                    </span>
                    <Button
                      variant="ghost"
                      className="icon-btn"
                      disabled={!canWrite(role) || busy}
                      aria-label={t("images.favorite")}
                      onClick={() =>
                        void run(() =>
                          patch(EP.models + "/" + item.id, {
                            favorite: !item.favorite,
                          }),
                        )
                      }
                    >
                      <Star
                        size={17}
                        fill={item.favorite ? "var(--rs-gold)" : "none"}
                        color="var(--rs-gold)"
                      />
                    </Button>
                  </div>
                </div>
                <div>
                  <h3>{item.name}</h3>
                  <small className="model-catalog-ref">
                    {item.modelRef || item.id}
                  </small>
                </div>
                <p className="model-catalog-description">
                  {t(
                    item.modelRef
                      ? `images.description.${item.id}`
                      : "images.description.ready",
                  )}
                </p>
                <div className="model-catalog-metrics">
                  <div>
                    <span>{t("images.totalParams")}</span>
                    <strong>
                      {parameters(item.paramsB, item.parameterEstimate)}
                    </strong>
                  </div>
                  <div>
                    <span>{t("images.activeParams")}</span>
                    <strong>
                      {item.activeParamsB
                        ? parameters(item.activeParamsB)
                        : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>{t("images.context")}</span>
                    <strong>{contextLabel(item.context)}</strong>
                  </div>
                </div>
                <div className="model-catalog-tags">
                  <span className="chip">
                    {item.modality === "unknown"
                      ? t("images.modalityUnknown")
                      : t(`images.modality.${item.modality}`)}
                  </span>
                  {item.license && <span className="chip">{item.license}</span>}
                  {item.access && item.access !== "public" && (
                    <span className="chip">
                      {t(`images.access.${item.access}`)}
                    </span>
                  )}
                  {item.quantizations.slice(0, 2).map((value) => (
                    <span className="chip" key={value}>
                      {value.toUpperCase()}
                    </span>
                  ))}
                </div>
                <div className="between model-catalog-actions">
                  <Button onClick={() => setModelId(item.id)}>
                    {t("common.details")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canWrite(role)}
                    onClick={() =>
                      navigate("/deployment/inference?model=" + item.id)
                    }
                  >
                    {t("images.deploy")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty text={t("images.noMatches")} />
        )
      ) : images.data?.filter((item) =>
          item.name.toLowerCase().includes(search.toLowerCase()),
        ).length ? (
        <div className="grid grid-3">
          {images.data
            .filter((item) =>
              item.name.toLowerCase().includes(search.toLowerCase()),
            )
            .map((item) => (
              <article className="catalog-card" key={item.id}>
                <Box size={26} color="var(--rs-brand)" />
                <strong>{item.name}</strong>
                <small>
                  {item.framework} · CUDA {item.cudaVersion} · {item.sizeGb} GB
                </small>
                <span className="chip">{item.source}</span>
                <div className="between">
                  <Button onClick={() => setImage(item)}>
                    {t("common.details")}
                  </Button>
                  <Button
                    disabled={!canWrite(role)}
                    onClick={() =>
                      navigate("/deployment/server?image=" + item.id)
                    }
                  >
                    {t("images.deploy")}
                  </Button>
                </div>
              </article>
            ))}
        </div>
      ) : (
        <Empty text={t("images.noMatches")} />
      )}
      <Modal
        drawer
        open={!!model || !!image}
        onClose={() => {
          setModelId(null);
          setImage(null);
        }}
        title={model?.name || image?.name || t("common.details")}
      >
        {model ? (
          <div className="stack">
            <p className="model-catalog-description">
              {t(
                model.modelRef
                  ? `images.description.${model.id}`
                  : "images.description.ready",
              )}
            </p>
            <Panel title={t("images.modelIdentity")}>
              <KeyValues
                items={[
                  [t("images.publisher"), publisherName(model)],
                  [t("images.modelRef"), model.modelRef || model.id],
                  [t("images.availability"), t("images.deployable")],
                  [
                    t("images.country"),
                    model.countryCode
                      ? t(`images.country.${model.countryCode}`)
                      : "—",
                  ],
                  [
                    t("images.access"),
                    model.access ? t(`images.access.${model.access}`) : "—",
                  ],
                ]}
              />
            </Panel>
            <Panel title={t("images.modelSpecifications")}>
              <KeyValues
                items={[
                  [
                    t("images.totalParams"),
                    parameters(model.paramsB, model.parameterEstimate),
                  ],
                  [
                    t("images.activeParams"),
                    model.activeParamsB ? parameters(model.activeParamsB) : "—",
                  ],
                  [
                    t("images.context"),
                    model.context
                      ? `${contextLabel(model.context)} · ${number(model.context)} tokens`
                      : t("images.unknown"),
                  ],
                  [
                    t("images.modality"),
                    model.modality === "unknown"
                      ? t("images.unknown")
                      : t(`images.modality.${model.modality}`),
                  ],
                  [t("images.license"), model.license || t("images.unknown")],
                  [t("images.architecture"), model.architecture || "—"],
                  [t("images.weightFormat"), model.weightFormat || "—"],
                  [
                    t("wizard.quantization"),
                    model.quantizations.length
                      ? model.quantizations.join(" / ")
                      : t("images.notConfigured"),
                  ],
                ]}
              />
            </Panel>
            {model.sourceUrl && (
              <Panel title={t("images.source")}>
                <a
                  href={model.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("images.officialCard")} · {model.modelRef}
                </a>
                <small>{t("images.verifiedAt")}: 2026-10-20</small>
              </Panel>
            )}
            <p className="model-catalog-note">{t("images.billingNote")}</p>
            <div className="row">
              <Button
                variant="primary"
                disabled={!canWrite(role)}
                onClick={() =>
                  navigate("/deployment/inference?model=" + model.id)
                }
              >
                {t("common.inference")}
              </Button>
              <Button
                disabled={!canWrite(role)}
                onClick={() => navigate("/deployment/server?model=" + model.id)}
              >
                {t("common.gpu_vm")}
              </Button>
            </div>
          </div>
        ) : image ? (
          <div className="stack">
            <Panel title={t("common.details")}>
              <KeyValues
                items={[
                  [t("common.version"), image.framework],
                  ["CUDA", image.cudaVersion],
                  [t("common.size"), image.sizeGb + " GB"],
                  [t("common.source"), image.source],
                ]}
              />
            </Panel>
            <Button
              disabled={!canWrite(role)}
              onClick={() => navigate("/deployment/server?image=" + image.id)}
            >
              {t("common.gpu_vm")}
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
