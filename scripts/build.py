"""Bundle a single, offline HTML page using only the Python standard library."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
page = (ROOT / "src/index.template.html").read_text()
for marker, filename in {
    "STYLES": "src/styles.css",
    "PDF_LIBRARY": "vendor/jspdf.umd.min.js",
    "CORE": "src/core.js",
    "PREVIEW": "src/preview.js",
    "APP": "src/app.js",
}.items():
    content = (ROOT / filename).read_text()
    if marker != "STYLES":
        content = re.sub(r"</script", r"<\\/script", content, flags=re.IGNORECASE)
    page = page.replace(f"/* {marker} */", content)
(ROOT / "index.html").write_text(page)
print(f"Built index.html ({len(page.encode()):,} bytes)")
