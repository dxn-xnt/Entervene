import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3 } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type { SectionHealthItem, TeacherDashboardSubjectComparison } from "@/lib/api";
import { formatPercent, formatScore } from "./format";

interface SubjectComparisonChartProps {
  subjectComparisons: TeacherDashboardSubjectComparison[];
  sectionMatrix: SectionHealthItem[];
  selectedSubjectId: string;
  onSelectSubject: (subjectId: number) => void;
  onSelectSection: (classId: number, subjectId: number) => void;
}

interface ComparisonRow {
  key: string;
  label: string;
  avgGradedScore: number | null;
  passingRate: number | null;
  submissionRate: number | null;
  studentCount: number;
  passingThreshold: number | null;
  gradeCoverage: number | null;
  availableGrades: number;
  totalGrades: number;
  subjectId: number;
  classId?: number;
}

function ComparisonTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ComparisonRow }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded border-2 border-black bg-white p-2.5 text-xs shadow-md">
      <div className="font-bold text-black">{row.label}</div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Avg. Graded Score:</span>
          <span className="font-bold tabular-nums">{formatPercent(row.avgGradedScore)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Term Passing Rate:</span>
          <span className="font-bold tabular-nums">{formatPercent(row.passingRate)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Submission Rate:</span>
          <span className="font-bold tabular-nums">{formatPercent(row.submissionRate)}</span>
        </div>
        <div className="border-t border-black/15 pt-1 text-[11px] text-muted-foreground">
          {row.studentCount} enrolled · Coverage {formatPercent(row.gradeCoverage)} ({row.availableGrades}/{row.totalGrades})
          {row.passingThreshold != null ? ` · Threshold ${formatScore(row.passingThreshold)}` : ""}
        </div>
      </div>
    </div>
  );
}

export function SubjectComparisonChart({
  subjectComparisons,
  sectionMatrix,
  selectedSubjectId,
  onSelectSubject,
  onSelectSection,
}: SubjectComparisonChartProps) {
  const isSectionMode = selectedSubjectId !== "all";

  const rows: ComparisonRow[] = isSectionMode
    ? sectionMatrix.map((sec) => ({
        key: `${sec.class_id}-${sec.subject_id}`,
        label: sec.section_name,
        avgGradedScore: sec.avg_graded_score_percent ?? sec.avg_score_percent,
        passingRate: sec.passing_rate_percent,
        submissionRate: sec.submission_rate_percent ?? sec.completion_rate_percent,
        studentCount: sec.student_count,
        passingThreshold: sec.passing_threshold ?? null,
        gradeCoverage: sec.grade_coverage_percent ?? null,
        availableGrades: sec.available_grade_count ?? 0,
        totalGrades: sec.total_grade_count ?? sec.student_count,
        subjectId: sec.subject_id,
        classId: sec.class_id,
      }))
    : subjectComparisons.map((subj) => ({
        key: String(subj.subject_id),
        label: subj.subject_name,
        avgGradedScore: subj.avg_graded_score_percent,
        passingRate: subj.passing_rate_percent,
        submissionRate: subj.submission_rate_percent,
        studentCount: subj.student_count,
        passingThreshold: subj.passing_threshold,
        gradeCoverage: subj.grade_coverage_percent,
        availableGrades: subj.available_grade_count,
        totalGrades: subj.total_grade_count,
        subjectId: subj.subject_id,
      }));

  const chartHeight = Math.max(240, Math.min(360, rows.length * 64 + 40));

  return (
    <Card className="flex w-full flex-col border-2 border-black bg-card p-4 shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-foreground">
            {isSectionMode ? "Section-Level Comparison" : "Subject-Level Comparison"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {isSectionMode
              ? "Click a section to open its class-subject workspace"
              : "Click a subject to filter dashboard analytics to that subject"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 font-medium">
            <span className="inline-block size-2.5 rounded-sm bg-black" />
            Graded %
          </span>
          <span className="inline-flex items-center gap-1 font-medium">
            <span className="inline-block size-2.5 rounded-sm border border-black bg-primary" />
            Passing %
          </span>
          <span className="inline-flex items-center gap-1 font-medium">
            <span className="inline-block size-2.5 rounded-sm border border-black bg-neutral-300" />
            Submission %
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <TeacherEmptyState
          compact
          icon={<BarChart3 className="size-5" />}
          title="No comparative data available"
          description="Assigned subjects and sections for the selected period will be compared here."
        />
      ) : (
        <div style={{ height: chartHeight }} className="w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              layout="vertical"
              margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
              barGap={3}
              onClick={(state) => {
                const idx = Number(state?.activeTooltipIndex);
                const row = Number.isInteger(idx) ? rows[idx] : undefined;
                if (!row) return;
                if (isSectionMode && row.classId != null) {
                  onSelectSection(row.classId, row.subjectId);
                } else {
                  onSelectSubject(row.subjectId);
                }
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" horizontal={false} />
              <XAxis
                type="number"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "#525252" }}
                axisLine={{ stroke: "#000000" }}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={108}
                tick={{ fontSize: 11, fill: "#171717", fontWeight: 600 }}
                axisLine={{ stroke: "#000000" }}
                tickLine={false}
              />
              <Tooltip content={<ComparisonTooltip />} />
              <Bar
                dataKey="avgGradedScore"
                name="Avg. Graded Score (%)"
                fill="#000000"
                barSize={10}
                radius={[0, 2, 2, 0]}
                className="cursor-pointer"
              />
              <Bar
                dataKey="passingRate"
                name="Term Passing Rate (%)"
                fill="#FFDB33"
                stroke="#000000"
                strokeWidth={1}
                barSize={10}
                radius={[0, 2, 2, 0]}
                className="cursor-pointer"
              />
              <Bar
                dataKey="submissionRate"
                name="Submission Rate (%)"
                fill="#D4D4D4"
                stroke="#000000"
                strokeWidth={1}
                barSize={10}
                radius={[0, 2, 2, 0]}
                className="cursor-pointer"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
