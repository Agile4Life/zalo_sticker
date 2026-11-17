"""Build a clean standalone Windows ZIP, using an explicit release allowlist."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = "0.2.1"


def main():
    output = ROOT / "dist"
    work = ROOT / "build/pyinstaller"
    subprocess.run([sys.executable,"-m","PyInstaller","--noconfirm","--clean","--onefile","--console",
        "--name","GiaoLangStickerPatch","--distpath",str(output / "binary"),"--workpath",str(work),
        "--specpath",str(work),"--paths",str(ROOT / "tools"),
        "--add-data",f"{ROOT / 'src'};src","--add-data",f"{ROOT / 'vendor'};vendor",
        str(ROOT / "tools/portable.py")],check=True,cwd=ROOT)
    release = output / f"GiaoLangSticker-{VERSION}-Windows-x64"
    release.mkdir(parents=True,exist_ok=True)
    shutil.copy2(output / "binary/GiaoLangStickerPatch.exe",release / "GiaoLangStickerPatch.exe")
    shutil.copy2(ROOT / "distribution/README.txt",release / "README.txt")
    shutil.copy2(ROOT / "vendor/fflate/LICENSE",release / "fflate-LICENSE.txt")
    for name,action in [("install.cmd","install"),("uninstall.cmd","restore"),("status.cmd","status")]:
        body=f'@echo off\r\nsetlocal\r\nchcp 65001 >nul\r\n"%~dp0GiaoLangStickerPatch.exe" {action} %*\r\nset "GIAOLANG_RESULT=%ERRORLEVEL%"\r\nif not "%GIAOLANG_RESULT%"=="0" echo Xem README.txt de khac phuc loi.\r\nexit /b %GIAOLANG_RESULT%\r\n'
        body = body.replace('exit /b %GIAOLANG_RESULT%', 'if "%~1"=="" pause\r\nexit /b %GIAOLANG_RESULT%')
        (release / name).write_bytes(body.encode("utf-8"))
    allowed=["GiaoLangStickerPatch.exe","README.txt","fflate-LICENSE.txt","install.cmd","uninstall.cmd","status.cmd"]
    hashes={name:hashlib.sha256((release / name).read_bytes()).hexdigest() for name in allowed}
    (release / "SHA256SUMS.json").write_text(json.dumps(hashes,indent=2),encoding="utf-8")
    archive=output / f"GiaoLangSticker-{VERSION}-Windows-x64.zip"
    with zipfile.ZipFile(archive,"w",compression=zipfile.ZIP_DEFLATED) as stream:
        for name in [*allowed,"SHA256SUMS.json"]:
            stream.write(release / name,f"{release.name}/{name}")
    with zipfile.ZipFile(archive) as stream:
        assert len(stream.namelist())==7
        assert all(Path(name).suffix in {".exe",".txt",".cmd",".json"} for name in stream.namelist())
    checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
    (output / (archive.name + ".sha256")).write_text(checksum + "  " + archive.name + "\n",encoding="utf-8")
    print(json.dumps({"zip":str(archive),"bytes":archive.stat().st_size,"sha256":checksum},indent=2))


if __name__=="__main__":
    main()
