# Optional managed VPN stacks

The normal deployment continues to provide diagnostics and Compose export. The optional manager lets an administrator adopt an existing, common Compose VPN/application project and review configuration changes in the Assistant before applying them. It does not create a new stack or migrate applications between projects.

This implementation is under verification. Use a disposable test stack before enabling it for existing workloads. The published 0.3.6 image does not contain this helper: use the same tested image built from this source for both Tuniku and the manager. No deployment is performed by generating a proposal.

## Enable the optional helper

Start Tuniku with the tested image first. It generates a private manager key in `/data/.secrets/manager-key`; there is no extra user-entered secret. For the primary ZimaOS Compose this corresponds to `/DATA/AppData/i_tuniku/Data/.secrets/manager-key`. Preserve this key together with the encrypted managed state when backing up.

Create `/DATA/AppData/i_tuniku/Data/managed` with owner UID/GID `1000:1000` and mode `0700`. The key must be a regular private file (mode `0600`). Filesystems that cannot enforce these permissions need a suitable private Linux volume; the helper refuses insecure storage.

The `docker-compose.managed.yml` overlay requires:

- `TUNIKU_IMAGE`: the tested immutable image tag or digest containing the helper.
- `DOCKER_SOCKET_GID`: the numeric group owning the host Docker socket. The helper runs as UID 1000 with that supplementary group.
- `TUNIKU_MANAGER_PROJECTS`: comma-separated exact existing Compose project names that the operator authorizes for management.

Validate the combined deployment with `docker compose -f docker-compose.yml -f docker-compose.managed.yml config --quiet`. Review the resolved image, mounts and project allowlist before starting it. The overlay uses `/DATA/AppData` and `/DATA/Downloads` as approved data roots; narrow them to the workload's directories when possible. The operator must ensure approved host paths do not resolve through symlinks into unrelated directories.

The manager has no published port and uses a separate internal network. Tuniku has no Docker socket mount. The observer stays read-only. A read-only socket mount still grants powerful Docker API access to the helper process; project validation and its small authenticated API are the software boundary. Do not expose that helper or share its key with other applications.

## Review and apply

In the Assistant, select the existing VPN and all applications already using its network namespace. Confirm adoption explicitly. Adoption records ownership and does not change running containers. Containers in other projects, host-sharing or privileged configurations, arbitrary devices, and static network addresses are refused.

Use the existing provider, VPN credential, server-selection or published-port form, then prepare a managed change. Blank credentials retain existing values only when provider and protocol match. The five-minute preview lists affected services, changed environment key names and port mappings without exposing credential values. Confirm the interruption separately to apply it. Editing the form clears the preview.

The helper checks the current configuration and running state again. It stops applications before the VPN, retains the originals under recovery names, recreates the VPN using its current image identity, waits for Docker health, and recreates applications against the new namespace. Named and anonymous volumes are reused; Control Server settings are retained. Stopped services remain stopped. A provider change can require different credentials.

The manager records operation progress and the interface polls it while an operation is active. An accepted request is not evidence of success: inspect the final operation status. No image pulls, image updates, shell execution or volume deletion are available through its API.

## Recovery and disabling

On failure, the helper attempts to remove only its new containers and restore the originals. If VPN recovery fails, applications remain stopped. Restarting the helper marks an unfinished operation as interrupted and locks that project; it never retries Docker writes automatically.

Preserve the original manager key, encrypted `managed` directory, retained containers and their volumes before manual recovery. Inspect the operation ID, created IDs, retained IDs and Docker state locally. Resolve uncertain writes before restarting dependent applications; a Docker request could have completed immediately before a process crash. Do not delete or regenerate the key to clear a lock. Automated crash recovery is not implemented. Successful operations retain stopped originals until the owner uses the confirmed cleanup flow below. Plan storage is capped at 1000 records: expired, unreferenced previews can be pruned, while operation-linked plans and encrypted recovery journals remain protected. Do not remove those records manually to bypass the cap.

Recreating containers through the helper does not rewrite the original host Compose file. A later external `docker compose up` can restore older settings or invalidate manager ownership. Keep an operator-reviewed deployment configuration in sync before using Compose for future maintenance; the helper refuses changed identities instead of silently taking them over.

To return to export-only use, remove the overlay and `TUNIKU_MANAGER_URL` and recreate Tuniku. Keep recovery records and the original key. Existing VPN/application containers and data are unaffected by disabling the helper.

