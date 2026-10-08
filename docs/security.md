# Security model

## Protected assets

- Tuniku administrator sessions and password hashes.
- Gluetun Control Server credentials.
- VPN provider credentials and WireGuard private keys.
- Snippets containing secret values.
- Local network and deployment topology.

## Authentication

First-run registration requires a server-side setup secret of at least 32
characters. The first
administrator password must contain at least 12 characters and differ from the
setup secret, username, app name, and common placeholder passwords.

Passwords use Argon2id. Sessions use random opaque tokens, store only their
SHA-256 hash in SQLite, and use signed HttpOnly SameSite=Lax cookies. Mutating
requests require the session-specific CSRF token.

Sessions expire after 30 minutes without activity and always expire after 24
hours. The Settings sheet shows the current session and the number of other
active sessions. Revoking other sessions requires a recent password
confirmation. Sign-in, re-authentication, revocation, and other audited actions
carry the server request ID so an operator can correlate a safe API error with
redacted audit evidence.

New installations provide only `ISHIKU_SETUP_SECRET`. Tuniku atomically
creates its cookie-signing secret with mode `0600` under
`/data/.secrets/session-secret` and reuses it across restarts. Existing
file-backed and environment-based session overrides remain compatible.

## Credential storage

Gluetun credentials are ephemeral by default. Tuniku creates a persistent
32-byte encryption key under `/data/.secrets/credential-encryption-key` and
uses AES-256-GCM with a random nonce when an administrator explicitly enables
credential persistence. Legacy external encryption-key overrides remain
supported. Stored credentials are never returned to the browser.
Blank credential fields preserve an existing saved credential only for the same
destination and authentication mode. Changing either clears that association.
Disabling persistence removes the encrypted database record while retaining the
current credential in memory until restart or explicit deletion.

## Upstream validation

Tuniku accepts only HTTP and HTTPS base URLs without embedded credentials,
queries, or fragments. It resolves the destination and blocks cloud metadata,
link-local, unspecified, multicast, and loopback addresses by default.
Private Docker and LAN addresses remain valid because Gluetun is normally
self-hosted.
The socket's DNS lookup is validated as well as the initial URL check, including
IPv4-mapped IPv6 destinations. Upstream redirects are rejected rather than
forwarding credentials to another destination, and response bodies are bounded
while streaming. API responses use `Cache-Control: no-store`.

Loopback can be allowed only with the explicit
`TUNIKU_ALLOW_LOOPBACK_UPSTREAM=true` advanced setting.

## Control allow-list

No caller supplies an arbitrary Gluetun method or path. Every operation maps to
a compile-time allow-list. Provider, VPN type, server location, credential,
published port, Docker Secret, and foreign-container proposals remain export tasks in the default deployment. The optional manager separately supports confirmed startup configuration and published-port changes for adopted projects; it never extends the Gluetun runtime allowlist.

## Docker observation

The primary deployment isolates Docker access in `tuniku-docker-observer`; the
Tuniku web application never mounts `/var/run/docker.sock`. The helper has no
host port, is reachable only on an internal Docker network, accepts GET only,
and recognizes only these operations for the discovered Gluetun container:

- list containers to locate Gluetun;
- inspect Gluetun;
- read a bounded 1–1000-line Gluetun log window with validated past timestamps;
- read one one-shot Docker Stats response and return only aggregate receive and
  send byte counters.

The inspect response drops environment values except `VPN_SERVICE_PROVIDER`
and `VPN_TYPE`; Tuniku exposes only environment names and redacts bounded log
text. No `exec`, container mutation, archive, image, build, volume, network, or
general Docker forwarding route exists.

Traffic accounting records only positive aggregate byte deltas grouped by
local day, plus the current counter/rate state. Daily totals older than 90 days
are deleted. Tuniku does not capture destinations, URLs, DNS queries, packet
contents, credentials, or a per-application identity. All applications sharing
Gluetun's network namespace are necessarily combined. Counter resets and
container replacements establish a new baseline and do not add a synthetic
delta. Poll failures are reported to the authenticated Overview but remain
ignored for application and Gluetun availability purposes.

Tuniku does not send the VPN public IP to an additional geolocation service.
Optional country, region, and city display values are accepted only from the
already configured Gluetun Control Server response and are length bounded.

A read-only Unix-socket mount does not enforce read-only Docker API semantics.
The security control is therefore the helper's small allow-listed implementation
and isolation from every container except Tuniku. Compromise of the helper would
still reach a privileged host interface, so deployments that do not need
Docker-level failure diagnostics should omit it and leave
`TUNIKU_DOCKER_PROXY_URL` unset.

## Provider catalog refresh

Catalog refreshes use a fixed HTTPS origin and provider identifier selected from
Tuniku's schema, not a caller-supplied URL. Responses are limited to 16 MiB and
100,000 records, parsed as JSON, compacted to bounded string values, and written
atomically with owner-only permissions. The bundled catalog remains the fallback
if refresh is unavailable.

