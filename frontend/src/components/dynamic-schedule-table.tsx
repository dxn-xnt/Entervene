import { Table } from "@/components/retroui/Table";
import { Loader } from "@/components/retroui/Loader";
import { Badge } from "@/components/retroui/Badge";
import type { DynamicScheduleRow } from "@/lib/api";

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
    return (
      <div className="flex items-center justify-center p-8 bg-white border-2 border-black rounded-lg shadow-md">
        <Loader size="sm" />
        <span className="ml-2 text-sm font-bold">Loading schedule...</span>
      </div>
    );
  }

  if (!isPublished || !schedule || schedule.length === 0) {
    return (
      <div className="p-6 text-center bg-amber-50/60 border-2 border-dashed border-amber-300 rounded-lg">
        <p className="text-sm font-semibold text-amber-900">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <Table
      wrapperClassName="shadow-md transition-all hover:shadow-none"
      className="table-fixed rounded-lg bg-white"
    >
      <Table.Header>
        <Table.Row>
          <Table.Head className="w-2/5 font-bold text-black">Subject</Table.Head>
          <Table.Head className="text-center font-bold text-black">Time</Table.Head>
          <Table.Head className="text-right w-48 font-bold text-black">Days</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {schedule.map((row, idx) =>
          row.type === "break" ? (
            <Table.Row key={`break_${idx}`} className="hover:bg-amber-50/30 bg-amber-50/20">
              <Table.Cell
                colSpan={3}
                className="text-center text-xs font-bold uppercase tracking-wider text-muted-foreground py-2.5"
              >
                — {row.label} —
              </Table.Cell>
            </Table.Row>
          ) : (
            <Table.Row
              key={`class_${row.subject_load_id || idx}`}
              className={`hover:bg-accent/40 ${row.is_covered ? "opacity-70 bg-amber-50/20" : ""}`}
            >
              <Table.Cell className="font-semibold text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>{row.subject}</span>
                  {row.is_substitution && (
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px] font-bold"
                    >
                      Covering: {row.original_teacher_name || "Original Teacher"}
                    </Badge>
                  )}
                  {row.is_covered && (
                    <Badge
                      variant="outline"
                      className="bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 text-[10px] font-bold"
                    >
                      On Leave • Covered by {row.substitute_name || "Substitute"}
                    </Badge>
                  )}
                </div>
                {showTeacher && row.teacher && (
                  <span className="text-xs text-muted-foreground font-normal block mt-0.5">
                    {row.teacher} {row.section_name ? `• ${row.section_name}` : ""}
                  </span>
                )}
              </Table.Cell>
              <Table.Cell className="text-center">
                <span className="inline-flex items-center justify-center rounded-full border-2 border-black bg-white px-3 py-0.5 text-xs font-bold shadow-[1px_1px_0_#000]">
                  {row.time}
                </span>
              </Table.Cell>

              <Table.Cell>
                <div className="flex flex-row justify-end gap-1">
                  {(row.days && row.days.length > 0 ? row.days : ["M", "T", "W", "Th", "F"]).map((day) => (
                    <span
                      key={day}
                      className="flex size-6 items-center justify-center rounded-full border-2 border-black bg-amber-100 font-bold text-[10px] text-black shadow-[1px_1px_0_#000]"
                    >
                      {day}
                    </span>
                  ))}
                </div>
              </Table.Cell>
            </Table.Row>
          )
        )}
      </Table.Body>
    </Table>
  );
}
