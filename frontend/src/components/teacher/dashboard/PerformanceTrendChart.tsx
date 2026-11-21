import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Plus, TrendingUp } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type { TrendChartPoint } from "@/lib/api";
import { formatPercent } from "./format";

interface PerformanceTrendChartProps {
  points: TrendChartPoint[];
  scopeLabel: string;
  hasSufficientData: boolean;
  gradedTaskCount: number;
  isHistorical: boolean;
  onPointClick: (point: TrendChartPoint) => void;
  onCreateClasswork: () => void;
}

function TrendTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: TrendChartPoint }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const pt = payload[0].payload;
  return (
    <div className="rounded border-2 border-black bg-white p-2.5 text-xs shadow-md">
      <div className="font-bold text-black">
        {pt.label} · {pt.title}
      </div>
      <div className="mt-1.5 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Avg. Graded Score:</span>
          <span className="font-bold tabular-nums text-black">
            {formatPercent(pt.avg_score_percent)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Submission Rate:</span>
          <span className="font-bold tabular-nums text-black">
            {formatPercent(pt.completion_rate_percent)}
          </span>
        </div>
        <div className="border-t border-black/15 pt-1 text-[11px] text-muted-foreground">
          {pt.submitted_count ?? "—"} / {pt.eligible_count ?? pt.total_enrolled} expected submitted ·{" "}
          {pt.scored_count ?? 0} finalized scores
        </div>
      </div>
    </div>
  );
}

export function PerformanceTrendChart({
  points,
  scopeLabel,
  hasSufficientData,
  gradedTaskCount,
  isHistorical,
  onPointClick,
  onCreateClasswork,
}: PerformanceTrendChartProps) {
  return (
    <Card className="flex w-full flex-col border-2 border-black bg-card p-4 shadow-md">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-foreground">
            Assessment Performance &amp; Submission Trend
          </h3>
          <p className="text-xs text-muted-foreground">
            {scopeLabel} · Official finalized scores vs. online submission participation
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="inline-block size-3 rounded-sm border border-black bg-primary" />
            Submission %
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="inline-block h-0.5 w-4 bg-black" />
            Graded Score %
          </span>
          {!hasSufficientData && points.length > 0 && (
            <Badge variant="outline" size="sm">
              {gradedTaskCount}/3 graded tasks for full trend
            </Badge>
          )}
        </div>
      </div>

      {points.length === 0 ? (
        <TeacherEmptyState
          compact
          icon={<TrendingUp className="size-5" />}
          title="No assessment trend data yet"
          description={
            isHistorical
              ? "No published submission-requiring or graded classworks were recorded for this period."
              : "Publish classworks or quizzes to track submission participation and graded score trends over time."
          }
          action={
            !isHistorical
              ? {
                  label: "Go to Classworks",
                  onClick: onCreateClasswork,
                  icon: <Plus className="size-4" />,
                }
              : undefined
          }
        />
      ) : (
        <div className="h-[270px] w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
              onClick={(state) => {
                const idx = Number(state?.activeTooltipIndex);
                const pt = Number.isInteger(idx) ? points[idx] : undefined;
                if (pt) onPointClick(pt);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
              <XAxis
                dataKey="short_label"
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
              <Tooltip content={<TrendTooltip />} />
              <Bar
                dataKey="completion_rate_percent"
                name="Submission Rate (%)"
                fill="#FFDB33"
                stroke="#000000"
                strokeWidth={1.5}
                barSize={26}
                radius={[3, 3, 0, 0]}
                className="cursor-pointer"
              />
              <Line
                type="monotone"
                dataKey="avg_score_percent"
                name="Avg. Graded Score (%)"
                stroke="#000000"
                strokeWidth={2.5}
                dot={{ r: 4, fill: "#FFFFFF", stroke: "#000000", strokeWidth: 2 }}
                activeDot={{ r: 6, fill: "#FFDB33", stroke: "#000000", strokeWidth: 2 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
