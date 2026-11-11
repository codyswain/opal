import { BACKUP_NAME_BASH, BACKUPS_KEPT } from './updateModel';

/**
 * The detached helper that swaps Opal's bundle once Opal has quit. Opal is
 * ad-hoc signed, so it cannot use Squirrel; it replaces its own folder.
 *
 * The helper waits for Opal's process to end (and changes nothing if it is
 * still running after `waitSeconds`), moves the running bundle into the
 * backups folder, moves the incoming bundle into its place and opens it. If
 * the second move fails it puts the old bundle back and opens that. Then it
 * deletes all but the newest two of its own kept copies, recognised by name;
 * nothing else in the backups folder is touched.
 */
export interface HelperPlan {
  mode: 'install' | 'rollback';
  /** Opal's process, which must end before anything moves. */
  pid: number;
  /** The running bundle, `…/Opal.app`. */
  target: string;
  /** The bundle that takes its place: the unpacked update, or a kept copy. */
  incoming: string;
  backupsDir: string;
  /** What the running bundle is called in the backups folder. */
  backupName: string;
  /** The executable in `Contents/MacOS`. */
  executable: string;
  /**
   * Set for a run under a test profile: the bundle's executable is started
   * directly with these variables, since `open` does not pass them on. Null
   * opens the bundle with `open`, as the Dock does.
   */
  relaunchEnv: Record<string, string> | null;
  /** Where the helper writes what it did. */
  logFile: string;
  openCommand?: string;
  waitSeconds?: number;
}

/** A shell word that means exactly `value`. */
export function shellQuote(value: string): string {
  if (value.includes('\0')) throw new Error('A path cannot contain a null character.');
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const VARIABLE = /^[A-Z_][A-Z0-9_]*$/;

export function helperScript(plan: HelperPlan): string {
  const wait = Math.max(1, Math.round(plan.waitSeconds ?? 60));
  if (!Number.isInteger(plan.pid) || plan.pid <= 0) throw new Error('No process to wait for.');
  const env = Object.entries(plan.relaunchEnv ?? {});
  if (env.some(([name]) => !VARIABLE.test(name))) throw new Error('Bad variable name.');
  const launch = plan.relaunchEnv
    ? `nohup /usr/bin/env ${env.map(([name, value]) => shellQuote(`${name}=${value}`)).join(' ')} "$1/Contents/MacOS/$EXECUTABLE" >/dev/null 2>&1 &`
    : `"$OPEN" "$1"`;
  return `#!/bin/bash
# Opal update helper (${plan.mode}). Written by Opal; safe to delete.
set -u
PID=${plan.pid}
TARGET=${shellQuote(plan.target)}
INCOMING=${shellQuote(plan.incoming)}
BACKUPS=${shellQuote(plan.backupsDir)}
KEPT="$BACKUPS"/${shellQuote(plan.backupName)}
EXECUTABLE=${shellQuote(plan.executable)}
OPEN=${shellQuote(plan.openCommand ?? '/usr/bin/open')}
LOG=${shellQuote(plan.logFile)}

note() { printf '%s %s\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"; }
launch() {
  ${launch}
}

ticks=0
while kill -0 "$PID" 2>/dev/null; do
  if [ "$ticks" -ge ${wait * 5} ]; then
    note "Opal (pid $PID) was still running after ${wait} s; nothing changed."
    exit 1
  fi
  sleep 0.2
  ticks=$((ticks + 1))
done

if [ ! -d "$INCOMING" ]; then
  note "The incoming bundle is missing: $INCOMING"
  launch "$TARGET"
  exit 1
fi
mkdir -p "$BACKUPS" || { note "Could not make $BACKUPS"; launch "$TARGET"; exit 1; }
# A kept copy of the same build is the same bundle; the running one replaces it.
if [ -e "$KEPT" ]; then rm -rf "$KEPT"; fi
if ! mv "$TARGET" "$KEPT"; then
  note "Could not move $TARGET aside; nothing changed."
  launch "$TARGET"
  exit 1
fi
if ! mv "$INCOMING" "$TARGET"; then
  note "Could not move the new bundle into place; putting the old one back."
  if [ -e "$TARGET" ]; then rm -rf "$TARGET"; fi
  mv "$KEPT" "$TARGET"
  launch "$TARGET"
  exit 1
fi
note "${plan.mode === 'install' ? 'Installed' : 'Rolled back'}: $TARGET; the previous bundle is $KEPT"

count=0
while IFS= read -r entry; do
  [[ "$entry" =~ ${BACKUP_NAME_BASH} ]] || continue
  [ -d "$BACKUPS/$entry" ] || continue
  count=$((count + 1))
  if [ "$count" -gt ${BACKUPS_KEPT} ]; then
    rm -rf "$BACKUPS/$entry" && note "Deleted the older copy $entry"
  fi
done < <(cd "$BACKUPS" && ls -1d Opal-update-*.app 2>/dev/null | LC_ALL=C sort -r)

launch "$TARGET"
exit 0
`;
}
