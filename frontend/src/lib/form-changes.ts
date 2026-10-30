/** Compare persisted form values; callers normalize fields as their API does. */
export function formSnapshot(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (item == null || item === "") return null;
    if (item instanceof Date) return item.toISOString();
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]));
    }
    return item;
  }
  return JSON.stringify(normalize(value));
}

/** Only use for selections whose order has no saved meaning. */
export function unorderedValues<T>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => formSnapshot(a).localeCompare(formSnapshot(b)));
}

export function optionalNumber(value: unknown): number | null {
  return value == null || String(value).trim() === "" ? null : Number(value);
}
