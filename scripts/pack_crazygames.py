import os
import zipfile

dist_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
out_zip = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "crazygames-release.zip")

if not os.path.isfile(os.path.join(dist_dir, "index.html")):
    raise SystemExit("Error: dist/index.html not found! Run npm run build first.")

with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, _, files in os.walk(dist_dir):
        for f in sorted(files):
            abs_p = os.path.join(root, f)
            rel_p = os.path.relpath(abs_p, dist_dir)
            zf.write(abs_p, rel_p)

size_mb = os.path.getsize(out_zip) / (1024 * 1024)
print(f"Created {out_zip} ({size_mb:.2f} MB) with index.html at archive root.")
