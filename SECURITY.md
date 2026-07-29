# Security policy

## Supported versions

Security fixes target the current `main` branch and the latest tagged release.

## Report a vulnerability

Do not open a public issue containing credentials, private topology, exploit
details, or affected deployment data. Use GitHub's private vulnerability
reporting for this repository when available.

Include:

- A concise impact description.
- The affected Tuniku version or Git SHA.
- Reproduction steps using redacted values.
- Whether the issue affects authentication, secret handling, SSRF protection,
  the Gluetun control allow-list, or Compose parsing.

## Deployment responsibility

Tuniku is designed for self-hosted environments. Operators remain responsible
for HTTPS termination, network access control, backups, current container
images, Gluetun role configuration, and keeping secrets out of repositories.
