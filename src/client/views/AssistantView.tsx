import type { PortSuggestion } from "../lib/portSuggestion.js";
import { ErrorField, FieldErrors } from "../components/ErrorField.js";
import { fieldErrors } from "../lib/fieldErrors.js";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ComposeResult, GluetunProviderProfile, Instance, ServerOptions, ComposeDraft, Overview } from "../lib/models.js";
import { SetupWorkflow, type SetupStep } from "../components/SetupWorkflow.js";
import { setupControlSuggestion, type ControlSuggestion } from "../lib/controlSuggestion.js";
import { api, ApiError } from "../lib/api.js";
import { useI18n, type TranslationKey } from "../lib/i18n.js";
import { ManagedStackPanel } from "../components/ManagedStackPanel.js";
import { Icon } from "../components/Icon.js";
import { copyText } from "../lib/clipboard.js";
import { initialComposeForm as initial, restoreComposeDraft, clearComposeSensitive, updateServerFilter, chooseAnyLocation, type ServerFilterInput } from "../lib/composeDraft.js";
import { SavedDraftsPanel } from "../components/SavedDraftsPanel.js";
import { Dialog } from "../components/Dialog.js";
import { importWireguard } from "../lib/wireguardImport.js";

const tasks: Array<{ id: string; label: TranslationKey; icon: string }> = [
  { id: "new_gluetun_setup", label: "newSetup", icon: "vpn" },
  { id: "enable_control_server", label: "enableControl", icon: "globe" },
  { id: "configure_control_auth", label: "configureAuth", icon: "user" },
  { id: "configure_provider", label: "configureProvider", icon: "settings" },
  { id: "configure_wireguard", label: "configureWireguard", icon: "vpn" },
  { id: "configure_openvpn", label: "configureOpenvpn", icon: "vpn" },
  { id: "set_server_selection", label: "serverSelection", icon: "globe" },
  { id: "publish_app_port", label: "publishPort", icon: "ports" },
  { id: "route_app_manually", label: "routeApp", icon: "code" },
  { id: "migrate_secrets", label: "migrateSecrets", icon: "warning" },
  { id: "review_existing_configuration", label: "reviewCompose", icon: "code" }
];

type ServerFilter = GluetunProviderProfile["serverFilters"][number];
const filterFormKeys: Record<ServerFilter, string> = {
  countries: "countries",
  regions: "regions",
  cities: "cities",
  hostnames: "hostnames",
  names: "serverNames",
  categories: "categories",
  isps: "isps"
};
const filterLabels: Record<ServerFilter, string> = {
  countries: "Server countries",
  regions: "Server regions",
  cities: "Server cities",
  hostnames: "Server hostnames",
  names: "Server names",
  categories: "Server categories",
  isps: "Server ISPs"
};



