import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight, GraduationCap } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type {
  TeacherDashboardGradeBand,
  TeacherDashboardThresholdSummary,
} from "@/lib/api";
import { formatPercent, formatScore } from "./format";

interface GradeDistributionChartProps {
  bands: TeacherDashboardGradeBand[];
  thresholdSummary: TeacherDashboardThresholdSummary;
  onOpenGrades: () => void;
}

function BandTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TeacherDashboardGradeBand }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const band = payload[0].payload;
  return (
    <div className="rounded border-2 border-black bg-white p-2.5 text-xs shadow-md">
      <div className="font-bold text-black">Grade Interval: {band.band}</div>
      <div className="mt-1 space-y-0.5">
        <div>
          Share of graded records:{" "}
          <span className="font-bold tabular-nums">{formatPercent(band.percent)}</span>
        </div>
        <div className="text-muted-foreground">
          {band.count} {band.count === 1 ? "student-subject record" : "student-subject records"}
        </div>
      </div>
    </div>
  );
}

export function GradeDistributionChart({
  bands,
  thresholdSummary,
  onOpenGrades,
}: GradeDistributionChartProps) {
  const hasGrades = thresholdSummary.available_grade_count > 0;

  return (
    <Card className="flex w-full flex-col border-2 border-black bg-card p-4 shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-foreground">
            Term Grade Distribution (%)
          </h3>
          <p className="text-xs text-muted-foreground">
            Neutral numeric intervals across computable class-record grades
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenGrades}
          className="h-8 gap-1 text-xs"
        >
          View Gradebook
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>

      {/* Configured passing-threshold outcomes strip — never hardcodes 75 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border-2 border-black/80 bg-muted/30 px-3 py-2 text-xs">
        {thresholdSummary.warnings.length > 0 ? (
          <span className="font-medium text-amber-800">
            {thresholdSummary.warnings[0].message}
          </span>
        ) : (
          <>
            <Badge variant="success" size="sm" className="font-semibold">
              Meeting Threshold: {formatPercent(thresholdSummary.meeting_threshold_percent)}
              {thresholdSummary.meeting_threshold_count != null
                ? ` (${thresholdSummary.meeting_threshold_count})`
                : ""}
            </Badge>
            <Badge variant="destructive" size="sm" className="font-semibold">
              Below Threshold: {formatPercent(thresholdSummary.below_threshold_percent)}
              {thresholdSummary.below_threshold_count != null
                ? ` (${thresholdSummary.below_threshold_count})`
                : ""}
            </Badge>
            <span className="text-muted-foreground">
              Coverage:{" "}
              <strong className="text-foreground">
                {formatPercent(thresholdSummary.grade_coverage_percent)}
              </strong>{" "}
              ({thresholdSummary.available_grade_count}/{thresholdSummary.total_grade_count})
            </span>
            <span className="ml-auto text-[11px] font-medium text-muted-foreground">
              {thresholdSummary.uniform_passing_threshold != null
                ? `Configured passing threshold: ${formatScore(thresholdSummary.uniform_passing_threshold)}`
                : thresholdSummary.has_mixed_thresholds
                  ? "Evaluated per each subject's configured passing threshold"
                  : "Configured template threshold"}
            </span>
          </>
        )}
      </div>

      {!hasGrades ? (
        <TeacherEmptyState
          compact
          icon={<GraduationCap className="size-5" />}
          title="No computable term grades yet"
          description="Once official graded assessments are scored for enrolled learners, the grade distribution and threshold outcomes will appear here."
        />
      ) : (
        <div className="h-[240px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={bands}
              margin={{ top: 18, right: 12, left: -12, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
              <XAxis
                dataKey="band"
                tick={{ fontSize: 11, fill: "#171717", fontWeight: 600 }}
                axisLine={{ stroke: "#000000" }}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: "#525252" }}
                axisLine={{ stroke: "#000000" }}
                tickLine={false}
              />
              <Tooltip content={<BandTooltip />} />
              <Bar
                dataKey="percent"
                name="Share of Graded Records (%)"
                fill="#FFDB33"
                stroke="#000000"
                strokeWidth={1.75}
                barSize={38}
                radius={[3, 3, 0, 0]}
              >
                <LabelList
                  dataKey="percent"
                  position="top"
                  formatter={(v: unknown) =>
                    typeof v === "number" && v > 0 ? `${v.toFixed(0)}%` : ""
                  }
                  style={{ fontSize: 11, fontWeight: 700, fill: "#000000" }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
