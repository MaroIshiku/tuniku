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

The provider dropdown is pinned to Gluetun `v3.41.3`. Tuniku offers only the
OpenVPN and native WireGuard choices supported for the selected provider in
that release. The form then requests the applicable connection data:

- WireGuard private key and address, plus AirVPN's preshared key or all custom
  endpoint values where required.
- OpenVPN manual credentials, provider certificates and keys, or a read-only
  custom configuration-file mount where required.
- Optional country, region, and city filters.
- Control Server authentication for a complete new setup.

The API validates the same catalog, protocol compatibility, required fields,
ports, input sizes, and accepted field names. The browser is not the security
boundary.

## Supported Gluetun variables

Tuniku uses only established names such as `VPN_SERVICE_PROVIDER`, `VPN_TYPE`,
`SERVER_COUNTRIES`, `SERVER_REGIONS`, `SERVER_CITIES`,
`WIREGUARD_PRIVATE_KEY`, `WIREGUARD_ADDRESSES`, `OPENVPN_USER`,
`OPENVPN_PASSWORD`, the provider-specific certificate/key and custom endpoint
variables shown by the guided flow, and
`HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE`.

Support and exact binding behavior can change between Gluetun releases. Verify
the generated fragment against the current official documentation before
deployment. Custom advanced values are presented as user-owned input; Tuniku
does not claim that unknown keys are supported.
