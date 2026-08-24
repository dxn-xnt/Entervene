import { useMemo, useState, useEffect } from "react";
import {
  Award,
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
  Trash2,
} from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Select } from "@/components/retroui/Select";
import { Badge } from "@/components/retroui/Badge";
import type { CompetencyItem, Lesson, LinkedClasswork } from "./types";

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
  openLessonDetail?: (lesson: Lesson) => void;
  // Competency additions
  competencies?: CompetencyItem[];
  openCompetencyForm?: (competency?: CompetencyItem | null) => void;
  onAddLessonToCompetency?: (competencyId: number) => void;
  onArchiveCompetency?: (competencyId: number) => void;
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
  openLessonDetail,
  competencies = [],
  openCompetencyForm,
  onAddLessonToCompetency,
  onArchiveCompetency,
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

  // Collapsed state for competencies: expand first competency by default, collapse others
  const [collapsedCompetencies, setCollapsedCompetencies] = useState<Record<number, boolean>>({});
  const [isUnassignedExpanded, setIsUnassignedExpanded] = useState<boolean>(false);

  useEffect(() => {
    if (competencies.length > 0) {
      setCollapsedCompetencies((prev) => {
        const next: Record<number, boolean> = { ...prev };
        competencies.forEach((comp, idx) => {
          if (next[comp.competency_id] === undefined) {
            // Expand only the first competency by default
            next[comp.competency_id] = idx !== 0;
          }
        });
        return next;
      });
      setIsUnassignedExpanded(false);
    } else {
      setIsUnassignedExpanded(true);
    }
  }, [competencies]);

  const toggleCompetencyCollapse = (competencyId: number) => {
    setCollapsedCompetencies((prev) => ({
      ...prev,
      [competencyId]: !prev[competencyId],
    }));
  };

  // Group lessons by competency_id
  const { lessonsByCompetency, unassignedLessons } = useMemo(() => {
    const byComp = new Map<number, Lesson[]>();
    const unassigned: Lesson[] = [];

    const activeCompIds = new Set(competencies.map((c) => c.competency_id));

    filteredLessons.forEach((lesson) => {
      if (lesson.competency_id && activeCompIds.has(lesson.competency_id)) {
        const list = byComp.get(lesson.competency_id) || [];
        list.push(lesson);
        byComp.set(lesson.competency_id, list);
      } else {
        unassigned.push(lesson);
      }
    });

    return { lessonsByCompetency: byComp, unassignedLessons: unassigned };
  }, [filteredLessons, competencies]);

  // Reusable renderer for a Lesson card + linked classwork items
  const renderLessonItem = (lesson: Lesson) => {
    const isExpanded = expandedLessonId === lesson.lesson_id;
    const classworks = linkedClassworks[lesson.lesson_id] || [];

    return (
      <div key={lesson.lesson_id} className="flex flex-col gap-2">
        <Card className="bg-primary border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
          <Card.Content className="flex items-center gap-2 py-3 px-4">
            <div className="flex min-w-0 flex-1 items-center justify-between text-left">
              <button
                type="button"
                onClick={() =>
                  openLessonDetail
                    ? openLessonDetail(lesson)
                    : openLessonManager(lesson)
                }
                className="group min-w-0 flex-1 text-left cursor-pointer"
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Card.Title className="truncate text-xl md:text-2xl font-bold text-gray-950 group-hover:underline">
                    {lesson.title}
                  </Card.Title>
                  <Badge
                    variant="secondary"
                    size="sm"
                    className="border border-black bg-white font-semibold"
                  >
                    {lesson.is_published ? "Published" : "Draft"}
                  </Badge>
                  {lesson.attachments.length > 0 && (
                    <Badge
                      size="sm"
                      className="border border-black bg-[#7ABA78] font-bold text-black"
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
              </button>
              <button
                type="button"
                onClick={() => toggleLesson(lesson.lesson_id)}
                className="p-1 text-gray-800 hover:text-black cursor-pointer ml-2"
                title={isExpanded ? "Collapse classwork list" : "Expand classwork list"}
              >
                {isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
              </button>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openLessonManager(lesson)}
              className="shrink-0 gap-1 border-black bg-white text-xs font-bold hover:bg-gray-50 ml-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
            >
              <Pencil size={14} />
              Manage
            </Button>
          </Card.Content>
        </Card>

        {isExpanded && (
          <div className="ml-3 flex flex-col gap-2 border-l-2 border-black pl-3 my-1">
            <div className="flex justify-end mt-1">
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => openClassworkForm(lesson)}
                className="gap-2 bg-[#7ABA78] hover:bg-[#68a866] font-semibold text-black border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <Plus size={16} />
                Add Classwork
              </Button>
            </div>
            {(() => {
              const quarterlyIds = new Set(
                quarterlyAssessments.map((q) => q.classwork_assignment_id),
              );
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
                  <Card
                    key={classwork.classwork_assignment_id}
                    onClick={() => openClassworkDetail(classwork)}
                    className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 bg-white border border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] p-3"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ")
                        openClassworkDetail(classwork);
                    }}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <FileText size={20} />
                      <div className="min-w-0">
                        <p className="text-sm md:text-base font-bold text-black line-clamp-2 break-words [overflow-wrap:anywhere]">
                          {classwork.title}
                        </p>
                        <p className="text-xs font-medium text-gray-700">
                          {classwork.classwork_type || "Classwork"}
                          {classwork.due_date
                            ? ` | Due ${new Date(classwork.due_date).toLocaleDateString()}`
                            : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex">
                      {classwork.attachment_count ? (
                        <Badge
                          variant="secondary"
                          className="inline-flex h-8 items-center whitespace-nowrap rounded-none text-xs font-semibold bg-[#F6E9B2] border border-black"
                        >
                          File {classwork.attachment_count}
                        </Badge>
                      ) : (
                        <span aria-hidden="true" className="h-8 w-20" />
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className="inline-flex h-8 items-center gap-1 rounded-none text-xs font-semibold border-black"
                    >
                      <Eye size={14} />
                      Details
                    </Badge>
                  </Card>
                ));
              }
              return (
                <Card className="block bg-white border border-black p-3">
                  <Card.Content className="flex items-center gap-3">
                    <ClipboardList size={20} />
                    <div>
                      <Card.Title className="text-base font-bold">
                        No classworks yet
                      </Card.Title>
                      <p className="text-xs font-medium text-gray-600">
                        Readings, activities, assignments, and quizzes linked to this lesson will appear here.
                      </p>
                    </div>
                  </Card.Content>
                </Card>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-6">
      {/* ── Quarterly Assessments section ── */}
      {quarterlyAssessments.length > 0 && (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GraduationCap size={20} />
                <h3 className="text-lg font-bold">Quarterly Assessments</h3>
                <Badge
                  variant="secondary"
                  size="sm"
                  className="border border-black bg-primary"
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
              Subject-level assessments spanning all lessons in this grading period.
            </p>

            <div className="flex flex-col gap-2">
              {quarterlyAssessments.map((classwork) => (
                <Card
                  key={classwork.classwork_assignment_id}
                  onClick={() => openClassworkDetail(classwork)}
                  className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-2 border-black bg-[#FFFDF0] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFF9D2]"
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      openClassworkDetail(classwork);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <GraduationCap size={20} className="text-black shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm md:text-base font-bold text-black line-clamp-2 break-words">
                        {classwork.title}
                      </p>
                      <p className="text-xs font-medium text-gray-700">
                        {classwork.classwork_type || "Quarterly Assessment"}
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
                        className="bg-[#F6E9B2] border border-black"
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
                </Card>
              ))}
            </div>
          </div>

          {/* ── Separator ── */}
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-black" />
            <span className="text-xs font-bold uppercase tracking-wider text-gray-600">
              Learning Competencies &amp; Lessons
            </span>
            <div className="h-px flex-1 bg-black" />
          </div>
        </>
      )}

      {/* ── Search, Sort, and Add Competency Toolbar ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <label className="relative shadow-md transition-shadow hover:shadow-none md:w-80">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={lessonSearch}
              onChange={(event) => setLessonSearch(event.target.value)}
              placeholder="Search competencies or lessons..."
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

        {openCompetencyForm && (
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => openCompetencyForm(null)}
            className="gap-2 border-black bg-[#F6E9B2] hover:bg-[#fae498] text-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] whitespace-nowrap"
          >
            <Award size={16} />
            Add Competency
          </Button>
        )}
      </div>

      {/* ── Hierarchy View: Competency Containers ── */}
      <div className="flex flex-col gap-5">
        {competencies.length > 0 &&
          competencies.map((comp) => {
            const compLessons = lessonsByCompetency.get(comp.competency_id) || [];
            const isCollapsed = collapsedCompetencies[comp.competency_id] ?? true;

            // If search query is active and neither competency statement nor its lessons match, hide
            if (lessonSearch.trim()) {
              const query = lessonSearch.toLowerCase();
              const matchesStatement =
                comp.statement.toLowerCase().includes(query) ||
                (comp.competency_code && comp.competency_code.toLowerCase().includes(query));
              if (!matchesStatement && compLessons.length === 0) {
                return null;
              }
            }

            return (
              <div
                key={comp.competency_id}
                className="flex flex-col rounded-lg border-2 border-black bg-[#F8FAFC] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden"
              >
                {/* ── Competency Header Accordion Bar ── */}
                <div className="flex items-center justify-between border-b-2 border-black bg-[#E2E8F0] px-4 py-3 gap-2 flex-wrap sm:flex-nowrap">
                  <button
                    type="button"
                    onClick={() => toggleCompetencyCollapse(comp.competency_id)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer group"
                  >
                    <div className="rounded border border-black bg-white p-1 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                      {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <Award size={18} className="text-blue-700 shrink-0" />
                        {comp.competency_code && (
                          <Badge
                            size="sm"
                            className="bg-black text-white font-mono font-bold text-xs"
                          >
                            {comp.competency_code}
                          </Badge>
                        )}
                        <Badge
                          variant="secondary"
                          size="sm"
                          className="border border-black bg-white text-xs font-semibold"
                        >
                          {compLessons.length} lesson{compLessons.length === 1 ? "" : "s"}
                        </Badge>
                        {(comp.target_hours || 0) > 0 && (
                          <Badge
                            size="sm"
                            className="border border-black bg-[#DDF2FD] text-black text-xs font-semibold"
                          >
                            {comp.target_hours} hrs
                          </Badge>
                        )}
                      </div>
                      <h4 className="text-sm md:text-base font-bold text-gray-900 group-hover:text-blue-900 line-clamp-2">
                        {comp.statement}
                      </h4>
                    </div>
                  </button>

                  <div className="flex items-center gap-2 shrink-0">
                    {onAddLessonToCompetency && (
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        onClick={() => onAddLessonToCompetency(comp.competency_id)}
                        className="gap-1 border-black bg-primary text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:opacity-90"
                      >
                        <Plus size={14} />
                        Add Lesson
                      </Button>
                    )}
                    {openCompetencyForm && (
                      <button
                        type="button"
                        onClick={() => openCompetencyForm(comp)}
                        title="Edit Competency"
                        className="rounded border border-black bg-white p-1.5 hover:bg-gray-100 cursor-pointer shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {onArchiveCompetency && (
                      <button
                        type="button"
                        onClick={() => onArchiveCompetency(comp.competency_id)}
                        title="Archive Competency"
                        className="rounded border border-red-500 bg-white p-1.5 text-red-600 hover:bg-red-50 cursor-pointer shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Competency Body (Lessons) ── */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-3 p-4 bg-white/60">
                    {compLessons.length > 0 ? (
                      <>
                        {compLessons.map(renderLessonItem)}
                        {onAddLessonToCompetency && (
                          <div className="flex justify-end pt-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => onAddLessonToCompetency(comp.competency_id)}
                              className="gap-1 border-2 border-black bg-white hover:bg-gray-100 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            >
                              <Plus size={14} />
                              Add Lesson to this Competency
                            </Button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center justify-between rounded border-2 border-dashed border-gray-400 bg-white p-4">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-600">
                          <BookOpen size={16} />
                          <span>No lessons assigned to this competency yet.</span>
                        </div>
                        {onAddLessonToCompetency && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onAddLessonToCompetency(comp.competency_id)}
                            className="border-black text-xs font-bold hover:bg-gray-50"
                          >
                            <Plus size={14} />
                            Create First Lesson
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {/* ── Standalone / Unassigned Lessons Section (Bottom, Collapsible) ── */}
        {unassignedLessons.length > 0 && (
          <div className="flex flex-col rounded-lg border-2 border-black bg-[#FFFBEB] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
            <button
              type="button"
              onClick={() => setIsUnassignedExpanded((prev) => !prev)}
              className="flex items-center justify-between border-b-2 border-black bg-[#FEF3C7] px-4 py-3 text-left cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <div className="rounded border border-black bg-white p-1 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                  {isUnassignedExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </div>
                <BookOpen size={18} className="text-amber-800 shrink-0" />
                <h4 className="text-sm md:text-base font-bold text-gray-900">
                  Standalone / Unassigned Lessons
                </h4>
                <Badge
                  variant="secondary"
                  size="sm"
                  className="border border-black bg-white text-xs font-semibold"
                >
                  {unassignedLessons.length}
                </Badge>
              </div>
              <p className="text-xs text-gray-600 hidden sm:block">
                Lessons not assigned to any specific learning competency
              </p>
            </button>

            {isUnassignedExpanded && (
              <div className="flex flex-col gap-3 p-4 bg-white/70">
                {unassignedLessons.map(renderLessonItem)}
              </div>
            )}
          </div>
        )}

        {/* ── Empty State when no competencies and no lessons exist ── */}
        {competencies.length === 0 && unassignedLessons.length === 0 && (
          <Card className="block border-2 border-black p-8 text-center bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <Card.Content className="flex flex-col items-center gap-3">
              <Award size={36} className="text-gray-400" />
              <Card.Title className="text-2xl font-bold">
                No Competencies or Lessons Yet
              </Card.Title>
              <p className="text-xs text-gray-600 max-w-md">
                Get started by creating a Learning Competency to group your lessons and prepare for Table of Specifications (TOS), or add a direct lesson.
              </p>
              <div className="flex gap-3 mt-2">
                {openCompetencyForm && (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => openCompetencyForm(null)}
                    className="border-black bg-primary font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:opacity-90"
                  >
                    <Award size={16} />
                    Add Competency
                  </Button>
                )}
              </div>
            </Card.Content>
          </Card>
        )}
      </div>
    </section>
  );
}
