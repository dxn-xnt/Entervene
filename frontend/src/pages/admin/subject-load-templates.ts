import type { SubjectLoadItem, SubjectLoadStudioData } from "@/lib/api";
import { timeStringToMinutes } from "@/lib/time-utils";
import type { PeriodTemplateSlotItem } from "@/pages/admin/forms/break-config-drawer";

export type StudioClassInfo = Pick<
  SubjectLoadStudioData["classes"][number],
  "class_id" | "section_name" | "academic_level_id" | "academic_year_id" | "pathway_id" | "period_template_group"
>;

export type StudioAcademicLevel = Pick<
  SubjectLoadStudioData["academic_levels"][number],
  "academic_level_id" | "grade_level"
>;

export type StudioSubjectOffering = NonNullable<SubjectLoadStudioData["subject_offerings"]>[number];

export type MissingPeriodSlotCode =
  | "NO_TEMPLATE_ASSIGNED"
  | "JHS_TEMPLATE_ON_SHS"
  | "NO_CLASS_PERIODS"
  | "MISSING_OFFERING_DURATION"
  | "NO_DURATION_MATCH";

export interface MissingPeriodSlotInfo {
  code: MissingPeriodSlotCode;
  message: string;
  showEditTimelinesAction: boolean;
  drawerGroup: string | null;
}

export function formatTemplateGroupName(group: string): string {
  switch (group) {
    case "JHS_45MIN":
      return "Junior High (Grades 7–10)";
    case "SHS_CAMPOS_ZARA":
      return "SHS Template A";
    case "SHS_DELMUNDO_REYES":
      return "SHS Template B";
    default:
      return group.replace(/_/g, " ");
  }
}

export function getClassGradeLevel(
  cls: Pick<StudioClassInfo, "academic_level_id"> | undefined,
  academicLevels: StudioAcademicLevel[] = [],
): number | null {
  if (!cls) return null;
  const level = academicLevels.find((item) => item.academic_level_id === cls.academic_level_id);
  return level?.grade_level ?? null;
}

export function isJhsGradeLevel(gradeLevel: number | null): boolean {
  return gradeLevel != null && gradeLevel >= 7 && gradeLevel <= 10;
}

export function isShsGradeLevel(gradeLevel: number | null): boolean {
  return gradeLevel != null && gradeLevel >= 11;
}

export function resolveDefaultShsDrawerGroup(periodTemplateSlots: PeriodTemplateSlotItem[]): string {
  const firstShsGroup = periodTemplateSlots.find((slot) => slot.template_group !== "JHS_45MIN")?.template_group;
  return firstShsGroup || "SHS_CAMPOS_ZARA";
}

/**
 * Strictly resolve a class's configured Break Timeline group.
 * - Grades 7–10 default to the canonical shared `JHS_45MIN` bell schedule.
 * - Grades 11–12 MUST have an explicit non-JHS template group assigned; never
 *   fall back to `JHS_45MIN` and never guess between SHS templates by name.
 */
export function resolveAssignedTemplateGroup(
  cls: Pick<StudioClassInfo, "academic_level_id" | "period_template_group"> | undefined,
  academicLevels: StudioAcademicLevel[] = [],
): string | null {
  if (!cls) return null;
  const grade = getClassGradeLevel(cls, academicLevels);
  const rawGroup = cls.period_template_group?.trim() || null;
  if (isShsGradeLevel(grade)) {
    if (!rawGroup || rawGroup === "JHS_45MIN") return null;
    return rawGroup;
  }
  return rawGroup || "JHS_45MIN";
}

export function getConfiguredTemplateSlots(
  cls: Pick<StudioClassInfo, "academic_level_id" | "period_template_group"> | undefined,
  academicLevels: StudioAcademicLevel[],
  periodTemplateSlots: PeriodTemplateSlotItem[],
): PeriodTemplateSlotItem[] {
  const group = resolveAssignedTemplateGroup(cls, academicLevels);
  if (!group) return [];
  return periodTemplateSlots
    .filter((slot) => slot.template_group === group)
    .sort((a, b) => a.display_order - b.display_order);
}

