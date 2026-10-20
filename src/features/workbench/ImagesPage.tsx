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
} from "../../components/ui";
export default function ImagesPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") || "models");
  const [search, setSearch] = useUrlState("q");
  const [modality, setModality] = useUrlState("modality");
  const [license, setLicense] = useUrlState("license");
  const [paramsSize, setParamsSize] = useUrlState("params");
  const [favorite, setFavorite] = useState(false);
  const [model, setModel] = useState<Model | null>(null);
  const [image, setImage] = useState<Image | null>(null);
  const models = useData<Model[]>(["models"], EP.models);
  const images = useData<Image[]>(["images"], EP.images);
  const { run } = useAction();
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  const filtered =
    models.data?.filter(
      (m) =>
        m.name.toLowerCase().includes(search.toLowerCase()) &&
        (!modality || m.modality === modality) &&
        (!license || m.license === license) &&
        (!paramsSize ||
          (paramsSize === "small" ? m.paramsB < 30 : m.paramsB >= 30)) &&
        (!favorite || m.favorite),
    ) || [];
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
      <div className="toolbar">
        <input
          className="input search"
          placeholder={t("common.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {tab === "models" && (
          <>
            <select
              aria-label={t("images.modality")}
              value={modality}
              onChange={(e) => setModality(e.target.value)}
            >
              <option value="">{t("images.modality")}</option>
              {["text", "image"].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <select
              aria-label={t("images.license")}
              value={license}
              onChange={(e) => setLicense(e.target.value)}
            >
              <option value="">{t("images.license")}</option>
              {[...new Set(models.data?.map((m) => m.license))].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <select
              aria-label={t("images.params")}
              value={paramsSize}
              onChange={(e) => setParamsSize(e.target.value)}
            >
              <option value="">{t("images.params")}</option>
              <option value="small">&lt; 30B</option>
              <option value="large">≥ 30B</option>
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
      ) : tab === "models" ? (
        filtered.length ? (
          <div className="grid grid-3">
            {filtered.map((m) => (
              <article className="catalog-card" key={m.id}>
                <div className="between">
                  <Brain size={24} color="var(--rs-purple)" />
                  <Button
                    variant="ghost"
                    className="icon-btn"
                    disabled={!canWrite(role)}
                    aria-label={t("images.favorite")}
                    onClick={() =>
                      void run(() =>
                        patch(EP.models + "/" + m.id, {
                          favorite: !m.favorite,
                        }),
                      )
                    }
                  >
                    <Star
                      size={17}
                      fill={m.favorite ? "var(--rs-gold)" : "none"}
                      color="var(--rs-gold)"
                    />
                  </Button>
                </div>
                <strong>{m.name}</strong>
                <small>
                  {m.paramsB}B · {m.modality} · {m.license}
                </small>
                <div className="row">
                  {m.quantizations.map((q) => (
                    <span className="chip" key={q}>
                      {q}
                    </span>
                  ))}
                </div>
                <div className="between">
                  <Button onClick={() => setModel(m)}>
                    {t("common.details")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canWrite(role)}
                    onClick={() =>
                      navigate("/deployment/inference?model=" + m.id)
                    }
                  >
                    {t("images.deploy")}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty />
        )
      ) : (
        <div className="grid grid-3">
          {images.data
            ?.filter((i) => i.name.toLowerCase().includes(search.toLowerCase()))
            .map((i) => (
              <article className="catalog-card" key={i.id}>
                <Box size={26} color="var(--rs-brand)" />
                <strong>{i.name}</strong>
                <small>
                  {i.framework} · CUDA {i.cudaVersion} · {i.sizeGb} GB
                </small>
                <span className="chip">{i.source}</span>
                <div className="between">
                  <Button onClick={() => setImage(i)}>
                    {t("common.details")}
                  </Button>
                  <Button
                    disabled={!canWrite(role)}
                    onClick={() => navigate("/deployment/server?image=" + i.id)}
                  >
                    {t("images.deploy")}
                  </Button>
                </div>
              </article>
            ))}
        </div>
      )}
      <Modal
        drawer
        small
        open={!!model || !!image}
        onClose={() => {
          setModel(null);
          setImage(null);
        }}
        title={model?.name || image?.name || t("common.details")}
      >
        <Panel title={t("common.details")}>
          <KeyValues
            items={
              model
                ? [
                    [t("images.params"), model.paramsB + "B"],
                    [t("images.license"), model.license],
                    [t("images.modality"), model.modality],
                    [t("wizard.quantization"), model.quantizations.join(" / ")],
                    [t("wizard.context"), model.context],
                  ]
                : image
                  ? [
                      [t("common.version"), image.framework],
                      ["CUDA", image.cudaVersion],
                      [t("common.size"), image.sizeGb + " GB"],
                      [t("common.source"), image.source],
                    ]
                  : []
            }
          />
        </Panel>
        <div className="row section-gap">
          <Button
            disabled={!canWrite(role)}
            onClick={() =>
              navigate(
                model
                  ? "/deployment/inference?model=" + model.id
                  : "/deployment/server?image=" + image?.id,
              )
            }
          >
            {t("common.inference")}
          </Button>
          {model && (
            <Button
              disabled={!canWrite(role)}
              onClick={() => navigate("/deployment/server?model=" + model.id)}
            >
              {t("common.gpu_vm")}
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
