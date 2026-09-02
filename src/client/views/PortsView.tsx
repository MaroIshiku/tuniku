import { useState, type FormEvent } from "react";
import type { Instance, Overview, PortDetection, PortLabel } from "../lib/models.js";
import { useI18n } from "../lib/i18n.js";
import { Icon } from "../components/Icon.js";
import { copyText } from "../lib/clipboard.js";
import { Sheet } from "../components/Sheet.js";

const emptyForm = { label: "", hostAddress: "", hostPort: "", containerPort: "8080", protocol: "tcp" as "tcp" | "udp", notes: "" };

export function PortsView(props: {
  instance: Instance | null;
  overview: Overview | null;
  ports: PortLabel[];
  detection: PortDetection | null;
  onSave: (body: any, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onSettings: () => void;
  notify: (text: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PortLabel | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const forwarded = props.overview?.portForwarding?.ports ?? [];
  const detectedPorts = props.ports.filter((port) => port.sourceType === "docker");
  const manualPorts = props.ports.filter((port) => port.sourceType === "manual");
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
    setOpen(true);
  }
  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
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
            <div data-label={t("hostPort")}><strong>{port.hostAddress ? `${port.hostAddress}:` : ""}{port.hostPort || "—"}</strong></div>
            <div data-label={t("containerPort")}><strong>{port.containerPort}</strong></div>
            <div data-label={t("protocol")}><span className="status-pill">{port.protocol.toUpperCase()}</span></div>
            <div className="port-actions">
              <button className="icon-button" type="button" aria-label={`${t("copy")} ${port.label}`} onClick={() => { void copyText(`"${port.hostAddress ? `${port.hostAddress}:` : ""}${port.hostPort || port.containerPort}:${port.containerPort}/${port.protocol}"`); props.notify(t("copied")); }}><Icon name="copy" /></button>
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
      <div className="page-heading"><div><span className="eyebrow">Gluetun</span><h1>{t("portOverview")}</h1><p>{t("portOverviewSubtitle")}</p></div></div>
      <div className="port-source-stack">
        <section className="content-card port-source-card" aria-labelledby="provider-ports-heading">
          <div className="content-card-header"><div><span className="eyebrow">Gluetun Control Server</span><h2 id="provider-ports-heading">{t("vpnProviderPortForwarding")}</h2><p>{t("vpnProviderPortsHint")}</p></div></div>
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
      <Sheet open={open} title={editing ? t("editPortNote") : t("addPort")} onClose={() => setOpen(false)}>
        <form className="port-form" onSubmit={(event) => void submit(event)}>
          <div className="inline-banner"><Icon name="info" /><span>{t("manualPortFormHint")}</span></div>
          <label className="text-field"><span>{t("label")}</span><input required value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></label>
          <label className="text-field"><span>{t("hostAddress")}</span><input placeholder="127.0.0.1" value={form.hostAddress} onChange={(event) => setForm({ ...form, hostAddress: event.target.value })} /></label>
          <div className="field-grid">
            <label className="text-field"><span>{t("hostPort")}</span><input type="number" min="1" max="65535" value={form.hostPort} onChange={(event) => setForm({ ...form, hostPort: event.target.value })} /></label>
            <label className="text-field"><span>{t("containerPort")}</span><input required type="number" min="1" max="65535" value={form.containerPort} onChange={(event) => setForm({ ...form, containerPort: event.target.value })} /></label>
          </div>
          <label className="select-field"><span>{t("protocol")}</span><select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as "tcp" | "udp" })}><option value="tcp">TCP</option><option value="udp">UDP</option></select></label>
          <label className="text-field"><span>{t("notes")}</span><textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
          <div className="button-row form-actions"><button className="button button-text" type="button" onClick={() => setOpen(false)}>{t("cancel")}</button><button className="button button-filled" type="submit" disabled={busy}>{t("save")}</button></div>
        </form>
      </Sheet>
    </>
  );
}