export function getAssignableClassSlots(
  cls: Pick<StudioClassInfo, "academic_level_id" | "period_template_group"> | undefined,
  academicLevels: StudioAcademicLevel[],
  periodTemplateSlots: PeriodTemplateSlotItem[],
): PeriodTemplateSlotItem[] {
  return getConfiguredTemplateSlots(cls, academicLevels, periodTemplateSlots).filter(
    (slot) => slot.slot_type === "CLASS" && !slot.is_locked_break && slot.slot_id != null,
  );
}

export function getOfferingForClassSubject(
  subjectId: number,
  cls: Pick<StudioClassInfo, "academic_level_id" | "academic_year_id" | "pathway_id">,
  offerings: StudioSubjectOffering[] = [],
  academicPeriodId: number,
): StudioSubjectOffering | undefined {
  return offerings.find((offering) => {
    if (
      offering.subject_id !== subjectId
      || offering.academic_level_id !== cls.academic_level_id
      || offering.academic_year_id !== cls.academic_year_id
      || offering.academic_period_id !== academicPeriodId
    ) {
      return false;
    }
    const pathwayIds = offering.pathway_ids || [];
    return pathwayIds.length === 0 || (cls.pathway_id != null && pathwayIds.includes(cls.pathway_id));
  });
}

export function getSlotDurationMinutes(slot: { start_time: string; end_time: string }): number | null {
  const start = timeStringToMinutes(slot.start_time);
  const end = timeStringToMinutes(slot.end_time);
  if (
    start == null
    || end == null
    || start === Number.MAX_SAFE_INTEGER
    || end === Number.MAX_SAFE_INTEGER
    || end <= start
  ) {
    return null;
  }
  return end - start;
}

export function getCompatiblePeriodSlots(
  cls: StudioClassInfo | undefined,
  subjectId: number,
  academicLevels: StudioAcademicLevel[],
  periodTemplateSlots: PeriodTemplateSlotItem[],
  offerings: StudioSubjectOffering[],
  academicPeriodId: number,
): PeriodTemplateSlotItem[] {
  if (!cls) return [];
  const offering = getOfferingForClassSubject(subjectId, cls, offerings, academicPeriodId);
  if (offering?.minutes == null) return [];
  return getAssignableClassSlots(cls, academicLevels, periodTemplateSlots).filter(
    (slot) => getSlotDurationMinutes(slot) === offering.minutes,
  );
}

export function resolveMatchingPeriodSlot(
  load: Pick<SubjectLoadItem, "slot_id" | "start_time" | "end_time">,
  candidateSlots: PeriodTemplateSlotItem[],
): PeriodTemplateSlotItem | undefined {
  return candidateSlots.find(
    (period) =>
      (load.slot_id != null && period.slot_id === load.slot_id)
      || (
        Boolean(load.start_time && load.end_time)
        && period.start_time === load.start_time
        && period.end_time === load.end_time
      ),
  );
}

/**
 * Explain clearly why no assignable period is available for a section/subject
 * and identify which Break Timeline group to open when the admin clicks
 * "Edit Break Timelines". Never invents periods or times.
 */
