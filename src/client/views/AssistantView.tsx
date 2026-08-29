import { useEffect, useState, type FormEvent } from "react";
import type { ComposeResult, Instance } from "../lib/models.js";
import { api, ApiError } from "../lib/api.js";
import { useI18n, type TranslationKey } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";

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

const initial = {
  taskType: "new_gluetun_setup",
  provider: "",
  vpnType: "wireguard",
  countries: "",
  regions: "",
  cities: "",
  authMode: "api_key",
  apiKey: "",
  basicUsername: "",
  basicPassword: "",
  wireguardPrivateKey: "",
  wireguardAddresses: "",
  openvpnUser: "",
  openvpnPassword: "",
  appName: "app",
  appImage: "example/app:version",
  hostAddress: "",
  hostPort: "8080",
  containerPort: "8080",
  protocol: "tcp",
  pastedCompose: "",
  includeSecrets: false
};

export function AssistantView(props: { instance: Instance | null; notify: (text: string, tone?: "success" | "error") => void }) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [saveDraft, setSaveDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ComposeResult | null>(null);
  const [tab, setTab] = useState<keyof ComposeResult["snippets"]>("compose");
  const update = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  const needsPorts = ["publish_app_port", "route_app_manually"].includes(form.taskType);
  const needsProvider = ["new_gluetun_setup", "configure_provider", "configure_wireguard", "configure_openvpn", "set_server_selection"].includes(form.taskType);
  const needsAuth = ["new_gluetun_setup", "enable_control_server", "configure_control_auth"].includes(form.taskType);

  useEffect(() => {
    if (!result?.containsSecretValues || result.redacted) return;
    const timeout = window.setTimeout(() => {
      setResult(null);
      setForm((current) => ({ ...current, includeSecrets: false }));
    }, 15 * 60_000);
    return () => window.clearTimeout(timeout);
  }, [result]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    try {
      const input: Record<string, unknown> = {
        ...form,
        hostPort: needsPorts ? Number(form.hostPort) : undefined,
        containerPort: needsPorts ? Number(form.containerPort) : undefined
      };
      const response = await api.generate({
        instanceId: props.instance?.id || null,
        saveDraft,
        title: tasks.find((task) => task.id === form.taskType)?.label || "Compose draft",
        input
      });
      setResult(response.result);
      setTab("compose");
      props.notify(response.result.validation.valid ? t("validYaml") : t("invalidYaml"), response.result.validation.valid ? "success" : "error");
    } catch (error) {
      props.notify(error instanceof ApiError ? error.message : t("error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function copy(content: string): Promise<void> {
    await navigator.clipboard.writeText(content);
    props.notify(t("copied"));
  }

  function download(filename: string, content: string, mediaType: string): void {
    const url = URL.createObjectURL(new Blob([content], { type: mediaType }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="page-heading assistant-heading"><div><span className="eyebrow">Tuniku</span><h1>{t("composeAssistant")}</h1><p>{t("composeSubtitle")}</p></div><span className="safety-badge"><Icon name="check" />Generation only</span></div>
      <form className="assistant-layout" onSubmit={(event) => void submit(event)}>
        <aside className="task-panel content-card">
          <h2>{t("task")}</h2>
          <div className="task-list">
            {tasks.map((task) => (
              <button className={form.taskType === task.id ? "active" : ""} type="button" key={task.id} onClick={() => update("taskType", task.id)}>
                <Icon name={task.icon} /><span>{t(task.label)}</span><Icon name="chevron" />
              </button>
            ))}
          </div>
        </aside>

        <section className="assistant-form content-card">
          <div className="content-card-header"><div><span className="eyebrow">{t("task")}</span><h2>{t(tasks.find((task) => task.id === form.taskType)?.label || "newSetup")}</h2></div><Icon name="settings" /></div>
          {needsProvider && <>
            <div className="field-grid">
              <label className="text-field"><span>{t("provider")}</span><input value={form.provider} placeholder="protonvpn" onChange={(event) => update("provider", event.target.value)} /></label>
              <label className="select-field"><span>{t("vpnType")}</span><select value={form.vpnType} onChange={(event) => update("vpnType", event.target.value)}><option value="wireguard">WireGuard</option><option value="openvpn">OpenVPN</option></select></label>
            </div>
            <div className="field-grid three">
              <label className="text-field"><span>{t("countries")}</span><input value={form.countries} onChange={(event) => update("countries", event.target.value)} /></label>
              <label className="text-field"><span>{t("regions")}</span><input value={form.regions} onChange={(event) => update("regions", event.target.value)} /></label>
              <label className="text-field"><span>{t("cities")}</span><input value={form.cities} onChange={(event) => update("cities", event.target.value)} /></label>
            </div>
          </>}
          {(form.taskType === "configure_wireguard" || (form.taskType === "new_gluetun_setup" && form.vpnType === "wireguard")) && <div className="tonal-form-group"><h3>WireGuard</h3>
            <label className="text-field"><span>{t("wireguardKey")}</span><input type="password" autoComplete="off" value={form.wireguardPrivateKey} onChange={(event) => update("wireguardPrivateKey", event.target.value)} /></label>
            <label className="text-field"><span>{t("wireguardAddresses")}</span><input value={form.wireguardAddresses} placeholder="10.0.0.2/32" onChange={(event) => update("wireguardAddresses", event.target.value)} /></label>
          </div>}
          {(form.taskType === "configure_openvpn" || (form.taskType === "new_gluetun_setup" && form.vpnType === "openvpn")) && <div className="tonal-form-group"><h3>OpenVPN</h3>
            <div className="field-grid"><label className="text-field"><span>{t("openvpnUser")}</span><input autoComplete="off" value={form.openvpnUser} onChange={(event) => update("openvpnUser", event.target.value)} /></label>
            <label className="text-field"><span>{t("openvpnPassword")}</span><input type="password" autoComplete="off" value={form.openvpnPassword} onChange={(event) => update("openvpnPassword", event.target.value)} /></label></div>
          </div>}
          {needsAuth && <div className="tonal-form-group"><h3>{t("authMode")}</h3>
            <div className="segmented-control">
              {(["none", "api_key", "basic"] as const).map((mode) => <button type="button" key={mode} className={form.authMode === mode ? "active" : ""} onClick={() => update("authMode", mode)}>{mode === "none" ? t("noAuth") : mode === "api_key" ? t("apiKey") : t("basicAuth")}</button>)}
            </div>
            {form.authMode === "api_key" && <label className="text-field"><span>{t("apiKey")}</span><input type="password" autoComplete="off" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} /></label>}
            {form.authMode === "basic" && <div className="field-grid"><label className="text-field"><span>{t("basicUsername")}</span><input autoComplete="off" value={form.basicUsername} onChange={(event) => update("basicUsername", event.target.value)} /></label><label className="text-field"><span>{t("basicPassword")}</span><input type="password" autoComplete="off" value={form.basicPassword} onChange={(event) => update("basicPassword", event.target.value)} /></label></div>}
          </div>}
          {needsPorts && <>
            {form.taskType === "route_app_manually" && <div className="field-grid"><label className="text-field"><span>{t("appName")}</span><input value={form.appName} onChange={(event) => update("appName", event.target.value)} /></label><label className="text-field"><span>{t("appImage")}</span><input value={form.appImage} onChange={(event) => update("appImage", event.target.value)} /></label></div>}
            <div className="field-grid three"><label className="text-field"><span>{t("hostAddress")}</span><input placeholder="127.0.0.1" value={form.hostAddress} onChange={(event) => update("hostAddress", event.target.value)} /></label><label className="text-field"><span>{t("hostPort")}</span><input required type="number" min="1" max="65535" value={form.hostPort} onChange={(event) => update("hostPort", event.target.value)} /></label><label className="text-field"><span>{t("containerPort")}</span><input required type="number" min="1" max="65535" value={form.containerPort} onChange={(event) => update("containerPort", event.target.value)} /></label></div>
          </>}
          {(form.taskType === "review_existing_configuration" || form.taskType === "migrate_secrets") && <label className="text-field"><span>{t("pasteCompose")}</span><textarea className="code-input" rows={12} value={form.pastedCompose} onChange={(event) => update("pastedCompose", event.target.value)} /></label>}
          <div className="assistant-options">
            <label className="switch-row"><input type="checkbox" checked={saveDraft} onChange={(event) => setSaveDraft(event.target.checked)} /><span>{t("saveDraft")}</span></label>
            <label className="switch-row warning-switch"><input type="checkbox" checked={form.includeSecrets} onChange={(event) => update("includeSecrets", event.target.checked)} /><span>{t("revealSecrets")}</span></label>
          </div>
          {form.includeSecrets && <div className="inline-banner warning"><Icon name="warning" /><span>{t("revealWarning")}</span></div>}
          <button className="button button-filled generate-button" type="submit" disabled={busy}><Icon name="code" />{busy ? t("loading") : t("generate")}</button>
        </section>

        {result && <section className="result-panel">
          <article className="result-section content-card"><h2>{t("detectedConfiguration")}</h2><pre className="code-block compact"><code>{JSON.stringify(result.detectedConfiguration, null, 2)}</code></pre></article>
          <article className="result-section content-card"><h2>{t("recommendedChange")}</h2><p>{result.recommendedChange}</p></article>
          <article className="result-section content-card snippet-card">
            <div className="content-card-header"><h2>{t("copyPasteSnippet")}</h2><div className={`validation-chip ${result.validation.valid ? "success" : "warning"}`}><Icon name={result.validation.valid ? "check" : "warning"} />{result.validation.valid ? t("validYaml") : t("invalidYaml")}</div></div>
            <div className="code-tabs">
              {(["compose", "env", "secrets", "steps"] as const).map((name) => <button type="button" className={tab === name ? "active" : ""} key={name} onClick={() => setTab(name)}>{t(name)}</button>)}
            </div>
            <pre className="code-block"><code>{result.snippets[tab]}</code></pre>
            <div className="button-row"><button className="button button-tonal" type="button" onClick={() => void copy(result.snippets[tab])}><Icon name="copy" />{t("copy")}</button>{result.artifacts.filter((artifact) => artifact.content === result.snippets[tab]).map((artifact) => <button className="button button-outlined" type="button" key={artifact.filename} onClick={() => download(artifact.filename, artifact.content, artifact.mediaType)}><Icon name="download" />{t("download")}</button>)}</div>
          </article>
          <article className="result-section content-card"><h2>{t("manualSteps")}</h2><ol className="steps-list">{result.manualSteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
          <article className="result-section content-card warning-card"><div className="content-card-header"><h2>{t("securityWarning")}</h2><Icon name="warning" /></div><ul>{result.securityWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></article>
        </section>}
      </form>
    </>
  );
}
