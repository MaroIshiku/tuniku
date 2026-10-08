import type { PortSuggestion } from "./lib/portSuggestion.js";
import { useSessionActivity } from "./lib/useSessionActivity.js";
import type { ControlSuggestion } from "./lib/controlSuggestion.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, setCsrfToken, setSessionExpiredHandler } from "./lib/api.js";
import type { Bootstrap, DockerDiagnostic, Instance, Overview, PortDetection, PortLabel, Section, TrafficSummary, User } from "./lib/models.js";
import { useTheme } from "./lib/theme.js";
import { useI18n } from "./lib/i18n.js";
import { AppShell } from "./components/AppShell.js";
import { SettingsSheet } from "./components/SettingsSheet.js";
import { ToastHost, type ToastMessage } from "./components/Toast.js";
import { Dialog } from "./components/Dialog.js";
import { SetupView } from "./views/SetupView.js";
import { LoginView } from "./views/LoginView.js";
import { OverviewView } from "./views/OverviewView.js";
import { ControlView } from "./views/ControlView.js";
import { PortsView } from "./views/PortsView.js";
import { AssistantView } from "./views/AssistantView.js";

export function App() {
  const [portSuggestion, setPortSuggestion] = useState<PortSuggestion | null>(null);
  const [controlSuggestion, setControlSuggestion] = useState<ControlSuggestion | null>(null);
  const { t, language, setLanguage } = useI18n();
  const theme = useTheme();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [assistantVisited, setAssistantVisited] = useState(false);
  const [assistantDirty, setAssistantDirty] = useState(false);
  useEffect(() => { if (section === "assistant") setAssistantVisited(true); }, [section]);
  const [settingsDiagnostics, setSettingsDiagnostics] = useState(false);
  const [dockerDiagnostic, setDockerDiagnostic] = useState<DockerDiagnostic | null>(null);
  const [dockerError, setDockerError] = useState("");
  const [dockerObservedAt, setDockerObservedAt] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [overviewRequestError, setOverviewRequestError] = useState("");
  const [trafficRequestError, setTrafficRequestError] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ports, setPorts] = useState<PortLabel[]>([]);
  const [portDetection, setPortDetection] = useState<PortDetection | null>(null);
  const [traffic, setTraffic] = useState<TrafficSummary | null>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastId = useRef(0);
  const dataGeneration = useRef(0);

  const notify = useCallback((text: string, tone: "success" | "error" = "success") => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3_500);
  }, []);

  const establishSession = useCallback((session: { user: User; csrfToken: string }) => {
    dataGeneration.current++;
    setCsrfToken(session.csrfToken);
    setUser(session.user);
    setBootstrap((current) => current ? { ...current, setup: { state: "completed", missingConfiguration: [] }, session } : current);
  }, []);

  useEffect(() => {
    void api.bootstrap().then((result) => {
      setBootstrap(result);
      if (result.session) establishSession(result.session);
      setLoading(false);
    }).catch((error) => {
      setFatalError(error instanceof Error ? error.message : t("error"));
      setLoading(false);
    });
  }, [establishSession, t]);

  const loadInstance = useCallback(async (): Promise<Instance | null> => {
    const generation = dataGeneration.current;
    const response = await api.instances();
    if (generation !== dataGeneration.current) return null;
    const selected = response.instances[0] ?? null;
    setInstance(selected);
    return selected;
  }, []);

  const overviewSequence = useRef(0);
  const overviewAbort = useRef<AbortController | null>(null);
  useEffect(() => () => { overviewSequence.current++; overviewAbort.current?.abort(); }, []);
  const metadataRefresh = useRef({ key: "", at: 0 });
  const clearSession = useCallback(() => {
      dataGeneration.current++;
      overviewSequence.current++; overviewAbort.current?.abort(); metadataRefresh.current = { key: "", at: 0 };
      setLoading(false);
      setLogoutOpen(false);
      setSettingsOpen(false);
      setControlSuggestion(null); setPortSuggestion(null);
      setUser(null);
      setAssistantVisited(false); setAssistantDirty(false);
      setInstance(null);
      setOverview(null);
      setDockerDiagnostic(null); setDockerError(""); setDockerObservedAt(null); setOverviewRequestError(""); setTrafficRequestError("");
      setTraffic(null);
      setCsrfToken(null);
      setPorts([]);
      setActivity([]);
      setPortDetection(null);
  }, []);
  useSessionActivity(Boolean(user));
  useEffect(() => {
    setSessionExpiredHandler(user ? () => { clearSession(); notify("Your session ended. Sign in again.", "error"); } : null);
    return () => setSessionExpiredHandler(null);
  }, [user, clearSession, notify]);
  const refreshOverview = useCallback(async (target: Instance | null, force = false): Promise<void> => {
    if (!target) return;
    setLoading(true);
    const superseded = Boolean(overviewAbort.current && !overviewAbort.current.signal.aborted);
    overviewAbort.current?.abort();
    const controller = new AbortController();
    overviewAbort.current = controller;
    const sequence = ++overviewSequence.current;
    const metadataKey = JSON.stringify([target.id, target.baseUrl]);
    const includeMetadata = force || superseded || metadataRefresh.current.key !== metadataKey || Date.now() - metadataRefresh.current.at >= 30_000;
    if (includeMetadata) metadataRefresh.current = { key: metadataKey, at: Date.now() };
    try {
      const [response, trafficResponse, portsResponse, dockerResponse] = await Promise.allSettled([
        api.overview(target.id, force, controller.signal),
        api.traffic(controller.signal),
        includeMetadata ? api.ports(target.id, force, controller.signal) : Promise.resolve(null),
        includeMetadata ? api.dockerObservation({ includeLogs: false, force }, controller.signal) : Promise.resolve(null)
      ]);
      if (sequence !== overviewSequence.current) return;
      const failures = [response, trafficResponse, portsResponse, dockerResponse].flatMap((entry) => entry.status === "rejected" ? [entry.reason] : []);
      if (failures.some((error) => error instanceof ApiError && error.status === 401)) {
        setUser(null);
        setCsrfToken(null);
        return;
      }
      if (dockerResponse.status === "fulfilled" && dockerResponse.value) {
        setDockerDiagnostic(dockerResponse.value.observation); setDockerError(""); setDockerObservedAt(dockerResponse.value.observation.observedAt || new Date().toISOString());
      } else if (dockerResponse.status === "rejected") setDockerError(`Docker diagnostics refresh failed. ${dockerResponse.reason instanceof Error ? dockerResponse.reason.message : "The observer could not be reached."} Any displayed container details are from the last successful observation.`);
      if (response.status === "fulfilled") { setOverview(response.value.overview); setOverviewRequestError(""); }
      else { setOverviewRequestError(`Control API refresh failed. ${response.reason instanceof Error ? response.reason.message : "No response is available."} Any displayed VPN values are from the last successful response.`); setOverview((current) => current ? { ...current, stale: true } : current); }
      if (trafficResponse.status === "fulfilled") { setTraffic(trafficResponse.value.traffic); setTrafficRequestError(""); }
      else { setTrafficRequestError(`Traffic refresh failed. ${trafficResponse.reason instanceof Error ? trafficResponse.reason.message : "No response is available."} Displayed totals are from the last successful sample.`); setTraffic((current) => current ? { ...current, error: "Traffic refresh failed. Displayed totals are from the last successful sample." } : current); }
      if (portsResponse.status === "fulfilled" && portsResponse.value) {
        setPorts(portsResponse.value.ports);
        setPortDetection(portsResponse.value.detection);
      } else if (portsResponse.status === "rejected") setPortDetection({ available: false, error: `Port refresh failed. ${portsResponse.reason instanceof Error ? portsResponse.reason.message : "No response is available."} Displayed mappings may be outdated.` });
      if (failures.length) notify(failures[0] instanceof Error ? failures[0].message : t("error"), "error");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setCsrfToken(null);
      } else {
        notify(error instanceof Error ? error.message : t("error"), "error");
      }
    } finally {
      if (sequence === overviewSequence.current) { overviewAbort.current = null; setLoading(false); }
    }
  }, [notify, t]);

  const loadSupportingData = useCallback(async (target: Instance | null): Promise<void> => {
    if (!target) {
      setPorts([]);
      setPortDetection(null);
      setActivity([]);
      return;
    }
    const generation = dataGeneration.current;
    const activityResponse = await api.activity();
    if (generation === dataGeneration.current) setActivity(activityResponse.events);
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadInstance().then(async (selected) => {
      if (selected) await Promise.all([refreshOverview(selected), loadSupportingData(selected)]);
    }).catch((error) => notify(error instanceof Error ? error.message : t("error"), "error"));
  }, [user, loadInstance, refreshOverview, loadSupportingData, notify, t]);

  useEffect(() => {
    if (!user || !instance) return;
    let timeout: number;
    let stopped = false;
    const schedule = () => {
      timeout = window.setTimeout(async () => {
        if (stopped) return;
        await refreshOverview(instance);
        if (!stopped) schedule();
      }, document.hidden ? 60_000 : 10_000);
    };
    schedule();
    return () => {
      stopped = true;
      window.clearTimeout(timeout);
    };
  }, [user, instance, refreshOverview]);

  async function handleControl(path: string): Promise<void> {
    if (!instance) return;
    setActionBusy(true);
    try {
      const response = await api.control(instance.id, path, { confirmed: true });
      if (response.overview) setOverview(response.overview);
      notify(t("actionComplete"));
      setActivity((await api.activity()).events);
    } catch (error) {
      notify(error instanceof Error ? error.message : t("error"), "error");
    } finally {
      setActionBusy(false);
    }
  }

  async function savePort(body: unknown, id?: string): Promise<void> {
    if (!instance) return;
    try {
      if (id) await api.updatePort(instance.id, id, body);
      else await api.createPort(instance.id, body);
      const response = await api.ports(instance.id);
      setPorts(response.ports);
      setPortDetection(response.detection);
      notify(t("success"));
    } catch (error) {
      notify(error instanceof Error ? error.message : t("error"), "error");
      throw error;
    }
  }

  async function deletePort(id: string): Promise<void> {
    if (!instance) return;
    try {
      await api.deletePort(instance.id, id);
      setPorts((current) => current.filter((port) => port.id !== id));
      notify(t("success"));
    } catch (error) {
      notify(error instanceof Error ? error.message : t("error"), "error");
    }
  }

  async function signOut(): Promise<void> {
    try {
      await api.logout();
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        notify("Sign-out could not be completed. Your session is still active; please try again.", "error");
        return;
      }
    }
    clearSession();
  }

  if (loading && !bootstrap) {
    return <main className="loading-page"><div className="loading-logo"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div><span>{t("loading")}</span></main>;
  }
  if (fatalError) {
    return <main className="auth-page"><section className="auth-window"><div className="auth-logo"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div><h1>{t("error")}</h1><p>{fatalError}</p><button className="button button-filled" type="button" onClick={() => window.location.reload()}>{t("retry")}</button></section></main>;
  }
  if (bootstrap?.setup.state === "unconfigured") {
    return <SetupView missingConfiguration={bootstrap.setup.missingConfiguration} onComplete={establishSession} />;
  }
  if (bootstrap?.setup.state === "ready_to_register") {
    return <SetupView onComplete={establishSession} />;
  }
  if (!user) {
    return <LoginView onComplete={establishSession} />;
  }

  return (
    <>
      <AppShell section={section} user={user} onSection={setSection} onSettings={() => { setSettingsDiagnostics(false); setSettingsOpen(true); }}>
        <div className="page-enter" key={section}>
          {section === "overview" && <OverviewView instance={instance} overview={overview} overviewRequestError={overviewRequestError} trafficRequestError={trafficRequestError} traffic={traffic} ports={ports} portDetection={portDetection} dockerDiagnostic={dockerDiagnostic} dockerError={dockerError} dockerObservedAt={dockerObservedAt} onDiagnostics={() => { setSettingsDiagnostics(true); setSettingsOpen(true); }} activity={activity} loading={loading} onSection={setSection} onConnectExisting={() => setSettingsOpen(true)} notify={notify} onRefresh={() => void refreshOverview(instance, true)} />}
          {section === "control" && <ControlView instance={instance} overview={overview} busy={actionBusy} onAction={handleControl} onRefresh={() => void refreshOverview(instance, true)} onSettings={() => { setSettingsDiagnostics(false); setSettingsOpen(true); }} />}
          {section === "ports" && <PortsView onRefresh={() => void refreshOverview(instance, true)} onConfigure={(suggestion) => { setPortSuggestion(suggestion); setSection("assistant"); }} instance={instance} overview={overview} ports={ports} detection={portDetection} onSave={savePort} onDelete={deletePort} onSettings={() => { setSettingsDiagnostics(false); setSettingsOpen(true); }} notify={notify} />}

        </div>
        {(assistantVisited || section === "assistant") && <div hidden={section !== "assistant"} className="page-enter"><AssistantView portSuggestion={portSuggestion} onPortSuggestionConsumed={() => setPortSuggestion(null)} instance={instance} overview={overview} overviewRequestError={overviewRequestError} loading={loading} onSettings={() => { setSettingsDiagnostics(false); setSettingsOpen(true); }} onControlSuggestion={(suggestion) => { setControlSuggestion(suggestion); setSettingsDiagnostics(false); setSettingsOpen(true); }} onRefresh={() => void refreshOverview(instance, true)} onPorts={() => setSection("ports")} notify={notify} onDirtyChange={setAssistantDirty} /></div>}
      </AppShell>
      <SettingsSheet
        controlSuggestion={controlSuggestion}
        onSuggestionConsumed={() => setControlSuggestion(null)}
        open={settingsOpen}
        focusDiagnostics={settingsDiagnostics}
        user={user}
        instance={instance}
        theme={theme.theme}
        mode={theme.mode}
        themes={theme.themes}
        modes={theme.modes}
        language={language}
        onTheme={theme.setTheme}
        onMode={theme.setMode}
        onLanguage={setLanguage}
        onClose={() => setSettingsOpen(false)}
        onInstance={(next) => {
          dataGeneration.current++;
          overviewSequence.current++; overviewAbort.current?.abort(); metadataRefresh.current = { key: "", at: 0 };
          setInstance(next);
          setOverview(null); setTraffic(null); setPorts([]); setPortDetection(null);
          setDockerDiagnostic(null); setDockerError(""); setDockerObservedAt(null); setOverviewRequestError(""); setTrafficRequestError("");
          void Promise.all([refreshOverview(next), loadSupportingData(next)]);
        }}
        onSignOut={() => setLogoutOpen(true)}
        notify={notify}
      />
      <Dialog open={logoutOpen} title={t("signOut")} confirmLabel={t("signOut")} onClose={() => setLogoutOpen(false)} onConfirm={() => void signOut()}>
        <p>{t("signedInAs")} <strong>{user.displayName}</strong>.</p>
        {assistantDirty && <p>Signing out discards unsaved Assistant inputs and credentials. Save a redacted draft first if you want to keep its non-secret settings.</p>}
      </Dialog>
      <ToastHost messages={toasts} />
    </>
  );
}
