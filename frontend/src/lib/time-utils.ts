export function timeStringToMinutes(str?: string | null): number {
  if (!str) return Number.MAX_SAFE_INTEGER;
  const parts = str.split(":");
  if (parts.length < 2) return Number.MAX_SAFE_INTEGER;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  if (isNaN(h)) return Number.MAX_SAFE_INTEGER;
  return h * 60 + m;
}

export function formatMinsTo12h(mins: number): string {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const p = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${p}`;
}

export function validatePeriodTimeRange(
  startStr: string,
  endStr: string,
  schoolDayStartStr: string = "06:00",
  schoolDayEndStr: string = "20:00"
): string | null {
  const startMins = timeStringToMinutes(startStr);
  const endMins = timeStringToMinutes(endStr);
  
  if (startMins >= Number.MAX_SAFE_INTEGER || endMins >= Number.MAX_SAFE_INTEGER) {
      return "Invalid time format.";
  }

  if (endMins <= startMins) {
    return "End time must be after start time.";
  }

  const minMins = timeStringToMinutes(schoolDayStartStr);
  const maxMins = timeStringToMinutes(schoolDayEndStr);

  if (startMins < minMins || endMins > maxMins) {
    return `Time falls outside configured school hours (${formatMinsTo12h(minMins)} - ${formatMinsTo12h(maxMins)}).`;
  }

  return null;
}
