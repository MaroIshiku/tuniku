# Changelog

All notable changes to Tuniku will be documented here.

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
