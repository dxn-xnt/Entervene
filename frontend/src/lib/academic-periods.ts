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
