# ZimaOS deployment notes

ZimaOS wording and controls can differ between versions. The primary
`docker-compose.yml` follows the ishiku ZimaOS installation profile:

1. Import `docker-compose.yml` as a custom stack.
2. Set `ISHIKU_SETUP_SECRET` to at least 32 random characters.
3. Confirm the `/DATA/AppData/i_tuniku/Data` host path.
   Tuniku runs as UID/GID `1000`; if needed, set ownership with
   `chown -R 1000:1000 /DATA/AppData/i_tuniku/Data`.
4. Save and deploy the Tuniku-only stack in ZimaOS. It contains no
   unconfigured Gluetun service.
5. Complete Tuniku first-run registration with the same setup value.
6. Choose **Create Gluetun configuration**, enter the VPN and Control Server
   settings in the provider-guided flow, and generate the proposal.
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

To place another application behind Gluetun:

1. Add `network_mode: "service:gluetun"` to that application service.
2. Publish its required web port on the Gluetun service.
3. Remove a conflicting port mapping from the application service.
4. Save and redeploy the stack manually.
5. Verify both the application UI and its public IP behavior.

Tuniku generates this guidance but does not save the ZimaOS stack, press
deploy, recreate containers, or authenticate to the foreign application.
