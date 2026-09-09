"""Verified local recovery copies. Not encryption, sync, or an off-device service.

Writers should be paused before copying databases. A changed file set fails
verification rather than publishing an apparently complete recovery copy.
Symlinks are preserved; their external targets are NOT included.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
from datetime import datetime, timezone


def inventory(root):
    result = {}
    def visit(directory):
        for item in sorted(directory.iterdir()):
            relative = item.relative_to(root).as_posix()
            if item.is_symlink():
                result[relative] = {'link': os.readlink(item)}
            elif item.is_dir():
                result[relative] = {'directory': True}
                visit(item)
            elif item.is_file():
                digest = hashlib.sha256()
                with item.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
                result[relative] = {'sha256': digest.hexdigest(), 'size': item.stat().st_size}
            else:
                raise ValueError(f'Unsupported special file: {relative}')
    visit(root)
    return result


def verify(snapshot):
    snapshot = Path(snapshot)
    manifest = json.loads((snapshot / 'manifest.json').read_text())
    if manifest.get('version') != 1:
        raise ValueError('Unsupported backup version')
    actual = inventory(snapshot / 'data')
    if actual != manifest['files']:
        raise ValueError('Backup contents do not match the recorded checksums')
    return {'files': sum('sha256' in item for item in actual.values()),
            'symlinks': sum('link' in item for item in actual.values())}


def create(sources, destination):
    destination = Path(destination).resolve()
    if destination.exists():
        raise FileExistsError('Backup destination already exists')
    sources = {label: Path(source).resolve() for label, source in sources.items()}
    if not sources:
        raise ValueError('At least one source is required')
    for label, source in sources.items():
        if not re.fullmatch(r'[A-Za-z0-9_-]+', label) or not source.is_dir():
            raise ValueError('Each source needs a simple unique label and an existing directory')
        if source in destination.parents:
            raise ValueError('Backup destination cannot be inside a source')
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.opal-incomplete-', dir=destination.parent))
    try:
        data = stage / 'data'
        data.mkdir()
        before = {label: inventory(source) for label, source in sources.items()}
        for label, source in sources.items():
            shutil.copytree(source, data / label, symlinks=True)
        for label, source in sources.items():
            if before[label] != inventory(source) or before[label] != inventory(data / label):
                raise ValueError('A source changed during backup. Pause writers and retry.')
        manifest = {'version': 1, 'createdAt': datetime.now(timezone.utc).isoformat(),
                    'sources': {label: str(source) for label, source in sources.items()},
                    'files': inventory(data), 'encrypted': False,
                    'externalSymlinkTargetsIncluded': False}
        (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        verify(stage)
        if destination.exists():
            raise FileExistsError('Backup destination already exists')
        stage.rename(destination)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return verify(destination)


def restore(snapshot, destination):
    """Restore only into a new directory, never over a live workspace."""
    snapshot, destination = Path(snapshot).resolve(), Path(destination).resolve()
    if destination.exists():
        raise FileExistsError('Restore destination must be new')
    if snapshot == destination or snapshot in destination.parents:
        raise ValueError('Restore destination cannot be inside the backup')
    verify(snapshot)
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.opal-restore-', dir=destination.parent))
    try:
        shutil.copytree(snapshot / 'data', stage / 'data', symlinks=True)
        expected = json.loads((snapshot / 'manifest.json').read_text())['files']
        if inventory(stage / 'data') != expected:
            raise ValueError('Restored files failed verification')
        (stage / 'data').chmod(0o700)
        if destination.exists():
            raise FileExistsError('Restore destination must be new')
        (stage / 'data').rename(destination)
    finally:
        shutil.rmtree(stage)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    create_parser = sub.add_parser('create')
    create_parser.add_argument('--source', action='append', required=True, metavar='LABEL=PATH')
    create_parser.add_argument('--destination', required=True)
    verify_parser = sub.add_parser('verify')
    verify_parser.add_argument('snapshot')
    restore_parser = sub.add_parser('restore')
    restore_parser.add_argument('snapshot')
    restore_parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    if args.command == 'create':
        pairs = [source.split('=', 1) for source in args.source]
        if any(len(pair) != 2 for pair in pairs) or len({pair[0] for pair in pairs}) != len(pairs):
            parser.error('Use unique LABEL=PATH sources')
        print(json.dumps(create(dict(pairs), args.destination)))
    elif args.command == 'verify':
        print(json.dumps(verify(args.snapshot)))
    else:
        restore(args.snapshot, args.destination)
        print('Restored and verified in the new directory.')

if __name__ == '__main__':
    main()
