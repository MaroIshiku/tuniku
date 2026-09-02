# ZimaOS deployment notes

ZimaOS wording and controls can differ between versions. The primary
`docker-compose.yml` follows the ishiku ZimaOS installation profile:

1. Import `docker-compose.yml` as a custom stack.
2. Set `ISHIKU_SETUP_SECRET` to at least 32 random characters.
3. Confirm the `/DATA/AppData/i_tuniku/Data` host path.
   Tuniku runs as UID/GID `1000`; if needed, set ownership with
   `chown -R 1000:1000 /DATA/AppData/i_tuniku/Data`.
4. Save and deploy the Tuniku stack in ZimaOS. It contains the application and
   its internal diagnostic helper, but no unconfigured Gluetun service.
5. Complete Tuniku first-run registration with the same setup value.
6. Choose **Create Gluetun configuration**, enter the VPN and Control Server
   settings in the provider-guided flow. Refresh and search the official server
   values where desired, then generate the validated proposal.
7. Keep the existing Tuniku stack running and import the generated
   `docker-compose.gluetun-addon.yml` as a separate stack. The add-on joins the
   external network `tuniku`; do not add a second Tuniku service or port 65001.
8. Configure `http://gluetun:8000` as the Control Server URL when prompted, or
   choose **Connect existing Gluetun** for an already running instance.

Gluetun provider and credential values are container startup configuration.
The current documented Control Server interface can read VPN settings and
change supported runtime state, but it is not a safe substitute for creating
the initial container configuration. Tuniku therefore generates the complete
proposal without receiving Docker or host-file write access.
The generated Compose uses direct scalar values and does not require an env
file; the optional env download is only a convenience copy. Secret-bearing
fields are `[REDACTED]` by default. Enable **Include secret values** for one
generation response or replace every marker before deployment. Tuniku does not
store the full-secret result in drafts, logs, or audits and removes it from the
browser after 15 minutes.

The add-on uses `qmcgaw/gluetun:latest`, a Docker-managed `gluetun_data` volume,
and the external `tuniku` network. Do not add `network_mode: bridge`: Compose
would then override the intended network attachment and Tuniku could not reach
Gluetun by service name. For Private Internet Access, use one of the searchable
`SERVER_REGIONS` values (for example `SE Stockholm`); do not add unsupported
`SERVER_COUNTRIES` or `SERVER_CITIES` variables.

If Gluetun exits, keep Tuniku running and open **Settings → Gluetun diagnostics**.
The primary stack's internal observer reports state, health, exit code, restart
count, start and finish timestamps, recognizable environment/network problems,
the final redacted logs, published Docker ports, and aggregate traffic counters.
It uses Docker inspect, logs, and one-shot stats and does not call `docker exec`;
`/bin/sh` is not present in the current Gluetun image.

The Overview distinguishes a VPN-provider forwarded port from ports published
on the Gluetun Docker service. It refreshes Docker detection every ten seconds
while visible and can show configured bindings even when Gluetun is stopped.
Traffic failures include an actionable reason instead of only an unavailable
label. Country, region, and city are displayed when the connected Gluetun
version includes them in its public-IP response.

The Overview reports combined download/upload rates, today's totals, and a
rolling 90-day total for Gluetun plus every application sharing its network
namespace. Per-application separation is not reliable in this arrangement.
Tuniku stores only aggregate byte deltas; it does not record destinations,
URLs, DNS queries, or packet contents.

The primary Tuniku Compose sets `HTTPS_ONLY=false`, so
`http://<docker-host>:65001` works on the trusted local network. Set
`HTTPS_ONLY=true` only when an HTTPS reverse proxy fronts Tuniku; this makes the
session cookie Secure. The alias `HTTPSONLY=true` is accepted for compatibility.

Tuniku automatically persists its internal session and credential-encryption
keys below `/data/.secrets`. No second or third Tuniku secret is needed in the
ZimaOS editor. Use `docker-compose.example.yml` only when a file-backed setup
secret and a preconfigured Gluetun service are preferred.

Older installations using the `tuniku_data` named volume remain supported.
Before switching them to the primary host-path Compose, stop Tuniku, back up
the volume, copy the complete `/data` contents to the new path, and retain any
legacy external encryption key while stored Gluetun credentials depend on it.

An image-only update cannot add the observer introduced by the current primary
stack. When upgrading an older single-service installation, import or replace
the complete current `docker-compose.yml`, then redeploy it. If Tuniku reports
`getaddrinfo ENOTFOUND tuniku-docker-observer`, the helper service or its
internal network has not been created from that Compose.

To place another application behind Gluetun in the same Compose project:

1. Add `network_mode: "service:gluetun"` to that application service.
2. Publish its required web port on the Gluetun service.
3. Remove a conflicting port mapping from the application service.
4. Save and redeploy the stack manually.
5. Verify both the application UI and its public IP behavior.

Tuniku generates this guidance but does not save the ZimaOS stack, press
deploy, recreate containers, or authenticate to the foreign application.

For an application kept in a separate ZimaOS/Compose stack, use
`network_mode: "container:gluetun"` instead of `service:gluetun`. Publish its
required UI port on the Gluetun service in either arrangement.
