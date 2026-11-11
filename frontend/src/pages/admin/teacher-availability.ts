import type { SubjectLoadItem, SubjectLoadStudioData } from "@/lib/api";

const DAY_LABELS: Record<string, string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

function minutes(value?: string | null): number | null {
  if (!value) return null;
  const [hours, mins] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null;
  return hours * 60 + mins;
}

export function teacherAssignmentConflict(
  loads: SubjectLoadItem[],
  staffId: string,
  classId: number,
  subjectId: number,
  classes: SubjectLoadStudioData["classes"] = [],
  subjects: SubjectLoadStudioData["subjects"] = [],
): string | null {
  const targetSlots = loads.filter(
    (load) => load.class_id === classId && load.subject_id === subjectId,
  );
  const otherTeacherLoads = loads.filter(
    (load) =>
      load.staff_id === staffId
      && !(load.class_id === classId && load.subject_id === subjectId),
  );

  for (const target of targetSlots) {
    const targetStart = minutes(target.start_time);
    const targetEnd = minutes(target.end_time);
    if (targetStart === null || targetEnd === null || targetEnd <= targetStart) continue;

    for (const existing of otherTeacherLoads) {
      const existingStart = minutes(existing.start_time);
      const existingEnd = minutes(existing.end_time);
      if (existingStart === null || existingEnd === null || existingEnd <= existingStart) continue;

      const commonDays = (target.days_of_week || []).filter((day) =>
        (existing.days_of_week || []).includes(day),
      );
      if (commonDays.length === 0) continue;

      // Half-open intervals: adjacent periods do not overlap.
      if (targetStart < existingEnd && existingStart < targetEnd) {
        const className = classes.find((item) => item.class_id === existing.class_id)?.section_name
          ?? `Section #${existing.class_id}`;
        const subjectName = subjects.find((item) => item.subject_id === existing.subject_id)?.subject_name
          ?? `Subject #${existing.subject_id}`;
        const days = commonDays.map((day) => DAY_LABELS[day] ?? day).join(", ");
        return `Conflict: ${subjectName} in ${className} on ${days}, ${existing.start_time}-${existing.end_time}`;
      }
    }
  }

  return null;
}

