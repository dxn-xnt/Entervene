export type AcademicPeriodLabelInput = {
  period_name?: string | null;
  period_type?: string | null;
  period_sequence?: number | null;
};

export function formatPeriodLabel(period: AcademicPeriodLabelInput) {
  if (period.period_name) return period.period_name;

  const sequence = period.period_sequence ?? "";

  switch (period.period_type) {
    case "TERM":
      return `Term ${sequence}`;
    case "SEMESTER":
      return `Semester ${sequence}`;
    case "QUARTER":
      return `Quarter ${sequence}`;
    default:
      return `Period ${sequence}`;
  }
}

export function periodTotal(periodType: string) {
  switch (periodType) {
    case "SEMESTER":
      return 2;
    case "QUARTER":
      return 4;
    case "TERM":
    default:
      return 3;
  }
}

export type OperationalPeriod = {
  id: number;
  period: string;
  period_type: string;
  period_sequence: number;
  academic_year_id: number;
  endDate: string | null;
  is_active: boolean;
};

export function overdueActivePeriodNotice(periods: OperationalPeriod[], today = new Date()):
  { active: OperationalPeriod; next: OperationalPeriod | null } | null {
  const todayLocal = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const active = periods.find((period) => period.is_active);
  if (!active?.endDate || !/^\d{4}-\d{2}-\d{2}$/.test(active.endDate) || todayLocal <= active.endDate) return null;
  const next = periods.filter((period) =>
    period.academic_year_id === active.academic_year_id
    && period.period_type === active.period_type
    && period.period_sequence > active.period_sequence,
  ).sort((a, b) => a.period_sequence - b.period_sequence)[0] ?? null;
  return { active, next };
}
