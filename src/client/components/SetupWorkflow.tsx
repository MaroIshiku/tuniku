import type { Instance, Overview } from "../lib/models.js";

export type SetupStep = "vpn" | "application" | "verify";
const steps: Array<{ id: SetupStep; label: string }> = [{ id: "vpn", label: "Set up VPN" }, { id: "application", label: "Connect application" }, { id: "verify", label: "Verify" }];

export function SetupWorkflow(props: {
  routingScope?: string;
  step: SetupStep; onStep: (step: SetupStep) => void; prepared: boolean;
  instance: Instance | null; overview: Overview | null; requestError: string; loading: boolean;
  onSettings: () => void; onRefresh: () => void; onPorts: () => void;
}) {
  const observation = props.overview;
  const timestamp = Date.parse(observation?.lastUpdatedAt ?? "");
  const fresh = Boolean(observation && observation.instanceId === props.instance?.id && !observation.stale && !props.requestError && Number.isFinite(timestamp) && Date.now() - timestamp <= 60_000);
  const connected = fresh && observation?.connected;
  return <section className="content-card setup-workflow" aria-labelledby="setup-workflow-title">
    <div className="content-card-header"><div><span className="eyebrow">Guided setup</span><h2 id="setup-workflow-title">Your VPN setup</h2></div></div>
    <p>Prepare the VPN, attach your application, then check the deployed result. Exports do not deploy changes. Managed changes require a separate reviewed plan and confirmation.</p>
    <nav aria-label="VPN setup progress"><ol className="setup-progress">{steps.map((step, index) => <li key={step.id}><button type="button" className={`button ${props.step === step.id ? "button-tonal" : "button-outlined"}`} aria-current={props.step === step.id ? "step" : undefined} onClick={() => props.onStep(step.id)}>{index + 1}. {step.label}</button></li>)}</ol></nav>
    {props.step === "vpn" && <>
      <h3>Prepare and deploy the VPN</h3><p>Complete the provider fields below and generate guidance. Review the result, replace redacted values, and deploy the Gluetun add-on beside Tuniku. Existing VPNs can connect through Settings.</p>
      <p role="status">{props.prepared ? "Configuration prepared. Deployment and VPN verification are still pending." : "Generate and review a configuration before deployment, or connect an existing VPN."}</p>
      <div className="button-row wrap"><button type="button" className="button button-tonal" onClick={props.onSettings}>Connect Control Server</button><button type="button" className="button button-outlined" onClick={() => props.onStep("application")}>Next: connect an application</button></div>
    </>}
    {props.step === "application" && <>
      <h3>Prepare application routing</h3><p>{props.routingScope === "separate_project" ? "For separate projects, merge the application fragment into its original application project and the VPN-port fragment into the original VPN project. Use the exact existing VPN container name. Preserve volumes and download paths. Start and check the VPN first, then recreate the application with its container reference; repeat this sequence after VPN replacement." : "For the same Compose project, merge the routing fragment into the complete original stack. Preserve volumes and download paths, then recreate the VPN and affected applications together."}</p>
      <p>VPN replacement can interrupt the application and invalidate its network reference. Inspect adopted applications in managed diagnostics; no automatic repair is triggered by this guide.</p>
      <div className="button-row wrap"><button type="button" className="button button-outlined" onClick={props.onPorts}>Inspect application ports</button><button type="button" className="button button-tonal" onClick={() => props.onStep("verify")}>Next: verify deployment</button></div>
    </>}
    {props.step === "verify" && <>
      <h3>Check the deployed result</h3>
      {(props.requestError || observation?.error || observation?.stale) && <p className="inline-banner warning" role="alert">{props.requestError || observation?.error?.message || "The last observation is outdated."} Refresh after checking Control Server access and authentication. Displayed values may be outdated.</p>}
      <div className="technical-card"><dl>
        <div><dt>Control Server</dt><dd>{!props.instance ? "Not configured" : connected ? "Control Server response received" : "No current successful check"}</dd></div>
        <div><dt>VPN process</dt><dd>{connected ? observation?.vpn?.status || "Unavailable" : "Unavailable or outdated"}</dd></div>
        <div><dt>Observed public IP</dt><dd>{connected ? observation?.publicIp?.publicIp || "Unavailable" : "Unavailable or outdated"}</dd></div>
        <div><dt>Last successful observation</dt><dd>{connected ? new Date(timestamp).toLocaleString("en") : "No current successful check"}</dd></div>
      </dl></div>
      <p>These are Gluetun observations. They do not prove that your application uses this VPN or that DNS and IPv6 are leak-free.</p>
      <ol className="steps-list"><li>Refresh and confirm the intended VPN process and public IP.</li><li>Inspect the application's actual network reference and published ports. Then open its UI and check its public IP from the application.</li><li>Test DNS and IPv6 behavior, VPN outage and recovery before relying on the route. Keep application downloads and data unchanged.</li></ol>
      <div className="button-row wrap"><button type="button" className="button button-filled" disabled={!props.instance || props.loading} onClick={props.onRefresh}>{props.loading ? "Checking deployment" : "Refresh deployment checks"}</button><button type="button" className="button button-outlined" onClick={props.onSettings}>Review connection settings</button><button type="button" className="button button-outlined" onClick={props.onPorts}>Inspect application ports</button></div>
    </>}
    <p className="muted">Resume this step while navigating in this tab. Save a redacted draft below to retain non-secret settings across sessions; opening it requires review and credentials again.</p>
  </section>;
}
