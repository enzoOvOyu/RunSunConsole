import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Activity, Expand, Minimize, Power, RefreshCw } from "lucide-react";
import type { ResourceOf, Status } from "../../../types/domain";
import { Button, Field, Panel } from "../../../components/ui";
import { EP, post } from "../../../lib/api-client";
import { t } from "../../../i18n";
import {
  LocalConsoleAdapter,
  runSafeCommand,
  type ConsoleConnectionState,
} from "./terminal-adapter";
import "./terminal.css";

type Props = {
  resource: ResourceOf<"gpu_vm">;
  authMethod: "password" | "ssh_key";
  osName: string;
  osFamily: string;
  driverVersion?: string;
  cudaVersion?: string;
  canManage: boolean;
  onStart: () => Promise<unknown>;
  onStop: () => Promise<unknown>;
  onRestart: () => Promise<unknown>;
};

export function RemoteTerminal({
  resource,
  authMethod,
  osName,
  osFamily,
  driverVersion,
  cudaVersion,
  canManage,
  onStart,
  onStop,
  onRestart,
}: Props) {
  const adapter = useMemo(() => new LocalConsoleAdapter(), []);
  const screenRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyIndex = useRef(0);
  const isWindows = /windows/i.test(osFamily);
  const username = "root";
  const prompt = isWindows
    ? "PS C:\\Users\\" + username + ">"
    : username + "@" + resource.displayId + ":~$";
  const [state, setState] = useState<ConsoleConnectionState>("disconnected");
  const [vmStatus, setVmStatus] = useState<Status>(resource.status);
  const [output, setOutput] = useState<string[]>([
    t("console.welcome", { os: osName }),
    t("console.helpHint"),
  ]);
  const [input, setInput] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [authenticated, setAuthenticated] = useState(authMethod !== "password");
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState("");
  const resourceIdRef = useRef(resource.resourceUuid);

  useEffect(() => {
    const resourceChanged = resourceIdRef.current !== resource.resourceUuid;
    resourceIdRef.current = resource.resourceUuid;
    if (resourceChanged) {
      void adapter.disconnect();
      setAuthenticated(authMethod !== "password");
      setLoginPassword("");
      setState("disconnected");
    }
    setVmStatus(resource.status);
    if (resource.status === "stopped") {
      void adapter.disconnect();
      setAuthenticated(authMethod !== "password");
      setLoginPassword("");
      setState("instance-stopped");
    } else if (resource.status === "error") {
      void adapter.disconnect();
      setAuthenticated(authMethod !== "password");
      setLoginPassword("");
      setState("failed");
    } else if (resource.status !== "running") {
      void adapter.disconnect();
      setAuthenticated(authMethod !== "password");
      setLoginPassword("");
      setState("disconnected");
    } else {
      setState((current) =>
        current === "instance-stopped" || current === "failed"
          ? "disconnected"
          : current,
      );
    }
  }, [adapter, authMethod, resource.status]);

  useEffect(
    () => () => {
      void adapter.disconnect();
    },
    [adapter],
  );

  useEffect(() => {
    const updateFullscreen = () =>
      setFullscreen(document.fullscreenElement === screenRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const connect = async () => {
    if (vmStatus !== "running") {
      setState(vmStatus === "stopped" ? "instance-stopped" : "failed");
      return;
    }
    setBusy(true);
    setMessage("");
    setState("connecting");
    try {
      await adapter.connect({ ...resource, status: vmStatus });
      setState("connected");
      setAuthenticated(authMethod !== "password");
      setLoginPassword("");
      setLoginError("");
      setOutput(
        authMethod === "password"
          ? []
          : [t("console.welcome", { os: osName }), t("console.helpHint")],
      );
      if (authMethod !== "password")
        window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setState("failed");
      setMessage(t("console.connectionFailed"));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await adapter.disconnect();
    setState(vmStatus === "stopped" ? "instance-stopped" : "disconnected");
    setAuthenticated(authMethod !== "password");
    setLoginPassword("");
    setMessage("");
  };

  const execute = useCallback(
    (raw: string) => {
      const command = raw.trim();
      if (!command) return;
      setHistory((items) => [...items, command]);
      historyIndex.current = history.length + 1;
      const result = runSafeCommand(command, {
        resource,
        osName,
        osFamily,
        username,
        driverVersion,
        cudaVersion,
      });
      if (result === "__CLEAR__") setOutput([]);
      else setOutput((items) => [...items, prompt + " " + command, result]);
      setInput("");
    },
    [
      cudaVersion,
      driverVersion,
      history.length,
      osFamily,
      osName,
      prompt,
      resource,
      username,
    ],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    execute(input);
  };

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      await post<{ username: string }>(EP.consoleLogin(resource.resourceUuid), {
        username: "root",
        password: loginPassword,
      });
      setAuthenticated(true);
      setLoginPassword("");
      setOutput([t("console.welcome", { os: osName }), t("console.helpHint")]);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } catch {
      setLoginError(t("console.loginFailed"));
    } finally {
      setLoginBusy(false);
    }
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next =
        event.key === "ArrowUp"
          ? Math.max(0, historyIndex.current - 1)
          : Math.min(history.length, historyIndex.current + 1);
      historyIndex.current = next;
      setInput(history[next] ?? "");
    }
  };

  const toggleFullscreen = async () => {
    if (!screenRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await screenRef.current.requestFullscreen();
  };

  const requestRestart = async () => {
    setBusy(true);
    setAuthenticated(authMethod !== "password");
    setLoginPassword("");
    setState("restarting");
    setMessage(t("console.restartPending"));
    await adapter.disconnect();
    const result = await onRestart();
    setBusy(false);
    if (result == null) {
      setState("failed");
      setMessage(t("console.operationFailed"));
      return;
    }
    if (
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      typeof result.status === "string"
    ) {
      setVmStatus(result.status as Status);
    }
    window.setTimeout(() => {
      setState("disconnected");
      setMessage(t("console.reconnectWhenReady"));
    }, 8000);
  };

  const lifecycleAction = async (action: "start" | "stop") => {
    setBusy(true);
    setMessage("");
    const result = action === "start" ? await onStart() : await onStop();
    setBusy(false);
    if (result == null) {
      setMessage(t("console.operationFailed"));
      return;
    }
    if (typeof result === "object" && result !== null && "status" in result) {
      const nextStatus = result.status;
      if (typeof nextStatus === "string") {
        setVmStatus(nextStatus as Status);
        setState(
          nextStatus === "stopped" ? "instance-stopped" : "disconnected",
        );
      }
    }
  };

  const labels: Record<ConsoleConnectionState, string> = {
    disconnected: t("console.disconnected"),
    connecting: t("console.connecting"),
    connected: t("console.connected"),
    failed: t("console.failed"),
    "instance-stopped": t("console.instanceStopped"),
    restarting: t("console.restarting"),
  };

  return (
    <Panel title={t("console.title")} className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="row">
          <span className={"terminal-state terminal-state-" + state}>
            <i />
            {labels[state]}
          </span>
          <code>{osName}</code>
        </div>
        <div className="row terminal-toolbar-actions">
          {state === "connected" ? (
            <Button onClick={() => void disconnect()} disabled={busy}>
              <Power size={15} />
              {t("console.disconnect")}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void connect()}
              disabled={busy || vmStatus !== "running"}
            >
              <Activity size={15} />
              {t("console.connect")}
            </Button>
          )}
          <Button
            variant="ghost"
            title={t("console.zoomOut")}
            aria-label={t("console.zoomOut")}
            onClick={() => setZoom((value) => Math.max(75, value - 10))}
          >
            −
          </Button>
          <span className="terminal-zoom">{zoom}%</span>
          <Button
            variant="ghost"
            title={t("console.zoomIn")}
            aria-label={t("console.zoomIn")}
            onClick={() => setZoom((value) => Math.min(125, value + 10))}
          >
            +
          </Button>
          <Button
            variant="ghost"
            title={t("console.fullscreen")}
            aria-label={t("console.fullscreen")}
            onClick={() => void toggleFullscreen()}
          >
            <Expand size={16} />
          </Button>
          {vmStatus === "running" && (
            <>
              <Button
                variant="ghost"
                disabled={!canManage || busy}
                onClick={() => void requestRestart()}
              >
                <RefreshCw size={15} />
                {t("resource.restart")}
              </Button>
              <Button
                variant="ghost"
                disabled={!canManage || busy}
                onClick={() => void lifecycleAction("stop")}
              >
                <Power size={15} />
                {t("resource.stop")}
              </Button>
            </>
          )}
          {vmStatus === "stopped" && (
            <Button
              variant="ghost"
              disabled={!canManage || busy}
              onClick={() => void lifecycleAction("start")}
            >
              <Power size={15} />
              {t("resource.start")}
            </Button>
          )}
        </div>
      </div>
      {message && (
        <div className="terminal-message" role="status">
          {message}
        </div>
      )}
      <div
        className="terminal-screen"
        ref={screenRef}
        style={{ "--terminal-zoom": zoom / 100 } as React.CSSProperties}
      >
        <div className="terminal-screen-header">
          <span>{osName}</span>
          <span>
            {username}@{resource.displayId}
          </span>
          {fullscreen && (
            <button
              className="terminal-fullscreen-exit"
              aria-label={t("console.exitFullscreen")}
              title={t("console.exitFullscreen")}
              onClick={() => void toggleFullscreen()}
            >
              <Minimize size={16} />
            </button>
          )}
        </div>
        {state === "connected" && !authenticated ? (
          <form className="terminal-login" onSubmit={submitLogin}>
            <div className="terminal-login-title">
              {t("console.loginTitle", { os: osName })}
            </div>
            <Field label={t("console.username")}>
              <input
                className="input"
                value="root"
                readOnly
                aria-label={t("console.username")}
              />
            </Field>
            <Field label={t("console.password")}>
              <input
                className="input"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                autoComplete="current-password"
                aria-label={t("console.password")}
                autoFocus
              />
            </Field>
            {loginError && (
              <small className="field-error" role="alert">
                {loginError}
              </small>
            )}
            <Button
              variant="primary"
              type="submit"
              disabled={!loginPassword || loginBusy}
            >
              {loginBusy ? t("console.authenticating") : t("console.login")}
            </Button>
          </form>
        ) : state === "connected" ? (
          <div
            className="terminal-session"
            onClick={() => inputRef.current?.focus()}
          >
            <div className="terminal-output" ref={outputRef}>
              {output.map((line, index) => (
                <pre key={index}>{line}</pre>
              ))}
            </div>
            <form onSubmit={submit} className="terminal-input-row">
              <span>{prompt}</span>
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={keyDown}
                aria-label={t("console.commandInput")}
                autoComplete="off"
                spellCheck={false}
                autoCapitalize="off"
              />
            </form>
          </div>
        ) : (
          <div className="terminal-placeholder">
            <span className={"terminal-state terminal-state-" + state}>
              <i />
              {labels[state]}
            </span>
            <p>
              {vmStatus === "running"
                ? t("console.connectPrompt")
                : vmStatus === "stopped"
                  ? t("console.instanceStoppedHint")
                  : vmStatus === "error"
                    ? t("console.instanceErrorHint")
                    : t("console.instanceUnavailableHint")}
            </p>
            {state === "failed" && (
              <Button onClick={() => void connect()} disabled={busy}>
                {t("common.retry")}
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="terminal-footer">
        <span>
          {t("console.resource")}: <code>{resource.displayId}</code>
        </span>
      </div>
    </Panel>
  );
}
