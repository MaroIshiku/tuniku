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
                         +-- generation-only Compose Assistant
```

Tuniku has no code path for Docker container creation, restart, update, delete,
network mutation, volume mutation, image mutation, or `exec`. It never mounts a
host Compose file and never writes one.

## First-run boundary

The primary ZimaOS deployment contains and starts only Tuniku, so missing
Gluetun provider credentials cannot block it or create a Gluetun restart loop.
After the administrator account is created, the empty state offers
two explicit paths: generate a new Gluetun Compose proposal or connect an already
running Control Server.

Provider selection and VPN credentials are Gluetun startup configuration, not
Control Server runtime settings. Tuniku therefore collects them in the
authenticated Compose Assistant and produces reviewable standalone Compose
text. The generated Compose contains direct values and does not require an env
file; a separate env export is optional. Applying that proposal remains a manual ZimaOS operation; Tuniku does not
gain Docker-socket or host-file access.

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

Migration version 3 contains:

- Local administrator accounts.
- Server-side sessions with 30-minute idle expiry, 24-hour absolute expiry,
  recent password confirmation, and revocation of other sessions.
- Gluetun instance preferences and encrypted optional credentials.
- Local port labels.
- Redacted Compose drafts.
- Redacted audit events correlated with stable API request IDs.

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
seconds in the background. Data older than 45 seconds is marked stale.
