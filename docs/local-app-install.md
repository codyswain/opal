# Updating Cody's Dock app

Cody wants the latest completed Opal changes available from the macOS Dock.
Treat updating the installed app as part of delivering future app changes.

- Stable installed location: `/Applications/Opal.app`
- Current development checkout: `/Users/codyswain/code/opal/.worktrees/core-ux`
- Normal settings and local data: `~/Library/Application Support/Opal`
- The Dock shortcut points to the installed app, not Electron or a worktree.

After verifying a completed change:

1. Run `npm run package` from the checkout containing that change.
2. Wait for a normal close of installed Opal so pending writes finish. During
   an autonomous session, do not interrupt a running app; stage the verified
   build until it is closed.
3. Copy `out/Opal-darwin-arm64/Opal.app` to a temporary application directory
   with `ditto`. Keep the previous installed bundle as a backup, then move
   the new bundle into `/Applications/Opal.app`.
4. Open `/Applications/Opal.app` and verify it launches and shows the change.

Preserve Application Support, Keychain credentials, and vault files. Do not
set `OPAL_TEST_USER_DATA_DIR` for the installed app. Do not overwrite a running
bundle or add duplicate Dock shortcuts. If a newer checkout becomes the source
of development, package that checkout instead and keep the installation path.

This is a local development installation, not an automatic update service.

Staging should keep the latest verified app and, at most, its immediate
predecessor. Remove superseded copies created by the current development
session only after verifying the latest compiled tree. Keep the installed
bundle and explicit rollback backups. Source commits, staged builds, installed
versions, and personal-data backups are separate checkpoints.
