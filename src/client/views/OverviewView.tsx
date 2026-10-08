import type { DockerDiagnostic, Instance, Overview, PortDetection, PortLabel, Section, TrafficSummary } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";
import { copyText } from "../lib/clipboard.js";

function statusTone(value: string | undefined): string {
  if (["running", "completed"].includes(value || "")) return "success";
  if (["stopped", "failed"].includes(value || "")) return "warning";
  return "neutral";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value / (1024 ** index))} ${units[index]}`;
}

function formatRate(value: number): string {
  return `${formatBytes(value)}/s`;
}

function publicIpLocation(overview: Overview | null): string | null {
  const publicIp = overview?.publicIp;
  if (!publicIp) return null;
  const values = [publicIp.city, publicIp.region, publicIp.country].filter((value): value is string => Boolean(value));
  return [...new Set(values)].join(", ") || null;
}

export function OverviewView(props: {
  instance: Instance | null;
  overview: Overview | null;
  overviewRequestError: string;
  trafficRequestError: string;
  traffic: TrafficSummary | null;
  ports: PortLabel[];
  portDetection: PortDetection | null;
  dockerDiagnostic: DockerDiagnostic | null;
  dockerError: string;
  dockerObservedAt: string | null;
  onDiagnostics: () => void;
  activity: any[];
  loading: boolean;
  onSection: (section: Section) => void;
  onConnectExisting: () => void;
  onRefresh: () => void;
  notify: (text: string, tone?: "success" | "error") => void;
}) {
  const { t, language } = useI18n();
  async function copyIp(): Promise<void> {
    try { await copyText(props.overview!.publicIp!.publicIp); props.notify(t("copied")); }
    catch (error) { props.notify(error instanceof Error ? error.message : t("error"), "error"); }
  }
  const vpnStatus = props.overview?.vpn?.status;
  const location = publicIpLocation(props.overview);
  const forwardedPorts = props.overview?.portForwarding?.ports ?? [];
  const publishedPorts = [...new Set(props.ports
    .filter((port) => port.sourceType === "docker" && port.hostPort)
    .map((port) => port.hostPort as number))].sort((left, right) => left - right);
  if (!props.instance) {
    return (
      <section className="empty-state hero-empty">
        <div className="empty-logo"><img src="/assets/logos/tuniku.png" alt="Tuniku" /></div>
        <h1>{t("prepareGluetun")}</h1>
        <p>{t("prepareGluetunHint")}</p>
        <div className="empty-actions">
          <button className="button button-filled" type="button" onClick={() => props.onSection("assistant")}><Icon name="code" />{t("createGluetunConfig")}</button>
          <button className="button button-outlined" type="button" onClick={props.onConnectExisting}><Icon name="settings" />{t("connectExistingGluetun")}</button>
        </div>
        <small className="empty-note">{t("manualDeploymentNote")}</small>
      </section>
    );
  }
  return (
    <>
      <section className={`hero-card vpn-hero ${props.overview?.connected ? "" : "offline"}`}>
        <div className="hero-status-icon"><Icon name="vpn" /></div>
        <div className="hero-copy">
          <div className="eyebrow">{props.instance.displayName}</div>
          <h1>{vpnStatus === "running" ? t("vpnConnected") : vpnStatus === "stopped" ? t("vpnStopped") : t("vpnUnknown")}</h1>
          <p>{props.overview?.connected ? t("connectionHealthy") : t("connectionUnavailable")}</p>
          {props.overview?.stale && <span className="stale-warning"><Icon name="warning" />{t("staleData")}</span>}
          {props.overview?.lastUpdatedAt && <span className="last-updated">{t("lastUpdated")}: {new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "medium" }).format(new Date(props.overview.lastUpdatedAt))}</span>}
        </div>
        <div className="hero-actions">
          <button className="button button-filled" type="button" onClick={() => props.onSection("control")}>{t("openControl")}</button>
          <button className="icon-button tonal" type="button" aria-label={t("refresh")} disabled={props.loading} onClick={props.onRefresh}><Icon name="refresh" /></button>
        </div>
      </section>

      {(props.overviewRequestError || props.overview?.error) && <div className="inline-banner warning page-banner" role="status"><Icon name="warning" /><div><strong>{t("connectionUnavailable")}</strong><span>{props.overviewRequestError || props.overview?.error?.message}</span></div></div>}

      <section className="dashboard-grid status-grid">
        <article className="status-card ip-status-card">
          <div className="card-icon"><Icon name="globe" /></div>
          <div className="card-heading">
            <span>{t("publicIp")}</span>
            <strong className="technical-value">{props.overview?.publicIp?.publicIp || "—"}</strong>
            <span className="card-detail">{location || t("ipLocationUnavailable")}</span><span className="card-detail">Reported IP location; not proof of the selected VPN server location.</span>
          </div>
          {props.overview?.publicIp?.publicIp && <button className="icon-button" type="button" aria-label={`${t("copy")} ${t("publicIp")}`} onClick={() => void copyIp()}><Icon name="copy" /></button>}
        </article>
        <article className="status-card">
          <div className="card-icon"><Icon name="dns" /></div>
          <div className="card-heading"><span>{t("dns")}</span><strong>{props.overview?.dns?.status || t("unknown")}</strong></div>
          <span className={`status-dot ${statusTone(props.overview?.dns?.status)}`} />
        </article>
        <article className="status-card">
          <div className="card-icon"><Icon name="refresh" /></div>
          <div className="card-heading"><span>{t("updater")}</span><strong>{props.overview?.updater?.status || t("unknown")}</strong></div>
          <span className={`status-dot ${statusTone(props.overview?.updater?.status)}`} />
        </article>
        <article className="status-card port-status-card">
          <div className="card-icon"><Icon name="ports" /></div>
          <div className="card-heading">
            <span>{t("ports")}</span>
            <strong>{forwardedPorts.length ? `${t("vpnProviderPort")}: ${forwardedPorts.join(", ")}` : t("noVpnProviderPort")}</strong>
            <span className="card-detail">
              {publishedPorts.length
                ? `${t("dockerPublishedPorts")}: ${publishedPorts.join(", ")}`
                : props.portDetection?.available
                  ? t("noDockerPublishedPorts")
                  : props.loading && !props.portDetection ? "Loading published mappings" : props.portDetection?.error || t("dockerPortDetectionUnavailable")}
            </span>
          </div>
        </article>
        <article className="status-card traffic-card">
          <div className="card-icon"><Icon name="activity" /></div>
          <div className="card-heading">
            <span>{t("vpnTraffic")}</span>
            <strong>{props.traffic?.available && !props.traffic.error && !props.trafficRequestError ? `↓ ${formatRate(props.traffic.downloadBytesPerSecond)} · ↑ ${formatRate(props.traffic.uploadBytesPerSecond)}` : props.loading && !props.traffic && !props.trafficRequestError ? "Loading network counters" : t("trafficUnavailable")}</strong>
            {props.traffic?.available && <span>{t("today")}: ↓ {formatBytes(props.traffic.todayDownloadedBytes)} · ↑ {formatBytes(props.traffic.todayUploadedBytes)}</span>}
            {props.traffic?.available && <span>{t("trackedTotal")}: ↓ {formatBytes(props.traffic.trackedDownloadedBytes)} · ↑ {formatBytes(props.traffic.trackedUploadedBytes)}</span>}
            <span className="card-detail">All Docker-reported interfaces; shared applications, VPN overhead and control traffic may be included. This is not provider usage.</span>
            {(props.trafficRequestError || props.traffic?.error) && <span className="card-detail warning-text" role="status">{props.trafficRequestError || props.traffic?.error}</span>}
          </div>
        </article>
      </section>


      <section className="content-card" aria-labelledby="traffic-history-heading">
        <div className="content-card-header"><div><span className="eyebrow">Container network traffic</span><h2 id="traffic-history-heading">Daily traffic history</h2></div></div>
        <p className="muted">Recorded aggregate byte changes across observed containers. Changing the connection does not partition this history. No destinations or packet contents are stored.</p>
        <p className="muted">Today and the preceding 89 days{props.traffic?.history ? ` · server time zone: ${props.traffic.history.timeZone}` : ""}. Days without records are omitted, not measured as zero. Intervals crossing midnight are split by elapsed time; daily values are estimates and exclude traffic before the first comparable sample.</p>
        {props.trafficRequestError && <p className="warning-text" role="status">History refresh failed. Displayed days are from the last successful response.</p>}
        {props.traffic?.history?.days.length ? <details className="traffic-history">
          <summary>Show recorded days ({props.traffic.history.days.length})</summary>
          <table><caption>Recorded daily container network counters, newest first</caption><thead><tr><th scope="col">Date</th><th scope="col">Received</th><th scope="col">Sent</th></tr></thead><tbody>{props.traffic.history.days.map((day) => <tr key={day.day}><th scope="row"><time dateTime={day.day}>{day.day}</time></th><td>{formatBytes(day.downloadedBytes)}</td><td>{formatBytes(day.uploadedBytes)}</td></tr>)}</tbody></table>
        </details> : <p className="muted">{props.loading && !props.traffic ? "Loading recorded days" : props.trafficRequestError && !props.traffic ? "Recorded days could not be loaded. Try Refresh." : "No daily counters have been recorded yet."}</p>}
      </section>

      <section className="content-card" aria-labelledby="docker-diagnostics-heading">
        <div className="content-card-header"><div><span className="eyebrow">Docker</span><h2 id="docker-diagnostics-heading">Container diagnostics</h2></div><button className="button button-outlined" type="button" onClick={props.onDiagnostics}>Open diagnostics and logs</button></div>
        <div className="technical-card"><dl>
          <div><dt>Control API</dt><dd>{props.overview?.connected ? props.overview.stale ? "Last known reachable" : "Reachable" : props.loading && !props.overview ? "Loading" : "Unavailable"}{props.overview?.stale ? " · stale" : ""}</dd></div>
          <div><dt>VPN process</dt><dd>{vpnStatus || "Unknown"}{props.overview?.stale ? " · stale" : ""}</dd></div>
          <div><dt>Docker container</dt><dd>{props.dockerDiagnostic?.container ? `${props.dockerDiagnostic.container.name} · ${props.dockerDiagnostic.container.displayState || props.dockerDiagnostic.container.state}` : props.loading && !props.dockerDiagnostic ? "Loading" : props.dockerDiagnostic?.available ? "Not found" : "Unavailable"}</dd></div>
          <div><dt>Docker healthcheck</dt><dd>{props.dockerDiagnostic?.container?.health || "Unavailable"}</dd></div>
          <div><dt>Exit code</dt><dd>{props.dockerDiagnostic?.container?.exitCode ?? "Unavailable"}</dd></div>
          <div><dt>Docker container restarts</dt><dd>{props.dockerDiagnostic?.container?.restartCount ?? "Unavailable"}</dd></div>
        </dl></div>
        <p className="muted">API reachability and a running VPN process do not prove tunnel health. Docker health reflects the configured container healthcheck. Restarting the VPN through Control does not recreate the container or increment Docker's restart count.</p>
        {props.dockerObservedAt && <p className="muted">Last Docker observation: {new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "medium" }).format(new Date(props.dockerObservedAt))}</p>}
        {props.dockerError && <p role="status" className="warning-text">{props.dockerError}</p>}
        {props.dockerDiagnostic?.association && <p className={props.dockerDiagnostic.association.state === "matched" ? "muted" : "warning-text"}>{props.dockerDiagnostic.association.message}</p>}
        {(props.dockerDiagnostic?.container?.error || props.dockerDiagnostic?.issues?.[0] || props.dockerDiagnostic?.logsError) && <p className="warning-text">{props.dockerDiagnostic?.container?.error || props.dockerDiagnostic?.issues?.[0] || props.dockerDiagnostic?.logsError}</p>}
      </section>

      <section className="content-card activity-card">
        <div className="content-card-header"><div><span className="eyebrow">Tuniku</span><h2>{t("recentActivity")}</h2></div><Icon name="activity" /></div>
        {props.activity.length ? (
          <div className="activity-list">
            {props.activity.slice(0, 6).map((event, index) => (
              <div className="activity-row" key={`${event.createdAt}-${index}`}>
                <span className={`activity-mark ${event.result === "success" ? "success" : event.result === "failed" ? "warning" : ""}`} />
                <div><strong>{String(event.eventType).replaceAll("_", " ")}</strong><span>{new Intl.DateTimeFormat(language, { dateStyle: "short", timeStyle: "short" }).format(new Date(event.createdAt))}</span></div>
                <span className="activity-result">{event.result}</span>
              </div>
            ))}
          </div>
        ) : <p className="muted">{t("noActivity")}</p>}
      </section>
    </>
  );
}
