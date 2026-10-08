# Image channels and promotion

`latest` may be updated by a verified main build or a stable version release. It is not restricted to versioned releases. Pin an immutable digest when a deployment must remain on a reviewed artifact.

Both publishing jobs use the same registry-writer concurrency group without cancelling an active writer. Verification runs first and retains the full ishiku/traceability gate. A manual main workflow can publish only from main. Candidates are separated by channel, source SHA, run ID and attempt, so main and release events cannot overwrite each other's candidate tag.

Promotion inspects the exact built digest and requires the amd64 and arm64 configurations to identify the expected source commit. The previous latest digest is resolved once and its architecture revisions must also agree. A full-history Git ancestry check permits the same source or a descendant to update latest; an older source retains the newer latest. Unrelated history, missing labels, missing history or unreadable registry data stop promotion. A first publication without an existing readable latest needs a separately reviewed bootstrap; registry failures are never treated as permission to overwrite.

Stable release tags must match the package version. Existing version tags are not overwritten. Version tags may be published for an older commit while latest remains on a newer main commit. Every tag points to the checked digest using `imagetools create`; promotion does not rebuild. Digest, source revision, previous digest and the promotion decision are recorded in `promotion-report.json`, retained as a workflow artifact and written to the job summary.

The workflows retain vulnerability scanning, OCI SBOM, provenance and verification gates. Configuration and simulated registry tests do not establish a successful GitHub publication, second-architecture execution, real VPN leak protection or NAS upgrade. Those release evidence requirements remain open until actually executed. Nothing in the local implementation authorizes publishing an image.

For data/schema changes, follow [the upgrade guide](upgrade.md). An image rollback also requires the matching database and original keys when the schema changed.

## Kit workflow adaptation

The Tuniku release workflow is an intentional local adaptation of the managed kit template for the approved main/latest policy. `.ishiku/kit-manifest.json` and `kit-version.lock` retain the upstream checksum and bind the adapted file to its installed checksum and decision. This does not change the central kit or waive a gate. A later kit sync will report a workflow conflict; review and reapply these channel controls before updating the kit.

## Per-architecture gate

Before promotion, both workflows resolve the exact linux/amd64 and linux/arm64 child digests from the built candidate index. Each child is pulled by digest and its actual architecture and source revision are checked. The bounded lifecycle harness executes on each immutable local image ID, including authentication, private SQLite/keys, replacement, wrong-key diagnosis and stopped backup/restore. Each child is then scanned separately for HIGH/CRITICAL vulnerabilities; a passing host-architecture scan cannot stand in for the other architecture. `architecture-runtime-report.json` records the index, child digests, source and runtime image IDs alongside the promotion report. ARM execution uses configured QEMU emulation on the runner. The runtime image seeds new data directories with mode0700; existing host data is not chmodded.

### Weekly upstream discovery

The additional Tuniku source-discovery workflow also scans each exact AMD64/ARM64 Gluetun child digest with HIGH/CRITICAL findings blocking success; it never substitutes a mutable tag between discovery and scanning. Both scans run independently and retain their reports. Main and version publishing both require this reusable gate to succeed before any candidate is published; unavailable metadata, an overdue exception or a HIGH/CRITICAL finding blocks publication. A passing scan does not establish VPN runtime compatibility, and a mutable latest tag can change after a scan. It runs Monday at 05:00 Europe/Berlin and can be dispatched manually. It preserves the kit's declaration-checking workflow and adds actual bounded reads of the official provider wiki, per-provider documentation, server-data repository, official Gluetun release metadata and Docker Hub Gluetun latest metadata. Run `node scripts/discover-upstreams.ts` locally with Node24 for the same report at `.ishiku/reports/tuniku-upstream-discovery.json`.

Reports distinguish changed, unchanged, observed and unavailable sources, bind documentation comparisons to a full wiki revision, record the latest index and both architecture digests, and flag the existing latest exception's review deadline. Failures, invalid metadata or overdue exception review fail discovery; source changes require review and do not trigger edits, pulls, deployment, release promotion, PR creation or automatic merging. Review dates and the exception deadline are never automatically extended.

Discovery completion is not runtime compatibility: the report explicitly records `NOT_TESTED`. Validate a changed Gluetun candidate against generated provider configuration, Control Server authentication, degraded upstream/DNS/network behavior, restart and VPN leak checks before approving it. Use exact candidate digests, preserve current settings/data and the previously working image identity, and review license/security changes and regenerated server-data diffs separately. GitHub's schedule can be delayed and requires the workflow on the default branch; no remote workflow has been dispatched by this local implementation. See [GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Approved temporary upstream exception

OVR-002 / DEC-SEC-GLUETUN-002 explicitly permits only four known HIGH CVE/package/version identities in the two recorded official Gluetun child digests through 2026-10-22. Raw architecture scans remain preserved; a separate fail-closed policy rejects changed digests, new/changed HIGH findings, all CRITICAL findings, malformed reports and expired approval. Clean future images do not need the exception. Tuniku runtime images still require zero HIGH/CRITICAL findings, source matching, actual architecture lifecycle, SBOM/provenance and checked-digest promotion. The exception does not claim the CVEs fixed or authorize any live NAS/VPN change.
