import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import workspace_backup as backup

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'vault'
        self.source.mkdir()
        (self.source / 'journal.md').write_text('Keep this thought')
        self.dest = self.root / 'snapshot'

    def test_restore_and_detect_corruption(self):
        backup.create({'vault': self.source}, self.dest)
        restored = self.root / 'restored'
        backup.restore(self.dest, restored)
        self.assertEqual((restored / 'vault/journal.md').read_text(), 'Keep this thought')
        (self.dest / 'data/vault/journal.md').write_text('corrupted')
        with self.assertRaises(ValueError): backup.verify(self.dest)
        with self.assertRaises(ValueError): backup.restore(self.dest, self.root / 'bad')
        self.assertFalse((self.root / 'bad').exists())

    def test_refuses_existing_destination_and_recursive_copy(self):
        with self.assertRaises(ValueError): backup.create({'vault': self.source}, self.source / 'backup')
        with self.assertRaises(FileExistsError): backup.create({'vault': self.source}, self.source)

    def test_changed_source_never_becomes_verified_backup(self):
        original = backup.shutil.copytree
        def changing(*args, **kwargs):
            result = original(*args, **kwargs)
            (self.source / 'journal.md').write_text('A newer thought')
            return result
        with patch.object(backup.shutil, 'copytree', side_effect=changing):
            with self.assertRaises(ValueError): backup.create({'vault': self.source}, self.dest)
        self.assertFalse(self.dest.exists())

    def test_symlink_target_is_not_copied(self):
        outside = self.root / 'private.txt'
        outside.write_text('outside vault')
        (self.source / 'link').symlink_to(outside)
        backup.create({'vault': self.source}, self.dest)
        self.assertTrue((self.dest / 'data/vault/link').is_symlink())
        self.assertEqual(backup.verify(self.dest)['symlinks'], 1)

if __name__ == '__main__': unittest.main()
