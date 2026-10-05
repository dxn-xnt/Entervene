import type { TOSRow } from "./tos-calculator";

/** Count shortages by type: extra items of another type cannot fill a deficit. */
export function computeTOSShortfall(
  rows: Pick<TOSRow, "type_counts">[],
  questions: { question_type: string }[],
) {
  const requested = new Map<string, number>();
  const produced = new Map<string, number>();
  for (const row of rows) {
    for (const [type, count] of Object.entries(row.type_counts)) {
      requested.set(type, (requested.get(type) || 0) + (count || 0));
    }
  }
  for (const question of questions) {
    produced.set(question.question_type, (produced.get(question.question_type) || 0) + 1);
  }
  const perType = [...new Set([...requested.keys(), ...produced.keys()])].map((type) => ({
    type,
    requested: requested.get(type) || 0,
    produced: produced.get(type) || 0,
    missing: Math.max(0, (requested.get(type) || 0) - (produced.get(type) || 0)),
  }));
  return {
    requested: perType.reduce((sum, item) => sum + item.requested, 0),
    produced: questions.length,
    missing: perType.reduce((sum, item) => sum + item.missing, 0),
    perType,
  };
}
