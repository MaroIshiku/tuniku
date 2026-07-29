# Compose Assistant

The Compose Assistant produces proposals and downloadable text artifacts. It
does not write host files, call Docker, or redeploy a stack.

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

Available downloads:

- `docker-compose.example.yml`
- `.env.example`
- `secrets.README.txt`
- `tuniku-manual-steps.md`

The YAML output is parsed again before the result is marked valid. Host ports
found in pasted Compose content are compared with planned mappings.

## Supported Gluetun variables

Tuniku uses only established names such as `VPN_SERVICE_PROVIDER`, `VPN_TYPE`,
`SERVER_COUNTRIES`, `SERVER_REGIONS`, `SERVER_CITIES`,
`WIREGUARD_PRIVATE_KEY`, `WIREGUARD_ADDRESSES`, `OPENVPN_USER`,
`OPENVPN_PASSWORD`, and `HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE`.

Support and exact binding behavior can change between Gluetun releases. Verify
the generated fragment against the current official documentation before
deployment. Custom advanced values are presented as user-owned input; Tuniku
does not claim that unknown keys are supported.
