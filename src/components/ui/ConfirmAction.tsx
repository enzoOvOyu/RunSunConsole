import { useRef, useState } from "react";
import { create } from "zustand";
import { Modal, Button, Field } from "./index";
import { t } from "../../i18n";
interface Confirmation {
  title: string;
  token: string;
  resolve: (confirmed: boolean) => void;
}
const useConfirmation = create<{
  pending: Confirmation | null;
  set: (pending: Confirmation | null) => void;
}>((set) => ({ pending: null, set: (pending) => set({ pending }) }));
export function confirmAction(title: string, token?: string): Promise<boolean> {
  const prefix = t("common.delete") + " ";
  const required =
    token ?? (title.startsWith(prefix) ? title.slice(prefix.length) : "");
  return new Promise((resolve) =>
    useConfirmation.getState().set({ title, token: required, resolve }),
  );
}
export function ConfirmAction() {
  const { pending, set } = useConfirmation();
  const [input, setInput] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);
  const finish = (value: boolean) => {
    pending?.resolve(value);
    set(null);
    setInput("");
  };
  return (
    <Modal
      open={!!pending}
      onClose={() => finish(false)}
      title={t("common.confirm")}
      initialFocusRef={cancel}
    >
      <div className="stack">
        <p>{pending?.title}</p>
        {pending?.token && (
          <Field label={t("resource.deleteInput", { id: pending.token })}>
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </Field>
        )}
        <div className="dialog-footer">
          <button
            ref={cancel}
            type="button"
            className="btn"
            onClick={() => finish(false)}
          >
            {t("common.cancel")}
          </button>
          <Button
            variant={pending?.token ? "danger" : "primary"}
            disabled={!!pending?.token && input !== pending.token}
            onClick={() => finish(true)}
          >
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