## Deployment

The Tuniku application runs as the unprivileged `node` user, supports a read-only
root filesystem, writes only `/data` and `/tmp`, and has no Docker socket. The
observer helper runs separately with all Linux capabilities dropped and a
read-only root filesystem. Use a trusted HTTPS reverse proxy for access outside
a trusted network.

## Recovering unreadable saved connection access

Settings diagnostics distinguish memory-only access, readable stored access and
unreadable stored access without returning credentials, ciphertext or key values.
Memory-only credentials disappear after a Tuniku restart. They do not repair an
unreadable stored record.

If stored credentials cannot be decrypted, preserve the database and key files.
Do not delete the database, generate a replacement key over the original, or reset
administrator accounts. Stop Tuniku before restoring a matching database and
`/data/.secrets/credential-encryption-key` backup, including the original legacy
key override if one was used. Keep restrictive file permissions. Restart and test
the saved connection. Alternatively, enter new provider Control Server credentials,
test them without saving, and explicitly save them to replace only that connection's
encrypted record. VPN configuration, downloads and other application data remain
untouched. Verify backup restoration on an isolated installation before relying on
it for production recovery.

### Dependency remediation, 2026-10-06

The lockfile updates vulnerable Fastify, Undici, fast-uri, brace-expansion and
source-map-js versions within their supported dependency ranges. A targeted
shell-quote 1.11.0 override fixes concurrently's exact vulnerable transitive pin
without a major downgrade of the development runner. MIT/BSD license metadata
was checked in the npm registry. `npm audit` reported zero known vulnerabilities
following installation; runtime, security and build checks remain mandatory.
Rollback requires restoring only this remediation's package/lockfile changes,
then reinstalling the previous lockfile; it reintroduces the reported advisories.

## Optional manager

The separately authenticated manager has a bounded mutation API and an internal network, with explicit project and data-root allowlists. Tuniku never receives the Docker socket. Encrypted recovery records and their original key must be backed up together. See [Managed stacks](managed-stacks.md) for deployment boundaries, interruption handling and manual recovery.

## Direct local HTTP

Open `http://<NAS-IP>:65001` with the primary Compose deployment. `HTTPS_ONLY=false` is the default and supports signing in over HTTP on a trusted local network. No certificate or reverse proxy is required. Session cookies remain HttpOnly and SameSite-protected; authenticated writes still require CSRF tokens. HTTP mode does not enable HSTS or upgrade-insecure-requests. Copy actions use the browser-compatible fallback when the secure Clipboard API is unavailable.

For HTTPS behind a reverse proxy, set `HTTPS_ONLY=true` and recreate Tuniku. This enables Secure cookies, HSTS and resource-upgrade policy; it does not issue a certificate. Return to `HTTPS_ONLY=false` and recreate the application when switching an existing installation back to direct LAN HTTP.

## Observer health

Observer `/health` reports process liveness independently of Docker. `/readyz` makes one bounded read-only Docker ping and returns 503 if the socket is missing, inaccessible or Docker is unavailable. The primary Compose checks observer readiness while Tuniku has no dependency on that result. App `/readyz` is the common Dockerfile/Compose readiness check; app `/health` remains available for liveness. Observer JSON-file logs rotate at 5 MiB with three files.


The observer refuses multiple eligible Gluetun targets with an actionable
ambiguity error. Label exactly one intended container `com.ishiku.tuniku.role=gluetun`.
Without an explicit role, only a single detected candidate is accepted. Retained
stopped manager recovery containers are excluded. No inspect, logs or stats
operation follows an ambiguous selection. This does not establish that a saved
Control Server URL belongs to the selected Docker container; multiple VPN
instances still require operator review.


API-instance attribution now compares every resolved Control API address and its
port with the selected container's direct network addresses or explicit non-wildcard
Control-port host bindings. Names alone, wildcard host bindings, TLS/path proxies
and older helpers without Control-port metadata cannot establish this association.
Use `http://gluetun:8000` on the shared network for the usual direct setup. Docker
metadata and logs remain separately labeled when association is unverified; ports
and traffic are not attributed to that API instance. Traffic collection checks the
full Docker identity again and rejects a changed saved connection before storing
counters. History is observer-wide across container replacements, and stays hidden
until the current connection has a verified sample. This is a configuration/IP
association within the trusted Docker and DNS boundary, not cryptographic attestation.

Overview polling requests metadata without logs. Log windows use only fixed GET
Docker operations: stdout/stderr and timestamps, tail 1–1000, optional validated
past Unix-second start/end. Streaming/follow is unavailable. Transport output stays
bounded to 512 KiB and displayed text to 256 KiB. Sensitive fields, URL credentials
and ANSI escapes are cleaned before returning logs; filtering and export operate
on that cleaned text. Failed refreshes retain a visible stale-data warning and
prevent export until a successful refresh.


