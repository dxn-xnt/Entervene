import { useState } from "react";
import { Table } from "@/components/retroui/Table";
import { LoadingPanel } from "@/components/loading-panel";
import { Empty } from "@/components/retroui/Empty";
import { Badge } from "@/components/retroui/Badge";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
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

function formatScheduleDays(days?: string[]): string {
  if (!days || days.length === 0) return "Monday – Friday";
  if (days.length === 5 && DAY_ORDER.every((d) => days.includes(d))) {
    return "Monday – Friday";
  }
  return days.map((d) => DAY_LABELS[d] || d).join(", ");
}

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
  showSection?: boolean;
  onSubjectClick?: (entry: DynamicScheduleRow) => void;
}

function getEntryKey(entry: DynamicScheduleRow, showSection = true): string {
  return [
    entry.subject_load_id ?? "",
    entry.subject ?? "",
    showSection ? (entry.section_name ?? "") : "",
    entry.teacher ?? "",
    entry.is_substitution ? "sub" : "",
    entry.original_teacher_name ?? "",
    entry.is_covered ? "cov" : "",
    entry.substitute_name ?? "",
  ].join("::");
}

function getEntriesKey(entries: DynamicScheduleRow[], showSection = true): string {
  if (!entries || entries.length === 0) return "";
  return entries.map((e) => getEntryKey(e, showSection)).sort().join("||");
}

