import { useState, useEffect } from "react";
import { Command } from "cmdk";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../stores/auth";
import { useLocale } from "../../stores/locale";
import { useTheme } from "../../stores/theme";
import { buildGroups } from "../../app/layouts/navModel";
import { EP, query } from "../../lib/api-client";
import { useData } from "../../features/shared/hooks";
import { resourceLink } from "../../lib/ids";
import type { Resource } from "../../types/domain";
import { t, dt } from "../../i18n";
import "./palette.css";
export function CommandPalette({
  open,
  onChange,
}: {
  open: boolean;
  onChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const role = useAuth((s) => s.role);
  const navigate = useNavigate();
  const { locale, setLocale } = useLocale();
  const toggle = useTheme((s) => s.toggle);
  const resources = useData<{ items: Resource[] }>(
    ["command-resources"],
    EP.resources + query({ size: 1000 }),
    { enabled: open },
  );
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onChange(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onChange]);
  const select = (action: () => void) => {
    action();
    onChange(false);
    setSearch("");
  };
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onChange}
      label={t("header.search")}
      shouldFilter={true}
    >
      <Command.Input
        placeholder={t("command.placeholder")}
        value={search}
        onValueChange={setSearch}
      />
      <Command.List>
        <Command.Empty>{t("command.empty")}</Command.Empty>
        <Command.Group heading={t("command.resources")}>
          {resources.data?.items.map((r) => (
            <Command.Item
              key={r.resourceUuid}
              value={`${r.displayId} ${r.resourceUuid} ${r.name} ${dt(r.name)}`}
              onSelect={() => select(() => navigate(resourceLink(r)))}
            >
              <span>{dt(r.name)}</span>
              <small className="resource-id">{r.displayId}</small>
            </Command.Item>
          ))}
        </Command.Group>
        {[
          {
            id: "create",
            items: buildGroups(role)
              .filter((g) => g.id === "deployment")
              .flatMap((g) => g.items),
          },
          {
            id: "navigate",
            items: buildGroups(role)
              .filter((g) => g.id !== "deployment")
              .flatMap((g) => g.items),
          },
        ].map((g) => (
          <Command.Group key={g.id} heading={t(`command.${g.id}`)}>
            {g.items.map((item) => (
              <Command.Item
                value={item.label()}
                key={item.path}
                onSelect={() => select(() => navigate(item.path))}
              >
                {item.label()}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
        <Command.Group heading={t("command.quick")}>
          <Command.Item onSelect={() => select(toggle)}>
            {t("header.theme")}
          </Command.Item>
          <Command.Item
            onSelect={() =>
              select(() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN"))
            }
          >
            {t("header.language")}
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
