import { useRef, useState } from "react";
import { Copy, KeyRound, Trash2, Upload } from "lucide-react";
import { Button, Empty, Field, PageHeader, Panel, toast } from "../../components/ui";
import { confirmAction } from "../../components/ui/ConfirmAction";
import { clientUuid } from "../../lib/uuid";
import { isValidSshPublicKey, readSshKeys, writeSshKeys, type SshKey } from "../../lib/ssh-keys";
import { t } from "../../i18n";
import "./ssh-keys.css";

export default function SshKeysPage() {
  const [keys, setKeys] = useState<SshKey[]>(readSshKeys);
  const [name, setName] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const save = () => {
    const normalized = publicKey.trim();
    if (!name.trim() || !isValidSshPublicKey(normalized)) {
      setInvalid(true);
      return;
    }
    const next = [
      { id: clientUuid(), name: name.trim(), publicKey: normalized, createdAt: new Date().toISOString() },
      ...keys,
    ];
    writeSshKeys(next);
    setKeys(next);
    setName("");
    setPublicKey("");
    setFileName("");
    setInvalid(false);
    toast(t("success.saved"));
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    const value = (await file.text()).trim();
    setPublicKey(value);
    setName((current) => current || file.name.replace(/\.pub$/i, ""));
    setInvalid(!isValidSshPublicKey(value));
  };

  const removeKey = async (key: SshKey) => {
    if (!(await confirmAction(`${t("common.delete")} ${key.name}`))) return;
    const next = keys.filter((item) => item.id !== key.id);
    writeSshKeys(next);
    setKeys(next);
    toast(t("success.deleted"));
  };

  return (
    <div className="stack">
      <PageHeader title={t("nav.ssh-keys")} subtitle={t("pageDescription.sshKeys")} />
      <Panel title={t("sshKeys.importTitle")}>
        <div className="stack">
          <div className="form-grid">
            <Field label={t("sshKeys.name")}>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </Field>
            <div className="ssh-key-file-field">
              <span className="field-label">{t("sshKeys.file")}</span>
              <div className="row">
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload size={15} aria-hidden="true" />
                  {t("sshKeys.chooseFile")}
                </Button>
                <small className="muted">
                  {fileName || t("sshKeys.noFileSelected")}
                </small>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pub,text/plain"
                  hidden
                  onChange={(event) => {
                    void importFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </div>
              <small>{t("sshKeys.fileHint")}</small>
            </div>
          </div>
          <Field label={t("sshKeys.publicKey")} hint={t("sshKeys.formatHint")}>
            <textarea
              className="input"
              rows={3}
              value={publicKey}
              onChange={(event) => {
                setPublicKey(event.target.value);
                setFileName("");
                setInvalid(false);
              }}
              aria-invalid={invalid && !isValidSshPublicKey(publicKey)}
            />
          </Field>
          {invalid && (!name.trim() || !isValidSshPublicKey(publicKey)) && (
            <p className="field-error">{t("sshKeys.validation")}</p>
          )}
          <div>
            <Button variant="primary" onClick={save}>
              <Upload size={15} />
              {t("sshKeys.add")}
            </Button>
          </div>
        </div>
      </Panel>
      <Panel title={t("sshKeys.savedTitle")}>
        {keys.length ? (
          <div className="stack">
            {keys.map((key) => (
              <article className="panel" key={key.id}>
                <div className="panel-body stack">
                  <div className="between">
                    <div className="row">
                      <KeyRound size={17} />
                      <strong>{key.name}</strong>
                    </div>
                    <div className="row">
                      <Button
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(key.publicKey);
                            toast(t("sshKeys.copied"));
                          } catch {
                            toast(t("sshKeys.copyFailed"), true);
                          }
                        }}
                      >
                        <Copy size={14} />
                        {t("common.copy")}
                      </Button>
                      <Button variant="danger" onClick={() => void removeKey(key)}>
                        <Trash2 size={14} />
                        {t("common.delete")}
                      </Button>
                    </div>
                  </div>
                  <code className="mono" style={{ overflowWrap: "anywhere" }}>
                    {key.publicKey}
                  </code>
                  <small className="muted">{t("sshKeys.localStorageHint")}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            text={t("sshKeys.emptyTitle")}
            action={<small>{t("sshKeys.emptyDescription")}</small>}
          />
        )}
      </Panel>
    </div>
  );
}
