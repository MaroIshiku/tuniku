# ZimaOS deployment notes

ZimaOS wording and controls can differ between versions. The primary
`docker-compose.yml` follows the ishiku ZimaOS installation profile:

1. Import `docker-compose.yml` as a custom stack.
2. Set `ISHIKU_SETUP_SECRET` to at least 32 random characters.
3. Configure the Gluetun provider, VPN type, credentials, and Control Server
   role using the current official documentation.
4. Confirm the `/DATA/AppData/i_tuniku/Data` and
   `/DATA/AppData/i_tuniku/Gluetun` host paths.
   Tuniku runs as UID/GID `1000`; if needed, set ownership with
   `chown -R 1000:1000 /DATA/AppData/i_tuniku/Data`.
5. Save and deploy the stack in ZimaOS.
6. Complete Tuniku first-run registration with the same setup value.
7. Configure `http://gluetun:8000` as the Control Server URL.

Tuniku automatically persists its internal session and credential-encryption
keys below `/data/.secrets`. No second or third Tuniku secret is needed in the
ZimaOS editor. Use `docker-compose.example.yml` only when a file-backed setup
secret is preferred.

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
