# Architecture

Tuniku is one container with a typed React frontend, a Fastify REST API, a
Gluetun adapter, Compose generation domain logic, and SQLite persistence.
Gluetun is always a separate service.

## Boundaries

```text
browser -> Tuniku UI -> Tuniku REST API -> Gluetun adapter -> Control Server
                         |                 |
                         |                 +-- documented /v1 routes only
                         +-- SQLite
                         +-- provider schema + official server catalog
                         +-- generation-only Compose Assistant
                         +-- fixed client -> internal observer -> Docker socket
```

Tuniku has no code path for Docker container creation, restart, update, delete,
network mutation, volume mutation, image mutation, or `exec`. It never mounts a
host Compose file and never writes one. The web application does not mount the
Docker socket. The primary deployment's separate observer helper mounts it and
accepts only fixed GET routes for Gluetun list, inspect, bounded logs, and
aggregate one-shot stats.

## First-run boundary

The primary ZimaOS deployment starts the Tuniku application and its isolated
diagnostic helper, but no Gluetun service, so missing Gluetun provider
credentials cannot block it or create a Gluetun restart loop.
After the administrator account is created, the empty state offers
two explicit paths: generate a new Gluetun Compose proposal or connect an already
running Control Server.

Provider selection and VPN credentials are Gluetun startup configuration, not
Control Server runtime settings. Tuniku therefore collects them in the
authenticated Compose Assistant and produces reviewable standalone Compose
text. The generated Compose contains direct values and does not require an env
file; a separate env export is optional. Applying that proposal remains a
manual ZimaOS operation; Tuniku does not gain Docker mutation or host-file
access.

## Provider data bootstrap

Tuniku carries a compact licensed snapshot of the official
`qdm12/gluetun-servers` data, split by provider and VPN protocol. Authenticated
administrators can refresh one provider at a time from the fixed official raw
GitHub origin. Downloads have time, byte, record, and value-length bounds and
are written atomically under `/data/server-catalog`.

This removes the circular dependency between configuring and starting Gluetun:
no fake production service or credentials are needed. Provider requirements
come from the official walkthrough schema; current location choices come from
the server dataset. Generated Compose uses `qmcgaw/gluetun:latest`, a named
`/gluetun` volume, and the existing external `tuniku` network.

## Docker diagnostics boundary

The optional observer helper has no published port and joins only the internal
`tuniku_observer` network shared with Tuniku. It locates a Gluetun container and
returns a reduced inspect response. All environment values except the provider
and VPN type are removed before leaving the helper. Log output is bounded and
redacted again by Tuniku before reaching the browser.

The stats route reduces Docker's response to container ID, aggregate received
bytes, aggregate sent bytes, and observation time. Tuniku persists positive
deltas by local day for 90 days. It cannot attribute traffic to individual
applications sharing the Gluetun network namespace and does not collect packet
or destination metadata.

The public-IP adapter accepts Gluetun's optional country, region, and city
fields in the same `/v1/publicip/ip` response. No independent geolocation API is
queried. Docker port discovery reads runtime bindings and uses configured host
bindings as a fallback when a stopped container has no runtime port map.

The helper does not expose arbitrary Docker paths or methods. It has no route
for `exec`, container lifecycle, images, volumes, networks, archives, or build.
Failure of the helper returns an unavailable diagnostic response and never
becomes a Tuniku health or startup dependency.

## Gluetun adapter

Read routes:

- `GET /v1/vpn/status`
- `GET /v1/vpn/settings`
- `GET /v1/publicip/ip`
- `GET /v1/dns/status`
- `GET /v1/updater/status`
- `GET /v1/portforward`

Allow-listed mutations:

- `PUT /v1/vpn/status`
- `PUT /v1/dns/status`
- `PUT /v1/updater/status`
- `PUT /v1/portforward`

The adapter validates schemas, distinguishes authentication, authorization,
timeout, TLS, unreachable, unsupported, and schema-change failures, and never
returns optimistic success.

## Persistence

Migration version 4 contains:

- Local administrator accounts.
- Server-side sessions with 30-minute idle expiry, 24-hour absolute expiry,
  recent password confirmation, and revocation of other sessions.
- Gluetun instance preferences and encrypted optional credentials.
- Local port labels.
- Redacted Compose drafts.
- Redacted audit events correlated with stable API request IDs.
- Current aggregate Docker traffic counters and rolling daily byte totals.

All instance-related entities use an instance identifier even though version 1
shows one active instance.

Runtime cookie-signing and credential-encryption keys live under
`/data/.secrets` by default. They are created atomically with restrictive file
permissions, persist across container replacement, and are covered by the same
backup and restore boundary as the database. Legacy runtime overrides are read
before these managed files for deployment compatibility.

## Polling

The server refreshes the configured Gluetun instance every 10 seconds. The
browser requests cached state every 10 seconds while visible and every 60
seconds in the background. Data older than 45 seconds is marked stale. When the
observer is configured, a separate optional 10-second poll records aggregate
Gluetun network counters; failures do not affect either service's health.
