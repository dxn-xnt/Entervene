export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)}%`;
}

export function formatScore(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

export function buildPathWithQuery(
  basePath: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === "all") {
      continue;
    }
    query.set(key, String(value));
  }
  const qs = query.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
