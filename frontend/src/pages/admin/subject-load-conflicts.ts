import type { ConflictItem, SubjectLoadItem } from "@/lib/api";

export type SlotMatchTarget = {
  class_id: number;
  subject_id: number;
  staff_id?: string | null;
  subject_load_id?: number | null;
  slot_id?: number | null;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week?: string[];
};

export type ConflictGuidance = {
  label: string;
  nextStep: string;
  canFixByTeacherChange: boolean;
};

const DAY_LABELS: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

function conflictDays(conflict: ConflictItem): string[] {
  if (conflict.days && conflict.days.length > 0) return conflict.days;
  return conflict.day ? [conflict.day] : [];
}

export function conflictKeys(conflict: ConflictItem): string[] {
  return Array.from(
    new Set(
      [
        ...(conflict.affected_keys || []),
        conflict.affected_key,
        conflict.related_affected_key,
      ].filter((key): key is string => Boolean(key)),
    ),
  );
}

export function conflictAffectsClass(conflict: ConflictItem, classId: number): boolean {
  return (
    conflict.class_id === classId ||
    conflict.related_class_id === classId ||
    conflictKeys(conflict).some((key) => key.startsWith(`${classId}_`))
  );
}

export function conflictAffectsSection(
  conflict: ConflictItem,
  classId: number,
  sectionLoads: SubjectLoadItem[] = [],
): boolean {
  if (conflictAffectsClass(conflict, classId)) return true;
  if (
    conflict.staff_id &&
    (conflict.rule === "TEACHER_OVERLAP" || conflict.rule === "DAILY_WORKLOAD_EXCEEDED")
  ) {
    const days = conflictDays(conflict);
    return sectionLoads.some(
      (load) =>
        load.class_id === classId &&
        load.staff_id === conflict.staff_id &&
        (days.length === 0 || (load.days_of_week || []).some((d) => days.includes(d))),
    );
  }
  return false;
}

export function conflictAffectsLoad(
  conflict: ConflictItem,
  classId: number,
  subjectId: number,
  subjectSlots: SlotMatchTarget[] = [],
): boolean {
  const key = `${classId}_${subjectId}`;
  if (
    conflictKeys(conflict).includes(key) ||
    (conflict.class_id === classId && conflict.subject_id === subjectId) ||
    (conflict.related_class_id === classId && conflict.related_subject_id === subjectId)
  ) {
    return true;
  }

  // Fallback for teacher-wide DAILY_WORKLOAD_EXCEEDED / TEACHER_OVERLAP without affected_keys
  if (
    subjectSlots.length > 0 &&
    conflict.staff_id &&
    (conflict.rule === "DAILY_WORKLOAD_EXCEEDED" || conflict.rule === "TEACHER_OVERLAP")
  ) {
    const days = conflictDays(conflict);
    return subjectSlots.some(
      (slot) =>
        slot.class_id === classId &&
        slot.subject_id === subjectId &&
        slot.staff_id === conflict.staff_id &&
        (days.length === 0 || (slot.days_of_week || []).some((d) => days.includes(d))),
    );
  }
  return false;
}

function matchesSideSlot(
  slot: SlotMatchTarget,
  slotDays: string[],
  side: {
    subjectLoadId?: number | null;
    slotId?: number | null;
    startTime?: string | null;
    endTime?: string | null;
    days: string[];
  },
): boolean {
  if (side.days.length > 0 && slotDays.length > 0) {
    if (!slotDays.some((d) => side.days.includes(d))) return false;
  }
  if (side.subjectLoadId != null && slot.subject_load_id != null) {
    return side.subjectLoadId === slot.subject_load_id;
  }
  if (side.startTime && side.endTime && slot.start_time && slot.end_time) {
    return side.startTime === slot.start_time && side.endTime === slot.end_time;
  }
  if (side.slotId != null && slot.slot_id != null) {
    return side.slotId === slot.slot_id;
  }
  return true;
}

/**
 * Determines whether a conflict affects a specific timetable slot (and optional
 * day subset for a rendered grid block). Falls back cleanly to load-level
 * matching when slot metadata is omitted.
 */
