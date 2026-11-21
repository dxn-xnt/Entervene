import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BookOpenCheck, Layers } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Tabs } from "@/components/retroui/Tabs";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import type {
  TeacherDashboardCategoryPerformance,
  TeacherDashboardLessonPerformance,
} from "@/lib/api";
import { formatPercent } from "./format";

interface OutcomesAndMasteryCardProps {
  categoryPerformance: TeacherDashboardCategoryPerformance[];
  lessonPerformance?: TeacherDashboardLessonPerformance;
  onCategoryClick: (category: string) => void;
  onLessonClick: (classId: number, subjectId: number, lessonId: number) => void;
}

function CategoryTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TeacherDashboardCategoryPerformance }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded border-2 border-black bg-white p-2.5 text-xs shadow-md">
      <div className="font-bold text-black">{item.label}</div>
      <div className="mt-1 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Avg. Graded Score:</span>
          <span className="font-bold tabular-nums">{formatPercent(item.avg_graded_score_percent)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Grading Completion:</span>
          <span className="font-bold tabular-nums">{formatPercent(item.grading_completion_rate_percent)}</span>
        </div>
        <div className="border-t border-black/15 pt-1 text-[11px] text-muted-foreground">
          {item.assignment_count} official {item.assignment_count === 1 ? "assignment" : "assignments"} ·{" "}
          {item.scored_submission_count} finalized scores
          {item.awaiting_grading_count ? ` · ${item.awaiting_grading_count} awaiting grading` : ""}
        </div>
      </div>
    </div>
  );
}

function LessonTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: {
      title: string;
      performance_percent: number;
      learner_count: number;
      question_count: number;
      scored_response_count: number;
    };
  }>;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0].payload;
  return (
    <div className="rounded border-2 border-black bg-white p-2.5 text-xs shadow-md">
      <div className="font-bold text-black">{item.title}</div>
      <div className="mt-1 space-y-0.5">
        <div>
          Points-pooled accuracy:{" "}
          <span className="font-bold tabular-nums">{formatPercent(item.performance_percent)}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {item.learner_count} learners · {item.question_count} mapped questions ·{" "}
          {item.scored_response_count} scored responses
        </div>
      </div>
    </div>
  );
}

