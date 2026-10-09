import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionItem,
  Button,
  Checkbox,
  InlineNotification,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Tabs,
  TextArea,
  TextInput,
} from "@carbon/react";
import {
  defaultEndpoints,
  executeRunResponse,
  managementFetch,
  type RequestSpec,
  type Run,
} from "./client";
import { LlmChatPanel } from "./LlmChatPanel";
import { RunInspector } from "./RunInspector";
import { A2aPanel, InferencePanel, McpPanel } from "./panels";

const historyKey = "wanaku-debugger-history";
const storageKey = "wanaku-debugger-settings";
interface Settings {
  mcp: string;
  a2a: string;
  inference: string;
  management: string;
  namespace: string;
  headers: string;
  token: string;
}
const defaults: Settings = {
  mcp: defaultEndpoints().mcp,
  a2a: defaultEndpoints().a2a,
  inference: defaultEndpoints().inference,
  management: "",
  namespace: "default",
  headers: "{}",
  token: "",
};
function loadSettings(): Settings {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? "null",
    );
    return saved && typeof saved === "object"
      ? { ...defaults, ...saved }
      : defaults;
  } catch {
    return defaults;
  }
}
function parseHeaders(value: string): Record<string, string> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some(value => typeof value !== "string"))
    throw new Error("Headers must be a JSON object of string values");
  return parsed as Record<string, string>;
}
function protocolResponse(run: Run, response: string, strict: boolean): unknown {
  if (strict && run.outcome === "error") throw new Error(run.summary);
  const body = strict ? response : run.response;
  try { return JSON.parse(body) as unknown; } catch { return body; }
}
export function DebuggerPage() {
  const [settings, setSettings] = useState(loadSettings);
  const [persist, setPersist] = useState(
    () => localStorage.getItem(storageKey) !== null,
  );
  const [runs, setRuns] = useState<Run[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(historyKey) ?? "[]") as Run[];
    } catch {
      return [];
    }
  });
  const [rememberHistory, setRememberHistory] = useState(
    () => localStorage.getItem(historyKey) !== null,
  );
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespaceError, setNamespaceError] = useState("");
  const [editedBody, setEditedBody] = useState("");
  const [requests] = useState(() => new Map<string, RequestSpec>());
  const [selected, setSelected] = useState<Run | null>(null);
  const inspectorLauncher = useRef<HTMLElement | null>(null);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  function change(key: keyof Settings, value: string) {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (persist) localStorage.setItem(storageKey, JSON.stringify(next));
  }
  async function send(spec: RequestSpec, inspect = true, strict = false): Promise<unknown> {
    if (inspect && document.activeElement instanceof HTMLElement && !document.activeElement.closest('[role="dialog"]')) {
      inspectorLauncher.current = document.activeElement;
    }
    try {
      const parsed = parseHeaders(settings.headers);
      const request = {
        ...spec,
        url: spec.url.startsWith("/")
          ? `${settings.management.replace(/\/$/, "")}${spec.url}`
          : spec.url,
        headers: { ...(parsed as Record<string, string>), ...spec.headers },
      };
      setPending((count) => count + 1);
      setError("");
      const { run, response } = await executeRunResponse(
        request,
        settings.token,
        settings.management,
      );
      requests.set(run.id, request);
      setRuns((history) => {
        const next = [run, ...history].slice(0, 100);
        if (rememberHistory)
          localStorage.setItem(historyKey, JSON.stringify(next));
        return next;
      });
      if (inspect) {
        setSelected(run);
        setEditedBody(request.body ?? "");
      }
      return protocolResponse(run, response, strict);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      if (strict) throw cause;
      return null;
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }
  useEffect(() => {
    if (!selected) inspectorLauncher.current?.focus();
  }, [selected]);
  useEffect(() => {
    let current = true;
    setNamespaceError("");
    void managementFetch(`${settings.management.replace(/\/$/, "")}/api/v1/namespaces`, settings.token)
      .then((data) => {
        if (current && Array.isArray(data)) setNamespaces(data.flatMap((entry: unknown) => {
          if (typeof entry === "string") return [entry];
          if (entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string") return [entry.name];
          return [];
        }));
      })
      .catch((cause: unknown) => {
        if (current) {
          setNamespaces([]);
          setNamespaceError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => { current = false; };
  }, [settings.management, settings.token]);
  const panel = {
    namespaces,
    onNamespace: (value: string) => change("namespace", value),
    namespace: settings.namespace,
    management: settings.management.replace(/\/$/, ""),
    headers: settings.headers,
    onHeaders: (value: string) => change("headers", value),
    send,
  };
  return (
    <main className="wanaku-debugger">
      <h1>Debugger</h1>
      <p>
        Inspect MCP, A2A and inference requests, responses and policy decisions.
      </p>
      <Accordion>
        <AccordionItem title="Connection settings">
          <div className="debugger-settings">
            {(
              [
                ["management", "Management endpoint"],
                ["mcp", "MCP endpoint"],
                ["a2a", "A2A endpoint"],
                ["inference", "Inference endpoint"],
              ] as const
            ).map(([key, label]) => (
              <TextInput
                key={key}
                id={`setting-${key}`}
                labelText={label}
                value={settings[key]}
                onChange={(e) => change(key, e.target.value)}
              />
            ))}
          </div>
          <TextInput
            id="debugger-token"
            type="password"
            labelText="Bearer token"
            autoComplete="off"
            value={settings.token}
            onChange={(e) => change("token", e.target.value)}
          />
          <TextArea
            id="debugger-headers"
            labelText="Additional headers JSON"
            value={settings.headers}
            onChange={(e) => change("headers", e.target.value)}
          />
          <Checkbox
            id="persist-debugger"
            labelText="Remember settings and token in this browser"
            checked={persist}
            onChange={(_, { checked }) => {
              setPersist(checked);
              if (checked)
                localStorage.setItem(storageKey, JSON.stringify(settings));
              else localStorage.removeItem(storageKey);
            }}
          />
          <div className="debugger-actions">
            <Button
              kind="secondary"
              onClick={() =>
                void send({
                  method: "GET",
                  url: `/api/v1/action-policies?namespace=${encodeURIComponent(settings.namespace)}`,
                  namespace: settings.namespace,
                })
              }
            >
              Load policy hints
            </Button>
          </div>
          <Checkbox
            id="remember-history"
            labelText="Remember redacted run history in this browser"
            checked={rememberHistory}
            onChange={(_, { checked }) => {
              setRememberHistory(checked);
              if (checked)
                localStorage.setItem(historyKey, JSON.stringify(runs));
              else localStorage.removeItem(historyKey);
            }}
          />
          <p>
            Tokens stay in memory unless you enable browser storage. Exports
            redact credentials.
          </p>
        </AccordionItem>
      </Accordion>
      {namespaceError && <InlineNotification kind="warning" title="Namespace discovery unavailable" subtitle={`${namespaceError}. Enter a namespace in the protocol panel to continue.`} hideCloseButton lowContrast />}
      {error && (
        <InlineNotification
          kind="error"
          title="Request could not run"
          subtitle={error}
          hideCloseButton
          lowContrast
        />
      )}
      {pending > 0 && (
        <p role="status">
          Running {pending} request{pending === 1 ? "" : "s"}…
        </p>
      )}
      <Tabs>
        <TabList aria-label="Debugger protocol">
          <Tab>MCP</Tab>
          <Tab>A2A</Tab>
          <Tab>Inference</Tab>
          <Tab>LLM Chat</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <McpPanel
              key={`mcp-${settings.namespace}-${settings.mcp}`}
              {...panel}
              base={settings.mcp}
            />
          </TabPanel>
          <TabPanel>
            <A2aPanel
              key={`a2a-${settings.namespace}-${settings.a2a}`}
              {...panel}
              base={settings.a2a}
            />
          </TabPanel>
          <TabPanel>
            <InferencePanel
              key={`inference-${settings.namespace}-${settings.inference}`}
              {...panel}
              base={settings.inference}
            />
          </TabPanel>
          <TabPanel>
            <LlmChatPanel {...panel} base={settings.inference} mcp={settings.mcp} />
          </TabPanel>
        </TabPanels>
      </Tabs>
      <section
        className="debugger-results"
        aria-label="Run history and inspector"
      >
        <div>
          <h2>Run history</h2>
          {runs.length === 0 && (
            <p>No runs yet. Discover entries or send a request to begin.</p>
          )}
          {runs.map((run) => (
            <Button
              key={run.id}
              kind="ghost"
              className="debugger-history"
              onClick={(event) => {
                inspectorLauncher.current = event.currentTarget;
                setSelected(run);
                setEditedBody(
                  requests.get(run.id)?.body ?? run.request.body ?? "",
                );
              }}
            >
              {run.request.method} {run.request.url} —{" "}
              {run.status ?? "Network error"} ({run.durationMs} ms)
            </Button>
          ))}
          {runs.length > 0 && (
            <Button
              kind="secondary"
              onClick={() => {
                setRuns([]);
                setSelected(null);
                requests.clear();
                localStorage.removeItem(historyKey);
              }}
            >
              Clear history
            </Button>
          )}
        </div>

      </section>
      {selected && <RunInspector run={selected} editedBody={editedBody} onBody={setEditedBody} onClose={() => setSelected(null)} onReplay={() => {
        const request = requests.get(selected.id) ?? selected.request;
        void send({ ...request, body: editedBody || undefined });
      }} />}
    </main>
  );
}
