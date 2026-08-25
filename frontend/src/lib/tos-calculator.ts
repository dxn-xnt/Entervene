/**
 * tos-calculator.ts
 * Pure-function module implementing the Sury Table of Specifications (TOS) calculator:
 * Steps A through I + reconciliation, validation, and Bloom drift analysis.
 */

export type TestPartType =
  | "MULTIPLE_CHOICE"
  | "TRUE_FALSE"
  | "IDENTIFICATION"
  | "MATCHING"
  | "ESSAY";

export type CognitiveLevel =
  | "REMEMBER"
  | "UNDERSTAND"
  | "APPLY"
  | "ANALYZE"
  | "EVALUATE"
  | "CREATE";

export type DifficultyBand = "EASY" | "AVERAGE" | "DIFFICULT";

export type TestPart = {
  type: TestPartType;
  count: number;
};

export type TOSCompetencyInput = {
  competency_id?: number;
  label: string;
  code?: string;
  days: number;
};

export type TOSDifficultyRatio = {
  easy: number; // e.g. 0.6
  average: number; // e.g. 0.3
  difficult: number; // e.g. 0.1
};

export type TOSRow = {
  competency_id?: number;
  label: string;
  code?: string;
  days: number;
  weight_percent: number; // (days / total_days) * 100

  // Step C
  raw_items: number;
  items: number; // Step C final items allocated to this row

  // Step D
  easy: number;
  average: number;
  difficult: number;
  easy_target: number;
  average_target: number;
  difficult_target: number;
  reconciled_band_total: number;
  difficulty_nudges: {
    easy: "up" | "down" | null;
    average: "up" | "down" | null;
    difficult: "up" | "down" | null;
  };

  // Step E - Bloom Taxonomy sub-split
  remember: number;
  understand: number;
  apply: number;
  analyze: number;
  evaluate: number;
  create_: number;

  // Step F - Item placement
  item_start: number;
  item_end: number;

  // Step I - Question type allocation per row
  type_counts: Partial<Record<TestPartType, number>>;
  type_targets: Partial<Record<TestPartType, number>>;
  reconciled_type_total: number;
  type_nudges: Partial<Record<TestPartType, "up" | "down" | null>>;
};

export type TOSDraft = {
  subject_id: number;
  subject_name: string;
  title: string;
  quarter: string;
  test_parts: TestPart[];
  total_items: number;
  competencies: TOSCompetencyInput[];
  difficulty_ratio: TOSDifficultyRatio;
  rows: TOSRow[];
  grand_total: TOSRow;
};

export type RowValidationResult = {
  isValid: boolean;
  band_errors: string[];
  type_errors: string[];
  reconciliation_note: string | null;
};

export type BloomSummary = Record<CognitiveLevel, number>;
export type BloomDrift = Record<CognitiveLevel, number>;

/**
 * Step C & D Core: Largest Remainder Method (Hamilton/Hare quota allocation).
 * Distributes integer items based on fractional quotas, breaking ties by first-listed order.
 */
