import type { PortSuggestion } from "../lib/portSuggestion.js";
import { serviceWebUrl, canOpenServiceDirectly } from "../lib/serviceWebUrl.js";
import { useState, type FormEvent } from "react";
import type { Instance, Overview, PortDetection, PortLabel } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";
import { copyText } from "../lib/clipboard.js";
import { ErrorField, FieldErrors } from "../components/ErrorField.js";
import { fieldErrors } from "../lib/fieldErrors.js";
import { Sheet } from "../components/Sheet.js";

const emptyForm = { label: "", hostAddress: "", hostPort: "", containerPort: "8080", protocol: "tcp" as "tcp" | "udp", notes: "" };
const bindAddress = (address: string | null): string => address ? `${address.includes(":") && !address.startsWith("[") ? `[${address}]` : address}:` : "";

export function PortsView(props: {
  instance: Instance | null;
  overview: Overview | null;
  ports: PortLabel[];
  detection: PortDetection | null;
  onSave: (body: any, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSettings: () => void;
  onConfigure: (suggestion: PortSuggestion) => void;
  onRefresh: () => void;
  notify: (text: string, tone?: "success" | "error") => void;
}) {
  const { t } = useI18n();
  const [webPort, setWebPort] = useState<PortLabel | null>(null);
  const [webHost, setWebHost] = useState("");
  const [webScheme, setWebScheme] = useState<"http" | "https">("http");
  let webUrl = "", webError = "";
  if (webPort) { try { webUrl = serviceWebUrl(webHost, webPort.hostPort!, webScheme); } catch (error) { webError = error instanceof Error ? error.message : "Check the host address."; } }
  const directOpen = Boolean(webUrl && canOpenServiceDirectly(webUrl, window.location.origin));
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PortLabel | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const forwarded = props.overview?.portForwarding?.ports ?? [];
  const detectedPorts = props.ports.filter((port) => port.sourceType === "docker");
  const manualPorts = props.ports.filter((port) => port.sourceType === "manual");
  async function copyPort(port: PortLabel): Promise<void> {
    try {
      const mapping = port.hostPort ? `${bindAddress(port.hostAddress)}${port.hostPort}:${port.containerPort}` : String(port.containerPort);
      await copyText(`"${mapping}/${port.protocol}"`);
      props.notify(t("copied"));
    } catch (error) { props.notify(error instanceof Error ? error.message : t("error"), "error"); }
  }
  function begin(port?: PortLabel): void {
    setEditing(port ?? null);
    setForm(port ? {
      label: port.label,
      hostAddress: port.hostAddress || "",
      hostPort: port.hostPort ? String(port.hostPort) : "",
      containerPort: String(port.containerPort),
      protocol: port.protocol,
      notes: port.notes || ""
    } : emptyForm);
    setErrors({}); setSaveError("");
    setOpen(true);
  }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true); setErrors({}); setSaveError("");
    try {
      await props.onSave({
        label: form.label,
        hostAddress: form.hostAddress || null,
        hostPort: form.hostPort ? Number(form.hostPort) : null,
        containerPort: Number(form.containerPort),
        protocol: form.protocol,
        notes: form.notes || null
      }, editing?.id);
      setOpen(false);
    } catch (failure) {
      setErrors(fieldErrors(failure));
      setSaveError(failure instanceof Error ? failure.message : "The port note could not be saved. Correct the fields and retry.");
    } finally {
      setBusy(false);
    }
  }
  function portList(entries: PortLabel[]) {
    return (
      <div className="port-list">
        <div className="port-table-head"><span>{t("label")}</span><span>{t("hostPort")}</span><span>{t("containerPort")}</span><span>{t("protocol")}</span><span /></div>
        {entries.map((port) => (
          <article className="port-row" key={port.id}>
            <div className="port-primary"><span className="port-icon"><Icon name="ports" /></span><div><strong>{port.label}</strong><span>{port.sourceType === "docker" ? t("detectedFromDocker") : t("localOnly")}{port.notes ? ` · ${port.notes}` : ""}</span></div></div>
            <div data-label={t("hostPort")}><strong>{bindAddress(port.hostAddress)}{port.hostPort || "—"}</strong></div>
            <div data-label={t("containerPort")}><strong>{port.containerPort}</strong></div>
            <div data-label={t("protocol")}><span className="status-pill">{port.protocol.toUpperCase()}</span></div>
            <div className="port-actions">
              <button className="icon-button" type="button" aria-label={`Configure ${port.label} in Assistant`} onClick={() => props.onConfigure({ label: port.label, hostAddress: port.hostAddress || "", hostPort: String(port.hostPort || port.containerPort), containerPort: String(port.containerPort), protocol: port.protocol })}><Icon name="settings" /></button>
              {port.protocol === "tcp" && port.hostPort && <button className="icon-button" type="button" aria-label={`Review web address for ${port.label}`} onClick={() => { setWebPort(port); setWebScheme("http"); setWebHost(port.hostAddress && !["0.0.0.0", "::"].includes(port.hostAddress) ? port.hostAddress : window.location.hostname.replace(/^\[|\]$/g, "")); }}><Icon name="globe" /></button>}
              <button className="icon-button" type="button" aria-label={`${t("copy")} ${port.label}`} onClick={() => void copyPort(port)}><Icon name="copy" /></button>
              {port.sourceType === "manual" && <button className="icon-button" type="button" aria-label={`${t("edit")} ${port.label}`} onClick={() => begin(port)}><Icon name="edit" /></button>}
              {port.sourceType === "manual" && <button className="icon-button danger-icon" type="button" aria-label={`${t("delete")} ${port.label}`} onClick={() => void props.onDelete(port.id)}><Icon name="delete" /></button>}
            </div>
          </article>
        ))}
      </div>
    );
  }
  if (!props.instance) return <section className="empty-state"><Icon name="ports" /><h1>{t("configureGluetun")}</h1><p>{t("configureHint")}</p><button className="button button-filled" type="button" onClick={props.onSettings}>{t("configureGluetun")}</button></section>;
  return (
    <>
      <div className="page-heading"><div><span className="eyebrow">Gluetun</span><h1>{t("portOverview")}</h1><p>{t("portOverviewSubtitle")}</p></div><div className="button-row"><button className="button button-tonal" type="button" onClick={props.onRefresh}>Detect ports again</button><button className="button button-filled" type="button" onClick={() => props.onConfigure({ label: "New publication", hostAddress: "", hostPort: "8080", containerPort: "8080", protocol: "tcp" })}>Configure a publication</button></div></div>
      <div className="port-source-stack">
        <section className="content-card port-source-card" aria-labelledby="provider-ports-heading">
          <div className="content-card-header"><div><span className="eyebrow">Gluetun Control Server</span><h2 id="provider-ports-heading">{t("vpnProviderPortForwarding")}</h2><p>{t("vpnProviderPortsHint")}</p></div></div>
          <p className="muted">Provider forwarding reaches the VPN endpoint. The application must listen on that port inside the VPN network. Publishing a Docker port separately exposes an application to your local host or network.</p>
          <div className="forwarded-strip"><div><Icon name="vpn" /><div><span>{t("vpnProviderPort")}</span><strong>{forwarded.length > 0 ? forwarded.join(", ") : t("noForwardedPorts")}</strong></div></div><span className={`status-pill ${forwarded.length > 0 ? "success" : ""}`}>{forwarded.length > 0 ? t("forwarded") : t("noneReported")}</span></div>
        </section>

        <section className="content-card port-source-card" aria-labelledby="docker-ports-heading">
          <div className="content-card-header"><div><span className="eyebrow">Docker</span><h2 id="docker-ports-heading">{t("dockerPublishedPortsTitle")}</h2><p>{t("dockerPublishedPortsHint")}</p></div></div>
          {props.detection && !props.detection.available && <div className="inline-banner warning page-banner"><Icon name="warning" /><div><strong>{t("automaticPortDetection")}</strong><span>{props.detection.error || t("connectionUnavailable")}</span></div></div>}
          {props.detection?.available && (detectedPorts.length > 0 ? portList(detectedPorts) : <div className="port-source-empty"><Icon name="ports" /><div><strong>{t("noDockerPublishedPorts")}</strong><span>{t("noDockerPublishedPortsHint")}</span></div></div>)}
        </section>

        <section className="content-card port-source-card" aria-labelledby="manual-ports-heading">
          <div className="content-card-header"><div><span className="eyebrow">Tuniku</span><h2 id="manual-ports-heading">{t("manualPortNotes")}</h2><p>{t("manualPortNotesHint")}</p></div><button className="button button-filled" type="button" onClick={() => begin()}><Icon name="add" />{t("addPort")}</button></div>
          {manualPorts.length > 0 ? portList(manualPorts) : <div className="port-source-empty"><Icon name="info" /><div><strong>{t("noPorts")}</strong><span>{t("noPortsHint")}</span></div></div>}
        </section>
      </div>
      <Sheet open={Boolean(webPort)} title="Review service web address" onClose={() => setWebPort(null)}>
        <div className="port-form"><p>A TCP mapping does not prove that a web service is listening. Confirm its protocol and a host reachable from this browser. Loopback addresses refer to this browser's device.</p>
          <label className="text-field"><span>Reachable service host</span><input value={webHost} onChange={event => setWebHost(event.target.value)} placeholder="nas.example or 192.0.2.10" /></label>
          <label className="select-field"><span>Web protocol</span><select value={webScheme} onChange={event => setWebScheme(event.target.value as "http" | "https")}><option value="http">HTTP</option><option value="https">HTTPS</option></select></label>
          {webError && <p className="warning-text" role="alert">{webError}</p>}
          <label className="text-field"><span>Service URL</span><input readOnly value={webUrl} /></label>
          {webUrl && !directOpen && <p className="inline-banner warning">This hostname also serves Tuniku. Browser session cookies span ports. Copy this address into a separate private browser session to keep your Tuniku session isolated.</p>}
          <div className="button-row"><button className="button button-tonal" type="button" disabled={!webUrl} onClick={() => { void copyText(webUrl).then(() => props.notify(t("copied"))).catch(error => props.notify(error instanceof Error ? error.message : t("error"), "error")); }}>Copy service URL</button><button className="button button-filled" type="button" disabled={!directOpen} onClick={() => { if (directOpen) window.open(webUrl, "_blank", "noopener,noreferrer"); }}>Open service</button></div>
        </div>
      </Sheet>
      <Sheet open={open} title={editing ? t("editPortNote") : t("addPort")} onClose={() => setOpen(false)}>
        <FieldErrors.Provider value={errors}><form className="port-form" onSubmit={(event) => void submit(event)}>
          <div className="inline-banner"><Icon name="info" /><span>{t("manualPortFormHint")}</span></div>
          <label className="text-field"><span>{t("label")}</span><input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
          <ErrorField field="hostAddress" className="text-field"><span>{t("hostAddress")}</span><input placeholder="127.0.0.1 or ::1" value={form.hostAddress} onChange={(event) => { setForm({ ...form, hostAddress: event.target.value }); setErrors(({ hostAddress: _hostAddress, hostPort: _hostPort, ...rest }) => rest); }} /></ErrorField>
          <p className="muted">Enter an IPv4 or IPv6 address without brackets. Display and copied Compose mappings add brackets around IPv6 addresses.</p>
          <div className="field-grid">
            <ErrorField field="hostPort" className="text-field"><span>{t("hostPort")}</span><input type="number" min="1" max="65535" value={form.hostPort} onChange={(event) => { setForm({ ...form, hostPort: event.target.value }); setErrors(({ hostPort: _hostPort, ...rest }) => rest); }} /></ErrorField>
            <label className="text-field"><span>{t("containerPort")}</span><input required type="number" min="1" max="65535" value={form.containerPort} onChange={(event) => setForm({ ...form, containerPort: event.target.value })} /></label>
          </div>
          <label className="select-field"><span>{t("protocol")}</span><select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as "tcp" | "udp" })}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
          <label className="text-field"><span>{t("notes")}</span><textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          {saveError && <p className="warning-text" role="alert">{saveError}</p>}
          <div className="button-row form-actions"><button className="button button-text" type="button" onClick={() => setOpen(false)}>{t("cancel")}</button><button className="button button-filled" type="submit" disabled={busy}>{t("save")}</button></div>
        </form></FieldErrors.Provider>
      </Sheet>
    </>
  );
}
