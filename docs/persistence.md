# Persistence and recovery

Opal saves several kinds of data. A Git push of the source repository does not
back up the personal workspace or update the installed application.

| Data | Current location | Recovery requirement |
| --- | --- | --- |
| Journal, task sources, attachments | Mounted vault folders | Include each folder, including hidden metadata |
| Daily focus | Vault `.opal/days` | Include in private vault history |
| Conversations, views, recent activity | Application Support/Opal/library | Back up with the vault |
| Journal recovery drafts | Application Support/Opal/journal-drafts | Back up with the vault |
| UI preferences, legacy database | Remaining Application Support/Opal | Include the full profile for recovery |
| Search indexes and thumbnails | Application Support/Opal | Rebuildable; currently included in full copies |
| API credentials | macOS Keychain | Not exported by workspace backup; reconnect on another Mac |
| Unsent chat composer text | Renderer memory | Not durable across restart yet |

## Verified recovery copies

`scripts/workspace_backup.py` creates a new local directory with a checksum
manifest. It compares sources before and after copying and checks every copied
file before publishing the destination. Failed copies do not become completed
backups. The snapshot parent is private to the local user. Copies are **not
encrypted** and are not automatically off-device.

Pause routines and quit Opal normally before taking a database-consistent
snapshot. Stable byte checks detect concurrent changes; they do not replace
quiescing database writers. The tool preserves symlinks without following them:
files outside the selected roots need their own source entry. Credentials in
vault configuration files are included in a full copy, so never put recovery
copies in a public repository.

```sh
python3 scripts/workspace_backup.py create \
  --source "vault=/path/to/vault" \
  --source "app-data=$HOME/Library/Application Support/Opal" \
  --destination "/path/to/private-backups/recovery-YYYY-MM-DD"

python3 scripts/workspace_backup.py verify /path/to/private-backups/recovery-YYYY-MM-DD

python3 scripts/workspace_backup.py restore \
  /path/to/private-backups/recovery-YYYY-MM-DD \
  --destination /path/to/new-restore-directory

python3 -m unittest discover -s scripts -p test_workspace_backup.py
```

Restore only creates a new directory and verifies the files. It never overwrites
an active vault or app profile. Inspect the restored copies before selecting a
vault or replacing app data with Opal closed. Paths may need updating on a new
machine. Byte verification is a recovery check, not an application launch test.

## Development delivery

After verification, commit and push the working branch. Use the existing public
app repository for source only; use the private vault repository for personal
text history. Review unpublished changes for credentials and personal content.
Never force-push to reconcile personal data. Fetch, preserve local edits,
combine concurrent changes, verify, then push.

Follow `local-app-install.md` when executable code changes. Documentation and
backup tooling changes do not require replacing the installed bundle.

## Next product work

1. Make unsent chat drafts durable across app restart, with explicit recovery.
2. Add honest storage status: saved locally, last verified recovery copy, and
   remote sync status are separate facts.
3. Offer backup destination selection and a restore preview inside Settings.
4. Add encrypted off-device backups after a destination and recovery-key plan
   are chosen. Keep at least one copy outside the primary Mac.
5. Extract a background routine service for an always-on personal host. Keep
   offline editing independent of that host's availability.

A commercial service can later add optional sync and hosted routines without
requiring that the only copy of a person's information lives on our servers.