export function OutcomesAndMasteryCard({
  categoryPerformance,
  lessonPerformance,
  onCategoryClick,
  onLessonClick,
}: OutcomesAndMasteryCardProps) {
  const [activeTab, setActiveTab] = useState<"categories" | "lessons">("categories");

  const lessonSubjects = useMemo(
    () => lessonPerformance?.subjects ?? [],
    [lessonPerformance],
  );
  const [selectedLessonSubjectId, setSelectedLessonSubjectId] = useState<number | null>(null);

  const currentLessonSubject = useMemo(() => {
    if (lessonSubjects.length === 0) return null;
    if (selectedLessonSubjectId != null) {
      const matched = lessonSubjects.find((s) => s.subject_id === selectedLessonSubjectId);
      if (matched) return matched;
    }
    return lessonSubjects.find((s) => s.items.length > 0) ?? lessonSubjects[0];
  }, [lessonSubjects, selectedLessonSubjectId]);

  const minLearners = lessonPerformance?.policy.min_learners ?? 3;
  const minQuestions = lessonPerformance?.policy.min_questions ?? 3;

  return (
    <Card className="flex w-full flex-col border-2 border-black bg-card p-4 shadow-md">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-foreground">
            Assessment Outcomes &amp; Lesson Mastery
          </h3>
          <p className="text-xs text-muted-foreground">
            Official ECR component breakdown and lowest-mastery mapped quiz lessons
          </p>
        </div>
      </div>

      <Tabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Assessment outcomes and lesson mastery"
        className="mx-0 mb-3 border-b-2 border-black sm:mx-0 md:mx-0"
        listClassName="px-0 sm:px-0 md:px-0"
        tabs={[
          { id: "categories", label: "By Category", icon: Layers },
          { id: "lessons", label: "Lowest-Mastery Lessons", icon: BookOpenCheck },
        ]}
      />

      {activeTab === "categories" ? (
        categoryPerformance.length === 0 ? (
          <TeacherEmptyState
            compact
            icon={<Layers className="size-5" />}
            title="No official category outcomes yet"
            description="Publish graded Written Work, Performance Task, or Exam assessments to compare component performance."
          />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 text-[11px]">
              <span className="inline-flex items-center gap-1 font-medium">
                <span className="inline-block size-2.5 rounded-sm bg-black" />
                Avg. Graded Score %
              </span>
              <span className="inline-flex items-center gap-1 font-medium">
                <span className="inline-block size-2.5 rounded-sm border border-black bg-primary" />
                Grading Completion %
              </span>
            </div>
            <div className="h-[225px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryPerformance}
                  margin={{ top: 10, right: 12, left: -12, bottom: 4 }}
                  barGap={4}
                  onClick={(state) => {
                    const idx = Number(state?.activeTooltipIndex);
                    const item = Number.isInteger(idx) ? categoryPerformance[idx] : undefined;
                    if (item) onCategoryClick(item.category);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
                  <XAxis
                    dataKey="label"
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
                  <Tooltip content={<CategoryTooltip />} />
                  <Bar
                    dataKey="avg_graded_score_percent"
                    name="Avg. Graded Score (%)"
                    fill="#000000"
                    barSize={22}
                    radius={[3, 3, 0, 0]}
                    className="cursor-pointer"
                  />
                  <Bar
                    dataKey="grading_completion_rate_percent"
                    name="Grading Completion (%)"
                    fill="#FFDB33"
                    stroke="#000000"
                    strokeWidth={1.5}
                    barSize={22}
                    radius={[3, 3, 0, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          {lessonSubjects.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {lessonSubjects.map((subj) => {
                const isSelected = subj.subject_id === currentLessonSubject?.subject_id;
                return (
                  <Button
                    key={subj.subject_id}
                    type="button"
                    size="sm"
                    variant={isSelected ? "default" : "outline"}
                    onClick={() => setSelectedLessonSubjectId(subj.subject_id)}
                    className="h-7 px-2.5 text-xs shadow-none"
                  >
                    {subj.subject_name}
                  </Button>
                );
              })}
            </div>
          )}

          {!currentLessonSubject || currentLessonSubject.items.length === 0 ? (
            <TeacherEmptyState
              compact
              icon={<BookOpenCheck className="size-5" />}
              title="Insufficient mapped lesson evidence"
              description={`Requires at least ${minLearners} distinct learners and ${minQuestions} scored quiz questions linked to a lesson to avoid small-sample noise.`}
            />
          ) : (
            <div className="h-[225px] w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={currentLessonSubject.items}
                  layout="vertical"
                  margin={{ top: 4, right: 14, left: 4, bottom: 4 }}
                  onClick={(state) => {
                    const idx = Number(state?.activeTooltipIndex);
                    const item = Number.isInteger(idx)
                      ? currentLessonSubject.items[idx]
                      : undefined;
                    const primaryClassId = currentLessonSubject.class_ids[0];
                    if (item && primaryClassId != null) {
                      onLessonClick(
                        primaryClassId,
                        currentLessonSubject.subject_id,
                        item.lesson_id,
                      );
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
                    dataKey="title"
                    width={130}
                    tick={{ fontSize: 11, fill: "#171717", fontWeight: 600 }}
                    axisLine={{ stroke: "#000000" }}
                    tickLine={false}
                  />
                  <Tooltip content={<LessonTooltip />} />
                  <Bar
                    dataKey="performance_percent"
                    name="Lesson Accuracy (%)"
                    fill="#FFDB33"
                    stroke="#000000"
                    strokeWidth={1.5}
                    barSize={18}
                    radius={[0, 3, 3, 0]}
                    className="cursor-pointer"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
