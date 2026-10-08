# Changelog

## Unreleased

- Correct managed provider/credential patches, explicit setting removal and individual port actions; validate complete resulting settings and authoritative dependencies before writes.
- Block always-restart retained originals and ambiguous WireGuard file sources; preserve explicit hostname/domain settings and stable Gluetun roles across pinned-image recreation.
- Make SQLite schema upgrades atomic and refuse unsupported future schemas.
- Add bounded expired-preview pruning, confirmed stopped-original cleanup, original-only manual recovery completion and secret-free complete Host Compose review exports.
- Separate setup/export from existing-stack management, prefill observed non-secret settings, collapse secondary tasks/drafts and correct separate-project routing guidance.

- Distinguish proposed output, redacted drafts, pending managed previews and observed configuration with encrypted adoption/apply drift references and fresh post-change inspection.
- Add separate-project manual routing/port fragments, bounded mount-path checks and a secret-free complete-Compose migration review.

- Compare port-note conflicts by address and protocol, and check fresh associated Gluetun mappings during application-port guidance without claiming a free host listener.

- Update the pinned distroless runtime base to address CVE-2026-75804 and CVE-2026-84782 in Debian OpenSSL; validate rebuilt architecture images with fresh vulnerability data.
- Explain raw IPv6 port-note input and retain field errors; display and copy IPv6 mappings with brackets.

- Diagnose temporary, partial and missing Gluetun data mounts without exposing host paths or automatically migrating existing files.

- Coordinate main and version release promotion, preserve main eligibility for latest, separate immutable candidates and guard digest/source ancestry.

- Document version/digest and Compose migration separately, matching app/observer bundles, protected rollback and required template inputs; distinguish Unreleased source from the pinned published image.

- Cascade geographic server selections and clear outdated narrower choices while preserving credentials and orthogonal preferences; show compatible relational catalog suggestions.

- Transfer reviewed new-setup Control Server inputs into Settings without automatic testing or saving; exclude VPN credentials, default encrypted storage off, and clear transferred form secrets on close or expiry.

- Add a guided VPN setup, application routing and deployment-check flow with retained tab progress, explicit expert tasks and current versus outdated runtime observations.

- Separate YAML, provider, Compose structure, unexecuted Compose CLI and runtime evidence; review environment precedence, unresolved inputs and service references without reading host files.

- Show browser transport, cookie policy, SQLite WAL mode and private storage diagnostics; create new databases with mode 0600 without rewriting existing permissions.
- Add isolated container replacement, wrong-key recovery and stopped-writer backup/restore checks, including private key permissions and direct HTTP authentication.

- Add owner-only offline administrator password recovery with hidden input, atomic session revocation and preserved VPN data.

- Explain and test connection credential lifetime across restarts and wrong-key recovery; allow explicit clearing of memory-only access.
- Renew idle sessions only from user interaction, with CSRF-protected activity and automatic browser cleanup when a session ends.

- Clear sensitive assistant inputs and generated output together, with explicit cleanup, idle expiry and rejection of late generation responses.

- Keep generator and connection validation errors beside their fields with accessible descriptions and persistent corrective guidance.

- List and reopen saved redacted drafts with titles, bounded metadata pages, legacy-port compatibility and explicit credential/source re-entry; saving edits preserves the original record.
- Retain Assistant inputs in tab memory across navigation and warn before replacing, unloading or signing out of unsaved inputs.

- Share bounded Docker metadata/port observations, separate background intervals, and preserve collection timestamps; explicit refresh and connection/control changes request fresh data.
- Bound browser API waits, abort superseded Overview/search requests, and prevent late connection/session responses from restoring old values.

- Add an expandable daily container traffic history from existing aggregates, with server time zone and explicit missing-day and estimate explanations.

- Add read-only adopted-application diagnostics, detect outdated VPN namespaces, and keep per-service ownership/access failures isolated.
- Label Docker network traffic accurately, expose sample quality, suppress gap/reset/baseline rates, and allocate daily deltas across local midnight with bounded 90-day retention.
- Preserve visible refresh errors and last-known values while independent successful sources remain available.

- Clarify complete Compose versus merge/review output, retain setup context for the next port step, and document online-only PWA limits while preserving unrelated origin caches.

- Associate Control API addresses and ports with selected Docker metadata before attributing ports or traffic; reject replacement races and retain separate diagnostics for unverified endpoints.
- Expose container diagnostics directly from Overview and add bounded log windows, local filtering, redacted export and persistent stale-data errors; metadata refreshes skip logs.

- Add reviewed browser-local WireGuard import with explicit routing/DNS limits, supported IVPN and Windscribe ports, and IVPN account-ID authentication validation.
- Compare Docker/Compose port bindings by address, protocol and range; recheck manager changes before mutation and reject ambiguous observer targets.

- Verify direct LAN HTTP with ordinary hostnames, persistent login and clipboard fallback while retaining optional HTTPS cookie/header policy.
- Distinguish observer liveness from Docker readiness, add actionable socket diagnostics, rotate observer logs, and align application readiness checks across container profiles.
- Parse OpenVPN client certificates and unencrypted private keys and reject mismatched pairs before producing configuration output.

- Add an opt-in authenticated manager and Assistant preview for explicitly adopted common VPN/application projects, with encrypted recovery records, confirmation, drift/replay protection, coordinated recreation and bounded rollback. Keep exports and the read-only observer available independently; document remaining deployment and recovery limits.

- Validate canonical WireGuard keys, IPv4/IPv6 CIDRs, endpoint IPs, Compose port ranges and service namespace references; reject incompatible server filters using retained offline server relationships.
- Redact URL credentials throughout inspected Compose, drafts and diagnostic text.
- Test unsaved connections without saving settings or replacing stored credentials; clear credential form values after deletion and invalidate outdated assistant results.
- Add an explicit new-setup env package that references its configuration file, keeps Compose-only as the default, and documents plaintext secret handling and container recreation.
- Limit generated Gluetun logs and cache refreshed catalogs until their files change; debounce and cancel cascading server-choice queries.

- Fix Docker observer selection when Gluetun is absent; keep detected published ports distinct from local notes and exposed-only ports.
- Scope Compose fragments to the chosen task, escape literal dollars, validate bind addresses and routing names, and redact list-form credentials and invalid YAML safely.
- Retain saved Basic Auth credentials when fields are left blank, clear persistence when deselected, and prevent credentials crossing connection destinations.
- Prevent outbound redirects and DNS rebinding; bound streamed upstream responses and avoid secret-bearing parser errors in logs and responses.
- Keep HTTP mode free of HTTPS-only browser headers; accept uppercase HTTPS_ONLY/HTTPSONLY values.
- Deduplicate status polling, invalidate stale connection/control results, await shutdown, ignore out-of-order traffic samples, and clear stale speed readings.
- Improve modal keyboard focus and logout failure handling, show generation validation details, and clear provider credentials when switching providers.
- Update transitive fast-uri dependencies to patched 3.1.6 and 4.1.3 versions and refresh the pinned Node 24 runtime base; add security, configuration and browser regressions.

All notable changes to Tuniku will be documented here.

## [0.3.6] - 2026-09-02

### Changed

- Split the Ports page into separate VPN-provider forwarding,
  Docker-published port, and local documentation sections.
- Renamed manual port entries to port notes and clarified in both the page and
  editor that they do not publish ports or change Docker, Gluetun, or Compose.

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

- Bound audit retention to 90 days / 10,000 events and new draft storage to 1,000 records / 25 MiB; preserve existing drafts and confirm audited deletion.
