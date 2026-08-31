# Compose Assistant

The Compose Assistant produces proposals and downloadable text artifacts. It
does not write host files, call Docker, or redeploy a stack.

Tuniku itself starts before Gluetun is configured. On a new installation, the
Overview empty state opens this assistant directly. The generated primary
artifact is a separate Gluetun-only add-on stack. It attaches to the existing
external Docker network named `tuniku`; it does not duplicate the running
Tuniku service or bind host port 65001 a second time.

## Input handling

- Input is limited to 1 MiB.
- YAML is parsed with strict duplicate-key checking.
- Pasted content is never executed or interpolated.
- Sensitive key names and authorization text are redacted.
- Secret form fields remain in React memory and request scope by default.
- Saved drafts contain only redacted input and output.

## Output contract

Every generation result contains detected configuration, a recommended change,
copy-paste snippets, ordered manual steps, and security warnings.

New Tuniku setup fragments expose one `ISHIKU_SETUP_SECRET` placeholder.
Tuniku persists its internal session and credential-encryption keys under
`/data/.secrets`; generated fragments do not ask users to create two unrelated
additional Tuniku secrets.

Available downloads:

- `docker-compose.gluetun-addon.yml` for the guided new setup
- `gluetun.optional.env`
- `secrets.README.txt`
- `tuniku-manual-steps.md`

The Compose download is the default deployment artifact. All Gluetun settings
are direct YAML scalar values; it contains no `${...}` references and does not
need the env download. The env artifact is an optional alternate representation.

Secret-bearing fields are `[REDACTED]` by default. Before deployment, either
enable **Include secret values** for one generation response or replace every
marker manually. A full-secret result remains only in the current request and
browser result and is removed after 15 minutes. Saved drafts, logs, audit
events, diagnostics, and Compose inspection always redact sensitive values.

The YAML output is parsed again before the result is marked valid. Host ports
found in pasted Compose content are compared with planned mappings.

## Guided Gluetun configuration

The provider dropdown follows the provider constants and official walkthroughs
for `qmcgaw/gluetun:latest`. Tuniku offers only the OpenVPN and native WireGuard
choices supported for the selected provider. The form then requests the
applicable connection data:

- WireGuard private key and address, plus AirVPN's preshared key or all custom
  endpoint values where required.
- OpenVPN manual credentials, provider certificates and keys, or a read-only
  custom configuration-file mount where required.
- Only the server filters and provider-specific options documented for that
  provider and protocol.
- Control Server authentication for a complete new setup.

For example, Private Internet Access presents `SERVER_REGIONS`, `SERVER_NAMES`,
and `SERVER_HOSTNAMES`; it does not offer the unsupported generic country or
city fields. Region `SE Stockholm` is valid in the bundled current catalog,
whereas `Stockholm` by itself is rejected before Compose is generated.

Each supported server filter is a searchable input backed by a compact snapshot
of the official [`qdm12/gluetun-servers`](https://github.com/qdm12/gluetun-servers)
dataset. **Refresh server data** retrieves the selected provider's current JSON
directly from that repository, validates and bounds it, and writes a local cache
under `/data/server-catalog`. The bundled snapshot remains available offline.

This is the bootstrap path: Tuniku does not need to run a fake Gluetun service
or invent temporary credentials. It can validate provider values before the
real Gluetun container exists. The generated service then uses a Docker-managed
`gluetun_data:/gluetun` volume, avoiding first-start bind-directory ownership
problems, and joins the existing external `tuniku` network without a conflicting
`network_mode` value.

The API validates the same provider schema, protocol compatibility, current
server values, required fields, exact environment names, provider-option values,
ports, input sizes, and accepted field names. The rendered YAML is parsed again
before it is marked valid. The browser is not the security boundary.

## Supported Gluetun variables

Tuniku uses only established names such as `VPN_SERVICE_PROVIDER`, `VPN_TYPE`,
the supported subset of `SERVER_COUNTRIES`, `SERVER_REGIONS`, `SERVER_CITIES`,
`SERVER_HOSTNAMES`, `SERVER_NAMES`, `SERVER_CATEGORIES`, and `ISP`, plus the
protocol credentials and provider-specific options shown by the guided flow.
The generator emits `qmcgaw/gluetun:latest` with `pull_policy: always` as an
explicit product requirement.

Because `latest` is mutable, support and exact binding behavior can change
between Tuniku releases. The refresh action updates server values, while changes
to provider-required variables still require a Tuniku schema update and its
release checks. Custom advanced values are presented as user-owned input;
Tuniku does not claim that unknown keys are supported.
