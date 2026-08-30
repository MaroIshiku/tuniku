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

## Upstream validation

Tuniku accepts only HTTP and HTTPS base URLs without embedded credentials,
queries, or fragments. It resolves the destination and blocks cloud metadata,
link-local, unspecified, multicast, and loopback addresses by default.
Private Docker and LAN addresses remain valid because Gluetun is normally
self-hosted.

Loopback can be allowed only with the explicit
`TUNIKU_ALLOW_LOOPBACK_UPSTREAM=true` advanced setting.

## Control allow-list

No caller supplies an arbitrary Gluetun method or path. Every operation maps to
a compile-time allow-list. Provider, VPN type, server location, credential,
published port, Docker Secret, and foreign-container changes are generation
tasks rather than live mutations.

## Deployment

The example container runs as the unprivileged `node` user, supports a
read-only root filesystem, writes only `/data` and `/tmp`, and has no Docker
socket. Use a trusted HTTPS reverse proxy for access outside a trusted network.
