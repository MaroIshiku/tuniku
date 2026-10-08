# Upgrade and Compose migration

An image pull downloads the image selected in your Compose file. It does not
change a pinned version/digest, add missing services or networks, copy data, or
recreate existing containers. Pulling `latest` does not update a service pinned
to `0.3.6@sha256:…`. Select a reviewed target, compare its complete Compose
configuration, and recreate affected services explicitly.

This source tree contains **Unreleased** audit changes. Its package version is
still 0.3.6; that alone does not identify a build containing these changes. The
checked-in primary Compose still selects the published 0.3.6 image. To deploy
new source behavior, use a separately built, tested target identified by its
image digest and source revision, with matching deployment files. No future
release version or completed publication is implied.

## Source-defined version bundles

These entries come from the repository's tagged source, not from assumptions
about whichever image a mutable tag currently resolves to.

| Source version | Source revision | Database schema | Primary app/observer pair |
| --- | --- | --- | --- |
| 0.3.3 | b115b192a95df647ed6879b79860f418ee0939e5 | 3 | Both use the 0.3.3 pin in that version's Compose |
| 0.3.4 | d6c4734071d4248b7fca34d00b28f9deb84752eb | 4 | Both use the 0.3.4 pin in that version's Compose |
| 0.3.5 | 96c2516f2a026e21c0663e7d7ffd8fc953b99269 | 4 | Both use the 0.3.5 pin in that version's Compose |
| 0.3.6 | 8344df7a13dfd8a66f8c4176fa2cc230a1cf518b | 4 | Both use the 0.3.6 pin below |
| Unreleased audit source | Record the exact tested source and image ID | 4 | Build and test both entrypoints from the same source/image |

The primary 0.3.6 bundle selects this reference for **both** `tuniku` and
`tuniku-docker-observer`:

```text
ghcr.io/maroishiku/tuniku:0.3.6@sha256:6417d799a5e0a936611a68621bcb593e575ea546ce5ca86f63746c25c9aa4dba
```

Keep both services on the same validated bundle. Mixed-version app/observer
pairs have no compatibility guarantee here. The observer uses
`dist/server/docker/observerProxy.js`; it is not a second web app and has no
published host port. Verify the selected digest is available and belongs to
the intended release/source before using it. A registry index listing both
architectures does not establish successful runtime or security tests.

## Review before changing the installation

1. Record the installed image IDs, source/version, exact saved Compose,
   existing container names, networks, published ports and data mounts.
   Keep provider credentials and environment values private.
2. Select the target's complete deployment files and compare them locally.
   Preserve the setup-secret source, existing session/encryption-key source,
   database mount, UID/GID, proxy/HTTP policy and port 65001. Keep the original
   Gluetun/application stacks and their download mounts unchanged.
3. Stop Tuniku and create a protected backup of its complete data directory,
   including `.secrets`, SQLite and any sidecars. Verify a restore in isolation.
   Keep old externally configured keys until their matching data no longer
   depends on them. A copied database with new keys is not a matching backup.
4. Review any schema or storage migration explicitly. The existing 3→4
   migration adds aggregate traffic tables; reverting to schema-3 code with an
   upgraded database is not a supported rollback procedure. For that rollback,
   restore the pre-upgrade database and matching keys with the writer stopped.
   The local admin-recovery tool accepts only schema 4.
5. Review data ownership/private modes and WAL/locking support. Keep an older
   named volume unless its move to a host path has been separately approved.
   Do not silently switch storage simply because a newer example uses a bind
   mount. Stop, back up, copy with ownership/modes preserved, and test the
   proposed move separately.

An older single-service/custom installation needs the complete observer
service and its internal network, as shown by the target Compose. Changing
only `tuniku.image` cannot add them. Preserve independent Tuniku startup;
do not add a VPN-health startup dependency that makes its UI unavailable
when Gluetun is down. Optional managed stacks require their separately
reviewed helper configuration and explicit adoption.

## Apply the reviewed bundle

After the backup and required migration review, use your actual reviewed file
in place of `reviewed-compose.yml`:

```sh
docker compose -f reviewed-compose.yml config --quiet
docker compose -f reviewed-compose.yml pull tuniku tuniku-docker-observer
docker compose -f reviewed-compose.yml up -d --no-deps tuniku-docker-observer tuniku
```