export function allocateByLargestRemainder(
  quotas: number[],
  totalTarget: number,
  tieOrderPriority?: number[]
): number[] {
  if (quotas.length === 0) return [];
  if (totalTarget <= 0) return quotas.map(() => 0);

  const floors = quotas.map((q) => Math.floor(Math.max(0, q)));
  const sumFloors = floors.reduce((a, b) => a + b, 0);
  let remainderPool = totalTarget - sumFloors;

  const remainderInfo = quotas.map((q, idx) => ({
    fraction: Math.max(0, q) - Math.floor(Math.max(0, q)),
    index: idx,
    tiePriority: tieOrderPriority ? tieOrderPriority[idx] : idx,
  }));

  const result = [...floors];

  if (remainderPool > 0) {
    // Sort descending by fraction remainder. Ties broken by tiePriority ascending.
    remainderInfo.sort((a, b) => {
      if (Math.abs(b.fraction - a.fraction) > 1e-9) {
        return b.fraction - a.fraction;
      }
      return a.tiePriority - b.tiePriority;
    });

    const distributeCount = Math.min(remainderPool, remainderInfo.length);
    for (let i = 0; i < distributeCount; i++) {
      result[remainderInfo[i].index] += 1;
    }
  } else if (remainderPool < 0) {
    // Deficit: subtract from items with smallest fraction remainder
    remainderInfo.sort((a, b) => {
      if (Math.abs(a.fraction - b.fraction) > 1e-9) {
        return a.fraction - b.fraction;
      }
      return a.tiePriority - b.tiePriority;
    });

    let toSubtract = Math.abs(remainderPool);
    for (let i = 0; i < remainderInfo.length && toSubtract > 0; i++) {
      const idx = remainderInfo[i].index;
      if (result[idx] > 0) {
        result[idx] -= 1;
        toSubtract--;
      }
    }
  }

  return result;
}

/**
 * Compute the complete TOS blueprint (Steps A through I) with column reconciliation.
 */
