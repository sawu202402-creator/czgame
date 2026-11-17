import os
import shutil
import sys
import zipfile

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(ROOT_DIR, "dist")

# Host-only files that should NOT be inside CrazyGames / Poki upload bundles
EXCLUDED_ROOT_FILES = {".nojekyll", "_headers", "manifest.json", ".DS_Store"}

TARGETS = {
    "crazygames": {
        "zip_name": "crazygames-release.zip",
        "must_include": "sdk.crazygames.com/crazygames-sdk-v3.js",
        "must_exclude": "poki",
    },
    "poki": {
        "zip_name": "poki-release.zip",
        "must_include": "game-cdn.poki.com/scripts/v2/poki-sdk.js",
        "must_exclude": "crazygames",
    },
}


def pack_target(target_key: str) -> None:
    if target_key not in TARGETS:
        raise SystemExit(f"Unknown target '{target_key}'. Expected one of: {', '.join(TARGETS)}")

    cfg = TARGETS[target_key]
    index_path = os.path.join(DIST_DIR, "index.html")
    if not os.path.isfile(index_path):
        raise SystemExit("Error: dist/index.html not found! Run Vite build first.")

    with open(index_path, "r", encoding="utf-8") as fh:
        html_text = fh.read()

    if cfg["must_include"] not in html_text:
        raise SystemExit(
            f"Error: dist/index.html is missing required SDK '{cfg['must_include']}' for {target_key}!"
        )
    if cfg["must_exclude"] in html_text.lower():
        raise SystemExit(
            f"Error: dist/index.html contains forbidden competitor keyword '{cfg['must_exclude']}'!"
        )

    # Audit built JS files to guarantee zero competitor SDK references
    assets_dir = os.path.join(DIST_DIR, "assets")
    if os.path.isdir(assets_dir):
        for fname in os.listdir(assets_dir):
            if fname.endswith(".js"):
                fpath = os.path.join(assets_dir, fname)
                with open(fpath, "r", encoding="utf-8", errors="ignore") as jf:
                    js_text = jf.read().lower()
                if cfg["must_exclude"] in js_text:
                    raise SystemExit(
                        f"Error: {fname} contains forbidden competitor symbol '{cfg['must_exclude']}'!"
                    )

    out_zip = os.path.join(ROOT_DIR, cfg["zip_name"])
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for root, _, files in os.walk(DIST_DIR):
            for f in sorted(files):
                if f in EXCLUDED_ROOT_FILES or f.startswith("."):
                    continue
                abs_p = os.path.join(root, f)
                rel_p = os.path.relpath(abs_p, DIST_DIR)
                zf.write(abs_p, rel_p)

    size_mb = os.path.getsize(out_zip) / (1024 * 1024)
    print(f"[{target_key.upper()}] Created {out_zip} ({size_mb:.2f} MB) — SDK audit PASSED.")

    if target_key == "crazygames":
        out_folder = os.path.join(ROOT_DIR, "crazygames-upload")
        if os.path.exists(out_folder):
            shutil.rmtree(out_folder)
        os.makedirs(out_folder, exist_ok=True)
        for root, dirs, files in os.walk(DIST_DIR):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            rel_dir = os.path.relpath(root, DIST_DIR)
            dst_dir = out_folder if rel_dir == "." else os.path.join(out_folder, rel_dir)
            os.makedirs(dst_dir, exist_ok=True)
            for f in sorted(files):
                if f in EXCLUDED_ROOT_FILES or f.startswith("."):
                    continue
                shutil.copy2(os.path.join(root, f), os.path.join(dst_dir, f))
        print(f"[CRAZYGAMES] Clean drag-and-drop folder ready: {out_folder}")


if __name__ == "__main__":
    target = sys.argv[1].strip().lower() if len(sys.argv) > 1 else "crazygames"
    pack_target(target)
