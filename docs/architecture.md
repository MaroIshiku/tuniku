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
                         +-- optional confirmed manager -> adopted containers
```

The default deployment has no Docker mutation path. The optional separate manager implements confirmed, bounded container recreation for explicitly adopted projects; see [managed stacks](managed-stacks.md). Neither mode exposes arbitrary Docker operations, image updates, volume deletion or `exec`. Tuniku never mounts or writes a host Compose file. The web application does not mount the
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
manual ZimaOS operation for new deployments. The optional manager can apply a separate reviewed plan to adopted existing projects without host-file access.

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


The Overview separates Control API reachability, reported VPN-process state and
Docker container state/health. None alone proves a leak-free tunnel. **Open
diagnostics and logs** opens Settings at the diagnostic heading with keyboard
focus. Docker container restart counts do not count VPN-process restarts through
the Control API. Metadata polling does not read logs; users explicitly refresh
bounded log windows, filter loaded lines locally and export redacted text. A
failed diagnostic refresh keeps last-known details visibly marked as outdated.

### Observation scheduling

Overview reads cached API status and persisted traffic every ten seconds (sixty seconds for a hidden page); Docker metadata and published ports are requested no more often than every thirty seconds. Manual Refresh requests fresh metadata. Authenticated metadata/port endpoints share an app-local, eight-entry cache with in-flight request coalescing, ten-second success TTL and two-second failure backoff. Cached responses keep the original observation timestamp. No secret values or logs enter the cache. Browser API responses retain Cache-Control: no-store.

Connection saves, credential removal, completed Control mutations and managed apply attempts invalidate the cache and reject pre-change in-flight results. External container changes become visible at the next fresh observation; cached metadata is observational, never a mutation precondition. Traffic sampling independently verifies current association and full container identity every ten seconds and never uses this cache. Logs are loaded explicitly with their bounded time/line filters and bypass the cache.

Browser API calls have a 45-second deadline covering fetch and the response body. Caller cancellation also interrupts the network request. Superseded Overview requests are aborted, connection/sign-out changes discard older data, and server suggestions retain a 250ms debounce with cancellation and result guards. Timed-out mutations are not retried automatically: the operator checks current state before repeating a change. These UI deadlines do not undo an operation already accepted by the server.
