# Local administrator recovery

This offline tool changes one existing administrator password and revokes that account's sessions. It preserves account identity, other administrators, Gluetun settings, encrypted credentials, drafts and key files. TOTP and recovery codes are deferred and are not implemented by this workflow. It requires local ownership of the database; it is not a public recovery endpoint.

1. Stop the Tuniku service. Confirm its container/process is stopped; the tool requires your explicit `--service-stopped` confirmation and does not itself stop or detect every possible service process.
2. Make and retain a protected matching backup of the data directory, including `.secrets`, database and SQLite sidecars. Verify a restore in isolation before relying on it. Never reset or regenerate encryption keys as a password recovery step.
3. Use the same tested Tuniku build as the database. The tool accepts database schema version 4 and never creates or migrates a database. The published 0.3.6 image may not contain this tool; build/test this source before use.
4. Check ownership and permissions: the data directory must belong to the recovery user with no group/other access (`0700`); database and existing `-wal`/`-shm` files must be private regular files (`0600`). Symlinks are refused. If the filesystem cannot enforce this, use a private Linux volume after a separately reviewed backup/migration. The tool does not change file ownership or permissions for you.
5. Run interactively with the normal application UID. In a clone after `npm ci && npm run build`:

```sh
node dist/server/recover-admin.js --database /path/to/private/tuniku.db --username admin --service-stopped --backup-confirmed
```

For Docker Compose with the tested image already selected, leave the normal service stopped and start only the one-off recovery command with the same data mount:

```sh
docker compose run --rm --no-deps --entrypoint /nodejs/bin/node tuniku dist/server/recover-admin.js --database /data/tuniku.db --username admin --service-stopped --backup-confirmed
```

Enter and repeat a strong password of at least 12 characters at the hidden prompts. Passwords are not accepted in arguments, environment variables or pipes. The password must differ from the username, common placeholders, and the setup secret when that secret is available to the tool. A failed password or audit write rolls back the transaction. Success emits only the revoked-session count and writes a secret-free recovery audit event.

Restart Tuniku and sign in with the new password; the old account sessions are invalid. Keep the backup until the connection and application state are checked. Restoring an old database can restore old password hashes and sessions: keep Tuniku stopped, protect the backup and perform another local password recovery/session revocation before making such a restored installation available.

The application restart, transaction rollback and data-retention tests use synthetic databases. They do not substitute for a tested NAS backup/restore, real container run or recovery of an existing installation.