### Traffic measurement scope and sample quality

The source is the fixed Docker Stats GET operation and the sum of receive/transmit
byte counters from all reported interfaces, including the older single-network
response shape. [Docker documents per-interface networking statistics](https://docs.docker.com/reference/api/engine/version-history/).
These are container-network counts. Shared applications, tunnel overhead,
Control API traffic and multiple-interface counting may be included. Tuniku
labels them **Container network traffic**, not VPN payload or provider billing
usage. Missing, negative, fractional and unsafe aggregate counters are rejected;
no missing measurement is converted into a measured zero.

Live interval rates require two comparable samples from the same container,
with increasing timestamps and at most 30 seconds between them. Baselines,
container replacements, counter resets and longer gaps expose explicit sample
quality and suppress live rates. A continuous sample with unchanged counters
can legitimately measure zero. Positive deltas over a gap still contribute to
tracked totals; resets never manufacture a positive delta. Late/repeated samples
cannot move the baseline backwards. After restart, stored rates have unknown
quality until a fresh sample establishes comparability.

Daily allocation across local midnight is a time-proportional estimate, because
Docker does not reveal when bytes moved within the sampling interval. Rounding
preserves the interval delta; local daylight-saving boundaries use their actual
elapsed duration. History covers today and the preceding 89 local calendar days.
An old portion of a long gap falls outside that retained window. Existing stored
history is not redistributed, and the SQLite schema stays unchanged. Totals do
not include activity before the initial baseline, counter-reset losses or bytes
not returned by Docker. No destinations, DNS queries or packet contents are
collected.

### Daily history

Overview's expandable daily history uses the existing authenticated traffic response and stored aggregate rows, newest first, within today plus 89 preceding server-local calendar days. The server time zone is shown; the browser does not reinterpret dates in its own zone. Days without a stored sample are omitted, not recorded as zero. Values are sampled counter deltas with time-proportional midnight allocation, not a complete provider usage record. History spans previously observed containers and connections and is not partitioned per application or connection. No additional traffic contents are collected. Cached history remains labelled when refresh fails.

## Connection credential lifetime

| Action | Credential lifetime |
| --- | --- |
| Test connection with unsaved inputs | Used for that test; does not replace saved settings or server-memory access. |
| Save with credential storage off | The current credential is held in Tuniku server memory until its process restarts or the stored-credential clear action is used. Browser reload, sign-out and Assistant cleanup do not erase server memory. |
| Save with encrypted credential storage on | Encrypted database record survives restart with the original encryption key. Blank fields retain it only for the same URL and authentication mode. |
| Disable credential storage | Removes the encrypted record while retaining readable current access in server memory until restart or explicit clear. |
| Change URL or authentication mode | Old credential association is cleared; enter credentials for the new destination. |
| Clear stored credential | Removes the encrypted record and current server-memory access; re-enter credentials before testing. |

An isolated integration test restarts Tuniku against a synthetic Control API and real SQLite database to verify transient loss, persistent recovery, wrong-key diagnosis and recovery with the original key. A wrong key never resets accounts or deletes encrypted records. This test demonstrates application restart behavior; it does not prove a NAS backup/restore or Docker host restart.

## User activity and idle sessions

Background status, traffic, log, catalog and session reads never update the idle deadline. The signed-in visible tab reports trusted pointer, keyboard and wheel interactions through an authenticated, CSRF-protected activity endpoint, coalesced over at most 15 seconds. There is no periodic keepalive. Applications using the API must explicitly report interactive activity; ordinary polling is insufficient. This is a user-interface activity signal, not proof that a human is present or a defense against malicious software with valid session access. Expired sessions cannot be renewed, and password confirmation for sensitive actions does not reset the current session's absolute 24-hour limit. An authentication-required response clears tab session data and unsaved sensitive forms and returns to sign-in. Save redacted drafts to retain non-secret settings before leaving the application idle.

Offline password recovery is documented in [Local administrator recovery](local-admin-recovery.md). TOTP and one-time recovery codes remain deferred; local recovery does not waive the release security baseline.


## Bounded local history

Audit history is automatically limited to 90 days and the newest 10,000 events, on startup, after every audit insert and during ten-minute maintenance. Back up protected history before deploying this approved retention policy if older events are needed. Sessions retain their existing idle/absolute deadlines; maintenance removes expired records. Rate limiters retain their bounded, fail-closed key policy.

Saved drafts are never automatically deleted. New saves are refused above 1,000 records or 25 MiB of serialized input/output UTF-8 bytes. Existing over-limit drafts remain accessible. Single and bulk draft deletion require UI confirmation and authenticated CSRF protection; deletion and secret-free audit commit atomically.
