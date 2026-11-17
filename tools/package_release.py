"""Build a clean standalone ZIP for the current OS/arch (Windows x64, macOS arm64 or x64), using an explicit release allowlist."""
from pathlib import Path
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.2.1"
MAC = sys.platform == "darwin"
if not MAC and sys.platform != "win32":
    raise SystemExit("Chỉ đóng gói được trên Windows hoặc macOS.")
# PyInstaller builds for the arch of the Python running it, so build once per arch.
PLATFORM = "macOS-" + {"arm64": "arm64", "x86_64": "x64"}[platform.machine()] if MAC else "Windows-x64"
BINARY = "GiaoLangStickerPatch" + ("" if MAC else ".exe")


def main():
    output = ROOT / "dist"
    work = ROOT / "build/pyinstaller"
    subprocess.run([sys.executable,"-m","PyInstaller","--noconfirm","--clean","--onefile","--console",
        "--name","GiaoLangStickerPatch","--distpath",str(output / "binary"),"--workpath",str(work),
        "--specpath",str(work),"--paths",str(ROOT / "tools"),
        "--add-data",f"{ROOT / 'src'}{os.pathsep}src","--add-data",f"{ROOT / 'vendor'}{os.pathsep}vendor",
        str(ROOT / "tools/portable.py")],check=True,cwd=ROOT)
    release = output / f"GiaoLangSticker-{VERSION}-{PLATFORM}"
    release.mkdir(parents=True,exist_ok=True)
    shutil.copy2(output / "binary" / BINARY,release / BINARY)
    shutil.copy2(ROOT / ("distribution/README-macos.txt" if MAC else "distribution/README.txt"),release / "README.txt")
    shutil.copy2(ROOT / "vendor/fflate/LICENSE",release / "fflate-LICENSE.txt")
    for name,action in [("install","install"),("uninstall","restore"),("status","status")]:
        if MAC:
            # .command files open in Terminal when double-clicked in Finder.
            name += ".command"
            body=f'#!/bin/sh\ncd "$(dirname "$0")" || exit 1\n./{BINARY} {action} "$@"\nrc=$?\n[ $rc -eq 0 ] || echo "Xem README.txt de khac phuc loi."\n[ $# -eq 0 ] && {{ printf "Nhan Enter de dong..."; read _; }}\nexit $rc\n'
            (release / name).write_bytes(body.encode("utf-8"))
            (release / name).chmod(0o755)
            continue
        name += ".cmd"
        body=f'@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n"%~dp0GiaoLangStickerPatch.exe" {action} %*\r\nset "GIAOLANG_RESULT=%ERRORLEVEL%"\r\nif not "%GIAOLANG_RESULT%"=="0" echo Xem README.txt de khac phuc loi.\r\nexit /b %GIAOLANG_RESULT%\r\n'
        body = body.replace('exit /b %GIAOLANG_RESULT%', 'if "%~1"=="" pause\r\nexit /b %GIAOLANG_RESULT%')
        (release / name).write_bytes(body.encode("utf-8"))
    script="command" if MAC else "cmd"
    allowed=[BINARY,"README.txt","fflate-LICENSE.txt",f"install.{script}",f"uninstall.{script}",f"status.{script}"]
    hashes={name:hashlib.sha256((release / name).read_bytes()).hexdigest() for name in allowed}
    (release / "SHA256SUMS.json").write_text(json.dumps(hashes,indent=2),encoding="utf-8")
    archive=output / f"GiaoLangSticker-{VERSION}-{PLATFORM}.zip"
    with zipfile.ZipFile(archive,"w",compression=zipfile.ZIP_DEFLATED) as stream:
        for name in [*allowed,"SHA256SUMS.json"]:
            stream.write(release / name,f"{release.name}/{name}")
    with zipfile.ZipFile(archive) as stream:
        assert len(stream.namelist())==7
        assert all(Path(name).suffix in {".exe",".txt",".cmd",".command",".json",""} for name in stream.namelist())
    checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / (archive.name + ".sha256")).write_text(checksum + "  " + archive.name + "\n",encoding="utf-8")
    print(json.dumps({"zip":str(archive),"bytes":archive.stat().st_size,"sha256":checksum},indent=2))


if __name__=="__main__":
    main()
