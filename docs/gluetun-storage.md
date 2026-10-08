# Gluetun data storage review

Gluetun diagnostics classify the Docker mount metadata covering `/gluetun`. A tmpfs or bind under `/tmp`, `/var/tmp`, `/run`, `/var/run` or `/dev/shm` is reported as temporary. Missing mount information is unverified; no covering mount means data may live in the replaceable container layer. File-only mounts are reported as partial. Docker volume and ordinary host bind mounts are reported as declared mounts, with a warning when read-only. Their host durability, ownership, free space and backup status are not verified by Docker metadata alone.

The observer exposes a fixed storage summary, not host source paths or mount names. It performs no host filesystem read, copy or permission change. An older observer without mount metadata remains compatible and produces an unverified result. Update the app and observer as a matching reviewed bundle to obtain the new summary.

## Before an existing installation is moved

1. Review the actual Compose and Docker inspect locally to identify the source, destination, owner and contents. Keep credentials and private paths out of support exports.
2. Inventory the affected Gluetun and application containers, their network dependency and download/config volumes. Plan interruption and client recreation when Gluetun's container identity changes.
3. Stop every writer and make a protected backup of the complete source, its ownership and permissions, plus the existing Compose. Do not treat a live copy as a consistent backup.
4. Prepare a persistent Linux destination with sufficient free space and compatible ownership/locking. Compare the proposed Compose diff: change only the reviewed data mapping and preserve unrelated application/download volumes, labels, ports and networks.
5. Obtain explicit approval for that concrete source/destination migration. Tuniku does not infer approval from detecting temporary storage and does not offer automatic migration.
6. With writers stopped, copy and verify contents and metadata locally before recreating the affected containers. Retain the original source and backup for rollback. Check startup, Gluetun data access, VPN state and application network association. Real-provider leak protection requires its own test.
7. If validation fails, stop writers and restore the original mapping and the matching backup. Recreate affected applications when required by their Gluetun network reference. Do not delete the original data while rollback is still needed.

This guide and diagnostics do not move any existing installation. A real migration requires its reviewed local paths, backup evidence and operator approval.