New-stack creation, adding unrouted applications, cross-project migration, image updates, automated recovery and live VPN leak checks remain separate work items.


Published-port changes are checked against other Docker containers during
preview and immediately before mutation. Protocols and bind addresses are
compared separately; wildcard listeners can overlap either address family.
A newly occupied port invalidates application before any writes. This check
cannot reserve ports atomically or discover non-Docker host listeners. Docker
creation/start failures still use the documented rollback procedure.


### Inspecting adopted applications

Select an adopted stack and choose **Inspect managed applications**. This reads
only the recorded VPN and application IDs, inside the current approved Compose
project. It shows inspection availability, state, healthcheck, exit code and
whether each application references the current VPN namespace. An outdated or
different namespace produces actionable review/recreation guidance. Missing
containers and changed ownership are isolated per service; no unrelated
container configuration, environment values or mount paths are returned.

Inspection does not start, stop, repair or adopt anything. A project changed
during inspection is marked stale; failed refreshes retain a stale-data warning.
Incorrect references also block the existing change-plan path. Docker health
and namespace references do not prove application readiness or leak-free VPN
routing. Legacy separate projects still require a reviewed migration.


## Disposable Docker lifecycle verification

After installing the locked development dependencies, use already local immutable image inputs:

```sh
TUNIKU_TEST_IMAGE=sha256:<locally-built-Tuniku-image-id> \
GLUETUN_TEST_IMAGE=qmcgaw/gluetun@sha256:<reviewed-local-architecture-digest> \
npm run test:managed-lifecycle
```

This host-side harness requires a local Unix-socket Docker context. It creates only randomly named and labelled non-root, read-only, capability-dropped test containers with no host ports, external network, host-data mount or container-mounted Docker socket. It executes the actual socket adapter and manager against those disposable resources. Its temporary socket bridge exposes only harness-owned labelled containers and forwards actual Docker RPCs. It checks replacement IDs, client namespace rebinding, existing named-volume data, exclusion of another synthetic project, obsolete references, drift refusal before writes, rollback after an injected new-client health failure, custom-name VPN recognition after image pinning and confirmed cleanup that preserves live volume data. Cleanup verifies ownership and removes clients before their namespace parents and the owned volume.

Gluetun runs an offline sleep process with a synthetic health check; the client is a Node process named jdownloader. This tests actual Docker lifecycle mechanics, not VPN connectivity, real Gluetun health, Control Server behavior, the JDownloader application, a NAS restart or leak protection. Existing upstream vulnerability and full release gates still apply. The ignored `.ishiku/reports/managed-lifecycle.json` records exact image IDs, versions, source hashes and limitations; no real data or VPN credentials are used.


## Review actual application dependencies

The candidate list resolves full container IDs, short IDs and names from observed Docker namespace references inside the manager's project allowlist. Known applications attached to the selected VPN are preselected for review; explicit ownership confirmation is still required. Applications using another network or another container are disabled. Unknown relationships remain marked and require manual selection plus the server's inspection before adoption; an unknown value is never an automatic match. Related applications in another approved project are shown as a migration blocker. Containers outside the allowlist are not exposed as selectable candidates.

Original containers retained by a successful operation and uncertain resources from an active, interrupted or failed recovery operation are marked as recovery resources and cannot be adopted again. Restored originals from a completed rollback remain usable in their existing project. Adoption always rechecks the authoritative Docker state, namespace membership, project boundaries and complete dependency set before any runtime change.

When the container list omits network mode (including some Podman compatibility responses), inventory reads details for up to 64 allowed containers, with at most four concurrent reads. Unavailable or remaining missing details stay unknown; no adoption follows automatically.


## Configuration references and pending changes

Current Assistant inputs are a proposal; generated output and redacted saved drafts do not establish a deployment. A managed preview is separate, expires after five minutes and is discarded when its inputs or selected project change. Review its affected services, port mappings, interruption and unchanged/no-op result before confirmation.

Explicit adoption stores an encrypted reference of the actual container configuration. A successfully completed managed apply replaces this reference with inspected new-container configuration; failed transactions retain the prior reference. **Inspect managed applications** compares current configuration against that reference and shows the collection time, Docker health, namespace associations and published port configuration. Changed credentials are detected without returning credential values or hashes. Runtime health and stopped/running state are separate from configuration drift. Missing/foreign containers or older records without a reference leave comparison unavailable. A successful reviewed operation can establish a reference for a legacy record without re-adoption.

