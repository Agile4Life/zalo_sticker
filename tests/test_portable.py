import hashlib
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch as mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import patch
import portable


def write_asar(destination, files):
    tree = {"files": {}}
    offset = 0
    for name, data in files.items():
        node = tree
        parts = name.split("/")
        for part in parts[:-1]:
            node = node["files"].setdefault(part, {"files": {}})
        node["files"][parts[-1]] = {"offset":str(offset),"size":len(data)}
        offset += len(data)
    encoded = json.dumps(tree,separators=(",",":")).encode()
    payload = struct.pack("<I",len(encoded)) + encoded
    payload += b"\0" * (-len(payload)%4)
    header = struct.pack("<I",len(payload)) + payload
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(struct.pack("<II",4,len(header)) + header + b"".join(files.values()))


class PortableTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="giaolang-portable-test-")
        self.directory = Path(self.temp.name).resolve()
        self.archive = self.directory / "Máy của bạn/Zalo-26.11.12/resources/app.asar"
        self.state = self.directory / "Local AppData/GiaoLangStickerPatch"
        self.files = {"package.json":json.dumps({"version":patch.VERSION}).encode(),
            patch.BUNDLE:b" ".join([patch.MODULE_ANCHOR,patch.UI_ANCHOR,patch.SEND_ANCHOR,patch.OPTIONS_ANCHOR]),
            "pc-dist/index.html":b'<html><script src="render.fixture.js"></script></html>',
            "keep-this-file.txt":b"Other machine-specific resources stay unchanged."}
        write_asar(self.archive,self.files)
        self.original = self.archive.read_bytes()
        members = {name:hashlib.sha256(self.files[name]).hexdigest() for name in patch.MEMBER_SHA256}
        self.profile = mock.object(patch,"PROFILES",{patch.VERSION:{"bundle":patch.BUNDLE,"members":members}})
        self.profile.start()
        self.stop_check = mock.object(patch,"ensure_stopped")
        self.stop_check.start()

    def tearDown(self):
        self.stop_check.stop()
        self.profile.stop()
        # Only delete the uniquely-created test directory owned by this test.
        assert self.directory.name.startswith("giaolang-portable-test-")
        assert self.archive.resolve().is_relative_to(self.directory)
        self.temp.cleanup()

    def test_install_reinstall_restore_on_another_machine(self):
        result = portable.install(self.archive,self.state)
        self.assertEqual(result["status"],"installed")
        backup=Path(result["backup"])
        self.assertEqual(backup.read_bytes(),self.original)
        current=patch.Asar(self.archive)
        self.assertEqual(current.read("keep-this-file.txt"),self.files["keep-this-file.txt"])
        self.assertIn(b"giaolang-pack.js",current.read("pc-dist/index.html"))
        self.assertEqual(portable.inspect(self.archive,self.state)[0]["status"],"installed")
        portable.install(self.archive,self.state)
        portable.restore(self.archive,self.state)
        self.assertEqual(self.archive.read_bytes(),self.original)

    def test_dry_run_does_not_modify_or_create_files(self):
        result=portable.install(self.archive,self.state,dry_run=True)
        self.assertTrue(result["dry_run"])
        self.assertEqual(self.archive.read_bytes(),self.original)
        self.assertFalse(self.state.exists())

    def test_running_zalo_blocks_writes(self):
        with mock.object(patch,"ensure_stopped",side_effect=ValueError("Zalo đang chạy")):
            with self.assertRaisesRegex(ValueError,"đang chạy"):
                portable.install(self.archive,self.state)
        self.assertEqual(self.archive.read_bytes(),self.original)

    def test_unsupported_version_is_not_modified(self):
        self.files["package.json"]=b'{"version":"99.1.1"}'
        write_asar(self.archive,self.files)
        original=self.archive.read_bytes()
        with self.assertRaisesRegex(ValueError,"99.1.1"):
            portable.install(self.archive,self.state)
        self.assertEqual(self.archive.read_bytes(),original)

    def test_discovery_chooses_current_version_instead_of_patching_stale_supported_copy(self):
        root=self.archive.parents[2]
        newer=root / "Zalo-99.1.1/resources/app.asar"
        files={**self.files,"package.json":b'{"version":"99.1.1"}'}
        write_asar(newer,files)
        self.assertEqual(portable.discover([root]),newer.resolve())

    def test_macos_app_bundle_install_and_restore(self):
        mac = self.directory / "Applications/Zalo.app/Contents/Resources/app.asar"
        write_asar(mac,self.files)
        original = mac.read_bytes()
        self.assertEqual(portable.discover([mac.parents[2]]),mac.resolve())
        state = self.directory / "Library/Application Support/GiaoLangStickerPatch"
        self.assertEqual(portable.install(mac,state)["status"],"installed")
        self.assertIn(b"giaolang-pack.js",patch.Asar(mac).read("pc-dist/index.html"))
        portable.restore(mac,state)
        self.assertEqual(mac.read_bytes(),original)

    def test_each_supported_version_uses_its_own_bundle(self):
        files = {**self.files,"package.json":b'{"version":"26.11.10"}',"pc-dist/lazy/other.js":self.files[patch.BUNDLE]}
        asar = self.directory / "other/Zalo.app/Contents/Resources/app.asar"
        write_asar(asar,files)
        members = {"pc-dist/lazy/other.js":hashlib.sha256(files["pc-dist/lazy/other.js"]).hexdigest(),
                   "pc-dist/index.html":hashlib.sha256(files["pc-dist/index.html"]).hexdigest()}
        with mock.object(patch,"PROFILES",{"26.11.10":{"bundle":"pc-dist/lazy/other.js","members":members}}):
            portable.install(asar,self.state)
        self.assertIn(b"giaolang-pack.js",patch.Asar(asar).read("pc-dist/index.html"))

    def test_corrupt_backup_blocks_restore(self):
        result=portable.install(self.archive,self.state)
        original=self.archive.read_bytes()
        Path(result["backup"]).write_bytes(b"bad-backup")
        with self.assertRaisesRegex(ValueError,"sao lưu"):
            portable.restore(self.archive,self.state)
        self.assertEqual(self.archive.read_bytes(),original)

    def test_unknown_local_changes_are_not_overwritten(self):
        portable.install(self.archive,self.state)
        with self.archive.open("ab") as stream:
            stream.write(b"unexpected-third-party-change")
        original=self.archive.read_bytes()
        with self.assertRaises(ValueError):
            portable.install(self.archive,self.state)
        self.assertEqual(self.archive.read_bytes(),original)


if __name__=="__main__":
    unittest.main()
