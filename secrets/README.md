# Local secret files

Create these files locally before starting the example Compose stack:

- `tuniku_registration_secret.txt` — a long random one-time setup secret.
- `tuniku_session_secret.txt` — at least 32 random bytes for signed session cookies.
- `tuniku_encryption_key.txt` — 32 random bytes encoded as Base64, or 64 hexadecimal characters.

Use restrictive file permissions such as `0600` where the host supports them.
Real secret files are ignored by Git. Never commit them.

Gluetun VPN credentials are intentionally not prescribed here. Their supported
binding depends on the Gluetun version and provider. Follow the current
[Gluetun setup documentation](https://github.com/qdm12/gluetun-wiki/tree/main/setup)
and keep real values outside the repository.
