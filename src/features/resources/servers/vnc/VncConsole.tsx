import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Activity,
  ChevronDown,
  Expand,
  Files,
  Globe2,
  Minimize,
  Monitor,
  Power,
  RefreshCw,
  Send,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import type { ResourceOf, Status } from "../../../../types/domain";
import { Button, Panel } from "../../../../components/ui";
import { t } from "../../../../i18n";
import {
  MockVncAdapter,
  runMockCommand,
  type VncConnectionState,
} from "./adapter";
import "./vnc.css";

type AppName = "terminal" | "files" | "browser";
type WindowState = { x: number; y: number; z: number };
type Props = {
  resource: ResourceOf<"gpu_vm">;
  canManage: boolean;
  onStart: () => Promise<unknown>;
  onStop: () => Promise<unknown>;
  onRestart: () => Promise<unknown>;
};
const initialOutput = [
  "Ubuntu 22.04 LTS · Mock VNC desktop",
  "Type 'help' to see available commands.",
];

export function VncConsole({
  resource,
  canManage,
  onStart,
  onStop,
  onRestart,
}: Props) {
  const adapter = useMemo(() => new MockVncAdapter(), []);
  const viewerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyIndex = useRef(0);
  const [state, setState] = useState<VncConnectionState>("disconnected");
  const [vmStatus, setVmStatus] = useState<Status>(resource.status);
  const [activeApps, setActiveApps] = useState<AppName[]>([]);
  const [windows, setWindows] = useState<Record<AppName, WindowState>>({
    terminal: { x: 150, y: 48, z: 3 },
    files: { x: 210, y: 68, z: 2 },
    browser: { x: 260, y: 88, z: 1 },
  });
  const [topZ, setTopZ] = useState(3);
  const [output, setOutput] = useState<string[]>(initialOutput);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setVmStatus(resource.status);
    if (resource.status === "stopped") {
      void adapter.disconnect();
      setState("instance-stopped");
    } else if (resource.status === "error") {
      void adapter.disconnect();
      setState("failed");
    } else if (resource.status !== "running") {
      void adapter.disconnect();
      setState("disconnected");
    } else {
      setState((current) =>
        current === "instance-stopped" || current === "failed"
          ? "disconnected"
          : current,
      );
    }
  }, [adapter, resource.status]);
  useEffect(
    () => () => {
      void adapter.disconnect();
    },
    [adapter],
  );
  useEffect(() => {
    const updateFullscreen = () =>
      setFullscreen(document.fullscreenElement === viewerRef.current);
    document.addEventListener("fullscreenchange", updateFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", updateFullscreen);
  }, []);

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
      setMessage(t("vnc.connectedHint"));
    } catch {
      setState("failed");
      setMessage(t("vnc.connectionFailedHint"));
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    await adapter.disconnect();
    setState(vmStatus === "stopped" ? "instance-stopped" : "disconnected");
    setMessage("");
  };
  const openApp = (app: AppName) => {
    setTopZ((z) => z + 1);
    setWindows((current) => ({
      ...current,
      [app]: { ...current[app], z: topZ + 1 },
    }));
    setActiveApps((current) =>
      current.includes(app) ? current : [...current, app],
    );
    if (app === "terminal")
      window.setTimeout(() => inputRef.current?.focus(), 0);
  };
  const closeApp = (app: AppName) =>
    setActiveApps((apps) => apps.filter((item) => item !== app));
  const focusApp = (app: AppName) => {
    setTopZ((z) => z + 1);
    setWindows((current) => ({
      ...current,
      [app]: { ...current[app], z: topZ + 1 },
    }));
  };
  const dragStart = (app: AppName, event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const origin = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      left: windows[app].x,
      top: windows[app].y,
    };
    const move = (pointer: PointerEvent) =>
      setWindows((current) => ({
        ...current,
        [app]: {
          ...current[app],
          x: Math.max(0, origin.left + pointer.clientX - origin.pointerX),
          y: Math.max(0, origin.top + pointer.clientY - origin.pointerY),
        },
      }));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const execute = useCallback(
    (raw: string) => {
      const command = raw.trim();
      if (!command) return;
      setHistory((items) => [...items, command]);
      historyIndex.current = history.length + 1;
      const result = runMockCommand(command, { resource });
      if (result === "__CLEAR__") setOutput([]);
      else
        setOutput((items) => [
          ...items,
          `ubuntu@runsun-gpu:~$ ${command}`,
          result,
        ]);
      setInput("");
    },
    [history.length, resource],
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    execute(input);
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
    if (!viewerRef.current) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await viewerRef.current.requestFullscreen();
  };
  const requestRestart = async () => {
    setBusy(true);
    setState("restarting");
    setMessage(t("vnc.restartPending"));
    await adapter.disconnect();
    const result = await onRestart();
    setBusy(false);
    if (result == null) {
      setState("failed");
      setMessage(t("vnc.operationFailed"));
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
      if (vmStatus === "running") {
        setState("disconnected");
        setMessage(t("vnc.reconnectWhenReady"));
      }
    }, 8000);
  };
  const lifecycleAction = async (action: "start" | "stop") => {
    setBusy(true);
    setMessage("");
    const result = action === "start" ? await onStart() : await onStop();
    setBusy(false);
    if (result == null) {
      setMessage(t("vnc.operationFailed"));
      return;
    }
    if (typeof result === "object" && result !== null && "status" in result) {
      const nextStatus = result.status;
      if (typeof nextStatus === "string") {
        setVmStatus(nextStatus as Status);
        setState(
          nextStatus === "stopped"
            ? "instance-stopped"
            : nextStatus === "running"
              ? "disconnected"
              : "disconnected",
        );
      }
    }
  };

  const labels: Record<VncConnectionState, string> = {
    disconnected: t("vnc.disconnected"),
    connecting: t("vnc.connecting"),
    connected: t("vnc.connected"),
    failed: t("vnc.failed"),
    "instance-stopped": t("vnc.instanceStopped"),
    restarting: t("vnc.restarting"),
  };
  const stateClass = `vnc-state vnc-state-${state}`;
  return (
    <Panel
      title={t("vnc.title")}
      hint={t("vnc.mockHint")}
      className="vnc-panel"
    >
      <div className="vnc-toolbar">
        <div className="row">
          <span className={stateClass}>
            <i />
            {labels[state]}
          </span>
          <span className="vnc-mock-tag">MOCK</span>
        </div>
        <div className="row vnc-toolbar-actions">
          {state === "connected" ? (
            <Button onClick={() => void disconnect()} disabled={busy}>
              <Power size={15} />
              {t("vnc.disconnect")}
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => void connect()}
              disabled={busy || vmStatus !== "running"}
            >
              <Activity size={15} />
              {t("vnc.connect")}
            </Button>
          )}
          <Button
            variant="ghost"
            title={t("vnc.zoomOut")}
            aria-label={t("vnc.zoomOut")}
            onClick={() => setZoom((v) => Math.max(75, v - 10))}
          >
            −
          </Button>
          <span className="vnc-zoom">{zoom}%</span>
          <Button
            variant="ghost"
            title={t("vnc.zoomIn")}
            aria-label={t("vnc.zoomIn")}
            onClick={() => setZoom((v) => Math.min(125, v + 10))}
          >
            +
          </Button>
          <Button
            variant="ghost"
            title={t("vnc.fullscreen")}
            aria-label={t("vnc.fullscreen")}
            onClick={() => void toggleFullscreen()}
          >
            <Expand size={16} />
          </Button>
          <Button
            variant="ghost"
            title={t("vnc.sendCtrlAltDel")}
            onClick={() => setMessage(t("vnc.shortcutHint"))}
          >
            <Send size={15} /> Ctrl+Alt+Del
          </Button>
          {vmStatus === "running" && (
            <Button
              variant="ghost"
              disabled={!canManage || busy}
              onClick={() => void requestRestart()}
            >
              <RefreshCw size={15} />
              {t("vnc.restart")}
            </Button>
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
          {vmStatus === "running" && (
            <Button
              variant="ghost"
              disabled={!canManage || busy}
              onClick={() => void lifecycleAction("stop")}
            >
              <Power size={15} />
              {t("resource.stop")}
            </Button>
          )}
        </div>
      </div>
      {(message || vmStatus !== "running") && (
        <div className="vnc-message" role="status">
          {message ||
            (vmStatus === "stopped"
              ? t("vnc.instanceStoppedHint")
              : vmStatus === "error"
                ? t("vnc.instanceErrorHint")
                : t("vnc.instanceUnavailableHint"))}
        </div>
      )}
      <div
        className="vnc-viewer"
        ref={viewerRef}
        style={{ "--vnc-zoom": zoom / 100 } as React.CSSProperties}
      >
        <div
          className="vnc-desktop"
          onDoubleClick={(event) => {
            if ((event.target as HTMLElement).closest(".vnc-desktop-icon")) {
              const app = (event.target as HTMLElement)
                .closest(".vnc-desktop-icon")
                ?.getAttribute("data-app") as AppName | null;
              if (app) openApp(app);
            }
          }}
        >
          <div className="vnc-topbar">
            <span>Activities</span>
            <span>Ubuntu 22.04</span>
            <span>
              ◉{" "}
              {new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              ⌄
            </span>
          </div>
          {fullscreen && (
            <button
              className="vnc-fullscreen-exit"
              aria-label={t("vnc.exitFullscreen")}
              title={t("vnc.exitFullscreen")}
              onClick={() => void toggleFullscreen()}
            >
              <Minimize size={16} />
            </button>
          )}
          <button
            className="vnc-desktop-icon"
            data-app="files"
            onClick={() => openApp("files")}
          >
            <Files />
            <span>Home</span>
          </button>
          <button
            className="vnc-desktop-icon vnc-desktop-terminal"
            data-app="terminal"
            onClick={() => openApp("terminal")}
          >
            <TerminalIcon />
            <span>Terminal</span>
          </button>
          <button
            className="vnc-desktop-icon vnc-desktop-browser"
            data-app="browser"
            onClick={() => openApp("browser")}
          >
            <Globe2 />
            <span>Web Browser</span>
          </button>
          {activeApps.map((app) => (
            <section
              key={app}
              className={`vnc-window vnc-window-${app}`}
              style={{
                left: windows[app].x,
                top: windows[app].y,
                zIndex: windows[app].z,
              }}
              onPointerDown={() => focusApp(app)}
            >
              <header
                className="vnc-window-title"
                onPointerDown={(event) => dragStart(app, event)}
              >
                <span>
                  {app === "terminal"
                    ? "Terminal"
                    : app === "files"
                      ? "Files"
                      : "Firefox Web Browser"}
                </span>
                <button
                  aria-label={t("common.close")}
                  onClick={() => closeApp(app)}
                >
                  <X size={15} />
                </button>
              </header>
              {app === "terminal" ? (
                <div
                  className="vnc-terminal"
                  onClick={() => inputRef.current?.focus()}
                >
                  <div className="vnc-terminal-output">
                    {output.map((line, index) => (
                      <pre key={`${index}-${line}`}>{line}</pre>
                    ))}
                  </div>
                  <form onSubmit={submit} className="vnc-terminal-form">
                    <span>ubuntu@runsun-gpu:~$</span>
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      onKeyDown={keyDown}
                      aria-label={t("vnc.terminalInput")}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </form>
                </div>
              ) : app === "files" ? (
                <div className="vnc-files">
                  <div className="vnc-files-sidebar">
                    Home
                    <br />
                    Recent
                    <br />
                    Starred
                  </div>
                  <div>
                    <h3>Home</h3>
                    <div className="vnc-file-grid">
                      <span>📁 workspace</span>
                      <span>📁 .cache</span>
                      <span>📄 .bashrc</span>
                      <span>📄 .profile</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="vnc-browser">
                  <div className="vnc-browser-address">
                    🔒 https://ubuntu.com
                  </div>
                  <div className="vnc-browser-content">
                    <div className="vnc-ubuntu-mark">●</div>
                    <h2>Ubuntu</h2>
                    <p>Linux for the cloud and the edge</p>
                    <small>{t("vnc.browserDemo")}</small>
                  </div>
                </div>
              )}
            </section>
          ))}
          <div className="vnc-dock">
            {(["browser", "files", "terminal"] as AppName[]).map((app) => (
              <button key={app} aria-label={app} onClick={() => openApp(app)}>
                {app === "browser" ? (
                  <Globe2 />
                ) : app === "files" ? (
                  <Files />
                ) : (
                  <TerminalIcon />
                )}
              </button>
            ))}
          </div>
          {state !== "connected" && (
            <div className="vnc-overlay">
              <Monitor size={35} />
              <strong>{labels[state]}</strong>
              <span>
                {vmStatus === "running"
                  ? t("vnc.connectPrompt")
                  : t("vnc.mockHint")}
              </span>
              {state === "failed" && (
                <Button onClick={() => void connect()} disabled={busy}>
                  {t("common.retry")}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="vnc-footer">
        <span>
          {t("vnc.resource")}: <code>{resource.displayId}</code>
        </span>
        <span>
          <ChevronDown size={14} />
          {t("vnc.mockNotice")}
        </span>
      </div>
    </Panel>
  );
}
