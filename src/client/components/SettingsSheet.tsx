import { ErrorField, FieldErrors } from "./ErrorField.js";
import { fieldErrors } from "../lib/fieldErrors.js";
import type { ControlSuggestion } from "../lib/controlSuggestion.js";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api.js";
import type { Instance, Language, Mode, SessionSummary, Theme, User } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "./Icon.js";
import { Dialog } from "./Dialog.js";
import { Sheet } from "./Sheet.js";
import { copyText } from "../lib/clipboard.js";

const NEW_INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

export function SettingsSheet(props: {
  controlSuggestion: ControlSuggestion | null;
  onSuggestionConsumed: () => void;
  open: boolean;
  focusDiagnostics?: boolean;
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
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [clearError, setClearError] = useState("");
  const clearing = useRef(false);
  const [clearBusy, setClearBusy] = useState(false);
  useEffect(() => { if (!props.open) { setClearConfirmation(false); setClearError(""); } }, [props.open]);
  async function clearDrafts(): Promise<void> {
    if (clearing.current) return;
    clearing.current = true; setClearBusy(true); setClearError("");
    try { const result = await api.clearDrafts(); setClearConfirmation(false); props.notify(`${result.deleted} saved drafts deleted. Refresh drafts to update the list.`); }
    catch (failure) { setClearError(failure instanceof Error ? failure.message : "Draft deletion failed."); }
    finally { clearing.current = false; setClearBusy(false); }
  }
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
  const diagnosticsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!props.open || !props.focusDiagnostics) return;
    const timer = window.setTimeout(() => {
      diagnosticsHeading.current?.scrollIntoView({ block: "start" });
      diagnosticsHeading.current?.focus({ preventScroll: true });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [props.open, props.focusDiagnostics]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const currentForm = useRef(form);
  currentForm.current = form;
  const [connectionError, setConnectionError] = useState("");
  const [testResult, setTestResult] = useState<any>(null);
  const [handoffDeadline, setHandoffDeadline] = useState(0);
  const [handoffNotice, setHandoffNotice] = useState("");
  useEffect(() => {
    const suggestion = props.controlSuggestion;
    if (!suggestion) return;
    if (Date.now() >= suggestion.expiresAt) setHandoffNotice("Setup connection inputs expired. Enter the credentials again.");
    else {
      setForm(current => ({ ...current, baseUrl: suggestion.baseUrl, authMode: suggestion.authMode, apiKey: suggestion.apiKey, username: suggestion.username, password: suggestion.password, saveCredential: false }));
      setHandoffDeadline(suggestion.expiresAt);
      setTestResult(null); setErrors({}); setConnectionError("");
      setHandoffNotice("Setup inputs copied for review. No connection change has been saved. Test and Save explicitly; encrypted credential storage is off until you choose it. Closing Settings or 15 minutes clears transferred inputs, without deleting server credentials.");
    }
    props.onSuggestionConsumed();
  }, [props.controlSuggestion]);
  useEffect(() => {
    if (!handoffDeadline) return;
    const clear = (reason: string) => {
      const next = { ...currentForm.current, apiKey: "", username: "", password: "" };
      currentForm.current = next; setForm(next); setHandoffDeadline(0);
      setTestResult(null); setConnectionError("");
      setHandoffNotice(reason);
    };
    if (!props.open) { clear("Transferred credentials cleared when Settings closed. Saved server credentials are unchanged."); return; }
    const expire = () => clear("Transferred credentials cleared after 15 minutes. Enter them again before Test or Save; saved server credentials are unchanged.");
    const check = () => { if (Date.now() >= handoffDeadline) expire(); };
    if (Date.now() >= handoffDeadline) { expire(); return; }
    const timer = window.setTimeout(expire, Math.max(0, handoffDeadline - Date.now()));
    window.addEventListener("focus", check); document.addEventListener("visibilitychange", check);
    return () => { window.clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
  }, [handoffDeadline, props.open]);
  const diagnosticsSequence = useRef(0);
  const isOpen = useRef(props.open);
  isOpen.current = props.open;
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [logWindow, setLogWindow] = useState("3600");
  const [logTail, setLogTail] = useState("200");
  const [logFilter, setLogFilter] = useState("");
  const [dockerBusy, setDockerBusy] = useState(false);
  const [dockerError, setDockerError] = useState("");
  const dockerSequence = useRef(0);
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
    void refreshDiagnostics();
    void refreshDockerObservation();
    void api.debugDetails().then(setDebugDetails).catch(() => setDebugDetails(null));
    void api.sessions().then((result) => setSessions(result.sessions)).catch(() => setSessions(null));
    return () => { diagnosticsSequence.current += 1; };
  }, [props.open]);

  async function refreshDiagnostics(): Promise<void> {
    const sequence = ++diagnosticsSequence.current;
    try { const result = await api.diagnostics(); if (isOpen.current && sequence === diagnosticsSequence.current) setDiagnostics(result); }
    catch { if (isOpen.current && sequence === diagnosticsSequence.current) setDiagnostics(null); }
  }

  async function refreshDockerObservation(): Promise<void> {
    const sequence = ++dockerSequence.current;
    setDockerBusy(true);
    try {
      const result = await api.dockerObservation({ tail: Number(logTail), ...(logWindow === "all" ? {} : { since: Math.floor(Date.now() / 1000) - Number(logWindow) }) });
      if (sequence !== dockerSequence.current) return;
      setDockerObservation(result.observation); setDockerError("");
    } catch (error) {
      if (sequence !== dockerSequence.current) return;
      setDockerError(error instanceof Error ? error.message : "Gluetun diagnostics are unavailable.");
    } finally { if (sequence === dockerSequence.current) setDockerBusy(false); }
  }

  const filteredLogs = String(dockerObservation?.logs ?? "").split("\n").filter((line) => line.toLowerCase().includes(logFilter.toLowerCase())).join("\n");
  function exportLogs(): void {
    const url = URL.createObjectURL(new Blob([filteredLogs], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "gluetun-redacted-logs.txt"; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const instanceId = props.instance?.id || NEW_INSTANCE_ID;
  const update = (key: string, value: unknown) => { setErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => field !== key))); setForm((current) => ({ ...current, [key]: value })); };
  useEffect(() => { setTestResult(null); }, [form]);

  async function saveConnection(testAfter = false): Promise<void> {
    setBusy(true);
    setTestResult(null); setConnectionError(""); setErrors({});
    try {
      if (testAfter) {
        const result = await api.testInstance(instanceId, { configuration: form });
        if (currentForm.current !== form) return;
        setTestResult(result);
        const accepted = result.reachable && result.authenticationAccepted;
        if (!accepted) {
          const message = result.reachable ? "Check the authentication mode and Gluetun credentials, then test again." : "Check the Control Server URL, published port and network access, then test again.";
          setConnectionError(message);
          setErrors({ [result.reachable ? form.authMode === "api_key" ? "apiKey" : form.authMode === "basic" ? "password" : "authMode" : "baseUrl"]: message });
        }
        props.notify(accepted ? t("authenticationAccepted") : t("connectionUnavailable"), accepted ? "success" : "error");
      } else {
        const response = await api.saveInstance(instanceId, form);
        props.onInstance(response.instance);
        void refreshDiagnostics();
        props.notify(t("success"));
      }
    } catch (error) {
      if (currentForm.current === form) { setConnectionError(error instanceof Error ? error.message : t("error")); setErrors(fieldErrors(error, "configuration.")); }
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
      setForm((current) => ({ ...current, saveCredential: false, apiKey: "", username: "", password: "" }));
      void refreshDiagnostics();
      props.notify(t("success"));
    } catch (error) {
      props.notify(error instanceof Error ? error.message : t("error"), "error");
    }
  }

  async function copyDebug(): Promise<void> {
    try {
      const value = debugDetails ?? await api.debugDetails();
      await copyText(JSON.stringify(value, null, 2));
      props.notify(t("copied"));
    } catch (error) { props.notify(error instanceof Error ? error.message : t("error"), "error"); }
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

      <FieldErrors.Provider value={errors}><section className="sheet-section">
        <div className="section-title"><Icon name="globe" /><div><h3>{t("connection")}</h3><p>{t("connectionHint")}</p></div></div>
        <ErrorField field={"displayName"} className="text-field"><span>{t("displayName")}</span><input value={form.displayName} onChange={(event) => update("displayName", event.target.value)} /></ErrorField>
        <ErrorField field={"baseUrl"} className="text-field"><span>{t("baseUrl")}</span><input inputMode="url" value={form.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} /></ErrorField>
        <ErrorField field={"authMode"} className="select-field"><span>{t("authMode")}</span><select value={form.authMode} onChange={(event) => update("authMode", event.target.value)}>
          <option value="none">{t("noAuth")}</option>
          <option value="api_key">{t("apiKey")}</option>
          <option value="basic">{t("basicAuth")}</option>
        </select></ErrorField>
        {form.authMode === "api_key" && <ErrorField field={"apiKey"} className="text-field"><span>{t("apiKey")}</span><input type="password" autoComplete="off" value={form.apiKey} onChange={(event) => update("apiKey", event.target.value)} placeholder={props.instance?.hasStoredCredential ? "••••••••••••" : ""} /></ErrorField>}
        {form.authMode === "basic" && <>
          <ErrorField field={"username"} className="text-field"><span>{t("basicUsername")}</span><input autoComplete="username" value={form.username} onChange={(event) => update("username", event.target.value)} /></ErrorField>
          <ErrorField field={"password"} className="text-field"><span>{t("basicPassword")}</span><input type="password" autoComplete="current-password" value={form.password} onChange={(event) => update("password", event.target.value)} /></ErrorField>
        </>}
        <div className="field-grid">
          <ErrorField field={"requestTimeoutSeconds"} className="text-field"><span>{t("timeout")}</span><input type="number" min="2" max="60" value={form.requestTimeoutSeconds} onChange={(event) => update("requestTimeoutSeconds", Number(event.target.value))} /></ErrorField>
          <ErrorField field={"tlsVerify"} className="switch-row"><input type="checkbox" checked={form.tlsVerify} onChange={(event) => update("tlsVerify", event.target.checked)} /><span>{t("tlsVerify")}</span></ErrorField>
        </div>
        {form.authMode !== "none" && <ErrorField field={"saveCredential"} className="switch-row"><input type="checkbox" checked={form.saveCredential} onChange={(event) => update("saveCredential", event.target.checked)} /><span>{t("saveCredential")}</span></ErrorField>}
        <p className="muted">Test connection checks these inputs without saving. Save with credential storage off keeps access only in Tuniku server memory until restart or Clear stored credential; signing out or reloading the browser does not clear server memory. Encrypted storage survives restarts only with the matching encryption key. Back up the data directory and its key files together.</p>
        {handoffNotice && <p className="inline-banner" role="status">{handoffNotice}</p>}
        {(props.instance?.hasStoredCredential || diagnostics?.gluetun?.accessState === "memory_only") && <div className="inline-banner"><Icon name="check" /><span>{props.instance?.hasStoredCredential ? t("storedCredential") : "Credential is held in server memory until restart or explicit clear."}</span><button className="button button-text" type="button" onClick={() => void clearCredential()}>{t("clearCredential")}</button></div>}
        {diagnostics?.gluetun?.accessState === "stored_unreadable" && <div className="inline-banner warning" role="alert"><Icon name="warning" /><span>Saved connection credentials could not be decrypted. Restore the original encryption key with its matching database backup, or enter and save new credentials. Keep the current data and key files until recovery is complete.</span></div>}
        {connectionError && <p className="inline-banner warning" role="alert">{connectionError} Review these settings and retry Save or Test connection.</p>}
        {testResult && <div className={`inline-banner ${testResult.reachable && testResult.authenticationAccepted ? "success" : "warning"}`}><Icon name={testResult.reachable && testResult.authenticationAccepted ? "check" : "warning"} /><span>{testResult.reachable ? `${t("reachable")} · ${testResult.authenticationAccepted ? t("authenticationAccepted") : t("connectionUnavailable")}` : t("connectionUnavailable")}</span></div>}
        <div className="button-row">
          <button className="button button-tonal" type="button" disabled={busy} onClick={() => void saveConnection(false)}>{t("save")}</button>
          <button className="button button-filled" type="button" disabled={busy} onClick={() => void saveConnection(true)}>{t("testConnection")}</button>
        </div>
      </section></FieldErrors.Provider>

      <section className="sheet-section about-card">
        <div className="about-identity"><div className="psu-app-symbol"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div><div><h3>{t("about")}</h3><p>{t("footerBoundary")}</p></div></div>
        <div className="technical-card">
          <dl>
            <div><dt>{t("version")}</dt><dd>{debugDetails?.app?.version || "0.3.6"}</dd></div>
            <div><dt>{t("buildDate")}</dt><dd>{debugDetails?.app?.buildDate || "development"}</dd></div>
            <div><dt>{t("gitSha")}</dt><dd>{debugDetails?.app?.gitSha || "development"}</dd></div>
          </dl>
        </div>
      </section>

      <section className="sheet-section gluetun-diagnostics">
        <div className="section-title"><Icon name="activity" /><div><h3 ref={diagnosticsHeading} tabIndex={-1}>Gluetun diagnostics</h3><p>Read from Docker without running a shell inside Gluetun. Container restarts differ from restarting the VPN process through Control.</p></div></div>
        {dockerObservation?.container ? <>
          <div className="technical-card"><dl>
            <div><dt>Status</dt><dd>{dockerObservation.container.displayState || dockerObservation.container.state}{dockerObservation.container.health ? ` · ${dockerObservation.container.health}` : ""}</dd></div>
            <div><dt>Exit code</dt><dd>{dockerObservation.container.exitCode ?? t("unknown")}</dd></div>
            <div><dt>Docker container restarts</dt><dd>{dockerObservation.container.restartCount ?? 0}</dd></div>
            <div><dt>Started</dt><dd>{formatDate(dockerObservation.container.startedAt)}</dd></div>
            <div><dt>Last stopped</dt><dd>{formatDate(dockerObservation.container.finishedAt)}</dd></div>
            <div><dt>Image</dt><dd>{dockerObservation.container.image}</dd></div>
          </dl></div>
          {dockerObservation.storage && <p className="muted"><strong>Gluetun data storage:</strong> {dockerObservation.storage.message}</p>}
          {dockerObservation.association && <p className={dockerObservation.association.state === "matched" ? "muted" : "warning-text"}>{dockerObservation.association.message}</p>}
          {dockerObservation.issues?.length > 0 && <div className="inline-banner warning diagnostics-issues"><Icon name="warning" /><ul>{dockerObservation.issues.map((issue: string) => <li key={issue}>{issue}</li>)}</ul></div>}
          <div className="field-grid"><label className="select-field"><span>Log time range</span><select value={logWindow} onChange={(event) => setLogWindow(event.target.value)}><option value="900">Last 15 minutes</option><option value="3600">Last hour</option><option value="86400">Last 24 hours</option><option value="all">All retained logs (bounded)</option></select></label><label className="select-field"><span>Maximum log lines</span><select value={logTail} onChange={(event) => setLogTail(event.target.value)}><option value="200">200</option><option value="500">500</option><option value="1000">1000</option></select></label></div>
          <label className="text-field"><span>Filter displayed logs</span><input value={logFilter} maxLength={200} onChange={(event) => setLogFilter(event.target.value)} /></label>
          <p className="muted">Refresh to load the selected range. Output is bounded and redacted; filtering and export use only the loaded lines.</p>
          <div><strong>Last Gluetun logs</strong>{dockerObservation.logs ? <pre className="code-block diagnostics-log" tabIndex={0}><code>{filteredLogs || "No loaded lines match this filter."}</code></pre> : <div className="inline-banner warning"><Icon name="warning" /><span>{dockerObservation.logsError || "No Gluetun log output is available."}</span></div>}</div>
        </> : <div className="inline-banner warning"><Icon name="warning" /><span>{dockerObservation?.logsError || dockerObservation?.issues?.[0] || "No Gluetun container was found."}</span></div>}
        {dockerError && <p role="alert" className="warning-text">{dockerError} Previous diagnostic details and logs may be outdated.</p>}
        <button className="button button-outlined" type="button" disabled={dockerBusy} onClick={() => void refreshDockerObservation()}><Icon name="refresh" />{dockerBusy ? "Loading diagnostics" : "Refresh diagnostics"}</button>
        <button className="button button-outlined" type="button" disabled={!filteredLogs || Boolean(dockerError)} onClick={exportLogs}>Export filtered redacted logs</button>
      </section>

      <section className="sheet-section">
        <div className="section-title"><Icon name="activity" /><h3>{t("adminInfo")}</h3></div>
        <div className="technical-card">
          <dl>
            <div><dt>Tuniku</dt><dd>{diagnostics?.tuniku?.status || t("unknown")}</dd></div>
            <div><dt>{t("database")}</dt><dd>{diagnostics?.database?.status || t("unknown")}</dd></div>
            <div><dt>Browser connection</dt><dd>{window.location.protocol === "https:" ? "HTTPS" : "Local HTTP"} · {diagnostics?.transport?.mode === "https_proxy" ? "HTTPS proxy policy" : diagnostics?.transport?.mode === "local_http" ? "Local HTTP policy" : t("unknown")}</dd></div>
            <div><dt>SQLite journal</dt><dd>{diagnostics?.database?.journalMode || t("unknown")}</dd></div>
            <div><dt>Gluetun</dt><dd>{diagnostics?.gluetun?.configured ? t("success") : t("unknown")}</dd></div>
            <div><dt>{t("dockerObservation")}</dt><dd>{dockerObservation?.container ? `${dockerObservation.container.name} · ${dockerObservation.container.state}` : diagnostics?.dockerObservation?.status || t("disabled")}</dd></div>
          </dl>
        </div>
        {diagnostics?.database?.storage && (!diagnostics.database.storage.privateDirectory || !diagnostics.database.storage.privateDatabase || !diagnostics.database.storage.privateSidecars || !diagnostics.database.storage.ownerMatches) && <p className="inline-banner warning" role="alert">Database storage needs a permissions review. With Tuniku stopped, back up its data and key files, then verify the application owns its private data directory (0700) and database/SQLite sidecars (0600). Use a Linux volume that supports ownership, locking and WAL. Existing files are not changed automatically.</p>}
        <div className="button-row wrap">
          <button className="button button-tonal" type="button" onClick={() => void copyDebug()}>{t("copyDebug")}</button>
          <button className="button button-outlined" type="button" onClick={() => { setClearError(""); setClearConfirmation(true); }}>{t("clearDrafts")}</button>
        </div>
      </section>

      <p className="muted">Audit history is retained for 90 days and at most the newest 10,000 events. Saved drafts are never automatically deleted; new saves are limited to 1,000 drafts and 25 MiB.</p>
      <Dialog open={clearConfirmation} title="Delete all saved drafts?" danger confirmLabel="Delete all drafts" onClose={() => { if (!clearing.current) setClearConfirmation(false); }} onConfirm={() => void clearDrafts()}>
        <p>This permanently deletes every saved draft. Your current form, accounts, VPN credentials and Docker containers are unaffected.</p>
        {clearError && <p role="alert">{clearError}</p>}
        {clearBusy && <p role="status">Deleting saved drafts…</p>}
      </Dialog>
      <button className="button button-outlined sign-out-button" type="button" onClick={props.onSignOut}><Icon name="user" />{t("signOut")}</button>
    </Sheet>
  );
}