Inspect readiness at `/readyz`, sign in, and check Settings for the selected
version/source, database status, transport policy, credential access and
observer diagnostics. Verify the existing Control Server and application
state. A Docker restart alone does not reload image/environment/Compose
changes; recreation is required. No Gluetun/client recreation is part of
these commands. Changes to those stacks use their own reviewed lifecycle plan.

If validation fails, keep Tuniku stopped where data compatibility is uncertain.
Restore the complete pre-upgrade bundle and matching backup before restarting;
never regenerate encryption keys or delete downloads as a rollback shortcut.
Treat a missing observer as a Compose/network issue, and an unreadable stored
credential as a key/backup issue. Neither is repaired by repeatedly pulling
`latest`.

Synthetic local container replacement, key recovery and stopped-writer
backup/restore are tested by the development lifecycle harness. A real
published-version upgrade, NAS reboot, DNS/IPv6 fail-closed behavior and
per-architecture release checks require separate recorded evidence.


## Isolated upgrade evidence

The versioned `scripts/verify-published-upgrade.ts` can verify the published 0.3.3/schema3 artifact against a locally built current image. Pull the exact previous digest shown in that script, set `TUNIKU_TEST_IMAGE` to the local current image and run it with Node24. It creates only randomly named disposable volumes and offline containers, using synthetic accounts, credentials and a draft. The old fixture explicitly uses a private process umask. It verifies forward migration, retained keys and readable credentials, then restores the stopped-writer schema3 backup with its matching original keys to the old image. Resources are cleaned up afterwards.

This local amd64/rootless result does not establish NAS reboot behavior, VPN application rebinding, real-provider leak protection or arm64 runtime compatibility. Never run this harness against existing NAS volumes.

## Observer network migration from older Compose files

Compare your actual Compose file with the complete target bundle before applying it. An image update alone does not fix service commands, network membership or socket placement. Preserve existing mounts and named volumes, published application ports, secrets, labels and the Gluetun/client topology.

The primary bundle gives Tuniku two networks: its normal `tuniku` bridge for Control Server access and outbound requests, and `tuniku_observer`, an internal bridge shared only with the diagnostic helper. The helper belongs only to the internal bridge, has no published host port and runs `dist/server/docker/observerProxy.js`. Only that helper mounts the Docker socket read-only. Tuniku itself never receives the socket. Both services use direct Node health commands; no shell or `docker exec` is needed to inspect a stopped Gluetun container.

For an older custom file:

1. Stop writers and back up the current Compose/env files and Tuniku data with matching keys using the preceding checklist. Review the proposed diff before deployment.
2. Add the complete observer service from the matching target bundle and its internal network. Remove any observer host-port publication. Set the app's proxy URL to that helper's service name and port.
3. Keep Tuniku on its normal bridge as well as the observer bridge. Do not put Tuniku in Gluetun's network namespace or make startup depend on VPN health. The generated Gluetun add-on joins the normal external `tuniku` bridge; it does not join the observer network.
4. Existing Docker networks retain their creation properties. If a previously created observer network is public or has incompatible settings, inventory its attached containers and propose a distinct internal network name. Do not delete or recreate a shared network as a shortcut. Apply that concrete network change only after the owner reviews it.
5. Run `docker compose -f reviewed-compose.yml config --quiet` with the actual env files, then inspect the full resolved configuration locally. It may contain secrets. Verify that the app and helper share the internal network, the app retains its normal bridge, and only the helper has the socket mount.
6. After deploying the reviewed app/helper pair, verify UI availability while Gluetun is unavailable, helper liveness/readiness, and Gluetun association/diagnostics. Keep the previous bundle and stopped-writer backup for rollback; changes to the VPN/client topology require their own review.

Custom deployments may omit the observer and leave `TUNIKU_DOCKER_PROXY_URL` unset, as the advanced example does. Control Server features remain available; Docker diagnostics and detected Docker ports remain explicitly unavailable. Do not compensate by exposing a general Docker TCP endpoint or enabling shell execution.

Schema upgrades now run in one SQLite transaction including every DDL statement and `user_version` change. If a step fails, the complete old schema/version is retained and the constructor closes its connection. Schemas newer than this application version are refused before journal changes; use the matching newer application or restore the protected backup with matching keys. This does not authorize a live database migration, fix already-partially-migrated databases automatically, or replace a real upgrade/restore acceptance test.
