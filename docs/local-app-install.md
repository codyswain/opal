# Getting a verified build into the installed app

Opal updates itself from **update sources**: folders or https addresses
that hold a `latest.json` and one zip of `Opal.app`. When a source offers a
newer build, the left sidebar shows "Update ready" above Settings. One click
saves, closes Opal, swaps the bundle and reopens it.

## Staging a build

After a change is verified:

1. Package it: `npm run package`. The build carries its short commit and
   build time (`__OPAL_BUILD__` in the main process, and
   `.vite/build/build-info.json` inside the bundle).
2. Stage it in a source folder:

   ```sh
   node scripts/stage-update.mjs out/Opal-darwin-arm64/Opal.app ~/opal-updates "One line on what changed"
   ```

   The script zips the bundle with `ditto -c -k --keepParent`, computes its
   sha256, writes `Opal-<commit>.zip` and then `latest.json` (last, and
   atomically), and removes older `Opal-*.zip` files from the folder.

That is all. A running Opal notices within 30 minutes, on its next launch,
or when its window is focused after ten minutes away. **Check for Updates**
in the palette looks at once.

Never quit or replace a running Opal yourself: the person using it clicks
"Update ready" when it suits them, and Opal saves their pages before it
closes.

## Where Opal looks

Each Mac lists its sources in `<userData>/updates.json`, and only there:

```json
{ "version": 1, "sources": ["~/opal-updates", "https://host.example/opal-updates"] }
```

`<userData>` is `~/Library/Application Support/Opal`. A folder opened in
Opal can never name a source. Addresses must be https; plain http is
refused. With no file, Opal shows no update row.

## What the install does

- Copies or downloads the zip into `<userData>/updates/` (2 GB at most),
  checks its sha256 against `latest.json`, unpacks it with `ditto -x -k`, and
  checks it holds exactly one `Opal.app` with the running app's
  `CFBundleIdentifier`. Any failure is one toast, and Opal keeps running.
- Writes a helper script, starts it detached, and quits through the normal
  close path.
- The helper waits for Opal to exit (and changes nothing after 60 s), moves
  the running bundle to `~/Library/Caches/Opal-app-backups/` as
  `Opal-update-<builtAt>-<commit>.app`, moves the new bundle into place and
  opens it. If that move fails it puts the old bundle back and opens it. It
  keeps its own two newest copies there and never touches other names.
  It logs to `<userData>/updates/helper.log`.

Install and roll back work only in the packaged app, and only when Opal can
write to the folder its bundle is in.

**Roll Back to Previous Build** (palette) puts back the newest kept copy
older than the running build, the same way. Opal then hides "Update ready"
for the build it rolled back from; **Install Update** still installs it.

## Testing an install without touching the real app

Run a copy of a packaged build with `OPAL_TEST_USER_DATA_DIR` set to a temp
profile. Under that profile only, `OPAL_TEST_UPDATE_BACKUPS_DIR` moves the
backups folder too. The helper then starts the new build's executable
directly with both variables (since `open` would drop them), so the
relaunched copy stays on the temp profile.

## Manual swap (fallback)

For a Mac with no source set up, or when the helper cannot run:

1. Wait for Opal to be closed normally, so pending saves finish.
2. Copy the new bundle beside the installed one with
   `ditto out/Opal-darwin-arm64/Opal.app /Applications/Opal.new.app`.
3. Move the installed bundle to `~/Library/Caches/Opal-app-backups/` under a
   name of your own, then move `Opal.new.app` to `/Applications/Opal.app`.
4. Open it and check it launches.

Do not set `OPAL_TEST_USER_DATA_DIR` for the installed app.
