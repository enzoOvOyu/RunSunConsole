import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "radix-ui";
import { ArrowUpRight, LayoutGrid, Plus, X } from "lucide-react";
import { Button } from "../../components/ui";
import { KINDS } from "../../types/domain";
import { KIND_META } from "../../lib/ids";
import { canWrite } from "../../lib/rbac";
import { useAuth } from "../../stores/auth";
import { t } from "../../i18n";

export function QuickDeploy() {
  const [open, setOpen] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pointerFrame = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const resetGlass = () => {
    if (pointerFrame.current !== null)
      cancelAnimationFrame(pointerFrame.current);
    pointerFrame.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    panel.removeAttribute("data-pointer-active");
    for (const name of [
      "x",
      "y",
      "tilt-x",
      "tilt-y",
      "angle",
      "blur",
      "saturation",
    ]) {
      panel.style.removeProperty(`--overview-glass-${name}`);
    }
  };
  useEffect(() => {
    if (!open) resetGlass();
    return () => {
      if (pointerFrame.current !== null)
        cancelAnimationFrame(pointerFrame.current);
      pointerFrame.current = null;
    };
  }, [open]);
  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType !== "mouse" ||
      !window.matchMedia("(hover: hover) and (pointer: fine)").matches ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    pointer.current = { x: event.clientX, y: event.clientY };
    if (pointerFrame.current !== null) return;
    pointerFrame.current = requestAnimationFrame(() => {
      pointerFrame.current = null;
      const panel = panelRef.current;
      const card = cardRef.current;
      if (!panel || !card) return;
      const rect = card.getBoundingClientRect();
      const x = Math.max(
        0,
        Math.min(
          1,
          (pointer.current.x - rect.left - 14) / Math.max(1, rect.width - 28),
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          1,
          (pointer.current.y - rect.top - 14) / Math.max(1, rect.height - 28),
        ),
      );
      panel.dataset.pointerActive = "true";
      const values = {
        x: `${x * 100}%`,
        y: `${y * 100}%`,
        "tilt-x": `${(0.5 - y) * 4}deg`,
        "tilt-y": `${(x - 0.5) * 4}deg`,
        angle: `${100 + x * 65 - y * 25}deg`,
        blur: `${20 + y * 8}px`,
        saturation: `${140 + x * 30}%`,
      };
      for (const [name, value] of Object.entries(values))
        panel.style.setProperty(`--overview-glass-${name}`, value);
    });
  };
  const role = useAuth((state) => state.role);
  const navigate = useNavigate();
  return (
    <section
      ref={cardRef}
      className="overview-action-bar"
      data-open={open}
      aria-label={t("overview.quickDeploy")}
    >
      <div className="overview-action-copy">
        <strong>{t("overview.quickDeploy")}</strong>
        <span>{t("overview.quickDeployHint")}</span>
      </div>
      <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
        <Dialog.Trigger asChild>
          <Button
            className="overview-deploy-trigger"
            disabled={!canWrite(role)}
          >
            <LayoutGrid size={16} />
            {t("overview.chooseResource")}
            <Plus size={16} className="overview-deploy-plus" />
          </Button>
        </Dialog.Trigger>
        <Dialog.Content
          className="overview-deploy-panel"
          ref={panelRef}
          onPointerMove={followPointer}
          onPointerLeave={resetGlass}
          onPointerCancel={resetGlass}
          aria-describedby={undefined}
        >
          <div className="overview-deploy-menu-header">
            <Dialog.Title className="overview-deploy-menu-heading">
              {t("overview.chooseResource")}
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                className="overview-deploy-close"
                aria-label={t("common.close")}
              >
                <X size={16} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="overview-deploy-options">
            {KINDS.map((kind) => {
              const Icon = KIND_META[kind].icon;
              return (
                <Button
                  key={kind}
                  disabled={!canWrite(role)}
                  onClick={() => {
                    setOpen(false);
                    navigate(`/deployment/${KIND_META[kind].deployKey}`);
                  }}
                >
                  <span
                    className="overview-deploy-option-icon"
                    style={{ color: KIND_META[kind].color }}
                  >
                    <Icon size={18} />
                  </span>
                  {t(`common.${kind}`)}
                  <ArrowUpRight size={15} className="overview-deploy-arrow" />
                </Button>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </section>
  );
}
