/**
 * pdf-font-loader.ts
 * Shared helper to register and apply DejaVuSans Unicode font in jsPDF documents.
 * Implements stroke-assisted bold rendering for the subsetted Unicode font with
 * strict state restoration to prevent leaking line width, draw color, or rendering mode.
 */

export async function setupUnicodePdfFont(doc: any): Promise<{
  activeFont: string;
  customFontLoaded: boolean;
  setFont: (bold?: boolean) => void;
}> {
  let activeFont = "helvetica";
  let customFontLoaded = false;
  try {
    const { QUIZ_FONT_NAME, QUIZ_FONT_B64 } = await import("./quiz-export-font");
    if (QUIZ_FONT_B64) {
      doc.addFileToVFS(`${QUIZ_FONT_NAME}.ttf`, QUIZ_FONT_B64);
      doc.addFont(`${QUIZ_FONT_NAME}.ttf`, QUIZ_FONT_NAME, "normal");
      doc.addFont(`${QUIZ_FONT_NAME}.ttf`, QUIZ_FONT_NAME, "bold");
      activeFont = QUIZ_FONT_NAME;
      customFontLoaded = true;
    }
  } catch {
    customFontLoaded = false;
    activeFont = "helvetica";
  }

  let isBold = false;

  if (customFontLoaded && typeof doc.text === "function") {
    const origText = doc.text.bind(doc);
    doc.text = function (text: any, x: any, y: any, options?: any, transform?: any) {
      if (isBold) {
        const prevLineWidth = typeof doc.getLineWidth === "function" ? doc.getLineWidth() : undefined;
        const prevDrawColor = typeof doc.getDrawColor === "function" ? doc.getDrawColor() : undefined;
        const currentTextColor = typeof doc.getTextColor === "function" ? doc.getTextColor() : "#000000";

        const fontSize = typeof doc.getFontSize === "function" ? doc.getFontSize() : 10;
        const lw = fontSize * 0.015;
        if (typeof doc.setLineWidth === "function") {
          doc.setLineWidth(lw);
        }
        if (typeof doc.setDrawColor === "function") {
          doc.setDrawColor(currentTextColor);
        }

        const prevRenderingMode = typeof (doc as any).getTextRenderingMode === "function"
          ? (doc as any).getTextRenderingMode()
          : (typeof options === "object" && options ? options.renderingMode : undefined);

        const opts = Object.assign({}, typeof options === "object" ? options : {}, {
          renderingMode: "fillThenStroke",
        });

        try {
          return origText(text, x, y, opts, transform);
        } finally {
          if (prevLineWidth !== undefined && typeof doc.setLineWidth === "function") {
            doc.setLineWidth(prevLineWidth);
          }
          if (prevDrawColor !== undefined && typeof doc.setDrawColor === "function") {
            doc.setDrawColor(prevDrawColor);
          }
          if (typeof (doc as any).setTextRenderingMode === "function" && prevRenderingMode !== undefined) {
            (doc as any).setTextRenderingMode(prevRenderingMode);
          }
        }
      }
      return origText(text, x, y, options, transform);
    };
  }

  const setFont = (bold = false) => {
    isBold = !!bold;
    doc.setFont(activeFont, bold ? "bold" : "normal");
  };

  return { activeFont, customFontLoaded, setFont };
}
