"""Standalone Windows / macOS installer for GiaoLang personal stickers."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import patch

PATCH_VERSION = "0.2.1"


def version_key(value):
    return tuple(int(part) if part.isdigit() else 0 for part in value.split("."))


def installed_roots():
    roots = [Path(os.environ[env]) / suffix for env, suffix in [
        ("LOCALAPPDATA", "Programs/Zalo"), ("LOCALAPPDATA", "Zalo"),
        ("ProgramFiles", "Zalo"), ("ProgramFiles(x86)", "Zalo")]
        if os.environ.get(env)]
    if sys.platform == "darwin":
        roots += [Path("/Applications/Zalo.app"), Path.home() / "Applications/Zalo.app"]
    if sys.platform == "win32":
        import winreg
        for hive in [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]:
            for view in [winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY]:
                try:
                    with winreg.OpenKey(hive, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Zalo.exe", 0, winreg.KEY_READ | view) as key:
                        exe = Path(winreg.QueryValue(key, None).strip('"'))
                        roots.append(exe.parent)
                except OSError:
                    pass
    return list(dict.fromkeys(root.resolve() for root in roots if root.is_dir()))


def discover(roots=None):
    choices = []
    for root in roots if roots is not None else installed_roots():
        candidates = []
        for archive in [root / "resources/app.asar", root / "Contents/Resources/app.asar", *root.glob("Zalo-*/resources/app.asar")]:
            if not archive.is_file():
                continue
            try:
                version = json.loads(patch.Asar(archive).read("package.json"))["version"]
                candidates.append((version_key(version), archive.resolve()))
            except (ValueError, KeyError, OSError):
                continue
        if candidates:
            choices.append(max(candidates, key=lambda row: row[0])[1])
    choices = list(dict.fromkeys(choices))
    if len(choices) != 1:
        if not choices:
            example = "/Applications/Zalo.app/Contents/Resources/app.asar" if sys.platform == "darwin" else "D:\\...\\resources\\app.asar"
            raise ValueError(f"Không tìm thấy Zalo PC. Dùng --archive \"{example}\" để chỉ đường dẫn.")
        raise ValueError("Có nhiều bản Zalo. Chọn một bản bằng --archive:\n" + "\n".join(map(str, choices)))
    return choices[0]


def state_paths(archive, state_root):
    target = hashlib.sha256(str(archive.resolve()).casefold().encode("utf-8")).hexdigest()[:20]
    directory = state_root / target
    return directory, directory / "install.json"


def read_state(manifest, archive):
    if manifest.is_file():
        info = json.loads(manifest.read_text(encoding="utf-8"))
        if Path(info["archive"]).resolve() != archive.resolve():
            raise ValueError("Bản sao lưu thuộc một thư mục Zalo khác.")
        return info
    # Migrate an earlier developer installation only when its exact digest and
    # target path agree. These legacy files are never bundled for distribution.
    legacy = patch.ROOT / "backups/install-manifest.json"
    if not getattr(sys, "frozen", False) and legacy.is_file():
        info = json.loads(legacy.read_text(encoding="utf-8"))
        if Path(info.get("installed_archive", "")).resolve() == archive.resolve() and patch.digest(archive) == info.get("patched_sha256"):
            return {"archive":str(archive), "backup":info["backup"],
                    "original_sha256":info["original_sha256"], "patched_sha256":info["patched_sha256"], "legacy":True}
    return None


def verified_backup(info):
    backup = Path(info["backup"])
    if not backup.is_file() or patch.digest(backup) != info["original_sha256"]:
        raise ValueError("Bản sao lưu gốc bị thiếu hoặc không khớp. Không thay tệp Zalo.")
    patch.validate_profile(backup)
    return backup


def inspect(archive, state_root):
    if not archive.is_file():
        raise ValueError("Không tìm thấy app.asar: " + str(archive))
    version = json.loads(patch.Asar(archive).read("package.json"))["version"]
    if version not in patch.PROFILES:
        raise ValueError(f"Máy đang có Zalo {version}; bộ cài này mới hỗ trợ {', '.join(patch.PROFILES)}. Không thay tệp.")
    directory, manifest = state_paths(archive, state_root)
    info = read_state(manifest, archive)
    current = patch.digest(archive)
    if info and current in [info["patched_sha256"], *info.get("known_patched_sha256", [])]:
        source = verified_backup(info)
        status = "installed"
    else:
        patch.validate_profile(archive)
        source = archive
        status = "original"
    installed_version = None
    if status == "installed":
        match = re.search(rb"const VERSION = '([^']+)';", patch.Asar(archive).read("pc-dist/giaolang-stickers.js"))
        installed_version = match.group(1).decode("ascii") if match else "unknown"
    return {"status":status,"archive":str(archive),"version":version,"patch_version":installed_version,
            "available_patch_version":PATCH_VERSION,
            "current_sha256":current,"source":str(source),"state_directory":str(directory)}, info


def default_state_dir():
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/GiaoLangStickerPatch"
    return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "GiaoLangStickerPatch"


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def install(archive, state_root, dry_run=False):
    plan, info = inspect(archive, state_root)
    if dry_run:
        return {**plan,"dry_run":True,"message":"Chỉ kiểm tra; chưa cài hoặc thay tệp."}
    patch.ensure_stopped()
    directory, manifest = state_paths(archive, state_root)
    directory.mkdir(parents=True, exist_ok=True)
    source = Path(plan["source"])
    original_sha = patch.digest(source)
    backup = directory / ("original-" + original_sha + ".asar")
    if not backup.exists():
        shutil.copy2(source, backup)
    if patch.digest(backup) != original_sha:
        raise ValueError("Không xác minh được bản sao lưu. Chưa cài.")
    with tempfile.TemporaryDirectory(prefix="giaolang-build-") as temp:
        output = Path(temp) / "app.asar"
        report = patch.build(backup, output, allow_matching_members=True)
        patch.ensure_stopped()
        if patch.digest(archive) != plan["current_sha256"]:
            raise ValueError("Zalo vừa thay đổi trong lúc chuẩn bị. Chưa cài.")
        # Write recovery metadata before the atomic app replacement; a crash
        # cannot leave a patched app without its original hash and backup path.
        record = {**plan,"patch_version":PATCH_VERSION,"backup":str(backup),"original_sha256":original_sha,
                  "patched_sha256":report["patched_sha256"],"installed_at":datetime.now(timezone.utc).isoformat()}
        record["known_patched_sha256"] = list(dict.fromkeys([
            *([] if not info else [info["patched_sha256"], *info.get("known_patched_sha256", [])]),
            report["patched_sha256"]]))
        atomic_json(manifest, record)
        staged = archive.with_name("app.asar.giaolang-installing")
        try:
            shutil.copy2(output, staged)
            if patch.digest(staged) != report["patched_sha256"]:
                raise ValueError("Tệp cài bị lỗi kiểm tra. Chưa cài.")
            os.replace(staged, archive)
        finally:
            if staged.exists():
                staged.unlink()
    return {"status":"installed","version":PATCH_VERSION,"archive":str(archive),"backup":str(backup),
            "message":"Đã cài. Mở lại Zalo → Sticker → ★. Bộ sticker cũ được giữ nguyên."}


def restore(archive, state_root, dry_run=False):
    plan, info = inspect(archive, state_root)
    if plan["status"] == "original":
        return {**plan,"message":"Zalo đang dùng bản gốc; không cần gỡ."}
    source = verified_backup(info)
    if dry_run:
        return {**plan,"dry_run":True,"message":"Có thể khôi phục bản gốc; chưa thay tệp."}
    patch.ensure_stopped()
    staged = archive.with_name("app.asar.giaolang-restoring")
    try:
        shutil.copy2(source, staged)
        if patch.digest(staged) != info["original_sha256"]:
            raise ValueError("Không xác minh được tệp khôi phục.")
        if patch.digest(archive) != plan["current_sha256"]:
            raise ValueError("Tệp Zalo vừa thay đổi. Không ghi đè.")
        os.replace(staged, archive)
    finally:
        if staged.exists():
            staged.unlink()
    return {"status":"original","archive":str(archive),"message":"Đã gỡ bản vá. Bộ sticker đã lưu không bị xóa."}


def main():
    parser = argparse.ArgumentParser(description=f"GiaoLang Sticker {PATCH_VERSION} — Zalo PC {', '.join(patch.PROFILES)}; Windows x64, macOS Intel / Apple Silicon")
    parser.add_argument("action",choices=["install","restore","status","build"],nargs="?",default="install")
    parser.add_argument("--archive",type=Path,help="Đường dẫn app.asar nếu Zalo nằm ở vị trí khác (macOS: Zalo.app/Contents/Resources/app.asar)")
    parser.add_argument("--state-dir",type=Path,default=default_state_dir())
    parser.add_argument("--dry-run",action="store_true",help="Chỉ kiểm tra, không cài hoặc gỡ")
    parser.add_argument("--output",type=Path,help="Tệp ASAR đầu ra cho lệnh build")
    parser.add_argument("--version",action="version",version=PATCH_VERSION)
    args = parser.parse_args()
    archive = args.archive.resolve() if args.archive else discover()
    if args.output and args.action != "build":
        parser.error("--output chỉ dùng cùng lệnh build")
    if args.action == "build":
        plan, _ = inspect(archive,args.state_dir)
        output = (args.output or Path.cwd() / f"build/app-{patch.VERSION}-giaolang.asar").resolve()
        source = Path(plan["source"]).resolve()
        if output in [archive.resolve(),source]:
            raise ValueError("Tệp đầu ra phải khác tệp Zalo và bản sao lưu gốc.")
        if args.dry_run:
            result = {**plan,"output":str(output),"dry_run":True}
        else:
            result = patch.build(source,output,allow_matching_members=True)
    elif args.action == "status":
        result = inspect(archive,args.state_dir)[0]
    else:
        result = (install if args.action == "install" else restore)(archive,args.state_dir,args.dry_run)
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__ == "__main__":
    for stream in [sys.stdout,sys.stderr]:
        if stream and hasattr(stream,"reconfigure"):
            stream.reconfigure(encoding="utf-8",errors="replace")
    try:
        main()
    except (ValueError,OSError,KeyError,subprocess.SubprocessError) as error:
        print("Lỗi: " + str(error),file=sys.stderr)
        if isinstance(error,PermissionError) and sys.platform == "darwin":
            print("macOS chặn ghi vào ứng dụng khác. Mở Cài đặt hệ thống → Quyền riêng tư & Bảo mật → "
                  "Quản lý ứng dụng (hoặc Toàn quyền truy cập đĩa), bật cho Terminal rồi chạy lại.",file=sys.stderr)
        sys.exit(1)