export function computeTOS(
  draft: Omit<TOSDraft, "rows" | "grand_total">
): { rows: TOSRow[]; grand_total: TOSRow } {
  const { test_parts, competencies, difficulty_ratio } = draft;

  const total_items = test_parts.reduce((sum, p) => sum + (p.count || 0), 0);
  const total_days = competencies.reduce((sum, c) => sum + (c.days || 0), 0);

  if (competencies.length === 0 || total_items === 0) {
    const emptyRow: TOSRow = {
      label: "TOTAL",
      days: total_days,
      weight_percent: 0,
      raw_items: 0,
      items: 0,
      easy: 0,
      average: 0,
      difficult: 0,
      easy_target: 0,
      average_target: 0,
      difficult_target: 0,
      reconciled_band_total: 0,
      difficulty_nudges: { easy: null, average: null, difficult: null },
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create_: 0,
      item_start: 0,
      item_end: 0,
      type_counts: {},
      type_targets: {},
      reconciled_type_total: 0,
      type_nudges: {},
    };
    return { rows: [], grand_total: emptyRow };
  }

  // STEP C: Item allocation per competency via Largest Remainder Method
  const rawQuotas = competencies.map((c) =>
    total_days > 0 ? (c.days / total_days) * total_items : total_items / competencies.length
  );
  const allocatedItems = allocateByLargestRemainder(rawQuotas, total_items);

  // STEP D: Grand total difficulty band split
  const grandEasyQuota = difficulty_ratio.easy * total_items;
  const grandAvgQuota = difficulty_ratio.average * total_items;
  const grandDiffQuota = difficulty_ratio.difficult * total_items;

  // Tie-break order for difficulty: Easy (0) before Average (1) before Difficult (2)
  const [grandEasy, grandAvg, grandDiff] = allocateByLargestRemainder(
    [grandEasyQuota, grandAvgQuota, grandDiffQuota],
    total_items,
    [0, 1, 2]
  );

  // Step D: Per-row initial difficulty allocations
  const rowEasy: number[] = [];
  const rowAvg: number[] = [];
  const rowDiff: number[] = [];

  for (let i = 0; i < competencies.length; i++) {
    const itm = allocatedItems[i];
    const eQuota = difficulty_ratio.easy * itm;
    const aQuota = difficulty_ratio.average * itm;
    const dQuota = difficulty_ratio.difficult * itm;

    const [e, a, d] = allocateByLargestRemainder([eQuota, aQuota, dQuota], itm, [0, 1, 2]);
    rowEasy.push(e);
    rowAvg.push(a);
    rowDiff.push(d);
  }

  // Step D: Reconciliation pass for each difficulty band across rows
  const easyNudges: Array<"up" | "down" | null> = competencies.map(() => null);
  const avgNudges: Array<"up" | "down" | null> = competencies.map(() => null);
  const diffNudges: Array<"up" | "down" | null> = competencies.map(() => null);

  function reconcileBand(
    rowValues: number[],
    grandTarget: number,
    ratio: number,
    nudges: Array<"up" | "down" | null>
  ) {
    const currentSum = rowValues.reduce((s, v) => s + v, 0);
    const deficit = grandTarget - currentSum;
    if (deficit === 0) return;

    const rowRemainders = allocatedItems.map((itm, idx) => ({
      index: idx,
      fraction: itm * ratio - Math.floor(itm * ratio),
    }));

    if (deficit > 0) {
      rowRemainders.sort((a, b) => (Math.abs(b.fraction - a.fraction) > 1e-9 ? b.fraction - a.fraction : a.index - b.index));
      for (let i = 0; i < Math.min(deficit, rowRemainders.length); i++) {
        const targetIdx = rowRemainders[i].index;
        rowValues[targetIdx] += 1;
        nudges[targetIdx] = "up";
      }
    } else {
      rowRemainders.sort((a, b) => (Math.abs(a.fraction - b.fraction) > 1e-9 ? a.fraction - b.fraction : a.index - b.index));
      let toSubtract = Math.abs(deficit);
      for (let i = 0; i < rowRemainders.length && toSubtract > 0; i++) {
        const targetIdx = rowRemainders[i].index;
        if (rowValues[targetIdx] > 0) {
          rowValues[targetIdx] -= 1;
          nudges[targetIdx] = "down";
          toSubtract--;
        }
      }
    }
  }

  reconcileBand(rowEasy, grandEasy, difficulty_ratio.easy, easyNudges);
  reconcileBand(rowAvg, grandAvg, difficulty_ratio.average, avgNudges);
  reconcileBand(rowDiff, grandDiff, difficulty_ratio.difficult, diffNudges);

  // STEP I: Proportional Question-Type allocation per competency row
  const rowTypeAllocations: Record<TestPartType, number[]> = {
    MULTIPLE_CHOICE: competencies.map(() => 0),
    TRUE_FALSE: competencies.map(() => 0),
    IDENTIFICATION: competencies.map(() => 0),
    MATCHING: competencies.map(() => 0),
    ESSAY: competencies.map(() => 0),
  };

  const rowTypeNudges: Record<TestPartType, Array<"up" | "down" | null>> = {
    MULTIPLE_CHOICE: competencies.map(() => null),
    TRUE_FALSE: competencies.map(() => null),
    IDENTIFICATION: competencies.map(() => null),
    MATCHING: competencies.map(() => null),
    ESSAY: competencies.map(() => null),
  };

  for (const part of test_parts) {
    if (!part.count || part.count <= 0) continue;
    const typeQuotas = allocatedItems.map((itm) => (itm / total_items) * part.count);
    const alloc = allocateByLargestRemainder(typeQuotas, part.count);
    rowTypeAllocations[part.type] = alloc;
  }

  // STEP E & F & Row object assembly
  let currentPlacement = 1;
  const rows: TOSRow[] = [];

  for (let i = 0; i < competencies.length; i++) {
    const comp = competencies[i];
    const items_i = allocatedItems[i];
    const weight_percent = total_days > 0 ? (comp.days / total_days) * 100 : (1 / competencies.length) * 100;

    const e = rowEasy[i];
    const a = rowAvg[i];
    const d = rowDiff[i];

    // Step E: Bloom sub-split
    const remember = Math.floor(e / 2) + (e % 2 !== 0 ? 1 : 0);
    const understand = Math.floor(e / 2);

    const apply = Math.floor(a / 2) + (a % 2 !== 0 ? 1 : 0);
    const analyze = Math.floor(a / 2);

    const evaluate = Math.floor(d / 2) + (d % 2 !== 0 ? 1 : 0);
    const create_ = Math.floor(d / 2);

    // Step F: Placement
    const item_start = items_i > 0 ? currentPlacement : 0;
    const item_end = items_i > 0 ? currentPlacement + items_i - 1 : 0;
    if (items_i > 0) {
      currentPlacement += items_i;
    }

    const typeCounts: Partial<Record<TestPartType, number>> = {};
    const typeTargets: Partial<Record<TestPartType, number>> = {};
    const typeNudges: Partial<Record<TestPartType, "up" | "down" | null>> = {};
    let reconciledTypeTotal = 0;

    for (const part of test_parts) {
      if (part.count > 0) {
        const countForType = rowTypeAllocations[part.type][i] || 0;
        typeCounts[part.type] = countForType;
        typeTargets[part.type] = countForType;
        reconciledTypeTotal += countForType;
        if (rowTypeNudges[part.type][i]) {
          typeNudges[part.type] = rowTypeNudges[part.type][i];
        }
      }
    }

    rows.push({
      competency_id: comp.competency_id,
      label: comp.label,
      code: comp.code,
      days: comp.days,
      weight_percent: Number(weight_percent.toFixed(2)),
      raw_items: Math.floor(rawQuotas[i]),
      items: items_i,
      easy: e,
      average: a,
      difficult: d,
      easy_target: e,
      average_target: a,
      difficult_target: d,
      reconciled_band_total: e + a + d,
      difficulty_nudges: {
        easy: easyNudges[i],
        average: avgNudges[i],
        difficult: diffNudges[i],
      },
      remember,
      understand,
      apply,
      analyze,
      evaluate,
      create_,
      item_start,
      item_end,
      type_counts: typeCounts,
      type_targets: typeTargets,
      reconciled_type_total: reconciledTypeTotal,
      type_nudges: typeNudges,
    });
  }

  // Compute Grand Total row
  const grandTotalRow: TOSRow = {
    label: "TOTAL",
    days: total_days,
    weight_percent: 100.0,
    raw_items: total_items,
    items: total_items,
    easy: grandEasy,
    average: grandAvg,
    difficult: grandDiff,
    easy_target: grandEasy,
    average_target: grandAvg,
    difficult_target: grandDiff,
    reconciled_band_total: total_items,
    difficulty_nudges: { easy: null, average: null, difficult: null },
    remember: rows.reduce((s, r) => s + r.remember, 0),
    understand: rows.reduce((s, r) => s + r.understand, 0),
    apply: rows.reduce((s, r) => s + r.apply, 0),
    analyze: rows.reduce((s, r) => s + r.analyze, 0),
    evaluate: rows.reduce((s, r) => s + r.evaluate, 0),
    create_: rows.reduce((s, r) => s + r.create_, 0),
    item_start: total_items > 0 ? 1 : 0,
    item_end: total_items,
    type_counts: test_parts.reduce<Partial<Record<TestPartType, number>>>((acc, p) => {
      acc[p.type] = p.count;
      return acc;
    }, {}),
    type_targets: test_parts.reduce<Partial<Record<TestPartType, number>>>((acc, p) => {
      acc[p.type] = p.count;
      return acc;
    }, {}),
    reconciled_type_total: total_items,
    type_nudges: {},
  };

  return { rows, grand_total: grandTotalRow };
}

