import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { Instance, Language, Mode, Theme, User } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "./Icon.js";
import { Sheet } from "./Sheet.js";

const NEW_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

export function SettingsSheet(props: {
  open: boolean;
  user: User;
  instance: Instance | null;
  theme: Theme;
  mode: Mode;
  themes: Theme[];
  modes: Mode[];
  language: Language;
  onTheme: (theme: Theme) => void;
  onMode: (mode: Mode) => void;
  onLanguage: (language: Language) => void;
  onClose: () => void;
  onInstance: (instance: Instance) => void;
  onSignOut: () => void;
  notify: (text: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    displayName: "Gluetun",
    baseUrl: "http://gluetun:8000",
    authMode: "api_key" as "none" | "api_key" | "basic",
    tlsVerify: true,
    requestTimeoutSeconds: 15,
    apiKey: "",
    username: "",
    password: "",
    saveCredential: false
  });
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [dockerObservation, setDockerObservation] = useState<any>(null);
  const [debugDetails, setDebugDetails] = useState<any>(null);

  useEffect(() => {
    if (!props.instance) return;
    setForm((current) => ({
      ...current,
      displayName: props.instance!.displayName,
      baseUrl: props.instance!.baseUrl,
      authMode: props.instance!.authMode,
      tlsVerify: props.instance!.tlsVerify,
      requestTimeoutSeconds: props.instance!.requestTimeoutSeconds,
      saveCredential: props.instance!.hasStoredCredential
    }));
  }, [props.instance]);

  useEffect(() => {
    if (!props.open) return;
    void api.diagnostics().then(setDiagnostics).catch(() => setDiagnostics(null));
    void api.dockerObservation().then((result) => setDockerObservation(result.observation)).catch(() => setDockerObservation(null));
    void api.debugDetails().then(setDebugDetails).catch(() => setDebugDetails(null));
  }, [props.open]);

  const instanceId = props.instance?.id || NEW_INSTANCE_ID;
  const update = (key: string, value: unknown) => setForm((current) => ({ ...current, [key]: value }));
  const credentialBody = useMemo(() => form.authMode === "api_key"
    ? { apiKey: form.apiKey }
    : form.authMode === "basic"
      ? { username: form.username, password: form.password }
      : {}, [form]);

  async function saveConnection(testAfter = false): Promise<void> {
    setBusy(true);
    setTestResult(null);
    try {
      const response = await api.saveInstance(instanceId, form);
      props.onInstance(response.instance);
      if (testAfter) {
        const result = await api.testInstance(instanceId, credentialBody);
        setTestResult(result);
        const accepted = result.reachable && result.authenticationAccepted;
        props.notify(accepted ? t("authenticationAccepted") : t("connectionUnavailable"), accepted ? "success" : "error");
      } else {
        props.notify(t("success"));
      }
    } catch (error) {
      props.notify(error instanceof ApiError ? error.message : t("error"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function clearCredential(): Promise<void> {
    if (!props.instance) return;
    try {
      await api.deleteCredential(props.instance.id);
      props.onInstance({ ...props.instance, hasStoredCredential: false });
      update("saveCredential", false);
      props.notify(t("success"));
    } catch (error) {
      props.notify(error instanceof Error ? error.message : t("error"), "error");
    }
  }

  async function copyDebug(): Promise<void> {
    const value = debugDetails ?? await api.debugDetails();
    await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    props.notify(t("copied"));
  }

  return (
    <Sheet open={props.open} title={t("settings")} onClose={props.onClose}>
      <section className="sheet-section profile-summary">
        <div className="profile-avatar">{props.user.displayName.slice(0, 2).toUpperCase()}</div>
        <div><strong>{props.user.displayName}</strong><span>@{props.user.username}</span></div>
      </section>

      <section className="sheet-section">
        <div className="section-title"><Icon name="settings" /><h3>{t("appearance")}</h3></div>
        <label className="field-label">{t("theme")}</label>
        <div className="theme-grid">
          {props.themes.map((theme) => (
            <button type="button" className={`theme-option theme-${theme} ${props.theme === theme ? "selected" : ""}`} key={theme} onClick={() => props.onTheme(theme)}>
              <span />{t(theme)}
            </button>
          ))}
        </div>
        <label className="field-label">{t("mode")}</label>
        <div className="segmented-control">
          {props.modes.map((mode) => <button type="button" className={props.mode === mode ? "active" : ""} key={mode} onClick={() => props.onMode(mode)}>{t(mode)}</button>)}
        </div>
        <label className="field-label">{t("language")}</label>
        <div className="segmented-control">
          {(["en"] as Language[]).map((language) => <button type="button" className={props.language === language ? "active" : ""} key={language} onClick={() => props.onLanguage(language)}>{t(language)}</button>)}
        </div>
      </section>

      <section className="sheet-section">
        <div className="section-title"><Icon name="globe" /><div><h3>{t("connection")}</h3><p>{t("connectionHint")}</p></div></div>
        <label className="text-field"><span>{t("displayName")}</span><input value={form.displayName} onChange={(event) => update("displayName", event.target.value)} /></label>
        <label className="text-field"><span>{t("baseUrl")}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} /></label>
        <label className="select-field"><span>{t("authMode")}</span><select value={form.authMode} onChange={(event) => update("authMode", event.target.value)}>
          <option value="none">{t("noAuth")}</option>
          <option value="api_key">{t("apiKey")}</option>
          <option value="basic">{t("basicAuth")}</option>
        </select></label>
        {form.authMode === "api_key" && <label className="text-field"><span>{t("apiKey")}</span><input type="password" autoComplete="off" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder={props.instance?.hasStoredCredential ? "••••••••••••" : ""} /></label>}
        {form.authMode === "basic" && <>
          <label className="text-field"><span>{t("basicUsername")}</span><input autoComplete="username" value={form.username} onChange={(event) => update("username", event.target.value)} /></label>
          <label className="text-field"><span>{t("basicPassword")}</span><input type="password" autoComplete="current-password" value={form.password} onChange={(event) => update("password", event.target.value)} /></label>
        </>}
        <div className="field-grid">
          <label className="text-field"><span>{t("timeout")}</span><input type="number" min="2" max="60" value={form.requestTimeoutSeconds} onChange={(event) => update("requestTimeoutSeconds", Number(event.target.value))} /></label>
          <label className="switch-row"><input type="checkbox" checked={form.tlsVerify} onChange={(event) => update("tlsVerify", event.target.checked)} /><span>{t("tlsVerify")}</span></label>
        </div>
        {form.authMode !== "none" && <label className="switch-row"><input type="checkbox" checked={form.saveCredential} onChange={(event) => update("saveCredential", event.target.checked)} /><span>{t("saveCredential")}</span></label>}
        {props.instance?.hasStoredCredential && <div className="inline-banner"><Icon name="check" /><span>{t("storedCredential")}</span><button className="button button-text" type="button" onClick={() => void clearCredential()}>{t("clearCredential")}</button></div>}
        {testResult && <div className={`inline-banner ${testResult.reachable && testResult.authenticationAccepted ? "success" : "warning"}`}><Icon name={testResult.reachable && testResult.authenticationAccepted ? "check" : "warning"} /><span>{testResult.reachable ? `${t("reachable")} · ${testResult.authenticationAccepted ? t("authenticationAccepted") : t("connectionUnavailable")}` : t("connectionUnavailable")}</span></div>}
        <div className="button-row">
          <button className="button button-tonal" type="button" disabled={busy} onClick={() => void saveConnection(false)}>{t("save")}</button>
          <button className="button button-filled" type="button" disabled={busy} onClick={() => void saveConnection(true)}>{t("testConnection")}</button>
        </div>
      </section>

      <section className="sheet-section about-card">
        <div className="about-identity"><div className="psu-app-symbol"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div><div><h3>{t("about")}</h3><p>{t("footerBoundary")}</p></div></div>
        <div className="technical-card">
          <dl>
            <div><dt>{t("version")}</dt><dd>{debugDetails?.app?.version || "0.1.0"}</dd></div>
            <div><dt>{t("buildDate")}</dt><dd>{debugDetails?.app?.buildDate || "development"}</dd></div>
            <div><dt>{t("gitSha")}</dt><dd>{debugDetails?.app?.gitSha || "development"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="sheet-section">
        <div className="section-title"><Icon name="activity" /><h3>{t("adminInfo")}</h3></div>
        <div className="technical-card">
          <dl>
            <div><dt>Tuniku</dt><dd>{diagnostics?.tuniku?.status || t("unknown")}</dd></div>
            <div><dt>{t("database")}</dt><dd>{diagnostics?.database?.status || t("unknown")}</dd></div>
            <div><dt>Gluetun</dt><dd>{diagnostics?.gluetun?.configured ? t("success") : t("unknown")}</dd></div>
            <div><dt>{t("dockerObservation")}</dt><dd>{dockerObservation?.container ? `${dockerObservation.container.name} · ${dockerObservation.container.state}` : diagnostics?.dockerObservation?.status || t("disabled")}</dd></div>
          </dl>
        </div>
        <div className="button-row wrap">
          <button className="button button-tonal" type="button" onClick={() => void copyDebug()}>{t("copyDebug")}</button>
          <button className="button button-outlined" type="button" onClick={() => void api.clearDrafts().then(() => props.notify(t("success"))).catch((error) => props.notify(error.message, "error"))}>{t("clearDrafts")}</button>
        </div>
      </section>

      <button className="button button-outlined sign-out-button" type="button" onClick={props.onSignOut}><Icon name="user" />{t("signOut")}</button>
    </Sheet>
  );
}
