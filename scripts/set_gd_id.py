#!/usr/bin/env python3
import os
import re
import sys
import zipfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP_PATH = os.path.join(ROOT_DIR, "gd-release.zip")


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        raise SystemExit("Usage: python3 scripts/set_gd_id.py <32_CHAR_GD_GAME_ID>")
    game_id = sys.argv[1].strip()
    if not re.fullmatch(r"[0-9a-fA-F]{32}", game_id):
        print(f"Warning: '{game_id}' is not a standard 32-hex ID, writing anyway...")
    if not os.path.isfile(ZIP_PATH):
        raise SystemExit(f"Error: {ZIP_PATH} not found! Run `npm run pack:gd` first.")

    tmp_zip = ZIP_PATH + ".tmp"
    new_cfg = (
        "// Configured GameDistribution Game ID\n"
        f'window.CZ_GD_GAME_ID = "{game_id}";\n'
    ).encode("utf-8")

    with zipfile.ZipFile(ZIP_PATH, "r") as zin, zipfile.ZipFile(
        tmp_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9
    ) as zout:
        wrote_cfg = False
        for item in zin.infolist():
            if item.filename == "gd-config.js":
                zout.writestr("gd-config.js", new_cfg)
                wrote_cfg = True
            else:
                zout.writestr(item, zin.read(item.filename))
        if not wrote_cfg:
            zout.writestr("gd-config.js", new_cfg)

    os.replace(tmp_zip, ZIP_PATH)
    print(f"[GD] Updated gd-release.zip with Game ID: {game_id}")


if __name__ == "__main__":
    main()
