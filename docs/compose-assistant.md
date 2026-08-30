# Compose Assistant

The Compose Assistant produces proposals and downloadable text artifacts. It
does not write host files, call Docker, or redeploy a stack.

Tuniku itself can start before Gluetun is configured. On a new installation,
the Overview empty state opens this assistant directly. The generated new-setup
stack contains both Tuniku and Gluetun but does not make Tuniku startup depend
on Gluetun startup success.

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

- `docker-compose.generated.yml`
- `gluetun.optional.env`
- `secrets.README.txt`
- `tuniku-manual-steps.md`

The Compose download is the default deployment artifact. All Gluetun settings
are direct YAML scalar values; it contains no `${...}` references and does not
need the env download. The env artifact is an optional alternate representation.

Secret-bearing fields are replaced with `[REDACTED]` in both artifacts by
default. A redacted result is structurally valid YAML but is clearly marked as
not deployment-ready. The operator must either replace every marker or opt in
to include sensitive values for one response. Full-secret results expire from
the browser view after 15 minutes.

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
