import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { Badge } from "@/components/retroui/Badge";
import type { DynamicScheduleRow } from "@/lib/api";

// Fixed day order matching DepEd school week
const DAY_ORDER = ["M", "T", "W", "Th", "F"] as const;
type SchoolDay = (typeof DAY_ORDER)[number];

const DAY_LABELS: Record<string, string> = {
  M: "Monday",
  T: "Tuesday",
  W: "Wednesday",
  Th: "Thursday",
  F: "Friday",
};

interface ColDef {
  /** Column key — the raw start_time string from the payload (e.g. "07:30") */
  start_time: string;
  /** Human-readable time range label ("7:30 AM – 8:15 AM") */
  time: string;
  isBreak: boolean;
  /** Only set for break rows */
  label?: string;
  slot_type?: string;
}

interface DynamicScheduleTableProps {
  schedule: DynamicScheduleRow[];
  isPublished?: boolean;
  isLoading?: boolean;
  emptyMessage?: string;
  showTeacher?: boolean;
}

export function DynamicScheduleTable({
  schedule,
  isPublished = true,
  isLoading = false,
  emptyMessage = "No published schedule available yet.",
  showTeacher = true,
}: DynamicScheduleTableProps) {
  if (isLoading) {
    return <LoadingPanel label="Loading schedule..." />;
  }

  if (!isPublished || !schedule || schedule.length === 0) {
    return <EmptyStateCard title={emptyMessage} />;
  }

  // ── 1. Build unique time-columns sorted chronologically ──────────────────
  // Use start_time as the canonical key; fall back to time string for
  // malformed rows that only carry the formatted range.
  const seenKeys = new Set<string>();
  const columns: ColDef[] = [];

  for (const row of schedule) {
    const key = row.start_time ?? row.time;
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);
    columns.push({
      start_time: key,
      time: row.time,
      isBreak: row.type === "break",
      label: row.label,
      slot_type: row.slot_type,
    });
  }

  // Sort lexicographically — "07:30" < "08:15" is correct for HH:MM strings
  columns.sort((a, b) => a.start_time.localeCompare(b.start_time));

  // ── 2. Build cellMap[day][start_time] = DynamicScheduleRow[] ─────────────
  // Arrays so overlapping entries (data integrity signal) stay visible.
  const cellMap: Record<string, Record<string, DynamicScheduleRow[]>> = {};
  for (const day of DAY_ORDER) {
    cellMap[day] = {};
  }

  for (const row of schedule) {
    if (row.type !== "class") continue;
    const key = row.start_time ?? row.time;
    if (!key) continue;
    for (const day of row.days ?? []) {
      const dayCell = cellMap[day as SchoolDay];
      if (!dayCell) continue; // unknown abbreviation — skip
      if (!dayCell[key]) dayCell[key] = [];
      dayCell[key].push(row);
    }
  }

  // ── 3. Render ─────────────────────────────────────────────────────────────
  // Orientation: days = top-row columns, time slots = left-column rows.
  return (
    <div className="overflow-x-auto rounded-lg border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <table className="w-full min-w-[640px] border-collapse bg-white text-sm">
        {/* ── Header row: corner + one column per day ── */}
        <thead>
          <tr>
            {/* Sticky time-label corner */}
            <th className="sticky left-0 z-20 w-28 border-b-2 border-r-2 border-black bg-[#F6E9B2] px-3 py-2.5 text-left text-xs font-bold text-black">
              Time
            </th>

            {DAY_ORDER.map((day) => (
              <th
                key={day}
                className="border-b-2 border-r border-black bg-[#F6E9B2] px-3 py-2.5 text-center text-xs font-bold text-black whitespace-nowrap min-w-[120px]"
              >
                <div>{DAY_LABELS[day]}</div>
                <div className="text-[10px] font-mono text-gray-600">{day}</div>
              </th>
            ))}
          </tr>
        </thead>

        {/* ── Body: one row per time slot ── */}
        <tbody>
          {columns.map((slot, slotIdx) => {
            // Break slot → full-width separator row
            if (slot.isBreak) {
              return (
                <tr key={slot.start_time} className="bg-amber-50/60">
                  <td className="sticky left-0 z-10 border-r-2 border-t border-black bg-amber-100/70 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground whitespace-nowrap">
                    {slot.label}
                  </td>
                  {DAY_ORDER.map((day) => (
                    <td
                      key={day}
                      className="border-r border-t border-black/20 bg-amber-50/50 px-1 py-1.5 text-center text-[10px] text-muted-foreground"
                    >
                      —
                    </td>
                  ))}
                </tr>
              );
            }

            // Class slot row
            return (
              <tr
                key={slot.start_time}
                className={slotIdx % 2 === 0 ? "bg-white" : "bg-gray-50/40"}
              >
                {/* Sticky time label */}
                <td className="sticky left-0 z-10 border-r-2 border-t border-black bg-[#F6E9B2] px-3 py-2.5 align-middle whitespace-nowrap">
                  <div className="text-xs font-bold text-black">{slot.time}</div>
                </td>

                {/* One cell per day */}
                {DAY_ORDER.map((day) => {
                  const entries = cellMap[day]?.[slot.start_time] ?? [];

                  return (
                    <td
                      key={day}
                      className="border-r border-t border-black/20 px-1.5 py-1.5 align-top"
                    >
                      {entries.length === 0 ? (
                        <div className="h-full min-h-[2rem]" />
                      ) : (
                        <div className="flex flex-col gap-1">
                          {/* Overlap warning — data integrity signal */}
                          {entries.length > 1 && (
                            <Badge
                              variant="outline"
                              className="border-red-400 bg-red-50 text-red-700 text-[9px] font-bold self-start"
                            >
                              ⚠ {entries.length} overlapping
                            </Badge>
                          )}

                          {entries.map((entry, i) => (
                            <div
                              key={
                                entry.subject_load_id ??
                                `${day}-${slot.start_time}-${i}`
                              }
                              className={`rounded border border-black px-2 py-1.5 text-[11px] leading-snug shadow-[1px_1px_0_rgba(0,0,0,1)] ${
                                entry.is_covered
                                  ? "bg-amber-50"
                                  : entry.is_substitution
                                  ? "bg-emerald-50"
                                  : "bg-white"
                              }`}
                            >
                              {/* Subject */}
                              <div className="font-bold text-black truncate">
                                {entry.subject}
                              </div>

                              {/* Section */}
                              {entry.section_name && (
                                <div className="mt-0.5 text-[10px] font-semibold text-gray-600 truncate">
                                  {entry.section_name}
                                </div>
                              )}

                              {/* Teacher (admin / student views) */}
                              {showTeacher && entry.teacher && (
                                <div className="text-[10px] text-gray-500 truncate">
                                  {entry.teacher}
                                </div>
                              )}

                              {/* Substitution badge */}
                              {entry.is_substitution && (
                                <Badge
                                  variant="outline"
                                  className="mt-1 bg-emerald-50 text-emerald-800 border-emerald-400 text-[9px] font-bold"
                                >
                                  Covering
                                  {entry.original_teacher_name
                                    ? ` · ${entry.original_teacher_name}`
                                    : ""}
                                </Badge>
                              )}

                              {/* On-leave badge */}
                              {entry.is_covered && (
                                <Badge
                                  variant="outline"
                                  className="mt-1 bg-amber-50 text-amber-800 border-amber-400 text-[9px] font-bold"
                                >
                                  On Leave ·{" "}
                                  {entry.substitute_name ?? "Substitute"}
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