/**
 * Validates a single TOS row against its post-reconciliation targets.
 */
export function validateTOSRow(row: TOSRow): RowValidationResult {
  const easy_diff = (row.easy || 0) - row.easy_target;
  const average_diff = (row.average || 0) - row.average_target;
  const diff_diff = (row.difficult || 0) - row.difficult_target;

  const band_errors: string[] = [];
  if (easy_diff !== 0) {
    band_errors.push(`Easy: ${easy_diff > 0 ? "+" : ""}${easy_diff} (expected ${row.easy_target})`);
  }
  if (average_diff !== 0) {
    band_errors.push(`Average: ${average_diff > 0 ? "+" : ""}${average_diff} (expected ${row.average_target})`);
  }
  if (diff_diff !== 0) {
    band_errors.push(`Difficult: ${diff_diff > 0 ? "+" : ""}${diff_diff} (expected ${row.difficult_target})`);
  }

  const type_errors: string[] = [];
  for (const [t, target] of Object.entries(row.type_targets)) {
    const actual = row.type_counts[t as TestPartType] ?? 0;
    if (actual !== target) {
      type_errors.push(`${t}: ${actual - (target || 0) > 0 ? "+" : ""}${actual - (target || 0)} (expected ${target})`);
    }
  }

  const bloomSum =
    (row.remember || 0) +
    (row.understand || 0) +
    (row.apply || 0) +
    (row.analyze || 0) +
    (row.evaluate || 0) +
    (row.create_ || 0);

  const rowTotal = (row.easy || 0) + (row.average || 0) + (row.difficult || 0);
  if (bloomSum !== rowTotal) {
    band_errors.push(`Bloom levels sum (${bloomSum}) does not match difficulty total (${rowTotal})`);
  }

  return {
    isValid: band_errors.length === 0 && type_errors.length === 0,
    band_errors,
    type_errors,
    reconciliation_note:
      row.reconciled_band_total !== row.items
        ? `LRM reconciliation adjusted this row's total to ${row.reconciled_band_total} (raw ${row.items})`
        : null,
  };
}