export function conflictAffectsSlot(
  conflict: ConflictItem,
  slot: SlotMatchTarget,
  cellDays?: string[],
): boolean {
  const slotDays = cellDays && cellDays.length > 0 ? cellDays : slot.days_of_week || [];
  const days = conflictDays(conflict);
  const key = `${slot.class_id}_${slot.subject_id}`;

  // Teacher-wide daily workload cap: only highlight slots taught by that teacher on the overloaded day
  if (conflict.rule === "DAILY_WORKLOAD_EXCEEDED") {
    if (conflict.staff_id && slot.staff_id !== conflict.staff_id) return false;
    const matchesLoad =
      conflictKeys(conflict).includes(key) ||
      Boolean(conflict.staff_id && slot.staff_id === conflict.staff_id);
    if (!matchesLoad) return false;
    if (days.length > 0 && slotDays.length > 0) {
      return slotDays.some((d) => days.includes(d));
    }
    return true;
  }

  // Pairwise overlaps carry separate primary and related slot metadata
  if (conflict.rule === "TEACHER_OVERLAP" || conflict.rule === "SECTION_OVERLAP") {
    const isPrimaryLoad =
      (conflict.class_id === slot.class_id && conflict.subject_id === slot.subject_id) ||
      conflict.affected_key === key;
    const isRelatedLoad =
      (conflict.related_class_id === slot.class_id && conflict.related_subject_id === slot.subject_id) ||
      conflict.related_affected_key === key;

    if (!isPrimaryLoad && !isRelatedLoad) {
      if (!conflictAffectsLoad(conflict, slot.class_id, slot.subject_id, [slot])) {
        return false;
      }
      return days.length === 0 || slotDays.length === 0 || slotDays.some((d) => days.includes(d));
    }

    const primaryMatches =
      isPrimaryLoad &&
      matchesSideSlot(slot, slotDays, {
        subjectLoadId: conflict.subject_load_id,
        slotId: conflict.slot_id,
        startTime: conflict.start_time,
        endTime: conflict.end_time,
        days,
      });

    const relatedMatches =
      isRelatedLoad &&
      matchesSideSlot(slot, slotDays, {
        subjectLoadId: conflict.related_subject_load_id,
        slotId: conflict.related_slot_id,
        startTime: conflict.related_start_time,
        endTime: conflict.related_end_time,
        days,
      });

    return primaryMatches || relatedMatches;
  }

  // An unscheduled draft slot should not highlight a different, already-placed slot on the timetable grid
  if (conflict.rule === "UNSCHEDULED_LOAD") {
    if (!conflictAffectsLoad(conflict, slot.class_id, slot.subject_id)) return false;
    const slotIsScheduled = Boolean(slot.start_time && slot.end_time && slotDays.length > 0);
    const conflictHasEmptyTime = !conflict.start_time || !conflict.end_time || days.length === 0;
    if (slotIsScheduled && conflictHasEmptyTime) return false;
    return true;
  }

  if (!conflictAffectsLoad(conflict, slot.class_id, slot.subject_id)) {
    return false;
  }

  return matchesSideSlot(slot, slotDays, {
    subjectLoadId: conflict.subject_load_id,
    slotId: conflict.slot_id,
    startTime: conflict.start_time,
    endTime: conflict.end_time,
    days,
  });
}

function conflictPriority(conflict: ConflictItem): number {
  if (conflict.severity === "error") return 0;
  if (conflict.rule !== "UNASSIGNED_TEACHER") return 1;
  return 2;
}