export function AssistantView(props: { portSuggestion: PortSuggestion | null; onPortSuggestionConsumed: () => void; instance: Instance | null; overview: Overview | null; overviewRequestError: string; loading: boolean; onSettings: () => void; onControlSuggestion: (suggestion: ControlSuggestion) => void; onRefresh: () => void; onPorts: () => void; notify: (text: string, tone?: "success" | "error") => void; onDirtyChange: (dirty: boolean) => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [mode, setMode] = useState<"setup" | "manage">("setup");
  const [workflowStep, setWorkflowStep] = useState<SetupStep>("vpn");
  const [controlReview, setControlReview] = useState(false);
  const [namesOpen, setNamesOpen] = useState(false);
  const [providers, setProviders] = useState<GluetunProviderProfile[]>([]);
  const [gluetunVersion, setGluetunVersion] = useState("latest");
  const [providerLoadError, setProviderLoadError] = useState(false);
  const [serverOptions, setServerOptions] = useState<Partial<Record<ServerFilter, ServerOptions>>>({});
  const [filterNotice, setFilterNotice] = useState("");
  const [catalogBusy, setCatalogBusy] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [saveDraft, setSaveDraft] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [pendingDraft, setPendingDraft] = useState<ComposeDraft | null>(null);
  const [draftNotice, setDraftNotice] = useState("");
  const [draftError, setDraftError] = useState("");

  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [savedGeneration, setSavedGeneration] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [wireguardSource, setWireguardSource] = useState("");
  const [importConfirmed, setImportConfirmed] = useState(false);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [cleanupNotice, setCleanupNotice] = useState("");
  const dirty = form !== initial || Boolean(wireguardSource) || Boolean(draftTitle);
  useEffect(() => {
    props.onDirtyChange(dirty);
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, props.onDirtyChange]);
  useEffect(() => () => props.onDirtyChange(false), [props.onDirtyChange]);

  function openDraft(draft: ComposeDraft): void {
    setErrors({}); setGenerationError("");
    try {
      const restored = restoreComposeDraft(draft.input, providers);
      if (restored.provider && !providers.some((profile) => profile.id === restored.provider)) throw new Error("This provider is unavailable in the current catalog. Keep the draft and retry after the catalog loads, or start a new draft.");
      setForm(restored); setResult(null); setIncludeSecrets(false); setSaveDraft(false);
      setWorkflowStep(["route_app_manually", "publish_app_port"].includes(restored.taskType) ? "application" : "vpn");
      setFilterNotice("");
      setWireguardSource(""); setImportConfirmed(false); setImportError(""); setImportNotice("");
      setDraftTitle(draft.title); setDraftError("");
      setDraftNotice(`Opened “${draft.title}”. Review these settings and re-enter credentials or pasted Compose before generating. Saving creates a new redacted draft.${draft.instanceId !== (props.instance?.id ?? null) ? " This draft belongs to a different connection; the current connection has not changed." : ""}`);
    } catch (error) { setDraftError(error instanceof Error ? error.message : "The draft could not be opened."); }
    setPendingDraft(null);
  }
  const formRevision = useRef(0);
  useEffect(() => { formRevision.current += 1; setResult(null); setIncludeSecrets(false); setControlReview(false); }, [form]);
  useEffect(() => { if (["gluetunServiceName", "gluetunContainerName", "composeProjectName", "externalNetworkName"].some(field => errors[field])) setNamesOpen(true); }, [errors]);
  const [tab, setTab] = useState<keyof ComposeResult["snippets"]>("compose");
  const update = (key: string, value: unknown) => { setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => field !== key))); setForm((current) => ({ ...current, [key]: value, ...(key === "provider" ? { anyLocation: false } : {}) })); };
  function changeServerFilter(key: ServerFilterInput, value: string): void {
    const changed = updateServerFilter(form, key, value);
    setForm(changed.form);
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([field]) => field !== key && !changed.cleared.includes(field as ServerFilterInput))));
    if (changed.cleared.length) setFilterNotice("Cleared narrower server selections after changing a broader filter. Choose compatible suggestions below; category and ISP preferences are retained and still validated together.");
    else if (["cities", "serverNames", "hostnames"].includes(key)) setFilterNotice("");
  }
  const needsPorts = ["publish_app_port", "route_app_manually"].includes(form.taskType);
  const needsProvider = ["new_gluetun_setup", "configure_provider", "configure_wireguard", "configure_openvpn", "set_server_selection"].includes(form.taskType);
  const needsCredentials = needsProvider && form.taskType !== "set_server_selection";
  const needsAuth = ["new_gluetun_setup", "enable_control_server", "configure_control_auth"].includes(form.taskType);
  const selectedProvider = providers.find((provider) => provider.id === form.provider);
  const visibleProviderOptions = selectedProvider?.options.filter((option) => !option.protocols || option.protocols.includes(form.vpnType)) ?? [];

  useEffect(() => {
    let active = true;
    void api.composeProviders().then((response) => {
      if (!active) return;
      setProviders(response.providers);
      setGluetunVersion(response.gluetunVersion);
      setProviderLoadError(false);
    }).catch(() => { if (active) setProviderLoadError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedProvider || selectedProvider.id === "custom") {
      setServerOptions({});
      return;
    }
    let active = true;
    const controller = new AbortController();
    const selection = Object.fromEntries(Object.entries(filterFormKeys).map(([field, key]) => [field, String(form[key as keyof typeof form])]));
    const timeout = window.setTimeout(() => {
      void Promise.allSettled(selectedProvider.serverFilters.map(async (field) => {
        const value = selection[field] ?? "";
        const query = value.slice(value.lastIndexOf(",") + 1).trim();
        const response = await api.serverOptions(selectedProvider.id, form.vpnType, field, query, selection, controller.signal);
        return [field, response.options] as const;
      })).then((entries) => {
        if (!active) return;
        setServerOptions(Object.fromEntries(entries.flatMap((entry) => entry.status === "fulfilled" ? [entry.value] : [])));
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [selectedProvider?.id, form.vpnType, form.countries, form.regions, form.cities, form.hostnames, form.serverNames, form.categories, form.isps, catalogRevision]);

  function clearSensitive(reason: string): void {
    // Invalidate in-flight generation before state effects run.
    formRevision.current += 1;
    setForm((current) => clearComposeSensitive(current));
    setWireguardSource(""); setImportConfirmed(false); setImportError(""); setImportNotice("");
    setResult(null); setIncludeSecrets(false); setErrors({}); setGenerationError("");
    setCleanupNotice(reason);
  }

  useEffect(() => {
    const cleared = clearComposeSensitive(form);
    if (!wireguardSource && !includeSecrets && Object.keys(cleared).every((key) => cleared[key as keyof typeof cleared] === form[key as keyof typeof form])) return;
    const expiresAt = Date.now() + 15 * 60_000;
    const expire = () => clearSensitive("Sensitive inputs and output cleared after 15 minutes. Re-enter credentials before generating again.");
    const checkExpiry = () => { if (Date.now() >= expiresAt) expire(); };
    const timeout = window.setTimeout(expire, 15 * 60_000);
    window.addEventListener("focus", checkExpiry);
    document.addEventListener("visibilitychange", checkExpiry);
    return () => { window.clearTimeout(timeout); window.removeEventListener("focus", checkExpiry); document.removeEventListener("visibilitychange", checkExpiry); };
  }, [form, wireguardSource, includeSecrets]);

  useEffect(() => {
    if (!result?.containsSecretValues || result.redacted) return;
    const timeout = window.setTimeout(() => clearSensitive("Sensitive inputs and output cleared after 15 minutes. Re-enter credentials before generating again."), 15 * 60_000);
    return () => window.clearTimeout(timeout);
  }, [result]);

  function selectTask(taskType: string): void {
    setErrors({}); setGenerationError("");
    setForm((current) => ({ ...current, taskType, vpnType: taskType === "configure_openvpn" ? "openvpn" : taskType === "configure_wireguard" ? "wireguard" : current.vpnType }));
    setResult(null);
    setWorkflowStep(["route_app_manually", "publish_app_port"].includes(taskType) ? "application" : "vpn");
  }

  function selectWorkflowStep(step: SetupStep): void {
    if (step === "verify") { setWorkflowStep(step); return; }
    const taskType = step === "vpn" ? "new_gluetun_setup" : "route_app_manually";
    if (form.taskType === taskType) { setWorkflowStep(step); return; }
    const preparedCompose = result?.validation.valid && form.taskType === "new_gluetun_setup" ? result.snippets.compose : "";
    selectTask(taskType);
    if (step === "application" && preparedCompose && !form.pastedCompose) setForm(current => ({ ...current, pastedCompose: preparedCompose }));
  }

  function applyWireguardImport(): void {
    if (!importConfirmed) return;
    try {
      const { warnings, ...values } = importWireguard(wireguardSource);
      setForm((current) => ({ ...current, ...values, taskType: current.taskType === "new_gluetun_setup" ? current.taskType : "configure_wireguard",
        countries: "", regions: "", cities: "", hostnames: "", serverNames: "", categories: "", isps: "", providerOptions: {},
        openvpnUser: "", openvpnPassword: "", openvpnCertificate: "", openvpnKey: "", openvpnEncryptedKey: "", openvpnKeyPassphrase: "" }));
      setWireguardSource(""); setImportConfirmed(false); setImportError("");
      setImportNotice(["WireGuard values imported into the Custom provider fields. Review them before generating or applying a change.", ...warnings].join(" "));
    } catch (error) { setImportError(error instanceof Error ? error.message : "The WireGuard import failed."); }
  }

  function selectProvider(providerId: string): void {
    setErrors({}); setGenerationError("");
    setResult(null);
    setServerOptions({});
    setFilterNotice("");
    const profile = providers.find((provider) => provider.id === providerId);
    setForm((current) => ({
      ...current,
      provider: providerId,
      vpnType: profile && !profile.protocols.includes(current.vpnType) ? profile.protocols[0] ?? "openvpn" : current.vpnType,
      countries: "", regions: "", cities: "", hostnames: "", serverNames: "", categories: "", isps: "", providerOptions: {},
      wireguardPrivateKey: "", wireguardAddresses: "", wireguardPresharedKey: "", wireguardPublicKey: "", wireguardEndpointIp: "",
      openvpnUser: "", openvpnPassword: "", openvpnCertificate: "", openvpnKey: "", openvpnEncryptedKey: "", openvpnKeyPassphrase: ""
    }));
  }

  function selectVpnType(vpnType: "openvpn" | "wireguard"): void {
    setErrors({}); setGenerationError("");
    setFilterNotice("");
    setForm((current) => ({ ...current, vpnType, countries: "", regions: "", cities: "", hostnames: "", serverNames: "", categories: "", isps: "", providerOptions: {} }));
  }

  function updateProviderOption(environmentName: string, value: string): void {
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => field !== `providerOptions.${environmentName}`)));
    setForm((current) => ({ ...current, providerOptions: { ...current.providerOptions, [environmentName]: value } }));
  }

  async function refreshCatalog(): Promise<void> {
    if (!selectedProvider || selectedProvider.id === "custom") return;
    setCatalogBusy(true);
    try {
      await api.refreshServerOptions(selectedProvider.id);
      setCatalogRevision((current) => current + 1);
      props.notify("Official Gluetun server data refreshed.", "success");
    } catch (error) {
      props.notify(error instanceof Error ? error.message : t("error"), "error");
    } finally {
      setCatalogBusy(false);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setGenerationError(""); setErrors({});
    const revision = formRevision.current;
    try {
      const input: Record<string, unknown> = {
        ...form, includeSecrets,
        hostPort: needsPorts ? Number(form.hostPort) : undefined,
        containerPort: needsPorts ? Number(form.containerPort) : undefined,
        wireguardEndpointPort: selectedProvider?.customConfiguration && form.vpnType === "wireguard" ? Number(form.wireguardEndpointPort) : undefined
      };
      setIncludeSecrets(false);
      const response = await api.generate({ instanceId: props.instance?.id || null, saveDraft, title: draftTitle.trim() || t(tasks.find((task) => task.id === form.taskType)?.label || "newSetup"), input });
      if (saveDraft) setDraftRevision((current) => current + 1);
      if (revision !== formRevision.current) return;
      setResult(response.result); setSavedGeneration(saveDraft);
      setTab("compose");
      props.notify(response.result.validation.valid ? t("validYaml") : t("invalidYaml"), response.result.validation.valid ? "success" : "error");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t("error");
      if (revision === formRevision.current) { setGenerationError(message); setErrors(fieldErrors(error, "input.")); }
      props.notify(message, "error");
    } finally { setBusy(false); }
  }

  async function copy(content: string): Promise<void> {
    try { await copyText(content); props.notify(t("copied")); }
    catch (error) { props.notify(error instanceof Error ? error.message : t("error"), "error"); }
  }
  function download(filename: string, content: string, mediaType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  }
  const protocolName = form.vpnType === "wireguard" ? "WireGuard" : "OpenVPN";

  const managementInput = { ...form,
    hostPort: needsPorts ? Number(form.hostPort) : undefined,
    containerPort: needsPorts ? Number(form.containerPort) : undefined,
    wireguardEndpointPort: selectedProvider?.customConfiguration && form.vpnType === "wireguard" ? Number(form.wireguardEndpointPort) : undefined
  };
  return <FieldErrors.Provider value={errors}>
    <div className="page-heading assistant-heading"><div><span className="eyebrow">Tuniku</span><h1>{t("composeAssistant")}</h1><p>{t("composeSubtitle")}</p></div><span className="safety-badge"><Icon name="check" />Exports never apply changes</span></div>
    <section className="content-card"><h2>Choose your next step</h2><div className="button-row wrap"><button type="button" className={`button ${mode === "setup" ? "button-filled" : "button-outlined"}`} aria-pressed={mode === "setup"} onClick={() => setMode("setup")}>Set up VPN or export configuration</button><button type="button" className="button button-outlined" onClick={props.onSettings}>Connect an existing VPN</button><button type="button" className={`button ${mode === "manage" ? "button-filled" : "button-outlined"}`} aria-pressed={mode === "manage"} onClick={() => setMode("manage")}>Manage an existing stack</button></div><p>{mode === "manage" ? "Choose an already routed stack, inspect its settings, then prepare a confirmed change. New stacks, adding applications and image updates require separate workflows." : "Prepare and export a configuration, or connect an existing Control Server. Exports never deploy changes."}</p></section>
    <div hidden={mode !== "setup"}><SetupWorkflow routingScope={form.routingScope} step={workflowStep} onStep={selectWorkflowStep} prepared={Boolean(result?.validation.valid)} instance={props.instance} overview={props.overview} requestError={props.overviewRequestError} loading={props.loading} onSettings={props.onSettings} onRefresh={props.onRefresh} onPorts={props.onPorts} /></div>
    <p className="inline-banner" role="status">{result ? savedGeneration ? "Output prepared; a redacted draft was saved. Deployment is still pending." : "Output prepared in this tab; no draft was saved. Deployment is still pending." : "Current inputs are an unverified proposal. Generate output or review a managed change plan before deployment."} Saved drafts never describe the running configuration.</p>
    <div hidden={mode !== "manage"}><ManagedStackPanel input={managementInput} onChooseTask={selectTask} onLoadSettings={input => {
      const publicFields = ["provider", "vpnType", "countries", "regions", "cities", "hostnames", "serverNames", "categories", "isps", "wireguardAddresses", "wireguardEndpointIp", "wireguardEndpointPort"];
      const values = Object.fromEntries(Object.entries(input).filter(([key, value]) => publicFields.includes(key) && !(typeof value === "string" && value.includes("[REDACTED]"))));
      const options = Object.fromEntries(Object.entries((input.providerOptions ?? {}) as Record<string, string>).filter(([, value]) => !value.includes("[REDACTED]")));
      setForm(current => ({ ...clearComposeSensitive(initial), ...values, taskType: current.taskType, providerOptions: options, wireguardEndpointPort: String(values.wireguardEndpointPort ?? initial.wireguardEndpointPort) }));
      setResult(null); setIncludeSecrets(false); setWireguardSource(""); setImportConfirmed(false);
      props.notify("Observed non-secret settings loaded. Blank credentials retain stored values for the same provider.");
    }} notify={props.notify} /></div>
    <details><summary>Saved export drafts</summary><SavedDraftsPanel revision={draftRevision} onOpen={(draft) => dirty ? setPendingDraft(draft) : openDraft(draft)} /></details>
    {draftNotice && <p className="inline-banner" role="status">{draftNotice}</p>}
    {draftError && <p className="inline-banner warning" role="alert">{draftError}</p>}
    {cleanupNotice && <p className="inline-banner" role="status">{cleanupNotice}</p>}
    <p className="muted">Inputs stay in this tab while you navigate. Reloading or signing out discards unsaved inputs; credentials are never saved in browser storage.</p>
    <Dialog open={Boolean(props.portSuggestion)} title="Review port configuration" confirmLabel="Use in Assistant" onClose={props.onPortSuggestionConsumed} onConfirm={() => {
      const suggestion = props.portSuggestion;
      if (!suggestion) return;
      setForm(current => ({ ...current, taskType: "publish_app_port", hostAddress: suggestion.hostAddress, hostPort: suggestion.hostPort, containerPort: suggestion.containerPort, protocol: suggestion.protocol }));
      setWorkflowStep("application"); setErrors({}); setGenerationError(""); setResult(null); setIncludeSecrets(false);
      props.onPortSuggestionConsumed();
    }}><p>{props.portSuggestion?.label || "New publication"}: host <strong>{props.portSuggestion?.hostAddress || "all interfaces"}:{props.portSuggestion?.hostPort}</strong> → container <strong>{props.portSuggestion?.containerPort}/{props.portSuggestion?.protocol}</strong>.</p><p>This replaces only the port fields and selected task. Your other inputs remain. Review the application and Compose configuration before generating. Nothing is generated, saved or applied automatically.</p></Dialog>
    <Dialog open={Boolean(pendingDraft)} title="Replace current inputs?" confirmLabel="Open draft" onClose={() => setPendingDraft(null)} onConfirm={() => { if (pendingDraft) openDraft(pendingDraft); }}><p>Opening this draft replaces your current inputs and clears credentials, pasted configuration and generated output. Cancel to keep editing.</p></Dialog>
    <Dialog open={controlReview} title="Review setup connection" confirmLabel="Use these inputs in Settings" onClose={() => setControlReview(false)} onConfirm={() => {
      try { const suggestion = setupControlSuggestion(form); setControlReview(false); props.onControlSuggestion(suggestion); }
      catch (error) { props.notify(error instanceof Error ? error.message : "Re-enter the setup credentials.", "error"); setControlReview(false); }
    }}><p>Control Server: <strong>http://{form.gluetunServiceName.trim() || "gluetun"}:8000</strong>. Authentication: <strong>{form.authMode === "api_key" ? "API key" : form.authMode === "basic" ? "Basic Auth" : "None"}</strong>.</p><p>This replaces unsaved connection inputs in Settings. Only Control Server credentials are transferred; VPN credentials stay here. Nothing is tested or saved automatically. Review the URL for your deployed stack, choose whether to store credentials encrypted, then Test and Save explicitly.</p><p>Transferred inputs clear when Settings closes or after 15 minutes. Saved server credentials are unaffected by form cleanup.</p></Dialog>
    <form onInvalidCapture={(event) => { const control = event.target as HTMLInputElement; if (control.name) setErrors((current) => ({ ...current, [control.name]: control.validationMessage })); }} className="assistant-layout" onSubmit={(event) => void submit(event)}>
      <aside className="task-panel content-card"><details><summary>Expert tasks</summary><div className="task-list">{tasks.map((task) => <button className={form.taskType === task.id ? "active" : ""} aria-pressed={form.taskType === task.id} type="button" key={task.id} onClick={() => selectTask(task.id)}><Icon name={task.icon} /><span>{t(task.label)}</span><Icon name="chevron" /></button>)}</div></details></aside>
      <section className="assistant-form content-card">
        <div className="content-card-header"><div><span className="eyebrow">{t("task")}</span><h2>{t(tasks.find((task) => task.id === form.taskType)?.label || "newSetup")}</h2></div><Icon name="settings" /></div>
        {!["review_existing_configuration", "migrate_secrets"].includes(form.taskType) && <details className="configuration-step" open={namesOpen} onToggle={event => setNamesOpen(event.currentTarget.open)}><summary>Compose service and deployment names</summary><p>Leave blank to use the defaults for a new stack. For existing stacks, a single Gluetun service is detected from the pasted configuration; several candidates require an exact service name. Existing project, container and network settings remain in your base file.</p><ErrorField field="gluetunServiceName" className="text-field"><span>VPN service name</span><input maxLength={128} placeholder={form.taskType === "new_gluetun_setup" ? "gluetun" : "Detect from pasted Compose"} value={form.gluetunServiceName} onChange={event => update("gluetunServiceName", event.target.value)} /></ErrorField>{form.taskType === "new_gluetun_setup" && <div className="field-grid three"><ErrorField field="gluetunContainerName" className="text-field"><span>VPN container name</span><input maxLength={128} placeholder="gluetun" value={form.gluetunContainerName} onChange={event => update("gluetunContainerName", event.target.value)} /></ErrorField><ErrorField field="composeProjectName" className="text-field"><span>Compose project name</span><input maxLength={128} placeholder="tuniku-gluetun" value={form.composeProjectName} onChange={event => update("composeProjectName", event.target.value)} /></ErrorField><ErrorField field="externalNetworkName" className="text-field"><span>Existing Tuniku network name</span><input maxLength={128} placeholder="tuniku" value={form.externalNetworkName} onChange={event => update("externalNetworkName", event.target.value)} /></ErrorField></div>}<p>Confirm that the selected external network exists and is shared with Tuniku. These names prepare a manual proposal; they do not rename running containers or select a managed project.</p></details>}
        {needsProvider && <div className="guided-configuration">
          {needsCredentials && form.vpnType === "wireguard" && <details className="tonal-form-group"><summary>Import WireGuard configuration</summary>
            <p>Paste a single-peer configuration with literal endpoint IP and dual-stack full-tunnel routes. Import fills the Custom provider fields; it does not connect or deploy. DNS addresses remain managed by Gluetun. Hooks, MTU and keepalive directives need manual review.</p>
            <label className="text-field"><span>WireGuard configuration to import</span><textarea className="code-input" rows={7} maxLength={32768} autoComplete="off" spellCheck={false} value={wireguardSource} onChange={(event) => { setWireguardSource(event.target.value); setImportConfirmed(false); setImportError(""); setImportNotice(""); }} /><small>Kept in this form only, never included in a saved draft. The pasted source clears after import or 15 minutes without editing.</small></label>
            <label className="switch-row"><input type="checkbox" checked={importConfirmed} onChange={(event) => setImportConfirmed(event.target.checked)} /><span>I reviewed the import limits and will keep Gluetun's DNS settings.</span></label>
            <button className="button button-tonal" type="button" disabled={!wireguardSource.trim() || !importConfirmed} onClick={applyWireguardImport}>Import reviewed configuration</button>
            {importError && <p role="alert">{importError}</p>}
          </details>}
          {importNotice && <div className="inline-banner" role="status"><Icon name="check" /><span>{importNotice}</span></div>}
          <section className="configuration-step" aria-labelledby="provider-step-title">
            <div className="step-heading"><span className="step-number">1</span><div><h3 id="provider-step-title">Choose your provider</h3><p>Supported provider identifiers are pinned to Gluetun {gluetunVersion}.</p></div></div>
            {providerLoadError && <div className="inline-banner warning"><Icon name="warning" /><span>The provider catalog could not be loaded. Reload the page before generating a configuration.</span></div>}
            <div className="field-grid"><ErrorField field={"provider"} className="select-field"><span>{t("provider")}</span><select required value={form.provider} disabled={providers.length === 0} onChange={(event) => selectProvider(event.target.value)}><option value="">Choose a provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></ErrorField><ErrorField field={"vpnType"} className="select-field"><span>{t("vpnType")}</span><select required value={form.vpnType} disabled={!selectedProvider} onChange={(event) => selectVpnType(event.target.value as "openvpn" | "wireguard")}>{selectedProvider?.protocols.map((protocol) => <option key={protocol} value={protocol}>{protocol === "wireguard" ? "WireGuard" : "OpenVPN"}</option>)}</select></ErrorField></div>
            {selectedProvider && <div className="provider-guidance"><Icon name="vpn" /><div><strong>{selectedProvider.label} · {protocolName}</strong><p>{selectedProvider.guidance}</p><p>{selectedProvider.schemaReview?.status === "matched" ? `Provider rules reviewed on ${selectedProvider.schemaReview.reviewedAt}.` : selectedProvider.schemaReview?.status === "changed" ? "Provider rules changed since their last documentation review." : "Provider rules review is unavailable."} Refreshing server data does not update these rules. Test your deployed VPN separately.</p>{selectedProvider.schemaReview?.sourceUrl && <a href={selectedProvider.schemaReview.sourceUrl} target="_blank" rel="noreferrer">Reviewed provider instructions</a>} <a href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">Open official provider instructions</a></div></div>}
          </section>
          {needsCredentials && selectedProvider && <section className="configuration-step" aria-labelledby="credentials-step-title">
            <div className="step-heading"><span className="step-number">2</span><div><h3 id="credentials-step-title">Enter {protocolName} connection data</h3><p>Only fields required by this provider and protocol are shown.</p></div></div>
            {form.vpnType === "wireguard" ? <div className="tonal-form-group">
              <div className="field-grid"><ErrorField field={"wireguardPrivateKey"} className="text-field"><span>{t("wireguardKey")}</span><input required type="password" autoComplete="off" value={form.wireguardPrivateKey} onChange={(event) => update("wireguardPrivateKey", event.target.value)} /></ErrorField>{selectedProvider.wireguardAddresses && <ErrorField field={"wireguardAddresses"} className="text-field"><span>{t("wireguardAddresses")}</span><input required value={form.wireguardAddresses} placeholder="10.0.0.2/32" onChange={(event) => update("wireguardAddresses", event.target.value)} /></ErrorField>}</div>
              {(selectedProvider.wireguardPresharedKey || selectedProvider.customConfiguration) && <ErrorField field={"wireguardPresharedKey"} className="text-field"><span>WireGuard preshared key</span><input required={selectedProvider.wireguardPresharedKey} type="password" autoComplete="off" value={form.wireguardPresharedKey} onChange={(event) => update("wireguardPresharedKey", event.target.value)} /></ErrorField>}
              {selectedProvider.customConfiguration && <div className="field-grid three"><ErrorField field={"wireguardPublicKey"} className="text-field"><span>Server public key</span><input required value={form.wireguardPublicKey} onChange={(event) => update("wireguardPublicKey", event.target.value)} /></ErrorField><ErrorField field={"wireguardEndpointIp"} className="text-field"><span>Endpoint IP</span><input required inputMode="decimal" value={form.wireguardEndpointIp} onChange={(event) => update("wireguardEndpointIp", event.target.value)} /></ErrorField><ErrorField field={"wireguardEndpointPort"} className="text-field"><span>Endpoint port</span><input required type="number" min="1" max="65535" value={form.wireguardEndpointPort} onChange={(event) => update("wireguardEndpointPort", event.target.value)} /></ErrorField></div>}
            </div> : <div className="tonal-form-group">
              {selectedProvider.customConfiguration ? <ErrorField field={"customOpenvpnConfigPath"} className="text-field"><span>Host path to custom OpenVPN configuration</span><input required value={form.customOpenvpnConfigPath} onChange={(event) => update("customOpenvpnConfigPath", event.target.value)} /><small>Tuniku mounts this file read-only at /gluetun/custom.conf.</small></ErrorField> : <>
                {(selectedProvider.openvpnCredentials !== "none" || selectedProvider.id === "ivpn") && <div className="field-grid"><ErrorField field={"openvpnUser"} className="text-field"><span>{t("openvpnUser")}</span><input required={selectedProvider.openvpnCredentials === "required" || selectedProvider.id === "ivpn"} autoComplete="off" value={form.openvpnUser} onChange={(event) => update("openvpnUser", event.target.value)} /></ErrorField><ErrorField field={"openvpnPassword"} className="text-field"><span>{t("openvpnPassword")}{selectedProvider.openvpnCredentials === "optional" ? " (optional for IVPN account IDs)" : ""}</span><input required={selectedProvider.openvpnCredentials === "required"} type="password" autoComplete="off" value={form.openvpnPassword} onChange={(event) => update("openvpnPassword", event.target.value)} /></ErrorField></div>}
                {selectedProvider.openvpnCertificate !== "none" && <ErrorField field={"openvpnCertificate"} className="text-field"><span>OpenVPN client certificate</span><textarea required rows={5} className="code-input" value={form.openvpnCertificate} onChange={(event) => update("openvpnCertificate", event.target.value)} /></ErrorField>}
                {selectedProvider.openvpnCertificate === "client_key" && <ErrorField field={"openvpnKey"} className="text-field"><span>OpenVPN client key</span><textarea required rows={5} className="code-input" value={form.openvpnKey} onChange={(event) => update("openvpnKey", event.target.value)} /></ErrorField>}
                {selectedProvider.openvpnCertificate === "encrypted_key" && <><ErrorField field={"openvpnEncryptedKey"} className="text-field"><span>OpenVPN encrypted client key</span><textarea required rows={5} className="code-input" value={form.openvpnEncryptedKey} onChange={(event) => update("openvpnEncryptedKey", event.target.value)} /></ErrorField><ErrorField field={"openvpnKeyPassphrase"} className="text-field"><span>OpenVPN key passphrase</span><input required type="password" autoComplete="off" value={form.openvpnKeyPassphrase} onChange={(event) => update("openvpnKeyPassphrase", event.target.value)} /></ErrorField></>}
              </>}
            </div>}
          </section>}
          {selectedProvider && selectedProvider.serverFilters.length > 0 && <section className="configuration-step" aria-labelledby="location-step-title"><div className="step-heading"><span className="step-number">3</span><div><h3 id="location-step-title">Choose supported servers (optional)</h3><p>Only filters documented for {selectedProvider.label} are shown. Suggestions come from the official Gluetun server catalog.</p></div></div><div className="segmented-control" aria-label="Server location choice"><button type="button" className={!form.anyLocation ? "active" : ""} aria-pressed={!form.anyLocation} onClick={() => update("anyLocation", false)}>Choose location filters</button><button type="button" className={form.anyLocation ? "active" : ""} aria-pressed={form.anyLocation} onClick={() => { setForm(current => chooseAnyLocation(current)); setErrors({}); setFilterNotice("Cleared geographical, server-name and hostname filters. Category, ISP and provider options remain. Existing Compose/env location filters still need review before deployment."); }}>Any supported location</button></div><p className="muted">{form.anyLocation ? "No geographical restriction. Gluetun chooses from servers matching your remaining preferences." : "Choose optional filters below. Empty fields leave the provider's selection unconstrained."} A tunnel address or reported IP geolocation does not prove the VPN server location.</p><div className="button-row"><button className="button button-outlined" type="button" disabled={catalogBusy} onClick={() => void refreshCatalog()}><Icon name="refresh" />{catalogBusy ? "Refreshing…" : "Refresh server data"}</button>{Object.values(serverOptions)[0] && <span className="muted-copy">{Object.values(serverOptions)[0]?.source === "refreshed" ? "Refreshed catalog" : "Bundled catalog"} · {Object.values(serverOptions)[0]?.updatedAt ? new Date(Object.values(serverOptions)[0]!.updatedAt!).toLocaleDateString("en") : Object.values(serverOptions)[0]?.sourceRevision}</span>}</div><div className="muted-copy catalog-provenance" aria-label="Server catalog provenance">{Object.values(serverOptions)[0] && <p>Source: qdm12/gluetun-servers · revision {Object.values(serverOptions)[0]!.sourceRevision}. Server data timestamp: {Object.values(serverOptions)[0]!.updatedAt ?? "unknown"}. {Object.values(serverOptions)[0]!.retrievedAt ? `Retrieved: ${Object.values(serverOptions)[0]!.retrievedAt}.` : Object.values(serverOptions)[0]!.bundledAt ? `Bundled: ${Object.values(serverOptions)[0]!.bundledAt}.` : "Retrieval time unknown."} {Object.values(serverOptions)[0]!.sourceUrl && <a href={Object.values(serverOptions)[0]!.sourceUrl!} target="_blank" rel="noopener noreferrer">View exact server source</a>}</p>}<p>Running Gluetun catalog comparison unavailable. Its documented Control Server API does not expose the full server catalog. Tuniku suggestions may differ from the running image or its locally updated server data; refreshing here updates Tuniku only.</p></div><div className="field-grid three">{selectedProvider.serverFilters.map((field) => {
            const formKey = filterFormKeys[field];
            const value = String(form[formKey as keyof typeof form] ?? "");
            const prefix = value.includes(",") ? `${value.slice(0, value.lastIndexOf(",") + 1)} ` : "";
            const listId = `server-options-${field}`;
            return <ErrorField field={formKey} className="text-field" key={field}><span>{filterLabels[field]}</span><input list={listId} disabled={form.anyLocation && !["categories", "isps"].includes(field)} value={value} placeholder="Search or leave empty" onChange={(event) => changeServerFilter(formKey as ServerFilterInput, event.target.value)} /><datalist id={listId}>{serverOptions[field]?.values.map((option) => <option key={option} value={`${prefix}${option}`} />)}</datalist><small>{field === "hostnames" ? "Hostnames can disappear after provider updates; prefer a broader filter when possible." : "Comma-separated values are supported; broader changes clear narrower geographic and hostname selections."}</small></ErrorField>;
          })}</div>{filterNotice && <p className="inline-banner" role="status">{filterNotice}</p>}</section>}
          {selectedProvider && visibleProviderOptions.length > 0 && <section className="configuration-step" aria-labelledby="provider-options-title"><div className="step-heading"><span className="step-number">4</span><div><h3 id="provider-options-title">Provider-specific options (optional)</h3><p>These variables are listed in the official {selectedProvider.label} walkthrough.</p></div></div><div className="field-grid">{visibleProviderOptions.map((option) => option.kind === "boolean" ? <ErrorField field={`providerOptions.${option.env}`} className="switch-row" key={option.env}><input type="checkbox" checked={form.providerOptions[option.env] === option.enabledValue} onChange={(event) => updateProviderOption(option.env, event.target.checked ? option.enabledValue || "on" : "")} /><span><strong>{option.label}</strong><small>{option.description}</small></span></ErrorField> : option.kind === "select" ? <ErrorField field={`providerOptions.${option.env}`} className="select-field" key={option.env}><span>{option.label}</span><select value={form.providerOptions[option.env] || ""} onChange={(event) => updateProviderOption(option.env, event.target.value)}><option value="">Use Gluetun default</option>{option.choices?.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select><small>{option.description}</small></ErrorField> : <ErrorField field={`providerOptions.${option.env}`} className="text-field" key={option.env}><span>{option.label}</span><input type="number" min="1" max="65535" value={form.providerOptions[option.env] || ""} onChange={(event) => updateProviderOption(option.env, event.target.value)} /><small>{option.description}</small></ErrorField>)}</div></section>}
        </div>}
        {needsAuth && <section className="configuration-step" aria-labelledby="auth-step-title"><div className="step-heading"><span className="step-number">{needsProvider ? visibleProviderOptions.length > 0 ? 5 : 4 : 1}</span><div><h3 id="auth-step-title">Protect Control Server access</h3><p>Tuniku will use the same authentication choice when you connect it later.</p></div></div><div className="segmented-control">{(["none", "api_key", "basic"] as const).map((mode) => <button type="button" key={mode} className={form.authMode === mode ? "active" : ""} onClick={() => update("authMode", mode)}>{mode === "none" ? t("noAuth") : mode === "api_key" ? t("apiKey") : t("basicAuth")}</button>)}</div>{form.authMode === "api_key" && <ErrorField field={"apiKey"} className="text-field"><span>{t("apiKey")}</span><input required type="password" autoComplete="off" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} /></ErrorField>}{form.authMode === "basic" && <div className="field-grid"><ErrorField field={"basicUsername"} className="text-field"><span>{t("basicUsername")}</span><input required autoComplete="off" value={form.basicUsername} onChange={(event) => update("basicUsername", event.target.value)} /></ErrorField><ErrorField field={"basicPassword"} className="text-field"><span>{t("basicPassword")}</span><input required type="password" autoComplete="off" value={form.basicPassword} onChange={(event) => update("basicPassword", event.target.value)} /></ErrorField></div>}</section>}
        {needsPorts && <>{form.taskType === "route_app_manually" && <div className="field-grid"><ErrorField field={"appName"} className="text-field"><span>{t("appName")}</span><input value={form.appName} onChange={(event) => update("appName", event.target.value)} /></ErrorField><ErrorField field={"appImage"} className="text-field"><span>{t("appImage")}</span><input value={form.appImage} onChange={(event) => update("appImage", event.target.value)} /></ErrorField></div>}<div className="field-grid three"><ErrorField field={"hostAddress"} className="text-field"><span>{t("hostAddress")}</span><input placeholder="127.0.0.1" value={form.hostAddress} onChange={(event) => update("hostAddress", event.target.value)} /></ErrorField><ErrorField field={"hostPort"} className="text-field"><span>{t("hostPort")}</span><input required type="number" min="1" max="65535" value={form.hostPort} onChange={(event) => update("hostPort", event.target.value)} /></ErrorField><ErrorField field={"containerPort"} className="text-field"><span>{t("containerPort")}</span><input required type="number" min="1" max="65535" value={form.containerPort} onChange={(event) => update("containerPort", event.target.value)} /></ErrorField></div></>}
        {form.taskType === "route_app_manually" && <>
          <ErrorField field="routingScope" className="select-field"><span>Application project</span><select value={form.routingScope} onChange={event => update("routingScope", event.target.value)}><option value="same_project">Same Compose project as the VPN</option><option value="separate_project">Separate existing Compose project</option></select></ErrorField>
          {form.routingScope === "separate_project" && <><ErrorField field="gluetunContainerName" className="text-field"><span>Existing VPN container name</span><input required value={form.gluetunContainerName} onChange={event => update("gluetunContainerName", event.target.value)} /></ErrorField><p className="inline-banner warning">Separate projects require manual startup ordering and application recreation after VPN replacement. Review both fragments; no migration runs automatically.</p></>}
        </>}
        {needsPorts && <ErrorField field={"protocol"} className="select-field"><span>{t("protocol")}</span><select value={form.protocol} onChange={(event) => update("protocol", event.target.value)}><option value="tcp">TCP</option><option value="udp">UDP</option></select></ErrorField>}
        {form.taskType !== "new_gluetun_setup" && <ErrorField field={"pastedCompose"} className="text-field"><span>{t("pasteCompose")}</span><textarea required={form.taskType === "review_existing_configuration" || form.taskType === "migrate_secrets"} className="code-input" rows={8} value={form.pastedCompose} onChange={(event) => update("pastedCompose", event.target.value)} /><small>Paste the existing stack to check context and published ports. Keep its volumes and application data when applying a fragment.</small></ErrorField>}
        {generationError && <div className="inline-banner warning" role="alert"><Icon name="warning" /><span>{generationError} Correct the input and generate again.</span></div>}
        {saveDraft && <label className="text-field"><span>Draft title</span><input maxLength={120} value={draftTitle} placeholder={t(tasks.find((task) => task.id === form.taskType)?.label || "newSetup")} onChange={(event) => setDraftTitle(event.target.value)} /></label>}
        <p className="muted">Sensitive inputs clear after 15 minutes without editing. Secret output clears within 15 minutes of generation. Each generation requires renewed secret consent.</p>
        <button className="button button-outlined" type="button" onClick={() => clearSensitive("Sensitive inputs and output cleared. Non-secret settings are retained.")}>Clear sensitive data</button>
        <div className="assistant-options"><label className="switch-row"><input type="checkbox" checked={saveDraft} onChange={(event) => setSaveDraft(event.target.checked)} /><span>{t("saveDraft")}</span></label><label className="switch-row warning-switch"><input type="checkbox" checked={includeSecrets} onChange={(event) => { setIncludeSecrets(event.target.checked); setResult(null); }} /><span>{t("revealSecrets")}</span></label></div>
        {form.taskType === "new_gluetun_setup" && <ErrorField field={"useEnvFile"} className="switch-row"><input type="checkbox" checked={form.useEnvFile} onChange={(event) => update("useEnvFile", event.target.checked)} /><span>Export Compose with a separate configuration file</span></ErrorField>}
        {includeSecrets ? <div className="inline-banner warning"><Icon name="warning" /><span>{t("revealWarning")}</span></div> : <div className="inline-banner"><Icon name="check" /><span>{form.taskType === "new_gluetun_setup" && form.useEnvFile ? "Save both Compose and gluetun.optional.env together. Secret values stay redacted until you explicitly include them." : "The Compose is self-contained. Secret values stay redacted until you explicitly include them; the optional .env download is never required."}</span></div>}
        <button className="button button-filled generate-button" type="submit" disabled={busy || (needsProvider && providers.length === 0)}><Icon name="code" />{busy ? t("loading") : t("generate")}</button>
      </section>
      {result && <section className="result-panel">
        {result.validation.errors.length > 0 && <div className="inline-banner warning" role="alert"><ul>{result.validation.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
        {result.validation.warnings.length > 0 && <div className="inline-banner warning"><ul>{result.validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        {result.redacted && <div className="inline-banner warning result-redaction"><Icon name="warning" /><span>{["review_existing_configuration", "migrate_secrets"].includes(form.taskType) ? "This review always redacts credentials. Keep your original Compose file; do not deploy this redacted copy." : "This preview contains [REDACTED] values and is not deployment-ready. Enable “Include secret values” and generate again, or replace every marker manually."}</span></div>}
        <article className="result-section content-card"><h2>{t("detectedConfiguration")}</h2><pre className="code-block compact" tabIndex={0} aria-label="Detected configuration code"><code>{JSON.stringify(result.detectedConfiguration, null, 2)}</code></pre></article>
        <article className="result-section content-card"><h2>{t("recommendedChange")}</h2><p>{result.recommendedChange}</p></article>
        <article className="result-section content-card" aria-labelledby="validation-evidence-heading"><h2 id="validation-evidence-heading">Validation evidence</h2><p>Generation checks configuration only. Deployment and VPN connectivity still need verification.</p><ul>{result.validation.checks?.map((check) => <li key={check.id}><strong>{check.label}: {({ passed: "Passed", failed: "Failed", not_run: "Not run", not_applicable: "Not applicable" })[check.status]}</strong><p>{check.detail}</p></li>)}</ul></article>
        <div className="inline-banner"><Icon name="code" /><span>{form.taskType === "new_gluetun_setup" ? "Complete Gluetun add-on Compose. It joins the existing tuniku network; Tuniku itself stays in its own stack." : ["review_existing_configuration", "migrate_secrets"].includes(form.taskType) ? "Redacted review copy. Review findings and secret-storage guidance manually; this output does not migrate credentials or change a deployment." : "Compose fragment. Merge these fields into the existing services and validate the complete merged stack before recreating affected containers. Keep the original volumes, networks and unrelated settings."}</span></div>
        {form.taskType === "new_gluetun_setup" && <button className="button button-outlined" type="button" onClick={() => { const compose = result.snippets.compose; selectTask("publish_app_port"); setForm((current) => ({ ...current, pastedCompose: compose })); }}>Next: configure application ports</button>}
        {form.taskType === "new_gluetun_setup" && result.validation.valid && <button className="button button-tonal" type="button" onClick={() => setControlReview(true)}>Use setup connection</button>}
        <article className="result-section content-card snippet-card"><div className="content-card-header"><h2>{t("copyPasteSnippet")}</h2><div className={`validation-chip ${result.validation.valid ? "success" : "warning"}`}><Icon name={result.validation.valid ? "check" : "warning"} />{result.validation.valid ? t("validYaml") : t("invalidYaml")}</div></div><div className="code-tabs">{(["compose", "env", "secrets", "steps"] as const).map((name) => <button type="button" className={tab === name ? "active" : ""} key={name} onClick={() => setTab(name)}>{t(name)}</button>)}</div><pre className="code-block" tabIndex={0} aria-label={`${t(tab)} output`}><code>{result.snippets[tab]}</code></pre><div className="button-row"><button className="button button-tonal" type="button" onClick={() => void copy(result.snippets[tab])}><Icon name="copy" />{t("copy")}</button>{result.artifacts.filter((artifact) => artifact.content === result.snippets[tab] || tab === "compose" && artifact.filename === "docker-compose.vpn-ports.fragment.yml").map((artifact) => <button className="button button-outlined" type="button" key={artifact.filename} onClick={() => download(artifact.filename, artifact.content, artifact.mediaType)}><Icon name="download" />{t("download")}{artifact.filename === "docker-compose.vpn-ports.fragment.yml" ? " VPN port fragment" : ""}</button>)}</div></article>
        <article className="result-section content-card"><h2>{t("manualSteps")}</h2><ol className="steps-list">{result.manualSteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
        <article className="result-section content-card warning-card"><div className="content-card-header"><h2>{t("securityWarning")}</h2><Icon name="warning" /></div><ul>{result.securityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></article>
      </section>}
    </form>
  </FieldErrors.Provider>;
}
