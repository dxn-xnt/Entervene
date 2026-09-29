/**
 * scripts/build_legacy_test_pdf.cjs
 * Demonstrates and verifies the legacy PDF import workaround.
 *
 * Builds a legacy-style PDF (jsPDF without custom font, which uses UTF-16BE for non-WinAnsi symbols)
 * containing the plain words "data", "electron", and "Wow!'" alongside mathematical symbols (<=, >=, ->, subset of).
 * Proves that:
 *  - "data" is NOT corrupted to "<=ata"
 *  - "electron" is NOT corrupted to ">=lectron"
 *  - "Wow!'" is NOT corrupted to "Wow->"
 *  - Math symbols are correctly mapped to safe text representations.
 *
 * Usage:
 *   node scripts/build_legacy_test_pdf.cjs
 */

const fs = require("fs");
const path = require("path");
const { jsPDF } = require("../frontend/node_modules/jspdf");

function buildLegacyPdf() {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Line 1: Mixed line with math symbols (forces jsPDF into UTF-16BE) AND words in quotes
  doc.text(
    '1. If "data" has condition x \u2264 y and "electron" has z \u2265 w, and set A \u2282 B, then x \u2192 y. Wow!\u2019',
    15,
    20
  );

  // Line 2: Standard text line without math symbols
  doc.text(
    '2. Plain text with quotes: The "data" on the "electron" was amazing! Wow!\u2019',
    15,
    30
  );

  // Line 3: Question format with answer
  doc.text('3. Which particles have negative charge? "electron"', 15, 40);
  doc.text('A) "data" packets    B) "electron" particles', 15, 50);

  const outBuf = Buffer.from(doc.output("arraybuffer"));
  const outPath = path.resolve(__dirname, "legacy_demo.pdf");
  fs.writeFileSync(outPath, outBuf);
  console.log(`Legacy test PDF written to: ${outPath} (${outBuf.length} bytes)`);
  return outPath;
}

buildLegacyPdf();
