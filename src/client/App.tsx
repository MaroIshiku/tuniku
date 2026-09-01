import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, setCsrfToken } from "./lib/api.js";
import type { Bootstrap, Instance, Overview, PortDetection, PortLabel, Section, TrafficSummary, User } from "./lib/models.js";
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
  const { t, language, setLanguage } = useI18n();
  const theme = useTheme();
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [instance, setInstance] = useState<Instance | null>(null);
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

  const notify = useCallback((text: string, tone: "success" | "error" = "success") => {
    const id = ++toastId.current;
    setToasts((current) => [...current, { id, text, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3_500);
  }, []);

  const establishSession = useCallback((session: { user: User; csrfToken: string }) => {
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
    const response = await api.instances();
    const selected = response.instances[0] ?? null;
    setInstance(selected);
    return selected;
  }, []);

  const refreshOverview = useCallback(async (target: Instance | null): Promise<void> => {
    if (!target) return;
    setLoading(true);
    try {
      const [response, trafficResponse] = await Promise.all([api.overview(target.id), api.traffic()]);
      setOverview(response.overview);
      setTraffic(trafficResponse.traffic);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setCsrfToken(null);
      } else {
        notify(error instanceof Error ? error.message : t("error"), "error");
      }
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  const loadSupportingData = useCallback(async (target: Instance | null): Promise<void> => {
    if (!target) {
      setPorts([]);
      setPortDetection(null);
      setActivity([]);
      return;
    }
    const [portsResponse, activityResponse] = await Promise.all([api.ports(target.id), api.activity()]);
    setPorts(portsResponse.ports);
    setPortDetection(portsResponse.detection);
    setActivity(activityResponse.events);
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
      setPorts((await api.ports(instance.id)).ports);
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
    } finally {
      setLogoutOpen(false);
      setSettingsOpen(false);
      setUser(null);
      setInstance(null);
      setOverview(null);
      setTraffic(null);
      setCsrfToken(null);
    }
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
      <AppShell section={section} user={user} onSection={setSection} onSettings={() => setSettingsOpen(true)}>
        <div className="page-enter" key={section}>
          {section === "overview" && <OverviewView instance={instance} overview={overview} traffic={traffic} activity={activity} loading={loading} onSection={setSection} onConnectExisting={() => setSettingsOpen(true)} onRefresh={() => void refreshOverview(instance)} />}
          {section === "control" && <ControlView instance={instance} overview={overview} busy={actionBusy} onAction={handleControl} onRefresh={() => void refreshOverview(instance)} onSettings={() => setSettingsOpen(true)} />}
          {section === "ports" && <PortsView instance={instance} overview={overview} ports={ports} detection={portDetection} onSave={savePort} onDelete={deletePort} onSettings={() => setSettingsOpen(true)} notify={notify} />}
          {section === "assistant" && <AssistantView instance={instance} notify={notify} />}
        </div>
      </AppShell>
      <SettingsSheet
        open={settingsOpen}
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
          setInstance(next);
          void Promise.all([refreshOverview(next), loadSupportingData(next)]);
        }}
        onSignOut={() => setLogoutOpen(true)}
        notify={notify}
      />
      <Dialog open={logoutOpen} title={t("signOut")} confirmLabel={t("signOut")} onClose={() => setLogoutOpen(false)} onConfirm={() => void signOut()}>
        <p>{t("signedInAs")} <strong>{user.displayName}</strong>.</p>
      </Dialog>
      <ToastHost messages={toasts} />
    </>
  );
}