function sortAndDeduplicate(matched: { conflict: ConflictItem; index: number }[]): ConflictItem[] {
  const seen = new Set<string>();
  const deduped: { conflict: ConflictItem; index: number }[] = [];

  for (const entry of matched) {
    const dedupKey = `${entry.conflict.severity}|${entry.conflict.rule}|${entry.conflict.message}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    deduped.push(entry);
  }

  deduped.sort((a, b) => {
    const prioDiff = conflictPriority(a.conflict) - conflictPriority(b.conflict);
    return prioDiff !== 0 ? prioDiff : a.index - b.index;
  });

  return deduped.map((entry) => entry.conflict);
}

/**
 * Returns all deduplicated conflicts affecting a (classId, subjectId) load,
 * ordered so blocking errors always take precedence over warnings and
 * schedule warnings take precedence over UNASSIGNED_TEACHER warnings.
 */
export function getLoadConflicts(
  conflicts: ConflictItem[],
  classId: number,
  subjectId: number,
  subjectSlots: SlotMatchTarget[] = [],
): ConflictItem[] {
  const matched: { conflict: ConflictItem; index: number }[] = [];
  conflicts.forEach((conflict, index) => {
    if (!conflictAffectsLoad(conflict, classId, subjectId, subjectSlots)) return;
    matched.push({ conflict, index });
  });
  return sortAndDeduplicate(matched);
}

export function getSlotConflicts(
  conflicts: ConflictItem[],
  slot: SlotMatchTarget,
  cellDays?: string[],
): ConflictItem[] {
  const matched: { conflict: ConflictItem; index: number }[] = [];
  conflicts.forEach((conflict, index) => {
    if (!conflictAffectsSlot(conflict, slot, cellDays)) return;
    matched.push({ conflict, index });
  });
  return sortAndDeduplicate(matched);
}

export type LoadConflictSummary = {
  primary: ConflictItem;
  all: ConflictItem[];
  errors: ConflictItem[];
  warnings: ConflictItem[];
  additionalCount: number;
  tooltip: string;
};

function buildSummary(all: ConflictItem[]): LoadConflictSummary | undefined {
  if (all.length === 0) return undefined;
  const primary = all[0];
  const errors = all.filter((c) => c.severity === "error");
  const warnings = all.filter((c) => c.severity !== "error");
  const tooltip = all
    .map((c) => `${c.severity === "error" ? "Conflict" : "Warning"}: ${c.message}`)
    .join("\n");
  return {
    primary,
    all,
    errors,
    warnings,
    additionalCount: all.length - 1,
    tooltip,
  };
}

/**
 * Resolves the highest-priority conflict for a load while preserving all
 * remaining deduplicated conflicts so warnings never hide blocking errors
 * and secondary conflict details remain available.
 */
export function getLoadConflictSummary(
  conflicts: ConflictItem[],
  classId: number,
  subjectId: number,
  subjectSlots: SlotMatchTarget[] = [],
): LoadConflictSummary | undefined {
  return buildSummary(getLoadConflicts(conflicts, classId, subjectId, subjectSlots));
}

/**
 * Resolves prioritized conflicts affecting one specific timetable slot/block.
 */
export function getSlotConflictSummary(
  conflicts: ConflictItem[],
  slot: SlotMatchTarget,
  cellDays?: string[],
): LoadConflictSummary | undefined {
  return buildSummary(getSlotConflicts(conflicts, slot, cellDays));
}

export function formatConflictScheduleContext(conflict: ConflictItem): string | null {
  const days = conflictDays(conflict).map((d) => DAY_LABELS[d] ?? d);
  const parts: string[] = [];
  if (days.length > 0) parts.push(days.join(", "));
  if (conflict.start_time && conflict.end_time) {
    parts.push(`${conflict.start_time}–${conflict.end_time}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function describeConflictForAdmin(conflict: ConflictItem): ConflictGuidance {
  switch (conflict.rule) {
    case "TEACHER_OVERLAP":
      return {
        label: "Teacher double-booked",
        nextStep:
          "Assign a different available teacher below, or move one of the overlapping classes to another period or day.",
        canFixByTeacherChange: true,
      };
    case "DAILY_WORKLOAD_EXCEEDED":
      return {
        label: "Teacher daily limit exceeded",
        nextStep:
          "Assign a teacher with available daily capacity below, move one of this teacher's classes to another day, or adjust workload limits in System Settings.",
        canFixByTeacherChange: true,
      };
    case "SECTION_OVERLAP":
      return {
        label: "Section time overlap",
        nextStep:
          "Reassigning the teacher will not fix this. Move one of the overlapping subjects in this section to a different period or day.",
        canFixByTeacherChange: false,
      };
    case "BREAK_TIME_VIOLATION":
      return {
        label: "Overlaps a scheduled break",
        nextStep:
          "Reassigning the teacher will not fix this. Move this class to a period outside Homeroom, Recess, or Lunch.",
        canFixByTeacherChange: false,
      };
    case "OFFERING_DURATION_MISMATCH":
      return {
        label: "Period duration mismatch",
        nextStep:
          "Reassigning the teacher will not fix this. Move this slot to a period matching the required curriculum minutes, or update the Subject Offering duration.",
        canFixByTeacherChange: false,
      };
    case "SUBJECT_NOT_OFFERED_IN_PERIOD":
      return {
        label: "Subject not offered this term",
        nextStep:
          "Reassigning the teacher will not fix this. Add an active Subject Offering for this grade, pathway, and term, or remove the subject from this section.",
        canFixByTeacherChange: false,
      };
    case "MISSING_OFFERING_DURATION":
      return {
        label: "Missing curriculum duration",
        nextStep:
          "Reassigning the teacher will not fix this. Set the required period minutes in Subject Offerings before publishing.",
        canFixByTeacherChange: false,
      };
    case "NO_MATCHING_DURATION_SLOT":
      return {
        label: "No matching period length",
        nextStep:
          "Reassigning the teacher will not fix this. Update this section's bell schedule template or Subject Offering minutes so a matching period exists.",
        canFixByTeacherChange: false,
      };
    case "UNSCHEDULED_LOAD":
      return {
        label: "Missing time or meeting days",
        nextStep:
          "Reassigning the teacher will not fix this. Place this subject on a timetable slot or set its time and meeting days in List view.",
        canFixByTeacherChange: false,
      };
    case "UNASSIGNED_TEACHER":
      return {
        label: "No teacher assigned",
        nextStep: "Select an available teacher below before publishing.",
        canFixByTeacherChange: true,
      };
    case "CORE_SUBJECT_SPLIT_SCHEDULE":
      return {
        label: "Core subject meets fewer than 5 days",
        nextStep:
          "Warning only: schedule this core subject across 5 days if required by school policy.",
        canFixByTeacherChange: false,
      };
    case "UNCONFIGURED_BELL_SCHEDULE":
      return {
        label: "Bell schedule not configured",
        nextStep:
          "Assign the appropriate bell schedule template for this section in Break Settings.",
        canFixByTeacherChange: false,
      };
    default:
      return {
        label: conflict.severity === "error" ? "Schedule conflict" : "Schedule warning",
        nextStep: "Review this subject's period time, meeting days, and assigned teacher.",
        canFixByTeacherChange: false,
      };
  }
}
