import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Eye,
  FileText,
  GraduationCap,
  Pencil,
  Plus,
  Search,
} from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Select } from "@/components/retroui/Select";
import { Badge } from "@/components/retroui/Badge";
import type { Lesson, LinkedClasswork } from "./types";

type LessonClassworkListProps = {
  lessonSearch: string;
  setLessonSearch: (value: string) => void;
  lessonSort: "order" | "newest" | "oldest" | "title";
  setLessonSort: (value: "order" | "newest" | "oldest" | "title") => void;
  filteredLessons: Lesson[];
  totalLessons: number;
  expandedLessonId: number | null;
  linkedClassworks: Record<number, LinkedClasswork[]>;
  loadingClassworkId: number | null;
  toggleLesson: (lessonId: number) => void;
  openLessonManager: (lesson: Lesson) => void;
  openClassworkForm: (lesson: Lesson) => void;
  openClassworkDetail: (classwork: LinkedClasswork) => void;
  subjectAssignments?: LinkedClasswork[];
  openQuarterlyAssessmentForm?: () => void;
};

export default function LessonClassworkList({
  lessonSearch,
  setLessonSearch,
  lessonSort,
  setLessonSort,
  filteredLessons,
  totalLessons,
  expandedLessonId,
  linkedClassworks,
  loadingClassworkId,
  toggleLesson,
  openLessonManager,
  openClassworkForm,
  openClassworkDetail,
  subjectAssignments,
  openQuarterlyAssessmentForm,
}: LessonClassworkListProps) {
  const quarterlyAssessments = (subjectAssignments ?? []).filter(
    (cw) => cw.classwork_category === "QUARTERLY_ASSESSMENT",
  );

  const sortOptions = [
    { value: "order", label: "Lesson order" },
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "title", label: "Title A-Z" },
  ];

  return (
    <section className="flex flex-col gap-6">
      {/* ── Quarterly Assessments section ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap size={20} />
            <h3 className="text-lg font-bold">Quarterly Assessments</h3>
            <Badge
              variant="secondary"
              size="sm"
              className="border border-black bg-[#F6E9B2]"
            >
              {quarterlyAssessments.length}
            </Badge>
          </div>
          {openQuarterlyAssessmentForm && (
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={openQuarterlyAssessmentForm}
              className="gap-2 border-black bg-[#F6E9B2] font-semibold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#f0dd9a]"
            >
              <Plus size={15} />
              Add Assessment
            </Button>
          )}
        </div>

        <p className="text-xs font-medium text-gray-600">
          Periodical exams and summative assessments that span multiple lessons
          — not tied to a single lesson.
        </p>

        {quarterlyAssessments.length > 0 ? (
          quarterlyAssessments.map((classwork) => (
            <Card
              key={classwork.classwork_assignment_id}
              className="block cursor-pointer shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5"
              onClick={() => openClassworkDetail(classwork)}
            >
              <Card.Content className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <GraduationCap size={20} className="shrink-0" />
                  <div className="min-w-0">
                    <Card.Title className="truncate text-lg font-bold">
                      {classwork.title}
                    </Card.Title>
                    <p className="text-xs font-medium text-gray-700">
                      Quarterly Assessment
                      {classwork.due_date
                        ? ` | Due ${new Date(classwork.due_date).toLocaleDateString()}`
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex min-w-28 justify-center">
                  {classwork.attachment_count ? (
                    <Badge
                      variant="secondary"
                      size="sm"
                      className="bg-[#F6E9B2]"
                    >
                      File {classwork.attachment_count}
                    </Badge>
                  ) : (
                    <span aria-hidden="true" className="h-7 w-20" />
                  )}
                </div>
                <span className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold">
                  <Eye size={14} />
                  Details
                </span>
              </Card.Content>
            </Card>
          ))
        ) : (
          <Card className="block border-dashed shadow-none">
            <Card.Content className="flex items-center gap-3">
              <GraduationCap size={20} className="shrink-0 text-gray-400" />
              <div>
                <p className="text-sm font-semibold text-gray-700">
                  No quarterly assessments yet
                </p>
                <p className="text-xs font-medium text-gray-500">
                  Periodical exams that cover an entire quarter will appear
                  here.
                </p>
              </div>
            </Card.Content>
          </Card>
        )}
      </div>

      {/* ── Separator ── */}
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-black" />
        <span className="text-xs font-bold uppercase tracking-wider text-gray-600">
          Lessons &amp; Classwork
        </span>
        <div className="h-px flex-1 bg-black" />
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <label className="relative shadow-md transition-shadow hover:shadow-none md:w-80">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
          <Input
            value={lessonSearch}
            onChange={(event) => setLessonSearch(event.target.value)}
            placeholder="Search lessons"
            className="h-10 w-full border-black pl-9 pr-3 shadow-none"
          />
        </label>

        <Select
          value={lessonSort}
          onValueChange={(v) =>
            setLessonSort(v as "order" | "newest" | "oldest" | "title")
          }
        >
          <Select.Trigger className="h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
            <Select.Value placeholder="Sort by" />
          </Select.Trigger>
          <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            {sortOptions.map((option) => (
              <Select.Item key={option.value} value={option.value}>
                {option.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select>
      </div>

      {filteredLessons.length > 0 ? (
        filteredLessons.map((lesson) => {
          const isExpanded = expandedLessonId === lesson.lesson_id;
          const classworks = linkedClassworks[lesson.lesson_id] || [];

          return (
            <div key={lesson.lesson_id} className="flex flex-col gap-2">
              <Card className="bg-primary border-black">
                <Card.Content className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleLesson(lesson.lesson_id)}
                    className="flex min-w-0 flex-1 items-center justify-between text-left"
                  >
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Card.Title className="truncate text-2xl font-bold text-gray-950">
                          {lesson.title}
                        </Card.Title>
                        <Badge
                          variant="secondary"
                          size="sm"
                          className="border border-black bg-white"
                        >
                          {lesson.is_published ? "Published" : "Draft"}
                        </Badge>
                        {lesson.attachments.length > 0 && (
                          <Badge
                            size="sm"
                            className="border border-black bg-[#7ABA78]"
                          >
                            {lesson.attachments.length} material
                            {lesson.attachments.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs font-medium text-gray-700">
                        {lesson.description ||
                          (lesson.created_at
                            ? `Created ${new Date(lesson.created_at).toLocaleDateString()}`
                            : "Lesson folder")}
                      </p>
                    </div>
                    {isExpanded ? (
                      <ChevronDown size={18} />
                    ) : (
                      <ChevronRight size={18} />
                    )}
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => openLessonManager(lesson)}
                    className="shrink-0 gap-1 border-black bg-white text-xs font-bold hover:bg-gray-50"
                  >
                    <Pencil size={14} />
                    Manage
                  </Button>
                </Card.Content>
              </Card>

              {isExpanded && (
                <div className="ml-3 flex flex-col gap-2 border-l-2 border-black pl-3">
                  <div className="flex justify-end mt-1">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => openClassworkForm(lesson)}
                      className="gap-2 bg-[#7ABA78] font-semibold"
                    >
                      <Plus size={16} />
                      Add Classwork
                    </Button>
                  </div>
                  {(() => {
                    const quarterlyIds = new Set(quarterlyAssessments.map((q) => q.classwork_assignment_id));
                    const lessonClassworks = classworks.filter(
                      (cw) =>
                        cw.classwork_category !== "QUARTERLY_ASSESSMENT" &&
                        !quarterlyIds.has(cw.classwork_assignment_id),
                    );
                    if (loadingClassworkId === lesson.lesson_id) {
                      return (
                        <div className="rounded-lg border border-black bg-white px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                          Loading classworks...
                        </div>
                      );
                    }
                    if (lessonClassworks.length > 0) {
                      return lessonClassworks.map((classwork) => (
                        <button
                          type="button"
                          key={classwork.classwork_assignment_id}
                          onClick={() => openClassworkDetail(classwork)}
                          className="grid w-full grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-3 rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5"
                        >
                        <div className="flex min-w-0 items-center gap-3">
                          <FileText size={20} />
                          <div className="min-w-0">
                            <p className="truncate text-lg font-bold">{classwork.title}</p>
                            <p className="text-xs font-medium text-gray-700">
                              {classwork.classwork_type || "Classwork"}
                              {classwork.due_date ? ` | Due ${new Date(classwork.due_date).toLocaleDateString()}` : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex min-w-28 justify-center">
                          {classwork.attachment_count ? (
                            <span className="whitespace-nowrap rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
                              File {classwork.attachment_count}
                            </span>
                          ) : (
                            <span aria-hidden="true" className="h-7 w-20" />
                          )}
                        </div>
                        <span className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs font-semibold">
                          <Eye size={14} />
                          Details
                        </span>
                      </button>
                    ));
                  }
                  return (
                    <div className="flex items-center justify-between rounded-lg border border-black bg-white px-4 py-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                      <div className="flex items-center gap-3">
                        <ClipboardList size={20} />
                        <div>
                          <Card.Title className="text-lg font-bold">
                            No classworks yet
                          </Card.Title>
                          <p className="text-xs font-medium">
                            Readings, activities, assignments, and quizzes
                            linked to this lesson will appear here.
                          </p>
                        </div>
                      </Card.Content>
                    </Card>
                  )}
                </div>
              )}
            </div>
          );
        })
      ) : totalLessons > 0 ? (
        <Card className="block">
          <Card.Content className="flex items-center justify-between">
            <div>
              <Card.Title className="text-lg font-bold">
                No matching lessons
              </Card.Title>
              <p className="text-xs font-medium">
                Try a different lesson name or description.
              </p>
            </div>
            <Search size={20} />
          </Card.Content>
        </Card>
      ) : (
        <>
          <Card className="block">
            <Card.Content className="flex items-center justify-between">
              <div>
                <Card.Title className="text-2xl font-bold">
                  No lessons yet
                </Card.Title>
                <p className="text-xs font-medium">
                  Use Add Lesson to create the first lesson for this subject.
                </p>
              </div>
              <BookOpen size={20} />
            </Card.Content>
          </Card>
          <Card className="block">
            <Card.Content className="flex items-center gap-3">
              <ClipboardList size={20} className="shrink-0" />
              <div>
                <Card.Title className="text-lg font-bold">Classwork</Card.Title>
                <p className="text-xs font-medium">
                  Assignments and activities for this subject appear here.
                </p>
              </div>
            </Card.Content>
          </Card>
        </>
      )}
    </section>
  );
}
