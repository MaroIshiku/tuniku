import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import type { ManagedDiagnostics, ManagedPlan, ManagedStatus } from "../lib/models.js";
import { Icon } from "./Icon.js";

export function ManagedStackPanel(props: { input: unknown; onChooseTask: (task: string) => void; onLoadSettings: (input: Record<string, unknown>) => void; notify: (text: string, tone?: "success" | "error") => void }) {
  const [clearKeys, setClearKeys] = useState<string[]>([]);
  const [clearableKeys, setClearableKeys] = useState<string[]>([]);
  const [observedPorts, setObservedPorts] = useState<Record<string, Array<{ HostIp: string; HostPort: string }>>>({});
  const [portAction, setPortAction] = useState("add");
  const [originalBinding, setOriginalBinding] = useState("");
  const [review, setReview] = useState<any>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [exportSource, setExportSource] = useState("");
  const [exportResult, setExportResult] = useState<any>(null);
  useEffect(() => { if (!exportSource) return; const timeout = window.setTimeout(() => { setExportSource(""); setExportResult(null); }, 15 * 60_000); return () => window.clearTimeout(timeout); }, [exportSource]);
  const [settingsReady, setSettingsReady] = useState(false);
  const [status, setStatus] = useState<ManagedStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [vpnId, setVpnId] = useState("");
  const [clients, setClients] = useState<string[]>([]);
  const [adoptionConfirmed, setAdoptionConfirmed] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [diagnostics, setDiagnostics] = useState<ManagedDiagnostics | null>(null);
  useEffect(() => { setDiagnostics(null); setClearKeys([]); setReview(null); setReviewConfirmed(false); setExportResult(null); setSettingsReady(false); setObservedPorts({}); setPortAction("add"); setOriginalBinding(""); }, [projectId]);
  useEffect(() => { if (!diagnostics || diagnostics.stale) return; const timer = window.setTimeout(() => setDiagnostics(current => current ? { ...current, stale: true } : null), Math.max(0, Date.parse(diagnostics.observedAt) + 60_000 - Date.now())); return () => window.clearTimeout(timer); }, [diagnostics]);
  const [plan, setPlan] = useState<ManagedPlan | null>(null);
  const [applyConfirmed, setApplyConfirmed] = useState(false);
  const managedInput = { ...(props.input as Record<string, unknown>), managedClearEnvironmentKeys: clearKeys, managedPortAction: portAction, ...(originalBinding ? { managedOriginalBinding: JSON.parse(originalBinding) } : {}) };
  const inputKey = JSON.stringify(managedInput);
  const currentSelection = useRef(`${projectId}:${inputKey}`);
  currentSelection.current = `${projectId}:${inputKey}`;
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const selection = currentSelection.current;
    void api.managementAction("settings", { projectId }).then(value => {
      if (!active || currentSelection.current !== selection) return;
      setClearableKeys(value.settings.clearableKeys ?? []); setObservedPorts(value.settings.publishedPorts ?? {});
      props.onLoadSettings(value.settings.input); setSettingsReady(true);
      if (value.settings.input.vpnType === "wireguard" && value.settings.configurationSource !== "environment") setError("A mounted WireGuard configuration may override environment changes. Review its source manually before rotating WireGuard keys.");
    }).catch(failure => { if (active) setError(failure instanceof Error ? failure.message : "The adopted settings could not be inspected."); });
    return () => { active = false; };
  }, [projectId]);
  const applying = status?.operations.some((operation) => operation.status === "applying" || operation.cleanupStatus === "applying") ?? false;
  useEffect(() => { setPlan(null); setApplyConfirmed(false); }, [inputKey, projectId]);
  useEffect(() => { if (!plan) return; const timeout = window.setTimeout(() => setPlan(null), Math.max(0, Date.parse(plan.expiresAt) - Date.now())); return () => window.clearTimeout(timeout); }, [plan]);
  useEffect(() => {
    let active = true;
    const refresh = () => void api.management().then((value) => { if (active) { setStatus(value); setError(""); } }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "Managed status is unavailable."); });
    refresh();
    const timer = applying ? window.setInterval(refresh, 2000) : null;
    return () => { active = false; if (timer !== null) window.clearInterval(timer); };
  }, [applying]);
  const latestOperation = status?.operations.filter(operation => operation.projectId === projectId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const lastSuccessfulOperation = status?.operations.filter(operation => operation.projectId === projectId && operation.status === "succeeded").sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const completedOperationKey = latestOperation?.status === "succeeded" ? latestOperation.id : "";
  useEffect(() => {
    if (!projectId || !completedOperationKey) return;
    let active = true;
    setDiagnostics(null);
    void api.managementDiagnostics(projectId).then(value => { if (active) setDiagnostics(value.diagnostics); }).catch(() => { if (active) setError("The change completed, but its current state could not be inspected. Refresh the inspection."); });
    return () => { active = false; };
  }, [projectId, completedOperationKey]);
  async function run(work: () => Promise<void>): Promise<void> {
    setBusy(true); setError("");
    try { await work(); setStatus(await api.management()); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The managed change failed."); }
    finally { setBusy(false); }
  }
  async function adopt(): Promise<void> {
    await run(async () => {
      const result = await api.managementAdopt(vpnId, clients);
      setProjectId(result.project.id); setAdoptionConfirmed(false);
      props.onChooseTask("configure_provider");
      props.notify("VPN stack adopted. Review its configuration before preparing a change.");
    });
  }
  const selectedVpn = status?.candidates.find((candidate) => candidate.id === vpnId);
  const owned = new Set(status?.projects.flatMap((project) => [project.vpnId, ...project.clientIds]) ?? []);
  const selectionNote = (candidate: ManagedStatus["candidates"][number]): string => candidate.recovery ? "Retained for recovery; cannot be adopted." : !candidate.network || candidate.network.kind === "unknown" ? "Namespace unknown; checked before adoption." : candidate.network.kind === "vpn_namespace" && candidate.network.vpnId === vpnId ? "Uses the selected VPN namespace." : "Does not use the selected VPN namespace; migration review required.";
  const canSelect = (candidate: ManagedStatus["candidates"][number]): boolean => !candidate.recovery && (!candidate.network || candidate.network.kind === "unknown" || candidate.network.kind === "vpn_namespace" && candidate.network.vpnId === vpnId);
  const crossProjectDependents = status?.candidates.filter(candidate => candidate.role === "application" && !candidate.recovery && candidate.network?.kind === "vpn_namespace" && candidate.network.vpnId === vpnId && candidate.project !== selectedVpn?.project) ?? [];
  return <section className="content-card managed-panel" aria-labelledby="managed-stack-title">
    <div className="content-card-header"><div><span className="eyebrow">Guided changes</span><h2 id="managed-stack-title">Manage your VPN stack</h2></div><Icon name="vpn" /></div>
    {error && <div className="inline-banner warning" role="alert"><Icon name="warning" /><span>{error}</span></div>}
    {status && !status.enabled && <p>Enable the optional managed deployment to apply confirmed VPN changes here. You can continue using configuration exports below.</p>}
    {status?.enabled && <>
      {status.prerequisites && <details><summary>Management prerequisites</summary><p>Approved projects: {status.prerequisites.projects.join(", ")}. {status.prerequisites.bindRootsConfigured ? "Data roots configured." : "No host bind roots configured; only Docker volumes can be adopted."} Existing same-project routed stacks only. Restart policy always, external dependencies and unknown network data block changes. New stacks, app migration and image updates use separate reviewed workflows.</p></details>}
      {status.storage && <details><summary>Manager storage and recovery retention</summary><p>{status.storage.plans}/{status.storage.limit} plans · {Math.ceil(status.storage.bytes / 1024)} KiB encrypted storage · {status.storage.retainedContainers} recovery containers.</p>{(status.storage.plans >= status.storage.limit * 0.8 || status.storage.bytes >= 25 * 1024 * 1024) && <p className="warning-text">Plan storage is nearing its limit. Referenced recovery plans are protected.</p>}<button type="button" className="button button-outlined" disabled={busy || status.storage.expiredUnreferenced === 0} onClick={() => void run(async () => { await api.managementAction("prune", { confirmed: true }); props.notify("Unreferenced expired previews removed. Recovery records and volumes preserved."); })}>Remove expired unreferenced previews ({status.storage.expiredUnreferenced})</button></details>}

      <p>Choose a managed stack, configure the change below, then review its impact before applying. Tuniku stays available while the VPN and its applications restart.</p>
      <label className="select-field"><span>Managed VPN stack</span><select value={projectId} disabled={busy || applying} onChange={(event) => { setProjectId(event.target.value); props.onChooseTask("configure_provider"); }}><option value="">Choose a stack</option>{status.projects.map((project) => <option key={project.id} value={project.id}>{project.composeProject}</option>)}</select></label>
      <details><summary>Adopt an existing VPN stack</summary>
        <p>Only explicitly selected containers in an allowed project will be managed. Existing applications in other projects need a reviewed migration first.</p>
        <label className="select-field"><span>VPN container to adopt</span><select value={vpnId} disabled={busy || applying} onChange={(event) => { const id = event.target.value; const vpn = status.candidates.find(candidate => candidate.id === id); setVpnId(id); setClients(status.candidates.filter(candidate => candidate.role === "application" && candidate.project === vpn?.project && !owned.has(candidate.id) && !candidate.recovery && candidate.network?.kind === "vpn_namespace" && candidate.network.vpnId === id).map(candidate => candidate.id)); setAdoptionConfirmed(false); }}><option value="">Choose a VPN container</option>{status.candidates.filter((candidate) => candidate.role === "vpn" && !owned.has(candidate.id)).map((candidate) => <option key={candidate.id} value={candidate.id} disabled={candidate.recovery}>{candidate.name} · {candidate.project}{candidate.recovery ? " · Retained for recovery" : ""}</option>)}</select></label>
        <fieldset><legend>Applications sharing this VPN</legend>{status.candidates.filter((candidate) => candidate.role === "application" && candidate.project === selectedVpn?.project && !owned.has(candidate.id)).map((candidate) => <label className="switch-row" key={candidate.id}><input type="checkbox" aria-label={candidate.name} aria-describedby={`managed-dependency-${candidate.id}`} checked={clients.includes(candidate.id)} disabled={busy || applying || !canSelect(candidate)} onChange={(event) => { setAdoptionConfirmed(false); setClients((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id)); }} /><span>{candidate.name}<small id={`managed-dependency-${candidate.id}`} className="dependency-note">{selectionNote(candidate)}</small></span></label>)}</fieldset>
        {crossProjectDependents.length > 0 && <p className="inline-banner warning" role="alert">Other approved projects share this VPN: {crossProjectDependents.map(candidate => `${candidate.name} (${candidate.project})`).join(", ")}. They cannot be adopted here; review the migration before continuing.</p>}
        <p className="muted">Known applications sharing this VPN are selected for review. Confirm ownership explicitly before adoption; other networks require a separate migration.</p>
        <label className="switch-row"><input type="checkbox" checked={adoptionConfirmed} onChange={(event) => setAdoptionConfirmed(event.target.checked)} /><span>I authorize Tuniku to manage this VPN and the selected applications.</span></label>
        <button className="button button-tonal" type="button" disabled={busy || applying || !vpnId || !adoptionConfirmed || selectedVpn?.recovery || crossProjectDependents.length > 0} onClick={() => void adopt()}>Adopt selected stack</button>
      </details>
      {projectId && <details><summary>Explicit setting removal and port actions</summary><p>Blank fields retain observed settings for the same provider. Select a setting here only to remove it; the plan lists removals. Any location explicitly clears location filters.</p>{clearableKeys.map(key => <label className="switch-row" key={key}><input type="checkbox" checked={clearKeys.includes(key)} onChange={event => setClearKeys(current => event.target.checked ? [...current, key] : current.filter(value => value !== key))} /><span>Remove {key}</span></label>)}<label className="select-field"><span>Managed port action</span><select value={portAction} onChange={event => { setPortAction(event.target.value); setOriginalBinding(""); }}><option value="add">Add binding (keep other addresses)</option><option value="replace">Replace selected binding</option><option value="remove">Remove selected binding</option></select></label>{portAction !== "add" && <label className="select-field"><span>Original binding for this target port</span><select value={originalBinding} onChange={event => setOriginalBinding(event.target.value)}><option value="">Choose the exact binding</option>{(observedPorts[`${(props.input as any).containerPort}/${(props.input as any).protocol ?? "tcp"}`] ?? []).map(binding => <option key={`${binding.HostIp}:${binding.HostPort}`} value={JSON.stringify({ address: binding.HostIp, port: binding.HostPort })}>{binding.HostIp || "all interfaces"}:{binding.HostPort}</option>)}</select></label>}</details>}
      <div className="button-row"><button className="button button-filled" type="button" disabled={busy || applying || !projectId || !settingsReady || Boolean(latestOperation && ["interrupted", "rollback_failed"].includes(latestOperation.status))} onClick={() => void run(async () => { const value = await api.managementPlan(projectId, managedInput); if (currentSelection.current === `${projectId}:${inputKey}`) { setPlan(value.plan); setApplyConfirmed(false); } })}>Review change plan</button><button className="button button-text" type="button" disabled={busy} onClick={() => void run(async () => {})}>Refresh managed status</button></div>
      <button className="button button-outlined" type="button" disabled={busy || applying || !projectId} onClick={() => void run(async () => { const selection = currentSelection.current; const value = await api.managementAction("settings", { projectId }); if (currentSelection.current !== selection) return; props.onLoadSettings(value.settings.input); setClearableKeys(value.settings.clearableKeys ?? []); setObservedPorts(value.settings.publishedPorts ?? {}); setClearKeys([]); setSettingsReady(true); })}>Reload observed settings (discard input edits)</button>
      <button className="button button-outlined" type="button" disabled={busy || applying || !projectId} onClick={() => void run(async () => { const value = await api.managementDiagnostics(projectId); if (currentSelection.current.startsWith(`${projectId}:`)) setDiagnostics(value.diagnostics); })}>Inspect managed applications</button>
      {diagnostics && <div className="technical-card" aria-labelledby="managed-diagnostics-title">
        <h3 id="managed-diagnostics-title">Managed application diagnostics</h3>
        <p>Observed {new Date(diagnostics.observedAt).toLocaleString("en")}. This inspection does not modify containers.</p>
        <h4>Configuration comparison</h4>
        <p role="status">{diagnostics.configuration?.state === "matched" ? "Observed configuration matches the saved managed reference." : diagnostics.configuration?.state === "drifted" ? "Configuration drift detected. Review external changes before preparing another managed change." : "Configuration comparison is unavailable. Legacy stacks need a successful reviewed change to establish a reference."}</p>
        {diagnostics.configuration?.baselineAt && <p>Reference saved {new Date(diagnostics.configuration.baselineAt).toLocaleString("en")} at {diagnostics.configuration.baselineSource === "successful_apply" ? "the last successful managed change" : "explicit adoption"}. Host Compose files and redacted drafts are not compared.</p>}
        {diagnostics.publishedPorts && <><h4>Observed published ports</h4><pre className="code-block">{JSON.stringify(diagnostics.publishedPorts, null, 2)}</pre></>}
        {lastSuccessfulOperation && <p>Last successful managed change: {new Date(lastSuccessfulOperation.finishedAt || lastSuccessfulOperation.startedAt).toLocaleString("en")}. Current inspection is separate from that historical result.</p>}
        {(diagnostics.stale || error) && <p className="warning-text">These details may be outdated. Refresh the inspection before using them.</p>}
        {[diagnostics.vpn, ...diagnostics.applications].map((service) => <div key={service.id}>
          <h4>{service.name || service.id.slice(0, 12)}</h4>
          <dl><div><dt>Inspection</dt><dd>{service.availability.replaceAll("_", " ")}</dd></div><div><dt>State</dt><dd>{service.state || "Unavailable"}</dd></div><div><dt>Healthcheck</dt><dd>{service.health || "Unavailable"}</dd></div><div><dt>Exit code</dt><dd>{service.exitCode ?? "Unavailable"}</dd></div><div><dt>VPN namespace</dt><dd>{service.namespace.replaceAll("_", " ")}</dd></div></dl>
          {service.issue && <p className="warning-text">{service.issue}</p>}
        </div>)}
        <p className="muted">Only adopted services are inspected. Network references and Docker health do not prove leak-free routing or application readiness. Incorrect references require reviewed recreation; no repair runs automatically.</p>
      </div>}
      {plan && <div className="technical-card">
        <h3>Review affected services</h3>
        <p role="status">{plan.interruptionRequired ? "Pending changes have not been applied." : "The proposed settings match the inspected runtime configuration."} Preview expires {new Date(plan.expiresAt).toLocaleTimeString("en")}. Editing inputs discards it.</p>
        <ul>{plan.services.map((service) => <li key={service.name}>{service.name} · {service.running ? "running" : "stopped"}</li>)}</ul>
        <p>{plan.environmentKeys.length ? `Changed settings: ${plan.environmentKeys.join(", ")}` : "No environment changes."}</p>
        {!!plan.removedEnvironmentKeys?.length && <p className="warning-text">Settings explicitly removed: {plan.removedEnvironmentKeys.join(", ")}</p>}
        {plan.portsChanged && <><p>Port bindings will change:</p><pre className="code-block">{JSON.stringify({ before: plan.portsBefore, after: plan.portsAfter }, null, 2)}</pre></>}
        {plan.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        <label className="switch-row"><input type="checkbox" checked={applyConfirmed} onChange={(event) => setApplyConfirmed(event.target.checked)} /><span>I confirm these changes and the expected service interruption.</span></label>
        <button className="button button-filled" type="button" disabled={busy || applying || !applyConfirmed} onClick={() => void run(async () => { await api.managementApply(plan.id); setPlan(null); setApplyConfirmed(false); props.notify("Change started. Follow the operation status below."); })}>Apply confirmed change</button>
      </div>}
      {projectId && <details><summary>Reconcile Host Compose before external maintenance</summary><p>Managed changes update Docker, while you own the Host Compose/Env files. An external update can restore old settings. Paste the complete original file for a preserved review document; no host files are modified and stored credentials never leave the helper.</p><label className="text-field"><span>Complete original Compose for managed export</span><textarea maxLength={200000} rows={6} value={exportSource} onChange={event => { setExportSource(event.target.value); setExportResult(null); }} /></label><button type="button" className="button button-outlined" disabled={busy || applying || !exportSource.trim()} onClick={() => void run(async () => { const value = await api.managementAction("export", { projectId, source: exportSource }); setExportResult(value.export); })}>Review managed Compose export</button>{exportResult && <><p className="warning-text">Review only; supply redacted/runtime values locally and verify image identities before deployment.</p><pre className="code-block">{JSON.stringify(exportResult.changes, null, 2)}</pre>{exportResult.warnings.map((warning: string) => <p key={warning}>{warning}</p>)}<button type="button" className="button button-tonal" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(exportResult, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "tuniku-managed-compose-review.json"; anchor.click(); URL.revokeObjectURL(url); }}>Download complete review document</button></>}</details>}
      {exportResult && <button type="button" className="button button-outlined" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(exportResult.document, null, 2)], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "compose.managed.review.json"; anchor.click(); URL.revokeObjectURL(url); }}>Download preserved Compose (review only)</button>}
      {review && <div className="technical-card"><h3>{review.action === "recovery-complete" ? "Review manual recovery completion" : "Review recovery-container cleanup"}</h3><p>{review.effect}</p><ul>{(review.services ?? review.containers ?? []).map((service: any) => <li key={service.id ?? service.name}>{service.name}</li>)}</ul><label className="switch-row"><input type="checkbox" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} /><span>{review.action === "cleanup" ? "I confirm permanent removal of the listed stopped containers, preserving their volumes." : "I confirm completion of the inspected manual recovery without Docker changes."}</span></label><button type="button" className="button button-filled" disabled={busy || !reviewConfirmed} onClick={() => void run(async () => { await api.managementAction(review.action, { operationId: review.operationId, fingerprint: review.fingerprint, confirmed: true }); setReview(null); setReviewConfirmed(false); props.notify("Confirmed recovery action completed."); })}>Complete confirmed recovery action</button><button type="button" className="button button-text" onClick={() => { setReview(null); setReviewConfirmed(false); }}>Cancel recovery action</button></div>}
      {status.operations.filter(operation => !projectId || operation.projectId === projectId).slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5).map((operation) => <div className="technical-card" role="status" key={operation.id}><Icon name={operation.status === "succeeded" ? "check" : "warning"} /><div><strong>{operation.status.replaceAll("_", " ")}</strong><p>{operation.cleanupStatus === "completed" ? "Stopped recovery containers removed; volumes and encrypted recovery configuration preserved." : operation.cleanupStatus === "applying" ? "Confirmed recovery cleanup is running." : operation.step}</p>{operation.error && <p>{operation.error}</p>}<small>Operation {operation.id}</small>{["interrupted", "rollback_failed"].includes(operation.status) && <><p>Restore the recorded original containers and data bindings manually, then inspect them. No automatic replay or adoption of replacement identities is available.</p><button type="button" className="button button-outlined" disabled={busy} onClick={() => void run(async () => { const value = await api.managementAction("recovery-review", { operationId: operation.id }); setReview({ ...value.review, action: "recovery-complete" }); setReviewConfirmed(false); })}>Inspect repaired originals</button></>}{operation.status === "succeeded" && <button type="button" className="button button-outlined" disabled={busy || applying || operation.cleanupStatus === "applying"} onClick={() => void run(async () => { const value = await api.managementAction("cleanup-review", { operationId: operation.id }); setReview({ ...value.review, action: "cleanup" }); setReviewConfirmed(false); })}>Review stopped recovery containers</button>}{operation.cleanupStatus === "interrupted" && <p className="warning-text">Cleanup was interrupted. Inspect remaining recovery containers before confirming another cleanup.</p>}</div></div>)}
    </>}
  </section>;
}
