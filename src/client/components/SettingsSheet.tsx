import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { Instance, Language, Mode, SessionSummary, Theme, User } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "./Icon.js";
import { Sheet } from "./Sheet.js";
import { copyText } from "../lib/clipboard.js";

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
  const [sessions, setSessions] = useState<SessionSummary | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");

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
    void refreshDockerObservation();
    void api.debugDetails().then(setDebugDetails).catch(() => setDebugDetails(null));
    void api.sessions().then((result) => setSessions(result.sessions)).catch(() => setSessions(null));
  }, [props.open]);

  async function refreshDockerObservation(): Promise<void> {
    try {
      const result = await api.dockerObservation();
      setDockerObservation(result.observation);
    } catch (error) {
      setDockerObservation({ available: false, container: null, issues: [], logs: null, logsError: error instanceof Error ? error.message : "Gluetun diagnostics are unavailable." });
    }
  }

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
    await copyText(JSON.stringify(value, null, 2));
    props.notify(t("copied"));
  }

  async function revokeOtherSessions(): Promise<void> {
    setBusy(true);
    try {
      await api.reauthenticate(reauthPassword);
      await api.revokeOtherSessions();
      setReauthPassword("");
      setSessions((current) => current ? { ...current, otherCount: 0 } : current);
      props.notify(t("sessionsRevoked"));
    } catch (error) {
      props.notify(error instanceof Error ? error.message : t("error"), "error");
    } finally {
      setBusy(false);
    }
  }

  const formatDate = (value: string | null | undefined): string => value
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : t("unknown");

  return (
    <Sheet open={props.open} title={t("settings")} onClose={props.onClose}>
      <section className="sheet-section profile-summary">
        <div className="profile-avatar">{props.user.displayName.slice(0, 2).toUpperCase()}</div>
        <div><span>{t("profile")}</span><strong>{props.user.displayName}</strong><span>@{props.user.username}</span></div>
      </section>

      <section className="sheet-section">
        <div className="section-title"><Icon name="user" /><h3>{t("sessions")}</h3></div>
        <div className="technical-card">
          <dl>
            <div><dt>{t("currentSession")}</dt><dd>{t("running")}</dd></div>
            <div><dt>{t("signedInSince")}</dt><dd>{formatDate(sessions?.current.createdAt)}</dd></div>
            <div><dt>{t("sessionExpires")}</dt><dd>{formatDate(sessions?.current.expiresAt)}</dd></div>
            <div><dt>{t("otherSessions")}</dt><dd>{sessions?.otherCount ?? 0}</dd></div>
          </dl>
        </div>
        {(sessions?.otherCount ?? 0) > 0 && <>
          <label className="text-field">
            <span>{t("confirmPassword")}</span>
            <input type="password" autoComplete="current-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} />
          </label>
          <button className="button button-outlined" type="button" disabled={busy || !reauthPassword} onClick={() => void revokeOtherSessions()}>{t("revokeOtherSessions")}</button>
        </>}
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
            <div><dt>{t("version")}</dt><dd>{debugDetails?.app?.version || "0.3.5"}</dd></div>
            <div><dt>{t("buildDate")}</dt><dd>{debugDetails?.app?.buildDate || "development"}</dd></div>
            <div><dt>{t("gitSha")}</dt><dd>{debugDetails?.app?.gitSha || "development"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="sheet-section gluetun-diagnostics">
        <div className="section-title"><Icon name="activity" /><div><h3>Gluetun diagnostics</h3><p>Read from Docker without running a shell inside Gluetun.</p></div></div>
        {dockerObservation?.container ? <>
          <div className="technical-card"><dl>
            <div><dt>Status</dt><dd>{dockerObservation.container.displayState || dockerObservation.container.state}{dockerObservation.container.health ? ` · ${dockerObservation.container.health}` : ""}</dd></div>
            <div><dt>Exit code</dt><dd>{dockerObservation.container.exitCode ?? t("unknown")}</dd></div>
            <div><dt>Restarts</dt><dd>{dockerObservation.container.restartCount ?? 0}</dd></div>
            <div><dt>Started</dt><dd>{formatDate(dockerObservation.container.startedAt)}</dd></div>
            <div><dt>Last stopped</dt><dd>{formatDate(dockerObservation.container.finishedAt)}</dd></div>
            <div><dt>Image</dt><dd>{dockerObservation.container.image}</dd></div>
          </dl></div>
          {dockerObservation.issues?.length > 0 && <div className="inline-banner warning diagnostics-issues"><Icon name="warning" /><ul>{dockerObservation.issues.map((issue: string) => <li key={issue}>{issue}</li>)}</ul></div>}
          <div><strong>Last Gluetun logs</strong>{dockerObservation.logs ? <pre className="code-block diagnostics-log" tabIndex={0}><code>{dockerObservation.logs}</code></pre> : <div className="inline-banner warning"><Icon name="warning" /><span>{dockerObservation.logsError || "No Gluetun log output is available."}</span></div>}</div>
        </> : <div className="inline-banner warning"><Icon name="warning" /><span>{dockerObservation?.logsError || dockerObservation?.issues?.[0] || "No Gluetun container was found."}</span></div>}
        <button className="button button-outlined" type="button" onClick={() => void refreshDockerObservation()}><Icon name="refresh" />Refresh diagnostics</button>
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