Inspection expires visibly after one minute. A selected stack is inspected again after a successful operation; a historical successful result is not current VPN or application verification. The reference does not compare host Compose files, env files or redacted drafts, and Docker health does not prove a VPN handshake or leak prevention. Preparing a new reviewed plan uses the currently observed configuration; it does not silently restore an old reference.

## Controlled manual recovery review

The encrypted operation record retains the pre-change configuration, original client associations and retained container IDs. Automatic rollback uses these originals only for a failed apply. Deliberately returning to a previous successful configuration and crash recovery require local owner repair. The bounded confirmation flows below can recheck repaired originals or remove stopped recovery containers; the helper has no general restore/exec endpoint.

Before that review, stop routed clients, preserve the full manager directory and original key, identify the exact operation and retained VPN/client IDs, and verify their Compose ownership, images and mounts. Do not substitute current Compose defaults for saved configuration. Resolve uncertain created IDs before selecting retained originals; container names alone are insufficient. Restore the VPN before its original clients, wait for its actual health and verify each client's namespace and application readiness. Leave clients stopped when recovery is uncertain. Retain download volumes and original files; never use volume deletion or key regeneration to clear a recovery lock.

## Reviewed changes and source of truth

Managed edits are patches. Blank settings retain the observed values when the provider/protocol are unchanged; deliberate removals are selected separately and listed in the preview. Server selection cannot change the provider or protocol. Complete resulting credentials and filters are validated before Docker writes. Port actions add a deduplicated binding or replace/remove one explicitly selected address/port for the selected target and protocol; other bindings remain.

Stacks using `restart: always` must be reviewed and changed manually to `unless-stopped` before adoption. Docker can restart manually stopped `always` originals after a daemon restart. No policy is silently changed. Missing authoritative dependency metadata prevents mutation; detail fallback is bounded to the adopted project, and unknown foreign-project metadata blocks rather than granting more access. Explicit hostname/domain settings are retained; generated container-ID hostnames are regenerated. Recreated VPNs retain a stable Gluetun role label while pinning their original image ID.

Environment-based WireGuard edits are blocked when a mount explicitly supplies `wg0.conf` or a mounted parent directory/volume makes that source unknown. Tuniku never reads the host file. Review the file-based workflow manually before changing credentials.

The helper owns confirmed runtime Docker changes. The owner owns Host Compose/Env files. Before external maintenance, inspect drift and use **Reconcile Host Compose before external maintenance** with the complete original file. The download contains a complete structured Compose review document, structural changes, immutable runtime image IDs and required local variables. Original storage, networks, image references and extension fields remain; credentials are redacted or represented by required local variables. It is not deployment-ready: resolve all values locally, review env_file precedence and image IDs, back up data/keys, and inspect runtime again. No Host Compose/Env file is read or written by Tuniku.

## Retention and manual recovery completion

Storage usage and plan/recovery counts are visible. Expired previews are automatically pruned before a new plan only when no operation references them. Referenced plans, encrypted journals, baselines, volumes and data remain. Storage nearing the plan limit warns before it fills.

After a successful change, **Review stopped recovery containers** lists only the exact retained originals. The owner must explicitly confirm their irreversible container removal. The helper rechecks identities, names, configuration, mounts, stopped state, dependent scope and active-project exclusions. Clients are removed before the VPN; Docker removal always uses `v=false` and `force=false`. Volumes, plans and journals remain. Once removed, restoring those containers requires the saved complete configuration and data/key backup. Interrupted cleanup blocks new managed changes until the remaining originals are reviewed and cleanup completed; no automatic cleanup replay occurs.

After manual recovery, **Inspect repaired originals** can release a project lock only when the exact recorded original IDs, names, image/configuration, mounts, running state and namespace have been restored; running services must pass the bounded health check. Recorded replacement containers must be absent. An expiring opaque review token and explicit confirmation cause another inspection before updating the helper journal/ownership/reference. This performs no Docker writes, automatic replay or adoption of arbitrary replacement IDs. Missing identities, drift, inaccessible details and running unverified services remain locked. Export/read-only operation remains available. Preserve the encrypted journal and original manager key; never edit ciphertext or delete keys to unlock a project.

For authoritative dependency checks, the Docker API must provide network mode for all listed containers or permit bounded detail reads within approved projects. Some Podman compatibility responses omit network mode for unrelated containers. These unknown foreign relationships block adoption and mutation; they do not grant foreign inspection access. A lifecycle pass through the harness-owned test bridge does not establish compatibility with an unrestricted host socket.
