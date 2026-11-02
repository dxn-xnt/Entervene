import { getClasses, getOfficialSections } from "@/lib/api";

export interface AcademicYearDateItem {
  academic_year_id: number;
  year_label: string;
  start_date?: string | null;
  end_date?: string | null;
  is_active?: boolean;
}

/**
 * Determines whether candidateYear is chronologically strictly earlier than targetYear.
 * Compares actual academic-year dates and calendar years parsed from year_label.
 * Never relies on database IDs or active flags.
 */
export function isChronologicallyEarlierYear(
  candidateYear: AcademicYearDateItem,
  targetYear: AcademicYearDateItem
): boolean {
  if (candidateYear.academic_year_id === targetYear.academic_year_id) {
    return false;
  }

  // 1. If start_dates are defined and differ, compare start_dates
  if (
    candidateYear.start_date &&
    targetYear.start_date &&
    candidateYear.start_date !== targetYear.start_date
  ) {
    return candidateYear.start_date < targetYear.start_date;
  }

  // 2. If candidate end_date is before or on target start_date
  if (
    candidateYear.end_date &&
    targetYear.start_date &&
    candidateYear.end_date <= targetYear.start_date
  ) {
    return true;
  }

  // 3. If end_dates are defined and differ, compare end_dates
  if (
    candidateYear.end_date &&
    targetYear.end_date &&
    candidateYear.end_date !== targetYear.end_date
  ) {
    return candidateYear.end_date < targetYear.end_date;
  }

  // 4. Parse 4-digit start year from year labels (e.g., "2025-2026" or "AY 2025-2026")
  const candidateStart = parseInt(
    candidateYear.year_label.match(/\d{4}/)?.[0] ?? "0",
    10
  );
  const targetStart = parseInt(
    targetYear.year_label.match(/\d{4}/)?.[0] ?? "0",
    10
  );

  if (candidateStart && targetStart && candidateStart !== targetStart) {
    return candidateStart < targetStart;
  }

  return false;
}

const reusableSetupCache = new Map<number, boolean>();

/**
 * Checks whether an academic year has reusable official sections or active classes.
 * Caches results in memory to avoid repeated queries.
 */
export async function checkYearHasReusableSetup(
  academicYearId: number
): Promise<boolean> {
  if (reusableSetupCache.has(academicYearId)) {
    return reusableSetupCache.get(academicYearId)!;
  }

  try {
    const [classesRes, sections] = await Promise.all([
      getClasses("active", academicYearId).catch(() => null),
      getOfficialSections(academicYearId).catch(() => []),
    ]);

    const hasClasses =
      (classesRes?.summary?.total_classes ??
        classesRes?.classes?.length ??
        0) > 0;
    const hasSections = (sections?.length ?? 0) > 0;

    const result = hasClasses || hasSections;
    reusableSetupCache.set(academicYearId, result);
    return result;
  } catch {
    return false;
  }
}

/**
 * Clears the reusable setup cache (useful after new classes or sections are created).
 */
export function invalidateReusableSetupCache(academicYearId?: number): void {
  if (academicYearId != null) {
    reusableSetupCache.delete(academicYearId);
  } else {
    reusableSetupCache.clear();
  }
}

