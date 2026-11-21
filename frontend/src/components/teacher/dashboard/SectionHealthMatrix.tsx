import { ArrowUpRight, School } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Table } from "@/components/retroui/Table";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type { SectionHealthItem } from "@/lib/api";
import { formatPercent, formatScore } from "./format";

interface SectionHealthMatrixProps {
  sections: SectionHealthItem[];
  onSelectSection: (classId: number, subjectId: number) => void;
}

export function SectionHealthMatrix({
  sections,
  onSelectSection,
}: SectionHealthMatrixProps) {
  return (
    <Card className="flex w-full flex-col border-2 border-black bg-card p-4 shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-foreground">
            Class &amp; Subject Health Matrix
          </h3>
          <p className="text-xs text-muted-foreground">
            Aggregate metrics per assigned section and subject — click any row to open details
          </p>
        </div>
        <Badge variant="outline" size="sm">
          {sections.length} {sections.length === 1 ? "load" : "loads"}
        </Badge>
      </div>

      {sections.length === 0 ? (
        <TeacherEmptyState
          compact
          icon={<School className="size-5" />}
          title="No matching classes or subjects"
          description="Adjust your class/subject filters or select another academic period to view section health."
        />
      ) : (
        <>
          {/* Mobile card list (< 640px) */}
          <div className="flex flex-col gap-2.5 sm:hidden">
            {sections.map((sec) => {
              const subRate = sec.submission_rate_percent ?? sec.completion_rate_percent;
              const gradedScore = sec.avg_graded_score_percent ?? sec.avg_score_percent;
              return (
                <button
                  key={`${sec.class_id}-${sec.subject_id}`}
                  type="button"
                  onClick={() => onSelectSection(sec.class_id, sec.subject_id)}
                  className="flex flex-col gap-2 rounded border-2 border-black bg-background p-3 text-left shadow-sm transition-transform active:translate-y-0.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-foreground">
                        {sec.section_name} · {sec.subject_name}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {sec.grade_level ? `${sec.grade_level} · ` : ""}
                        {sec.student_count} enrolled · {sec.published_classworks} published
                      </div>
                    </div>
                    <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                    <div className="rounded border border-black/40 bg-muted/30 p-1.5">
                      <div className="text-muted-foreground">Submission</div>
                      <div className="font-bold tabular-nums">{formatPercent(subRate)}</div>
                    </div>
                    <div className="rounded border border-black/40 bg-muted/30 p-1.5">
                      <div className="text-muted-foreground">Grading</div>
                      <div className="font-bold tabular-nums">
                        {formatPercent(sec.grading_completion_rate_percent)}
                      </div>
                    </div>
                    <div className="rounded border border-black/40 bg-muted/30 p-1.5">
                      <div className="text-muted-foreground">Avg. Score</div>
                      <div className="font-bold tabular-nums">{formatPercent(gradedScore)}</div>
                    </div>
                    <div className="rounded border border-black/40 bg-muted/30 p-1.5">
                      <div className="text-muted-foreground">Passing</div>
                      <div className="font-bold tabular-nums">
                        {formatPercent(sec.passing_rate_percent)}
                      </div>
                    </div>
                    <div className="rounded border border-black/40 bg-muted/30 p-1.5">
                      <div className="text-muted-foreground">Mean ECR</div>
                      <div className="font-bold tabular-nums">
                        {formatScore(sec.current_grade)}
                      </div>
                    </div>
                    <div className="rounded border border-black/40 bg-muted/30 p-1.5">
                      <div className="text-muted-foreground">Attendance</div>
                      <div className="font-bold tabular-nums">
                        {formatPercent(sec.attendance_rate_percent)}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Desktop & tablet structured table with shadow breathing room */}
          <div className="hidden p-1 sm:block">
            <Table wrapperClassName="shadow-sm">
              <Table.Header>
                <Table.Row className="hover:bg-primary">
                  <Table.Head className="font-bold text-black">Class &amp; Subject</Table.Head>
                  <Table.Head className="text-right font-bold text-black">Enrolled</Table.Head>
                  <Table.Head className="text-right font-bold text-black">Submission</Table.Head>
                  <Table.Head className="text-right font-bold text-black">Grading</Table.Head>
                  <Table.Head className="text-right font-bold text-black">Avg. Score</Table.Head>
                  <Table.Head className="text-right font-bold text-black">Passing</Table.Head>
                  <Table.Head className="text-right font-bold text-black">Attendance</Table.Head>
                  <Table.Head className="w-8" />
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {sections.map((sec) => {
                  const subRate = sec.submission_rate_percent ?? sec.completion_rate_percent;
                  const gradedScore = sec.avg_graded_score_percent ?? sec.avg_score_percent;
                  return (
                    <Table.Row
                      key={`${sec.class_id}-${sec.subject_id}`}
                      tabIndex={0}
                      role="button"
                      onClick={() => onSelectSection(sec.class_id, sec.subject_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectSection(sec.class_id, sec.subject_id);
                        }
                      }}
                      className="cursor-pointer hover:bg-primary/15 focus-visible:bg-primary/20 focus-visible:outline-none"
                    >
                      <Table.Cell className="py-2.5">
                        <div className="font-bold text-foreground">{sec.section_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {sec.subject_name}
                          {sec.grade_level ? ` · ${sec.grade_level}` : ""}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums font-medium">
                        {sec.student_count}
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums font-semibold">
                        {formatPercent(subRate)}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <div className="tabular-nums font-semibold">
                          {formatPercent(sec.grading_completion_rate_percent)}
                        </div>
                        {sec.awaiting_grading_count != null && sec.awaiting_grading_count > 0 && (
                          <div className="text-[10px] font-medium text-amber-800">
                            {sec.awaiting_grading_count} awaiting
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums font-semibold">
                        {formatPercent(gradedScore)}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <div className="tabular-nums font-semibold">
                          {formatPercent(sec.passing_rate_percent)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Mean {formatScore(sec.current_grade)} · {sec.available_grade_count ?? 0}/
                          {sec.total_grade_count ?? sec.student_count}
                          {sec.passing_threshold != null
                            ? ` (≥${formatScore(sec.passing_threshold, 0)})`
                            : ""}
                        </div>
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums font-semibold">
                        {formatPercent(sec.attendance_rate_percent)}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <ArrowUpRight className="ml-auto size-4 text-muted-foreground" />
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}