export function DynamicScheduleTable({
  schedule,
  isPublished = true,
  isLoading = false,
  emptyMessage = "No published schedule available yet.",
  showTeacher = true,
  showSection = true,
  onSubjectClick,
}: DynamicScheduleTableProps) {
  const [selectedEntry, setSelectedEntry] = useState<DynamicScheduleRow | null>(null);
  if (isLoading) {
    return <LoadingPanel label="Loading schedule..." />;
  }

  if (!isPublished || !schedule || schedule.length === 0) {
    return (
      <Empty>
        <Empty.Content>
          <Empty.Title>{emptyMessage}</Empty.Title>
        </Empty.Content>
      </Empty>
    );
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
    <div className="min-w-0">
      <Table className="w-full min-w-[640px] border-collapse bg-background text-sm">
        {/* ── Header row: corner + one column per day ── */}
        <Table.Header>
          <Table.Row>
            {/* Sticky time-label corner */}
            <Table.Head className="sticky left-0 z-20 w-28 border-b-2 border-r-2 border-black bg-primary px-3 py-2.5 text-left text-base font-bold text-black">
              Time
            </Table.Head>

            {DAY_ORDER.map((day) => (
              <Table.Head
                key={day}
                className="border-b-2 border-r-none border-black bg-primary px-3 py-2.5 text-center text-base font-bold text-black whitespace-nowrap min-w-[120px]"
              >
                <div>{DAY_LABELS[day]}</div>
              </Table.Head>
            ))}
          </Table.Row>
        </Table.Header>

        {/* ── Body: one row per time slot ── */}
        <Table.Body>
          {columns.map((slot) => {
            // Break slot → full-width separator row
            if (slot.isBreak) {
              return (
                <Table.Row key={slot.start_time} className="bg-background border-none">
                  <Table.Cell className="sticky left-0 z-10 border-r-2 border-t-2 border-black bg-background px-3 py-1 text-xs font-semibold text-foreground whitespace-nowrap">
                    {slot.time}
                  </Table.Cell>
                  <Table.Cell
                    colSpan={DAY_ORDER.length}
                    className="border-none bg-background px-3 py-1.5 text-center text-xs font-medium text-muted-foreground"
                  >
                    {slot.label}
                  </Table.Cell>
                </Table.Row>
              );
            }

            // Class slot row — group contiguous identical days into merged cards
            const groups: {
              startDay: SchoolDay;
              span: number;
              entries: DynamicScheduleRow[];
            }[] = [];

            for (const day of DAY_ORDER) {
              const entries = cellMap[day]?.[slot.start_time] ?? [];
              const currentKey = getEntriesKey(entries, showSection);
              const lastGroup = groups[groups.length - 1];
              const lastKey = lastGroup ? getEntriesKey(lastGroup.entries, showSection) : null;

              if (lastGroup && lastKey === currentKey) {
                lastGroup.span += 1;
              } else {
                groups.push({
                  startDay: day,
                  span: 1,
                  entries,
                });
              }
            }

            return (
              <Table.Row
                key={slot.start_time}
                className="bg-background border-none hover:bg-background"
              >
                {/* Sticky time label */}
                <Table.Cell className="sticky left-0 z-10 border-r-2 border-y-2 border-black px-3 py-2.5 align-middle whitespace-nowrap">
                  <div className="text-xs font-bold text-black">{slot.time}</div>
                </Table.Cell>

                {/* Grouped day cells */}
                {groups.map((group) => {
                  const entries = group.entries;

                  return (
                    <Table.Cell
                      key={group.startDay}
                      colSpan={group.span}
                      className="border-none px-1.5 py-1 align-top"
                    >
                      {entries.length === 0 ? (
                        <div className="h-full min-h-[2rem]" />
                      ) : (
                        <div className="flex flex-col gap-1 w-full">
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
                                `${group.startDay}-${slot.start_time}-${i}`
                              }
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                if (onSubjectClick) {
                                  onSubjectClick(entry);
                                } else {
                                  setSelectedEntry(entry);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  if (onSubjectClick) {
                                    onSubjectClick(entry);
                                  } else {
                                    setSelectedEntry(entry);
                                  }
                                }
                              }}
                              className={`w-full rounded border-2 border-black px-2 py-1.5 text-xs hover:bg-retro leading-snug shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-primary ${entry.is_covered
                                ? "bg-amber-50"
                                : entry.is_substitution
                                  ? "bg-emerald-50"
                                  : "bg-white"
                                }`}
                            >
                              {/* Subject */}
                              <div className="text-sm font-bold text-black truncate">
                                {entry.subject}
                              </div>

                              {/* Section */}
                              {showSection && entry.section_name && (
                                <div className="mt-0.5 font-semibold text-foreground">
                                  {entry.section_name}
                                </div>
                              )}

                              {/* Teacher (admin / student views) */}
                              {showTeacher && entry.teacher && (
                                <div className="text-muted-foreground">
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
                    </Table.Cell>
                  );
                })}
              </Table.Row>
            );
          })}
        </Table.Body>
      </Table>

      {/* Subject Detail Modal */}
      <Dialog
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      >
        <Dialog.Content size="md" className="overflow-hidden p-0 max-w-lg">
          <Dialog.Header className="bg-primary text-black border-b-2 border-black px-5 py-4">
            <Dialog.Title className="font-bold font-head text-black">
              Subject Details
            </Dialog.Title>
          </Dialog.Header>

          <div className="flex flex-col gap-4 p-5 bg-background text-sm">
            {/* Subject Header */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl font-black text-foreground">
                  {selectedEntry?.subject}
                </h3>
                {selectedEntry?.subject_codename && (
                  <Badge variant="surface" size="sm" className="font-mono">
                    {selectedEntry.subject_codename}
                  </Badge>
                )}
              </div>
            </div>

            {/* Grid of details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Section */}
              {selectedEntry?.section_name && (
                <div className="flex flex-col gap-0.5 rounded border-2 border-black bg-card p-2.5 shadow-[2px_2px_0px_#000]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    Section
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {selectedEntry.section_name}
                  </span>
                </div>
              )}

              {/* Assigned Teacher */}
              {selectedEntry?.teacher && (
                <div className="flex flex-col gap-0.5 rounded border-2 border-black bg-card p-2.5 shadow-[2px_2px_0px_#000]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    Teacher
                  </span>
                  <span className="text-sm font-bold text-foreground">
                    {selectedEntry.teacher}
                  </span>
                </div>
              )}

              {/* Time Slot */}
              <div className="flex flex-col gap-0.5 rounded border-2 border-black bg-card p-2.5 shadow-[2px_2px_0px_#000]">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  Time Schedule
                </span>
                <span className="text-sm font-bold text-foreground">
                  {selectedEntry?.time}
                </span>
              </div>

              {/* Scheduled Days */}
              <div className="flex flex-col gap-0.5 rounded border-2 border-black bg-card p-2.5 shadow-[2px_2px_0px_#000]">
                <span className="text-[10px] font-bold text-muted-foreground flex items-center gap-1.5">
                  Days
                </span>
                <span className="text-sm font-bold text-foreground">
                  {formatScheduleDays(selectedEntry?.days)}
                </span>
              </div>
            </div>

            {/* Status Notes (Substitution or On-leave) */}
            {(selectedEntry?.is_substitution || selectedEntry?.is_covered) && (
              <div className="flex flex-col gap-2 rounded border-2 border-black p-3 bg-muted/40">
                <span className="text-xs font-bold text-foreground">
                  Schedule Status
                </span>
                {selectedEntry.is_substitution && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-500 font-bold">
                      Covering Substitution
                    </Badge>
                    {selectedEntry.original_teacher_name && (
                      <span className="text-xs text-muted-foreground">
                        Original Teacher: {selectedEntry.original_teacher_name}
                      </span>
                    )}
                  </div>
                )}
                {selectedEntry.is_covered && (
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-500 font-bold">
                      Teacher On Leave
                    </Badge>
                    {selectedEntry.substitute_name && (
                      <span className="text-xs text-muted-foreground">
                        Covered by: {selectedEntry.substitute_name}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <Dialog.Footer className="bg-card border-t-2 border-black px-5 py-3 flex justify-end">
            <Button
              variant="default"
              size="sm"
              onClick={() => setSelectedEntry(null)}
            >
              Close
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}

