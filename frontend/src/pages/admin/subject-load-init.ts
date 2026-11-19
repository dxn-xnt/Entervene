import type { SubjectLoadItem, SubjectLoadStudioData } from "@/lib/api";

export function isSubjectOfferedForClass(
  sub: { subject_id: number; academic_level_id: number },
  cls: { academic_level_id: number; academic_year_id: number; pathway_id?: number | null },
  offerings: Array<{
    subject_id: number;
    academic_year_id: number;
    academic_level_id: number;
    academic_period_id: number;
    pathway_ids?: number[];
  }>,
  academicPeriodId: number,
): boolean {
  if (sub.academic_level_id !== cls.academic_level_id) return false;

  return offerings.some((so) => {
    if (
      so.subject_id !== sub.subject_id ||
      so.academic_level_id !== cls.academic_level_id ||
      so.academic_year_id !== cls.academic_year_id ||
      so.academic_period_id !== academicPeriodId
    ) {
      return false;
    }

    const eligiblePathwayIds = so.pathway_ids || [];
    return eligiblePathwayIds.length === 0 || (
      cls.pathway_id != null && eligiblePathwayIds.includes(cls.pathway_id)
    );
  });
}

/**
 * Build initial Studio load rows from server studio-data without mutating
 * existing drafts/published schedules or auto-assigning times to new sections.
 * Eligible subjects with no persisted DB load start as unscheduled drafts.
 */
export function buildInitialStudioLoads(data: SubjectLoadStudioData): SubjectLoadItem[] {
  const existing = data.existing_loads || [];
  const periodIdToUse = data.active_period_id;
  const offerings = data.subject_offerings || [];
  const initialLoads: SubjectLoadItem[] = [];
  const includedExisting = new Set<SubjectLoadItem>();

  const appendExistingLoad = (m: SubjectLoadItem, idx: number, isOfferingEligible: boolean) => {
    includedExisting.add(m);
    initialLoads.push({
      _key: m.subject_load_id
        ? `sl_${m.subject_load_id}`
        : `slot_${m.class_id}_${m.subject_id}_${idx}`,
      _offering_eligible: isOfferingEligible,
      subject_load_id: m.subject_load_id,
      class_id: m.class_id,
      subject_id: m.subject_id,
      staff_id: m.staff_id || null,
      academic_period_id: periodIdToUse,
      slot_id: m.slot_id,
      start_time: m.start_time || null,
      end_time: m.end_time || null,
      days_of_week: m.days_of_week || [],
      status: m.status || "draft",
      is_locked: Boolean(m.is_locked || m.status === "published"),
      logical_load_id: m.logical_load_id,
      section_revision: m.section_revision,
      base_revision: m.status === "published" || m.status === "active"
        ? m.section_revision
        : m.base_revision,
      has_live_data: m.has_live_data,
      dependencies: m.dependencies,
    });
  };

  (data.classes || []).forEach((cls) => {
    const levelSubjects = (data.subjects || []).filter((sub) =>
      isSubjectOfferedForClass(sub, cls, offerings, periodIdToUse)
    );

    levelSubjects.forEach((sub) => {
      const matched = existing.filter(
        (ex) => ex.class_id === cls.class_id && ex.subject_id === sub.subject_id
      );

      if (matched.length > 0) {
        matched.forEach((m, idx) => {
          appendExistingLoad(m, idx, true);
        });
      } else {
        // Leave new section subjects unscheduled until explicitly placed by the admin.
        initialLoads.push({
          _key: `new_${cls.class_id}_${sub.subject_id}`,
          _offering_eligible: true,
          subject_load_id: undefined,
          class_id: cls.class_id,
          subject_id: sub.subject_id,
          staff_id: null,
          academic_period_id: periodIdToUse,
          slot_id: null,
          start_time: null,
          end_time: null,
          days_of_week: [],
          status: "draft",
          is_locked: false,
        });
      }
    });
  });

  // Keep existing rows whose offering was removed or changed visible for
  // review/correction. They are not synthesized as eligible rows and the
  // shared backend validator will continue to block their publication.
  existing.forEach((load, idx) => {
    if (!includedExisting.has(load)) appendExistingLoad(load, idx, false);
  });

  return initialLoads;
}
