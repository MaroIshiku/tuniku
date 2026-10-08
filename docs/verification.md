# Verification scope and evidence

Real NAS reboot, VPN connectivity/outage/leak and personal-installation acceptance are explicitly deferred by the owner in DEC-VERIFY-002. They are not reported as passing. This deferral does not waive vulnerability or release gates.

Twelve software control requirements are verified against executed synthetic tests and bounded actual-Docker checks. `.ishiku/evidence/requirements.json` records commands, artifact hashes, scope, metrics, source identities and the applicable acceptance/test-map hashes. `scripts/verify-requirement-evidence.mjs` runs through the versioned compliance check and rejects changed acceptance criteria, changed mappings, missing/changed files or added mapped sources. GitHub CI evidence belongs to the exact recorded source revision; unchanged implementation/test hashes permit later evidence-only commits without claiming a new runtime test.

| Requirement | Executed evidence |
| --- | --- |
| CORE-001 | Application suite, browser, structural security and actual managed lifecycle |
| AUTH-001 | Application security/negative cases, browser sessions and structural controls |
| SETUP-001 | Configuration, browser HTTP, actual image persistence and schema upgrade |
| BOOTSTRAP-001 | Delivery/Compose checks and browser first-run flow |
| ASSISTANT-001 | Generator/import/filter/draft regressions, browser and actual Compose artifact probes |
| DIAG-001 | Observer association/failure/security regressions and browser degraded states |
| TRAFFIC-001 | Counter quality, identity, midnight/DST/retention and browser history |
| UI-001 | Versioned design checks and browser responsive/theme/accessibility matrix |
| OPS-001 | Independent clone, immutable image lifecycle, actual schema3-to4 and backup rollback |
| MGMT-001 | Negative security tests, browser confirmation and nine actual Docker lifecycle scenarios |
| RETENTION-001 | Atomic retention/deletion/limits and browser confirmation |
| REL-001 | Executed release-control/negative-gate tests, bounded scan-policy tests and local multiarchitecture OCI/SBOM/provenance readiness; actual publication receipt is recorded after promotion |

The actual migration harness uses the pinned previously published schema3 image and synthetic account, draft and encrypted credential. It verifies current schema4 upgrade and restoring the stopped matching-key schema3 backup. No production database is opened. Both current architectures were built and passed the bounded image lifecycle harness; ARM64 uses the already installed emulator. Local multiarch OCI export contains SPDX SBOM and SLSA provenance and its runtime filesystems match the tested images. That local artifact is not a GitHub release or registry-promotion result.

## Official Gluetun security boundary

The official `latest` index remains `sha256:2733bb22b27e3efa7a9f2cef9057ec12791b8b225793fcd3dbfd0508404dfc25`. Its reviewed runtime has four HIGH findings: pcre2 10.48-r0, golang.org/x/crypto v0.52.0, golang.org/x/net v0.55.0 and golang.org/x/text v0.38.0. Official v3.41.3 has additional findings and is not a safe downgrade. Current source discovery and scans are retained as local evidence and release workflow artifacts.

A locally built patch candidate updates pcre2 to 10.49-r0 and the Go dependency graph to crypto v0.55.0, net v0.57.0 and text v0.41.0, retaining the upstream source revision and runtime defaults. Both candidate architectures scan with zero HIGH/CRITICAL findings. This is a derivative, not an official upstream release; it has not been integrated or published. Six kernel-dependent upstream tests fail for insufficient network privileges on both the original and patched trees, so this candidate is not claimed fully verified.

Official-image compatibility and future upstream updates remain the recorded deployment choice. An external HIGH finding cannot be fixed by changing Tuniku code or marking evidence verified. The original release gates remain enforced; An explicitly approved, expiring OVR-002 now permits only the recorded upstream findings. Tuniku scans and all remaining release controls stay enforced.

## Reusable verification flag

The GitHub context of a reused workflow belongs to its caller. Checking for `github.event_name == workflow_call` therefore disabled the strict flag for real push/tag/manual callers. An actual disposable GitHub run exposed this. Tuniku now reads `inputs.require_all_verified` directly; release callers still pass true. The regression is tested, and both managed workflow checksums retain the upstream version and the narrow installed correction under DEC-VERIFY-003. This strengthens the existing gate and does not waive requirement or vulnerability evidence.

Requirement verification records executed software controls and prepublication artifact readiness. It is distinct from the receipt of an actual release: candidate identities, runtime/scans, SBOM/provenance and latest promotion must still succeed in the real workflow before publication is reported complete. This avoids requiring a nonexistent publication receipt before its gated workflow can run. No AppSpec acceptance criterion is removed.
