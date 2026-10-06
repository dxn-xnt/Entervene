import type { TOSRow } from "./tos-calculator";

export function buildTOSGenerationRows(rows: TOSRow[]) {
  const active = rows.filter((row) => row.items > 0);
  if (active.length === 0) throw new Error("The blueprint has no allocated questions. Recalculate before generating.");
  for (const row of rows) {
    const count = Object.values(row.type_counts).reduce((sum, value) => sum + (value || 0), 0);
    if (count !== row.items) {
      throw new Error(`Question type counts for "${row.label}" total ${count}, but the blueprint allocates ${row.items} items. Recalculate before generating.`);
    }
  }
  const total = active.reduce((sum, row) => sum + row.items, 0);
  if (active.length > 12 || total > 50 || active.some((row) => row.items > 20)) {
    throw new Error(`AI generation supports up to 12 competency rows, 20 questions per row, and 50 questions total (currently ${active.length} rows, ${total} items). Please adjust before generating.`);
  }
  return active.map((row) => ({
    competency_id: row.competency_id || null,
    label: row.label,
    code: row.code || null,
    type_counts: row.type_counts,
    bloom_targets: {
      REMEMBER: row.remember, UNDERSTAND: row.understand,
      APPLY: row.apply, ANALYZE: row.analyze, EVALUATE: row.evaluate, CREATE: row.create_,
    },
  }));
}

export function tosGenerationErrorMessage(data: unknown): string {
  const fallback = "AI question generation failed. Please retry.";
  if (!data || typeof data !== "object" || !("detail" in data)) return fallback;
  if (typeof data.detail === "string") return data.detail || fallback;
  if (!Array.isArray(data.detail)) return fallback;
  const messages = data.detail.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== "object" || !("msg" in entry) || typeof entry.msg !== "string") return [];
    const location = "loc" in entry && Array.isArray(entry.loc)
      ? entry.loc.filter((part: unknown) => typeof part === "string" || typeof part === "number").join(".") : "";
    return [location ? `${location}: ${entry.msg}` : entry.msg];
  });
  return messages.join("; ") || fallback;
}
