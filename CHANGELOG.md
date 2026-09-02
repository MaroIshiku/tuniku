# Changelog

All notable changes to Tuniku will be documented here.

## [0.3.5] - 2026-09-02

### Added

- Added optional country, region, and city display from Gluetun's existing
  public-IP response without sending the VPN IP to another geolocation service.
- Added actionable traffic-counter reasons for a missing observer, stopped
  Gluetun container, failed Docker Stats call, or absent network counters.

### Fixed

- Separated VPN-provider port forwarding from Docker-published ports in the
  Overview and refreshed Docker port detection every ten seconds.
- Added configured Docker port-binding fallback for stopped containers and a
  generated Gluetun role label for deterministic observer selection.
- Added a compatible Docker Stats fallback for daemons that reject `one-shot`.
- Rebalanced the wide Overview into two rows so long IP, port, and traffic
  values remain readable at 1920×1080.

## [0.3.4] - 2026-09-01

### Added

- Added privacy-preserving aggregate Gluetun download/upload rates, current-day
  totals, and rolling 90-day totals using one-shot Docker Stats.
- Added automatic display of Docker ports published on the Gluetun container.

### Fixed

- Accepted the current Gluetun Control Server mutation response field
  `outcome`, while retaining compatibility with older `status` responses.
- Treated Gluetun's no-forwarding response (`port: 0`, `ports: null`) as a valid
  empty port list instead of an unrecognized response.
- Replaced raw observer DNS failures with instructions to redeploy the complete
  current Compose, which creates the observer service and internal network.

### Security

- Kept traffic observation behind a fixed GET-only observer route and retained
  only aggregate byte deltas; Tuniku does not capture destinations, URLs, DNS
  queries, credentials, or packet contents.

## [0.3.3] - 2026-08-31

### Changed

- Added 30-minute idle and 24-hour absolute session expiry.
- Added password-confirmed revocation of other active sessions in Settings.
- Added request IDs to API error envelopes and security audit events.
- Changed the guided new setup to generate a separate Gluetun-only add-on for
  the already-running Tuniku stack and its external `tuniku` network.
- Added `HTTPS_ONLY=false` as the trusted-LAN HTTP default, with opt-in Secure
  cookies behind an HTTPS reverse proxy.
- Preserved redacted generated credentials by default with an explicit,
  short-lived full-secret output option.
- Replaced generic Gluetun location fields with provider- and protocol-specific
  filters and options sourced from the current official provider walkthroughs.
- Added searchable, protocol-aware server choices from the official
  `qdm12/gluetun-servers` catalog, plus authenticated per-provider refreshes and
  a licensed offline snapshot.
- Changed generated services and all setup templates to
  `qmcgaw/gluetun:latest` with `pull_policy: always`, as explicitly required.
- Changed generated `/gluetun` persistence to a Docker-managed named volume and
  removed conflicting network-mode output from the add-on flow.
- Added Gluetun container state, health, exit code, restart, timestamp,
  configuration-issue, and bounded redacted log diagnostics through an isolated
  internal Docker observer; no container shell is required.
- Added blocking high/critical container scans, multi-architecture release
  promotion, attached SBOM evidence, immutable tags, and GitHub Releases.
- Verified the current `qmcgaw/gluetun:latest` provider schema against Gluetun
  source commit `7d749df` and the official walkthroughs at commit `888ab89`,
  and refreshed locked dependency patch levels.

## [0.3.2] - 2026-08-30

### Changed

- Replaced free-form provider entry with the Gluetun v3.41.3 provider catalog
  and protocol-aware, provider-specific setup guidance.
- Generated Compose files now contain direct values and run without an env
  file; a redacted or full `.env` remains available as an optional export.
- Kept sensitive values redacted until the operator explicitly includes them
  for a generation response.
- Kept generated results within the responsive app grid at compact, medium,
  expanded, and wide viewport sizes.

### Security

- Added server-side catalog, protocol, required-field, input-size, and unknown-
  field validation for Compose generation requests.

## [0.3.1] - 2026-08-29

### Fixed

- The primary ZimaOS stack now contains only Tuniku, so an unconfigured Gluetun
  service cannot block first start or enter a restart loop.
- The first empty state now leads to the Compose Assistant for a new Gluetun
  setup and separately offers connection to an existing Control Server.
- Generated and hardened Compose setups no longer make Tuniku startup depend
  on Gluetun startup success.

### Security

- Preserved the generation-only boundary: Tuniku does not mount the Docker
  socket, write host Compose files, or accept Gluetun credentials before the
  authenticated administrator flow.

## [0.3.0] - 2026-08-29

### Changed

- Added a ZimaOS-native primary Compose with direct values, app metadata,
  assigned port `65001`, and standard `/DATA/AppData/i_tuniku/` host paths.
- Pinned the published Tuniku `0.3.0` multi-architecture image by OCI digest.
- Reduced first-run configuration to one operator-provided
  `ISHIKU_SETUP_SECRET`; hardened file-backed setup remains available.
- Updated generated Compose Assistant setup fragments to the same single-secret
  model and immutable Gluetun reference.
- Preserved legacy Tuniku secret variables and files as compatibility
  overrides for existing deployments.

### Security

- Generate persistent cookie-signing and credential-encryption keys atomically
  under `/data/.secrets` with restrictive file permissions.
- Reject missing or shorter-than-32-character setup secrets before first-admin
  registration.

## [0.2.0] - 2026-08-29

### Changed

- Updated the standalone app to ishiku kit 1.2.1 and Node.js 24 LTS.
- Updated supported application and development dependencies.
- Updated Gluetun to v3.41.3 with an immutable multi-architecture digest.
- Published Tuniku on its assigned host port `65001` while preserving internal port `8080`.
- Replaced the complete browser, PWA, launcher, catalog, and in-app icon set.
- Gated GHCR `latest` publishing on full verification and added SBOM and provenance output.

### Security

- Dropped all Linux capabilities, disabled privilege escalation, and bounded Tuniku process IDs.
- Resolved the dependency audit finding present in the previous lockfile.

## [0.1.0] - 2026-07-29

### Added

- Initial authenticated Gluetun dashboard.
- Allow-listed Control Server adapter and background polling.
- Generation-only Compose Assistant.
- Local port overview and labels.
- Pixel Soft Utility responsive interface with six themes.
- Docker, ZimaOS, security, and architecture documentation.