/**
 * Validates the full draft prior to export or generation.
 */
export function validateTOS(draft: TOSDraft): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (draft.test_parts.length === 0 || draft.total_items <= 0) {
    errors.push("At least one test part with items is required.");
  }

  if (draft.competencies.length === 0) {
    errors.push("At least one competency is required.");
  }

  const sumEasy = draft.rows.reduce((s, r) => s + (r.easy || 0), 0);
  const sumAvg = draft.rows.reduce((s, r) => s + (r.average || 0), 0);
  const sumDiff = draft.rows.reduce((s, r) => s + (r.difficult || 0), 0);

  if (sumEasy !== draft.grand_total.easy) {
    errors.push(`Total Easy items (${sumEasy}) must equal grand target (${draft.grand_total.easy})`);
  }
  if (sumAvg !== draft.grand_total.average) {
    errors.push(`Total Average items (${sumAvg}) must equal grand target (${draft.grand_total.average})`);
  }
  if (sumDiff !== draft.grand_total.difficult) {
    errors.push(`Total Difficult items (${sumDiff}) must equal grand target (${draft.grand_total.difficult})`);
  }

  for (const part of draft.test_parts) {
    const partSum = draft.rows.reduce((s, r) => s + (r.type_counts[part.type] || 0), 0);
    if (partSum !== part.count) {
      errors.push(`Total ${part.type} items (${partSum}) must equal configured count (${part.count})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Counts actual cognitive_level tags from generated questions.
 */
export function buildBloomSummary(
  questions: Array<{ cognitive_level?: string }>
): BloomSummary {
  const summary: BloomSummary = {
    REMEMBER: 0,
    UNDERSTAND: 0,
    APPLY: 0,
    ANALYZE: 0,
    EVALUATE: 0,
    CREATE: 0,
  };

  for (const q of questions) {
    const level = (q.cognitive_level || "REMEMBER").toUpperCase() as CognitiveLevel;
    if (level in summary) {
      summary[level]++;
    } else {
      summary.REMEMBER++;
    }
  }
  return summary;
}

/**
 * Calculates drift between actual and target Bloom counts.
 */
export function buildBloomDrift(
  actual: BloomSummary,
  target: BloomSummary
): BloomDrift {
  const drift: BloomDrift = {
    REMEMBER: 0,
    UNDERSTAND: 0,
    APPLY: 0,
    ANALYZE: 0,
    EVALUATE: 0,
    CREATE: 0,
  };

  const keys: CognitiveLevel[] = ["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"];
  for (const k of keys) {
    drift[k] = (actual[k] || 0) - (target[k] || 0);
  }
  return drift;
}
