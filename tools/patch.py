"""Build/install/restore an exact-version, reversible Zalo sticker patch."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
ASSETS = Path(getattr(sys, "_MEIPASS", ROOT))
VERSION = "26.11.12"
ORIGINAL_SHA256 = "4c3a7aa9b8fb409a95c6739ef9dccdc01127d0dc4f6383ee396400b7f94484c5"
BUNDLE = "pc-dist/lazy/default-login-main-startup-shared-worker-znotification.82f32878081d885b6bdd.js"
MEMBER_SHA256 = {
    BUNDLE: "36fef10b316f84ceb54044b213366b63e3882c232a4024f2962e6a0be295fdb1",
    "pc-dist/index.html": "8d9753503c1a75bd29ab2e2d53d801d8f21d7a9b46ba817c2d61fe2857e16c2d",
}
# One entry per supported Zalo version. Each is pinned by member hashes, so a
# different build with the same version is still refused. macOS (Intel and Apple
# Silicon share one universal app.asar) is a separate Zalo release from Windows.
PROFILES = {
    VERSION: {"bundle": BUNDLE, "members": MEMBER_SHA256},
    "26.11.10": {
        "bundle": "pc-dist/lazy/default-login-main-startup-shared-worker-znotification.4bb5e1e2c2e9bab4f7b3.js",
        "members": {
            "pc-dist/lazy/default-login-main-startup-shared-worker-znotification.4bb5e1e2c2e9bab4f7b3.js": "32090ad21922a614ad11a12bff9709d269bff273667faa9314d237712abca38e",
            "pc-dist/index.html": "794c6cd9b33148a514482f11ad6a6a1300b768059c3ed1d0dd3cbef14ab85ffc",
        },
    },
}
DEFAULT_ARCHIVE = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs/Zalo" / f"Zalo-{VERSION}/resources/app.asar"
UI_ANCHOR = b"Te.propTypes={sendSticker:c.a.func.isRequired,dispatch:c.a.func.isRequired};var Re=Te,"
MODULE_ANCHOR = b'Em8I:function(t,n,a){"use strict";'
SEND_ANCHOR = b"_sendSticker(e,t,n=null,a=!1){"
OPTIONS_ANCHOR = b"R.propertyExt=E.propertyExt,R.jxlStatus=n.jxlStatus)"
SEND_HOOK = b'''if(e&&e.__giaoLang&&window.GiaoLangSticker)return window.GiaoLangSticker.bridge(this,e,{constants:L,photo:R.a,recents:j,upload:(file,to)=>__giaoLangRequire("UYGI").b.uploadFile({toUid:to,rawFile:file,isGroup:to.startsWith(L.GROUPID_PREFIX),clientId:E.a.next(),extData:{uploadMainType:__giaoLangRequire("1+6A").c.File},feature:__giaoLangRequire("1+6A").a.SendMsg},{},{onStart:()=>{},callbackError:()=>{},signalProgress:()=>{}}),locked:()=>c.ModuleContainer.resolve(gt.b).verifySetting({field:"lockSendMsg",convId:this.convId,showNoti:{windowId:this.windowId,type:"TOAST",config:{textKey:Object(gt.d)(this.convId),type:pt.TOAST_TYPE.ERROR,noBackground:!0},triggerValue:!0}})});'''


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


class Asar:
    def __init__(self, path: Path):
        self.path = path
        with path.open("rb") as stream:
            raw = stream.read(16)
            if len(raw) != 16:
                raise ValueError("Invalid ASAR header")
            size, header_size, payload_size, json_size = struct.unpack("<4I", raw)
            if size != 4 or not 0 < json_size <= payload_size <= header_size <= 16 * 1024 * 1024:
                raise ValueError("Unsupported ASAR header")
            raw_header = stream.read(json_size)
            self.header = json.loads(raw_header)
            # Electron on macOS pins this value in Info.plist (ElectronAsarIntegrity).
            self.header_sha256 = hashlib.sha256(raw_header).hexdigest()
            self.base = 8 + header_size

    def entry(self, name: str):
        node = self.header
        for part in name.split("/"):
            node = node["files"][part]
        return node

    def read(self, name: str) -> bytes:
        entry = self.entry(name)
        if entry.get("unpacked") or "offset" not in entry:
            raise ValueError(f"Not a packed file: {name}")
        with self.path.open("rb") as stream:
            stream.seek(self.base + int(entry["offset"]))
            data = stream.read(entry["size"])
        if len(data) != entry["size"]:
            raise ValueError("Truncated ASAR member")
        return data


def replace_once(source: bytes, before: bytes, after: bytes) -> bytes:
    count = source.count(before)
    if count != 1:
        raise ValueError(f"Patch anchor must occur once; found {count}: {before[:90]!r}")
    return source.replace(before, after, 1)


def integrity(data: bytes, previous: dict | None) -> dict:
    block_size = (previous or {}).get("blockSize", 4 * 1024 * 1024)
    return {"algorithm": "SHA256", "hash": hashlib.sha256(data).hexdigest(),
            "blockSize": block_size,
            "blocks": [hashlib.sha256(data[i:i+block_size]).hexdigest() for i in range(0, len(data), block_size)]}


def validate_profile(source: Path) -> str:
    archive = Asar(source)
    version = json.loads(archive.read("package.json"))["version"]
    if version not in PROFILES:
        raise ValueError(f"Zalo {version} chưa được hỗ trợ; bộ cài này dành cho {', '.join(PROFILES)}.")
    for name, expected in PROFILES[version]["members"].items():
        if hashlib.sha256(archive.read(name)).hexdigest() != expected:
            raise ValueError(f"Mã Zalo {version} không khớp bản đã kiểm tra ({name}). Không ghi đè.")
    return version


def build(source: Path, output: Path, allow_matching_members=False) -> dict:
    original_sha256 = digest(source)
    if not allow_matching_members and original_sha256 != ORIGINAL_SHA256:
        raise ValueError("Bản Zalo không khớp bản gốc 26.11.12 đã kiểm tra. Không sửa tệp.")
    version = validate_profile(source)
    archive = Asar(source)
    bundle_name = PROFILES[version]["bundle"]
    bundle = archive.read(bundle_name)
    # The method's fourth parameter is also named `a` (a boolean), shadowing
    # webpack's factory require. Capture the loader in the factory's own scope.
    bundle = replace_once(bundle, MODULE_ANCHOR,
                          MODULE_ANCHOR + b"const __giaoLangRequire=a;")
    bundle = replace_once(bundle, UI_ANCHOR,
                          UI_ANCHOR.replace(b";var Re=Te,", b";window.GiaoLangSticker&&window.GiaoLangSticker.install(i.a,Te);var Re=Te,"))
    bundle = replace_once(bundle, SEND_ANCHOR, SEND_ANCHOR + SEND_HOOK)
    bundle = replace_once(bundle, OPTIONS_ANCHOR,
                          b"R.propertyExt=E.propertyExt,R.jxlStatus=n.jxlStatus,void 0!==E.pStickerType&&(R.pStickerType=E.pStickerType))")
    index = replace_once(archive.read("pc-dist/index.html"), b'<script src="render.',
                         b'<script src="giaolang-zip.js"></script><script src="giaolang-pack.js"></script><script src="giaolang-stickers.js"></script><script src="render.')
    zip_code = b"/* fflate 0.8.3, MIT. See giaolang-fflate-LICENSE.txt. */\n(function(module,exports,define){\n" + (ASSETS / "vendor/fflate/index.js").read_bytes() + b"\n;globalThis.GiaoLangZip=globalThis.fflate;})(undefined,undefined,undefined);"
    changes = {bundle_name: bundle, "pc-dist/index.html": index,
               "pc-dist/giaolang-stickers.js": (ASSETS / "src/giaolang-stickers.js").read_bytes(),
               "pc-dist/giaolang-pack.js": (ASSETS / "src/sticker-pack.js").read_bytes(),
               "pc-dist/giaolang-zip.js": zip_code,
               "pc-dist/giaolang-fflate-LICENSE.txt": (ASSETS / "vendor/fflate/LICENSE").read_bytes()}
    tree = copy.deepcopy(archive.header)
    offset = source.stat().st_size - archive.base
    for name, data in changes.items():
        node = tree
        parts = name.split("/")
        for part in parts[:-1]:
            node = node["files"][part]
        old = node["files"].get(parts[-1], {})
        entry = {"size": len(data), "offset": str(offset)}
        if old.get("integrity"):
            entry["integrity"] = integrity(data, old["integrity"])
        node["files"][parts[-1]] = entry
        offset += len(data)
    encoded = json.dumps(tree, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    payload = struct.pack("<I", len(encoded)) + encoded
    payload += b"\0" * (-len(payload) % 4)
    header = struct.pack("<I", len(payload)) + payload
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as dest, source.open("rb") as original:
        dest.write(struct.pack("<II", 4, len(header)))
        dest.write(header)
        original.seek(archive.base)
        shutil.copyfileobj(original, dest)
        for data in changes.values():
            dest.write(data)
    patched = Asar(output)
    for name, data in changes.items():
        if patched.read(name) != data:
            raise ValueError(f"Patch verification failed: {name}")
    # Verify every original packed member; offsets of untouched members stay the same.
    def walk(node, prefix=""):
        for name, entry in node.get("files", {}).items():
            full = prefix + name
            if "files" in entry:
                yield from walk(entry, full + "/")
            elif "offset" in entry and not entry.get("unpacked"):
                yield full, entry
    unchanged = 0
    with source.open("rb") as old, output.open("rb") as new:
        for name, entry in walk(archive.header):
            if name in changes:
                continue
            old.seek(archive.base + int(entry["offset"]))
            new.seek(patched.base + int(patched.entry(name)["offset"]))
            remaining = entry["size"]
            while remaining:
                size = min(remaining, 1024 * 1024)
                if old.read(size) != new.read(size):
                    raise ValueError(f"Untouched member changed: {name}")
                remaining -= size
            unchanged += 1
    report = {"version": version, "original_sha256": original_sha256,
              "patched_sha256": digest(output), "changed_members": list(changes),
              "unchanged_members_verified": unchanged, "output": str(output)}
    (output.parent / "patch-manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def ensure_stopped():
    if sys.platform == "darwin":
        # -x: exact name, so "Zalo Helper" and this tool are not matched.
        if subprocess.run(["pgrep", "-x", "Zalo"], capture_output=True).returncode == 0:
            raise ValueError("Zalo đang chạy. Thoát hẳn Zalo (Zalo → Thoát Zalo, hoặc ⌘Q) rồi chạy lại.")
        return
    result = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
                             "@(Get-Process -Name Zalo -ErrorAction SilentlyContinue).Count"],
                            capture_output=True, text=True, check=True)
    if int(result.stdout.strip() or "0"):
        raise ValueError("Zalo đang chạy. Chọn Cài đặt → Thoát Zalo rồi chạy lại để tránh thay tệp đang dùng.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "install", "restore", "status"])
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    args = parser.parse_args()
    archive = args.archive.resolve()
    backup = ROOT / "backups" / f"app-{VERSION}-{ORIGINAL_SHA256[:12]}.asar"
    if args.action == "status":
        print(json.dumps({"archive": str(archive), "sha256": digest(archive),
                          "original": digest(archive) == ORIGINAL_SHA256,
                          "has_backup": backup.exists()}, indent=2))
        return
    if args.action == "restore":
        ensure_stopped()
        if not backup.exists() or digest(backup) != ORIGINAL_SHA256:
            raise ValueError("Không tìm thấy bản sao lưu gốc hợp lệ.")
        # Only restore the same explicitly supported app directory.
        if json.loads(Asar(archive).read("package.json"))["version"] != VERSION:
            raise ValueError("Không khôi phục đè lên phiên bản Zalo khác.")
        tmp = archive.with_name("app.asar.giaolang-restoring")
        shutil.copy2(backup, tmp)
        os.replace(tmp, archive)
        print("Đã khôi phục Zalo gốc; bộ sticker vẫn còn trong dữ liệu cục bộ.")
        return
    source = archive if digest(archive) == ORIGINAL_SHA256 else backup
    if not source.exists():
        raise ValueError("Ứng dụng đã thay đổi và chưa có bản sao lưu đúng phiên bản.")
    output = ROOT / "build" / f"app-{VERSION}-giaolang.asar"
    report = build(source, output)
    if args.action == "install":
        ensure_stopped()
        current_digest = digest(archive)
        previous_manifest = ROOT / "backups/install-manifest.json"
        if current_digest != ORIGINAL_SHA256:
            previous = json.loads(previous_manifest.read_text(encoding="utf-8")) if previous_manifest.exists() else {}
            if current_digest != previous.get("patched_sha256"):
                raise ValueError("Zalo hiện có thay đổi khác. Không ghi đè bản vá chưa xác định.")
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(archive, backup)
        if digest(backup) != ORIGINAL_SHA256:
            raise ValueError("Sai mã kiểm tra bản sao lưu. Không cài.")
        tmp = archive.with_name("app.asar.giaolang-installing")
        shutil.copy2(output, tmp)
        if digest(tmp) != report["patched_sha256"]:
            raise ValueError("Bản sao cài đặt không khớp.")
        os.replace(tmp, archive)
        report.update({"installed_archive": str(archive), "backup": str(backup)})
        previous_manifest.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"Lỗi: {error}", file=sys.stderr)
        sys.exit(1)