export function diagnoseMissingPeriodSlots(
  cls: StudioClassInfo | undefined,
  subjectId: number,
  academicLevels: StudioAcademicLevel[],
  periodTemplateSlots: PeriodTemplateSlotItem[],
  offerings: StudioSubjectOffering[],
  academicPeriodId: number,
): MissingPeriodSlotInfo | null {
  if (!cls) return null;
  const grade = getClassGradeLevel(cls, academicLevels);
  const isShs = isShsGradeLevel(grade);
  const rawGroup = cls.period_template_group?.trim() || null;

  if (isShs && !rawGroup) {
    return {
      code: "NO_TEMPLATE_ASSIGNED",
      message: `No Break Timeline is assigned to ${cls.section_name}. Assign a Senior High template in Edit Break Timelines.`,
      showEditTimelinesAction: true,
      drawerGroup: resolveDefaultShsDrawerGroup(periodTemplateSlots),
    };
  }

  if (isShs && rawGroup === "JHS_45MIN") {
    return {
      code: "JHS_TEMPLATE_ON_SHS",
      message: `${cls.section_name} is assigned to the Junior High template (JHS_45MIN). Assign an SHS template in Edit Break Timelines.`,
      showEditTimelinesAction: true,
      drawerGroup: resolveDefaultShsDrawerGroup(periodTemplateSlots),
    };
  }

  const assignedGroup = resolveAssignedTemplateGroup(cls, academicLevels);
  const assignableSlots = getAssignableClassSlots(cls, academicLevels, periodTemplateSlots);
  if (!assignedGroup || assignableSlots.length === 0) {
    const label = assignedGroup ? formatTemplateGroupName(assignedGroup) : cls.section_name;
    return {
      code: "NO_CLASS_PERIODS",
      message: `No class periods are configured in ${label}. Add valid class periods in Edit Break Timelines.`,
      showEditTimelinesAction: true,
      drawerGroup: assignedGroup || (isShs ? resolveDefaultShsDrawerGroup(periodTemplateSlots) : "JHS_45MIN"),
    };
  }

  const offering = getOfferingForClassSubject(subjectId, cls, offerings, academicPeriodId);
  if (offering?.minutes == null) {
    return {
      code: "MISSING_OFFERING_DURATION",
      message: "No period duration is configured for this subject offering in Curriculum Plan.",
      showEditTimelinesAction: false,
      drawerGroup: null,
    };
  }

  const compatible = assignableSlots.filter(
    (slot) => getSlotDurationMinutes(slot) === offering.minutes,
  );
  if (compatible.length > 0) return null;

  const availableDurations = Array.from(
    new Set(
      assignableSlots
        .map((slot) => getSlotDurationMinutes(slot))
        .filter((minutes): minutes is number => minutes != null),
    ),
  ).sort((a, b) => a - b);
  const availableText = availableDurations.map((minutes) => `${minutes} min`).join(", ");

  return {
    code: "NO_DURATION_MATCH",
    message: `No ${offering.minutes}-minute class period exists in ${formatTemplateGroupName(assignedGroup)} (configured: ${availableText}). Update this section's schedule in Edit Break Timelines.`,
    showEditTimelinesAction: true,
    drawerGroup: assignedGroup,
  };
}

/**
 * Attach authoritative `slot_id` when a load's saved times exactly match a
 * single assignable CLASS period in its section's assigned Break Timeline.
 * Never overwrites or clears custom/unmatched saved schedules.
 */
export function withAuthoritativeTemplateSlots(
  items: SubjectLoadItem[],
  classes: StudioClassInfo[] = [],
  academicLevels: StudioAcademicLevel[] = [],
  periodTemplateSlots: PeriodTemplateSlotItem[] = [],
): SubjectLoadItem[] {
  const classesById = new Map(classes.map((cls) => [cls.class_id, cls]));
  return items.map((item) => {
    if (!item.start_time || !item.end_time) return item;
    const cls = classesById.get(item.class_id);
    if (!cls) return item;
    const assignable = getAssignableClassSlots(cls, academicLevels, periodTemplateSlots);
    const matches = assignable.filter(
      (slot) => slot.start_time === item.start_time && slot.end_time === item.end_time,
    );
    return matches.length === 1
      ? {
          ...item,
          slot_id: matches[0].slot_id,
          start_time: matches[0].start_time,
          end_time: matches[0].end_time,
        }
      : item;
  });
}
