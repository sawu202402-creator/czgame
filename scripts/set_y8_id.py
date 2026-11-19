#!/usr/bin/env python3
import os
import sys
import zipfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZIP_PATH = os.path.join(ROOT_DIR, "y8-release.zip")


def main() -> None:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        raise SystemExit("Usage: python3 scripts/set_y8_id.py <Y8_APP_ID> [Y8_GAME_ID]")
    app_id = sys.argv[1].strip()
    game_id = sys.argv[2].strip() if len(sys.argv) > 2 else ""

    if not os.path.isfile(ZIP_PATH):
        raise SystemExit(f"Error: {ZIP_PATH} not found! Run `npm run pack:y8` first.")

    tmp_zip = ZIP_PATH + ".tmp"
    new_cfg = (
        "// Configured Y8 App ID & Game ID\n"
        f'window.CZ_Y8_APP_ID = "{app_id}";\n'
        f'window.CZ_Y8_GAME_ID = "{game_id}";\n'
    ).encode("utf-8")

    with zipfile.ZipFile(ZIP_PATH, "r") as zin, zipfile.ZipFile(
        tmp_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9
    ) as zout:
        wrote_cfg = False
        for item in zin.infolist():
            if item.filename == "y8-config.js":
                zout.writestr("y8-config.js", new_cfg)
                wrote_cfg = True
            else:
                zout.writestr(item, zin.read(item.filename))
        if not wrote_cfg:
            zout.writestr("y8-config.js", new_cfg)

    os.replace(tmp_zip, ZIP_PATH)
    print(f"[Y8] Updated y8-release.zip with App ID: {app_id}" + (f", Game ID: {game_id}" if game_id else ""))


if __name__ == "__main__":
    main()
