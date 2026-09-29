"""
Generate font subset and TypeScript font module for jsPDF quiz export.

Requirements:
  - fonttools (pip install fonttools)
  - DejaVu Sans (bundled in matplotlib or system) or Arial fallback

Usage:
  python scripts/generate_font_subset.py

Outputs:
  frontend/src/lib/quiz-export-font.ts   -- TS module exporting font b64 string
"""

import sys
import subprocess
import base64
import os
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

# fonttools is installed in user site-packages or venv
SITE_PACKAGES = [
    Path(os.environ.get("APPDATA", "")) / "Python" / "Python312" / "site-packages",
    Path("backend/venv/Lib/site-packages"),
]
for sp in SITE_PACKAGES:
    if sp.exists():
        sys.path.insert(0, str(sp))

try:
    from fontTools.ttLib import TTFont
except ImportError:
    print("ERROR: fonttools not installed.", file=sys.stderr)
    print("  Run: pip install fonttools", file=sys.stderr)
    sys.exit(1)

# Locate pyftsubset
PYFTSUBSET = None
for sp in SITE_PACKAGES:
    cand = sp.parent / "Scripts" / "pyftsubset.exe"
    if cand.exists():
        PYFTSUBSET = cand
        break
    cand_unix = sp.parent / "bin" / "pyftsubset"
    if cand_unix.exists():
        PYFTSUBSET = cand_unix
        break

if not PYFTSUBSET:
    import shutil
    cand_path = shutil.which("pyftsubset")
    if cand_path:
        PYFTSUBSET = Path(cand_path)

if not PYFTSUBSET or not PYFTSUBSET.exists():
    print("ERROR: pyftsubset executable not found.", file=sys.stderr)
    sys.exit(1)

def find_dejavu_font() -> tuple[Path, str]:
    """
    Locates the DejaVu Sans TTF font source.
    Pinned strictly to DejaVu Sans; does NOT fall back to system Arial.
    """
    # 1. Check for DejaVu Sans via matplotlib font manager
    try:
        import matplotlib.font_manager
        p = Path(matplotlib.font_manager.findfont("DejaVu Sans"))
        if p.exists() and "dejavu" in p.name.lower():
            return p, "DejaVuSans"
    except Exception:
        pass

    # 2. Check site-packages matplotlib mpl-data fonts
    for sp in SITE_PACKAGES:
        cand = sp / "matplotlib" / "mpl-data" / "fonts" / "ttf" / "DejaVuSans.ttf"
        if cand.exists():
            return cand, "DejaVuSans"

    # 3. Common OS paths for DejaVu Sans
    common_dejavu = [
        Path(r"C:\Windows\Fonts\DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/local/share/fonts/DejaVuSans.ttf"),
        Path("/Library/Fonts/DejaVuSans.ttf"),
    ]
    for c in common_dejavu:
        if c.exists():
            return c, "DejaVuSans"

    raise RuntimeError(
        "ERROR: Required font 'DejaVuSans.ttf' was not found.\n"
        "DejaVu Sans is required for lossless Unicode PDF export (fallback to Arial is disabled).\n"
        "To resolve, install matplotlib ('pip install matplotlib') or provide DejaVuSans.ttf in system fonts."
    )

FONT_PATH, FONT_NAME = find_dejavu_font()

TEMP_TTF = Path("scripts/_temp_subset.ttf")
OUTPUT_TS = Path("frontend/src/lib/quiz-export-font.ts")

# Unicode ranges:
#   Basic Latin (0020-007E)
#   Latin-1 Supplement (00A0-00FF)
#   Greek (0370-03FF)
#   General Punctuation (2010-206F: — – ' " " • … and U+2011)
#   Superscripts/Subscripts (2070-209F: ², etc.)
#   Currency/Letterlike (2100-214F: ℃, etc.)
#   Arrows (2190-21FF: →, ←, ↔)
#   Math Operators (2200-22FF: ≤, ≥, ≠, ≈, ⊂, √, etc.)
UNICODES = "U+0020-007E,U+00A0-00FF,U+0370-03FF,U+2010-206F,U+2070-209F,U+2100-214F,U+2190-21FF,U+2200-22FF"

print(f"Subsetting: {FONT_PATH.name} ({FONT_NAME})")
result = subprocess.run(
    [str(PYFTSUBSET), str(FONT_PATH), f"--unicodes={UNICODES}", f"--output-file={TEMP_TTF}"],
    capture_output=True, text=True
)
if result.returncode != 0:
    print("ERROR from pyftsubset:", result.stderr)
    sys.exit(1)
if result.stderr:
    print("pyftsubset warnings:", result.stderr.strip())

raw_size = TEMP_TTF.stat().st_size
b64_data = base64.b64encode(TEMP_TTF.read_bytes()).decode("ascii")
b64_size = len(b64_data)
print(f"Subset TTF: {raw_size // 1024} KB raw, {b64_size // 1024} KB base64")
print(f"Lazy-loaded on PDF export click: +{b64_size // 1024} KB chunk (0 KB in main bundle)")

# Check coverage
font = TTFont(str(TEMP_TTF))
cmap = font.getBestCmap() or {}
REQUIRED = [
    (0x2192, "→"), (0x2264, "≤"), (0x2265, "≥"), (0x2282, "⊂"),
    (0x00B2, "²"), (0x03C0, "π"), (0x0394, "Δ"),
    (0x00F1, "ñ"), (0x00E9, "é"), (0x2013, "–"), (0x2014, "—"),
    (0x2018, "'"), (0x201C, '"'), (0x201D, '"'),
    (0x2022, "•"), (0x2026, "…"), (0x00B0, "°"), (0x2011, "‑"),
    (0x221A, "√"), (0x00B5, "µ"), (0x00BD, "½"),
]
missing = [(cp, ch) for cp, ch in REQUIRED if cp not in cmap]
ok_count = len(REQUIRED) - len(missing)

print(f"\nFont coverage: {ok_count}/{len(REQUIRED)} required glyphs")
for cp, ch in REQUIRED:
    status = "OK" if cp in cmap else "MISSING (sanitize fallback)"
    print(f"  U+{cp:04X} {repr(ch)}: {status}")

# Clean up temp TTF file
if TEMP_TTF.exists():
    TEMP_TTF.unlink()

header = f"""// AUTO-GENERATED by scripts/generate_font_subset.py
// Source: {FONT_PATH.name} ({FONT_NAME}) subsetted to Unicode ranges:
//   Basic Latin, Latin-1 Supplement, Greek, Superscripts,
//   General Punctuation, Arrows, Mathematical Operators
// Raw TTF: {raw_size // 1024} KB  |  Base64 (lazy-loaded): {b64_size // 1024} KB
// Missing glyphs: {", ".join(repr(ch) for _, ch in missing) if missing else "None (100% coverage)"}
// License: Bitstream Vera / DejaVu Fonts (public domain / free license).
//          See frontend/src/lib/DEJAVU_FONT_LICENSE.txt
// To regenerate: python scripts/generate_font_subset.py

/** Font family name registered with jsPDF */
export const QUIZ_FONT_NAME = "{FONT_NAME}";

/** Base64-encoded subsetted TTF for use with jsPDF addFileToVFS/addFont */
export const QUIZ_FONT_B64 = \""""
footer = '";\n'

with open(str(OUTPUT_TS), "wb") as f:
    f.write(header.encode("utf-8"))
    f.write(b64_data.encode("ascii"))
    f.write(footer.encode("ascii"))

print(f"\nWritten: {OUTPUT_TS} ({OUTPUT_TS.stat().st_size // 1024} KB)")
print("Done.")
