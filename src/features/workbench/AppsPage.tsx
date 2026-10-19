import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { EP } from "../../lib/api-client";
import { useData } from "../shared/hooks";
import { useAuth } from "../../stores/auth";
import { canWrite } from "../../lib/rbac";
import { t } from "../../i18n";
import {
  PageHeader,
  Button,
  Modal,
  Loading,
  ErrorState,
  Empty,
} from "../../components/ui";
interface AppTemplate {
  id: string;
  name: string;
  description: string;
  modelRef?: string;
  imageRef?: string;
  kind: string;
}
export default function AppsPage() {
  const q = useData<AppTemplate[]>(["apps"], EP.apps);
  const [selected, setSelected] = useState<AppTemplate | null>(null);
  const navigate = useNavigate();
  const role = useAuth((s) => s.role);
  return (
    <>
      <PageHeader title={t("nav.apps")} />
      {q.isPending ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data.length ? (
        <div className="grid grid-3">
          {q.data.map((a) => (
            <article className="catalog-card" key={a.id}>
              <Sparkles size={25} color="var(--rs-brand)" />
              <strong>{a.name}</strong>
              <small>{a.description}</small>
              <div className="between">
                <Button onClick={() => setSelected(a)}>
                  {t("common.details")}
                </Button>
                <Button
                  variant="primary"
                  disabled={!canWrite(role)}
                  onClick={() =>
                    navigate(
                      `/deployment/${a.kind === "inference" ? "inference" : "server"}?${a.modelRef ? "model=" + a.modelRef : "image=" + a.imageRef}&template=${a.id}`,
                    )
                  }
                >
                  {t("apps.deploy")}
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty />
      )}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name || t("common.details")}
      >
        <p>{selected?.description}</p>
      </Modal>
    </>
  );
}
