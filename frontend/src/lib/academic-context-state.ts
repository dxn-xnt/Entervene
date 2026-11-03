import type {
  AcademicPeriodItem,
  AcademicYearItem,
} from "@/context/AcademicPeriodContext";

export type AcademicContextState = "active" | "historical" | "future";

export function academicContextState(
  selectedYear: AcademicYearItem | null | undefined,
  selectedPeriod: AcademicPeriodItem | null | undefined,
  periods: AcademicPeriodItem[] = [],
): AcademicContextState {
  if (selectedYear && !selectedYear.is_active) return "historical";
  if (selectedPeriod?.status?.trim().toLowerCase() === "closed") {
    return "historical";
  }
  if (!selectedPeriod || selectedPeriod.is_active) return "active";

  const activePeriod = periods.find((period) => period.is_active);
  if (!activePeriod) return "historical";

  return selectedPeriod.period_sequence > activePeriod.period_sequence
    ? "future"
    : "historical";
}
