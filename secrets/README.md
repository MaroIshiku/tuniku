# Local secret files

The hardened example Compose stack needs one local file:

- `setup_secret.txt` — at least 32 random characters for one-time administrator setup.

Generate it with `openssl rand -base64 48 > secrets/setup_secret.txt` and use
restrictive file permissions such as `0600`. Tuniku creates its session and
credential-encryption keys under `/data/.secrets` on first start, so they
follow the normal data backup.

Existing installations may keep their legacy session and encryption secret
files as runtime overrides. Keep the previous encryption key while any stored
Gluetun credential still depends on it. Real secret files are ignored by Git.
Never commit them.

Gluetun VPN credentials are intentionally not prescribed here. Their supported
binding depends on the Gluetun version and provider. Follow the current
[Gluetun setup documentation](https://github.com/qdm12/gluetun-wiki/tree/main/setup)
and keep real values outside the repository.
