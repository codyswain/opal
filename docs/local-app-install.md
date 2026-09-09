# Updating Cody's Dock app

Cody wants the latest completed Opal changes available from the macOS Dock.
Treat updating the installed app as part of delivering future app changes.

- Stable installed location: `/Applications/Opal.app`
- Current development checkout: `/Users/codyswain/code/opal/.worktrees/core-ux`
- Normal settings and local data: `~/Library/Application Support/Opal`
- The Dock shortcut points to the installed app, not Electron or a worktree.

After verifying a completed change:

1. Run `npm run package` from the checkout containing that change.
2. Quit the installed Opal normally so pending writes finish.
3. Copy `out/Opal-darwin-arm64/Opal.app` to a temporary application directory
   with `ditto`. Keep the previous installed bundle as a backup, then move
   the new bundle into `/Applications/Opal.app`.
4. Open `/Applications/Opal.app` and verify it launches and shows the change.

Preserve Application Support, Keychain credentials, and vault files. Do not
set `OPAL_TEST_USER_DATA_DIR` for the installed app. Do not overwrite a running
bundle or add duplicate Dock shortcuts. If a newer checkout becomes the source
of development, package that checkout instead and keep the installation path.

This is a local development installation, not an automatic update service.
