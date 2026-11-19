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

export type TeacherWorkloadCaps = {
  maxSubjectsPerDay?: number;
  maxHoursPerDay?: number;
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
  caps?: TeacherWorkloadCaps,
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

  // Check teacher daily workload caps (hours/day and section-subject loads/day)
  // on days where the target subject actually has scheduled slots.
  if (caps && (caps.maxSubjectsPerDay != null || caps.maxHoursPerDay != null)) {
    const targetScheduledDays = new Set<string>();
    const projectedDailyHours = new Map<string, number>();
    const projectedDailySubjects = new Map<string, Set<string>>();

    const addSlotToTotals = (slot: SubjectLoadItem, recordTargetDay: boolean) => {
      const start = minutes(slot.start_time);
      const end = minutes(slot.end_time);
      if (start === null || end === null || end <= start) return;
      const hours = (end - start) / 60;
      const uniqueDays = Array.from(new Set(slot.days_of_week || []));
      if (uniqueDays.length === 0) return;

      for (const day of uniqueDays) {
        if (recordTargetDay) targetScheduledDays.add(day);
        projectedDailyHours.set(day, (projectedDailyHours.get(day) ?? 0) + hours);
        const keySet = projectedDailySubjects.get(day) ?? new Set<string>();
        keySet.add(`${slot.class_id}_${slot.subject_id}`);
        projectedDailySubjects.set(day, keySet);
      }
    };

    for (const existing of otherTeacherLoads) addSlotToTotals(existing, false);
    for (const target of targetSlots) addSlotToTotals(target, true);

    for (const day of targetScheduledDays) {
      const dayLabel = DAY_LABELS[day] ?? day;
      const hrs = projectedDailyHours.get(day) ?? 0;
      if (caps.maxHoursPerDay != null && hrs > caps.maxHoursPerDay) {
        return `Conflict: Exceeds max ${caps.maxHoursPerDay} hrs/day on ${dayLabel} (${hrs.toFixed(1)} hrs)`;
      }
      const subjCount = projectedDailySubjects.get(day)?.size ?? 0;
      if (caps.maxSubjectsPerDay != null && subjCount > caps.maxSubjectsPerDay) {
        return `Conflict: Exceeds max ${caps.maxSubjectsPerDay} subjects/day on ${dayLabel} (${subjCount} scheduled)`;
      }
    }
  }

  return null;
}
