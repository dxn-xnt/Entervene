"""
Verify that QuizImportService._extract_pdf_text extracts text from legacy_demo.pdf
without corrupting 'data', 'electron', and 'Wow!'.
"""
import sys
from pathlib import Path

# Add backend to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.stdout.reconfigure(encoding="utf-8")

from app.services.quiz.QuizImportService import _extract_pdf_text

pdf_path = Path(__file__).resolve().parent / "legacy_demo.pdf"
with open(pdf_path, "rb") as f:
    text = _extract_pdf_text(f.read())

print("=== EXTRACTED TEXT FROM LEGACY PDF ===")
print(text)
print("=======================================")

assert '"data"' in text, 'ERROR: "data" was corrupted!'
assert "<=ata" not in text, 'ERROR: "data" was corrupted to <=ata!'
assert '"electron"' in text, 'ERROR: "electron" was corrupted!'
assert ">=lectron" not in text, 'ERROR: "electron" was corrupted to >=lectron!'
assert "Wow->" not in text, 'ERROR: Wow! was corrupted to Wow->!'
assert "<=" in text, 'ERROR: <= was not extracted!'
assert ">=" in text, 'ERROR: >= was not extracted!'
assert "subset of" in text, 'ERROR: subset of was not extracted!'
assert "->" in text, 'ERROR: -> was not extracted!'

print("\nSUCCESS: All assertions passed!")
print('  - "data" preserved exactly')
print('  - "electron" preserved exactly')
print('  - "Wow!\'" preserved exactly')
print("  - Math symbols (<=, >=, subset of, ->) correctly mapped")
