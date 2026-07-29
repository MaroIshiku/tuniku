import { useState } from "react";
import type { Instance, Overview } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";
import { Dialog } from "../components/Dialog.js";

type Action = { path: string; label: string; warning: string; danger?: boolean } | null;

function available(overview: Overview | null, capability: string): boolean {
  return overview?.capabilities?.[capability]?.state === "available";
}

export function ControlView(props: {
  instance: Instance | null;
  overview: Overview | null;
  busy: boolean;
  onAction: (path: string) => Promise<void>;
  onRefresh: () => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const [action, setAction] = useState<Action>(null);
  if (!props.instance) {
    return <section className="empty-state"><Icon name="vpn" /><h1>{t("configureGluetun")}</h1><p>{t("configureHint")}</p><button className="button button-filled" type="button" onClick={props.onSettings}>{t("configureGluetun")}</button></section>;
  }
  const vpn = props.overview?.vpn?.status;
  const dns = props.overview?.dns?.status;
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">{props.instance.displayName}</span><h1>{t("vpnControl")}</h1><p>{t("vpnControlSubtitle")}</p></div><button className="icon-button tonal" type="button" aria-label={t("refresh")} onClick={props.onRefresh}><Icon name="refresh" /></button></div>
      <section className="hero-card control-hero">
        <div className={`connection-orb ${vpn === "running" ? "running" : vpn === "stopped" ? "stopped" : ""}`}><Icon name="vpn" /></div>
        <div className="hero-copy">
          <span className="eyebrow">OpenVPN / WireGuard</span>
          <h2>{vpn === "running" ? t("vpnConnected") : vpn === "stopped" ? t("vpnStopped") : t("vpnUnknown")}</h2>
          <p>{props.overview?.publicIp?.publicIp ? `${t("publicIp")}: ${props.overview.publicIp.publicIp}` : t("connectionUnavailable")}</p>
        </div>
        <div className="control-actions">
          <button className="button button-filled" type="button" disabled={props.busy || vpn === "running" || !available(props.overview, "vpn")} onClick={() => setAction({ path: "vpn/start", label: t("startVpn"), warning: t("confirmStart") })}><Icon name="play" />{t("startVpn")}</button>
          <button className="button button-danger" type="button" disabled={props.busy || vpn === "stopped" || !available(props.overview, "vpn")} onClick={() => setAction({ path: "vpn/stop", label: t("stopVpn"), warning: t("confirmStop"), danger: true })}><Icon name="stop" />{t("stopVpn")}</button>
        </div>
      </section>

      <section className="dashboard-grid control-grid">
        <article className="content-card">
          <div className="content-card-header"><div><span className="eyebrow">{t("updater")}</span><h2>{props.overview?.updater?.status || t("unknown")}</h2></div><Icon name="refresh" /></div>
          <p className="muted">{available(props.overview, "updater") ? t("confirmStart") : t("unsupported")}</p>
          <button className="button button-tonal" type="button" disabled={props.busy || !available(props.overview, "updater")} onClick={() => void props.onAction("updater/start")}>{t("runUpdater")}</button>
        </article>
        <article className="content-card">
          <div className="content-card-header"><div><span className="eyebrow">{t("dns")}</span><h2>{dns || t("unknown")}</h2></div><Icon name="dns" /></div>
          <p className="muted">{available(props.overview, "dns") ? t("advancedDns") : t("unsupported")}</p>
          <div className="button-row">
            <button className="button button-tonal" type="button" disabled={props.busy || dns === "running" || !available(props.overview, "dns")} onClick={() => setAction({ path: "dns/start", label: t("startDns"), warning: t("confirmStart") })}>{t("startDns")}</button>
            <button className="button button-outlined" type="button" disabled={props.busy || dns === "stopped" || !available(props.overview, "dns")} onClick={() => setAction({ path: "dns/stop", label: t("stopDns"), warning: t("confirmStart") })}>{t("stopDns")}</button>
          </div>
        </article>
      </section>

      <section className="content-card settings-preview">
        <div className="content-card-header"><div><span className="eyebrow">Gluetun</span><h2>{t("currentSettings")}</h2></div><Icon name="code" /></div>
        {props.overview?.settings ? <pre className="code-block compact"><code>{JSON.stringify(props.overview.settings, null, 2)}</code></pre> : <p className="muted">{available(props.overview, "vpnSettings") ? t("loading") : t("unsupported")}</p>}
      </section>

      <Dialog open={Boolean(action)} title={t("confirmAction")} danger={action?.danger} confirmLabel={action?.label} onClose={() => setAction(null)} onConfirm={() => {
        const current = action;
        setAction(null);
        if (current) void props.onAction(current.path);
      }}>
        <div className="dialog-warning"><Icon name="warning" /><p>{action?.warning}</p></div>
      </Dialog>
    </>
  );
}
