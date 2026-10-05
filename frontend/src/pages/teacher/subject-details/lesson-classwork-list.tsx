import { useMemo, useState, useEffect } from "react";
import {
  Archive,
  ArchiveIcon,
  Award,
  BookOpen,
  ClipboardList,
  Eye,
  FileText,
  GraduationCap,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { formatDate, toTitleCase } from "@/lib/formatters";
import { Text } from "@/components/retroui/Text";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Accordion } from "@/components/retroui/Accordion";
import { Select } from "@/components/retroui/Select";
import { Badge } from "@/components/retroui/Badge";
import { ContextMenu } from "@/components/retroui/ContextMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { OverviewCard } from "@/components/overview-cards";
import { IconContainer } from "@/components/icon-container";
import type { CompetencyItem, Lesson, LinkedClasswork } from "./types";

type SubjectLessonListProps = {
  lessonSearch: string;
  setLessonSearch: (value: string) => void;
  lessonSort: "order" | "newest" | "oldest" | "title";
  setLessonSort: (value: "order" | "newest" | "oldest" | "title") => void;
  competencyFilter?: string;
  setCompetencyFilter?: (value: string) => void;
  filteredLessons: Lesson[];
  totalLessons?: number;
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
  onArchiveLesson?: (lesson: Lesson) => Promise<void> | void;
  // Overview metrics
  overviewMastery?: number;
  classworkCount?: number | null;
  overviewCompletion?: number;
};

export default function SubjectLessonList({
  lessonSearch,
  lessonSort,
  setLessonSort,
  competencyFilter,
  setCompetencyFilter,
  filteredLessons,
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
  onArchiveLesson,
  overviewMastery = 0,
  classworkCount = 0,
  overviewCompletion = 0,
}: SubjectLessonListProps) {
  const [internalCompetencyFilter, setInternalCompetencyFilter] = useState("all");
  const activeCompetencyFilter =
    competencyFilter !== undefined
      ? competencyFilter
      : internalCompetencyFilter;
  const handleCompetencyFilterChange =
    setCompetencyFilter || setInternalCompetencyFilter;

  const [lessonToArchive, setLessonToArchive] = useState<Lesson | null>(null);
  const [isArchivingLesson, setIsArchivingLesson] = useState(false);
  const quarterlyAssessments = (subjectAssignments ?? []).filter(
    (cw) => cw.classwork_category === "QUARTERLY_ASSESSMENT",
  );
  const quarterlyIds = useMemo(
    () => new Set(quarterlyAssessments.map((q) => q.classwork_assignment_id)),
    [quarterlyAssessments],
  );

  const sortOptions = [
    { value: "order", label: "Lesson order" },
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "title", label: "Title A-Z" },
  ];

  useEffect(() => {
    if (
      activeCompetencyFilter !== "all" &&
      activeCompetencyFilter !== "unassigned" &&
      !competencies.some((c) => String(c.competency_id) === activeCompetencyFilter)
    ) {
      handleCompetencyFilterChange("all");
    }
  }, [competencies, activeCompetencyFilter, handleCompetencyFilterChange]);

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

  const showUnassigned =
    (activeCompetencyFilter === "all" || activeCompetencyFilter === "unassigned") &&
    unassignedLessons.length > 0;

  // Reusable renderer for a Lesson card + linked classwork items
  const renderLessonItem = (lesson: Lesson) => {
    const isExpanded = expandedLessonId === lesson.lesson_id;
    const classworks = linkedClassworks[lesson.lesson_id] || [];

    return (
      <ContextMenu key={lesson.lesson_id}>
        <ContextMenu.Trigger className="block w-full">
          <Accordion
            value={isExpanded ? [String(lesson.lesson_id)] : []}
            onValueChange={() => toggleLesson(lesson.lesson_id)}
            className="w-full shadow-none"
          >
            <Accordion.Item
              value={String(lesson.lesson_id)}
              className="rounded border-2 border-black bg-primary shadow-none! overflow-hidden"
            >
              <Accordion.Header className="items-center p-3 shadow-none">
                <div className="flex flex-1 items-center justify-between gap-2 min-w-0 text-left mr-2 shadow-none">
                  <div className="flex flex-1 flex-col items-start min-w-0">
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openLessonDetail) openLessonDetail(lesson);
                          else openLessonManager(lesson);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            if (openLessonDetail) openLessonDetail(lesson);
                            else openLessonManager(lesson);
                          }
                        }}
                        className="text-base sm:text-lg md:text-xl font-bold text-gray-950 break-words line-clamp-2 hover:underline cursor-pointer"
                      >
                        {lesson.title}
                      </span>

                      {lesson.attachments && lesson.attachments.length > 0 && (
                        <Badge
                          size="sm"
                          className="border border-black bg-[#7ABA78] font-bold text-black shrink-0"
                        >
                          {lesson.attachments.length} material
                          {lesson.attachments.length === 1 ? "" : "s"}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Badge
                    variant={lesson.is_published ? "solid" : "default"}
                    size="sm"
                    className="py-1 rounded!"
                  >
                    {lesson.is_published ? "Published" : "Draft"}
                  </Badge>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="secondary"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                          }
                        }}
                        className="p-1"
                      >
                        <MoreVertical size={14} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      onClick={(e) => e.stopPropagation()}
                      className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] min-w-[150px] p-1 rounded font-semibold text-xs z-50"
                    >
                      {openLessonDetail && (
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openLessonDetail(lesson);
                          }}
                          className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                        >
                          <Eye size={14} />
                          <span>View Lesson</span>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          openLessonManager(lesson);
                        }}
                        className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                      >
                        <Pencil size={14} />
                        <span>Manage</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setLessonToArchive(lesson);
                        }}
                        className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2"
                      >
                        <Archive size={14} />
                        <span>Archive</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Accordion.Header>

              <Accordion.Content className="p-3 border-t-2 border-black bg-white space-y-3">
                <p className="text-xs font-normal text-foreground break-words line-clamp-2">
                  {lesson.description ||
                    (lesson.created_at
                      ? `Created ${formatDate(lesson.created_at)}`
                      : "Lesson folder")}
                </p>

                {(() => {
                  const lessonClassworks = classworks.filter(
                    (cw) =>
                      cw.classwork_category !== "QUARTERLY_ASSESSMENT" &&
                      !quarterlyIds.has(cw.classwork_assignment_id),
                  );
                  if (loadingClassworkId === lesson.lesson_id) {
                    return (
                      <div className="rounded border border-black bg-white px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                        Loading classworks...
                      </div>
                    );
                  }

                  if (lessonClassworks.length > 0) {
                    return lessonClassworks.map((classwork) => (
                      <Card
                        key={classwork.classwork_assignment_id}
                        onClick={() => openClassworkDetail(classwork)}
                        className="flex w-full cursor-pointer items-center justify-between gap-4 shadow-none hover:bg-retro hover:translate-x-1 transition-all p-3"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ")
                            openClassworkDetail(classwork);
                        }}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <IconContainer variant="primary" className="shadow-none p-2">
                            <FileText size={20} className="shrink-0" />
                          </IconContainer>
                          <div className="min-w-0 w-full">
                            <div className="flex flex-row items-center justify-between w-full">
                              <div className="flex flex-col">
                                <p className="text-sm md:text-base font-bold text-black line-clamp-2 break-words [overflow-wrap:anywhere]">
                                  {classwork.title}
                                </p>
                                <p className="text-xs font-medium text-gray-700">
                                  {classwork.created_at
                                    ? `Created ${formatDate(classwork.created_at)}`
                                    : ""}
                                  {classwork.due_date
                                    ? `${classwork.created_at ? " | " : ""}Due ${formatDate(classwork.due_date)}`
                                    : ""}
                                </p>
                              </div>
                              <Badge size="sm" variant="surface" className="mr-1">
                                {toTitleCase(classwork.classwork_type)}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ));
                  }
                  return (
                    <Empty className="p-4 shadow-none bg-retro">
                      <EmptyHeader>
                        <EmptyMedia>
                          <div className="flex size-10 items-center justify-center border-2 border-black bg-primary">
                            <ClipboardList className="size-5 text-black" />
                          </div>
                        </EmptyMedia>
                        <EmptyTitle>No classworks yet</EmptyTitle>
                        <EmptyDescription className="whitespace-nowrap">
                          Readings, activities, assignments, and quizzes linked to this lesson will appear here.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  );
                })()}
                <div className="flex justify-end">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => openClassworkForm(lesson)}
                    className="w-full shadow-none"
                  >
                    <Plus size={16} className="mr-2" />
                    Add Classwork
                  </Button>
                </div>
              </Accordion.Content>
            </Accordion.Item>
          </Accordion>
        </ContextMenu.Trigger>

        <ContextMenu.Content className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] min-w-[160px] p-1 rounded font-semibold text-xs z-50">
          {openLessonDetail && (
            <ContextMenu.Item
              onClick={() => openLessonDetail(lesson)}
              className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
            >
              <Eye size={14} />
              <span>View Lesson</span>
            </ContextMenu.Item>
          )}
          <ContextMenu.Item
            onClick={() => openLessonManager(lesson)}
            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
          >
            <Pencil size={14} />
            <span>Manage Lesson</span>
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 border-b border-black" />
          <ContextMenu.Item
            variant="destructive"
            onClick={() => setLessonToArchive(lesson)}
            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 text-red-600 hover:bg-red-50 hover:text-red-700 rounded focus:bg-red-50 focus:text-red-700 text-xs font-bold"
          >
            <Archive size={14} />
            <span>Archive Lesson</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu>
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
                <h3 className="text-lg font-bold">Exams</h3>
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
                  Add Exam
                </Button>
              )}
            </div>

            <p className="text-xs font-medium text-gray-600">
              Subject-level exams spanning all lessons in this grading period.
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
                        {toTitleCase(classwork.classwork_type, "Exam")}
                        {classwork.due_date
                          ? ` | Due ${formatDate(classwork.due_date)}`
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
                  <span className="inline-flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-xs font-semibold">
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start min-w-0">
        {/* ── Main Panel (Left to Center): Toolbar, Competencies, and Lessons ── */}
        <div className="flex flex-col gap-4 min-w-0">
          {/* Header toolbar */}
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Text as="h3" className="text-xl font-bold tracking-tight sm:text-2xl">
                Lessons & Competencies
              </Text>
            </div>
          </div>

          {/* ── Search, Sort, and Add Competency Toolbar ── */}
          <div className="-mt-2 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-row items-center justify-between gap-3 w-full">
              {/* <label className="relative md:w-80">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                <Input
                  value={lessonSearch}
                  onChange={(event) => setLessonSearch(event.target.value)}
                  placeholder="Search competencies or lessons..."
                  className="h-10 w-full border-black pl-9 pr-3"
                />
              </label> */}

              <Select
                value={activeCompetencyFilter}
                onValueChange={(val) => handleCompetencyFilterChange(val)}
              >
                <Select.Trigger className="h-10 text-sm w-full max-w-112">
                  <Select.Value placeholder="Filter by competency" />
                </Select.Trigger>
                <Select.Content className="border-2 border-black bg-white overflow-y-auto">
                  <Select.Item value="all">All Competencies</Select.Item>
                  {competencies.map((comp) => (
                    <Select.Item
                      key={comp.competency_id}
                      value={String(comp.competency_id)}
                    >
                      {comp.competency_code
                        ? `${comp.competency_code} - ${comp.statement}`
                        : comp.statement}
                    </Select.Item>
                  ))}
                  {unassignedLessons.length > 0 && (
                    <Select.Item value="unassigned">Unassigned Lessons</Select.Item>
                  )}
                </Select.Content>
              </Select>

              <Select
                value={lessonSort}
                onValueChange={(v) =>
                  setLessonSort(v as "order" | "newest" | "oldest" | "title")
                }
              >
                <Select.Trigger className="h-10 text-sm">
                  <Select.Value placeholder="Sort by" />
                </Select.Trigger>
                <Select.Content className="border-2 border-black">
                  {sortOptions.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </div>

          </div>

          {/* ── Hierarchy View: Competency Containers ── */}
          <div className="flex flex-col gap-3">
            {competencies.length > 0 &&
              competencies.map((comp) => {
                const compLessons = lessonsByCompetency.get(comp.competency_id) || [];
                const compClassworkCount = compLessons.reduce((acc, lesson) => {
                  const cws = linkedClassworks[lesson.lesson_id] || [];
                  return (
                    acc +
                    cws.filter(
                      (cw) =>
                        cw.classwork_category !== "QUARTERLY_ASSESSMENT" &&
                        !quarterlyIds.has(cw.classwork_assignment_id),
                    ).length
                  );
                }, 0);

                // If competency filter is active and doesn't match this competency, hide
                if (
                  activeCompetencyFilter !== "all" &&
                  String(comp.competency_id) !== activeCompetencyFilter
                ) {
                  return null;
                }

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
                  <ContextMenu key={comp.competency_id}>
                    <ContextMenu.Trigger className="block w-full">
                      <Card className="flex flex-col">
                        {/* ── Competency Header ── */}
                        <Card.Header className="flex flex-row items-center justify-between gap-3 px-1 mb-0">
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <Card.Title className="text-base text-lg font-bold text-black break-words line-clamp-2">
                                {comp.competency_code || comp.statement}
                              </Card.Title>


                            </div>
                            {comp.competency_code && comp.statement && (
                              <p className="text-xs text-muted-foreground break-words line-clamp-2">
                                {comp.statement}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <Badge
                              variant="surface"
                              size="sm"
                            >
                              {compClassworkCount}{" "}
                              {compClassworkCount === 1 ? "classwork" : "classworks"}
                            </Badge>
                            {(openCompetencyForm || onArchiveCompetency) && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="icon"
                                    className="p-1 shadow-none"
                                    aria-label="Competency options"
                                  >
                                    <MoreVertical size={14} />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                  align="end"
                                  onClick={(e) => e.stopPropagation()}
                                  className="border-2 border-black bg-white min-w-[180px] p-1 rounded font-semibold text-xs z-50"
                                >
                                  {onAddLessonToCompetency && (
                                    <DropdownMenuItem
                                      onClick={() => onAddLessonToCompetency(comp.competency_id)}
                                      className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                                    >
                                      <Plus size={14} />
                                      Add Lesson
                                    </DropdownMenuItem>
                                  )}
                                  {openCompetencyForm && (
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openCompetencyForm(comp);
                                      }}
                                      className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-yellow-100"
                                    >
                                      <Pencil size={14} />
                                      <span>Edit Competency</span>
                                    </DropdownMenuItem>
                                  )}
                                  {onArchiveCompetency && (
                                    <DropdownMenuItem
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onArchiveCompetency(comp.competency_id);
                                      }}
                                      className="flex items-center gap-2 cursor-pointer whitespace-nowrap text-xs rounded p-2 hover:bg-red-50 hover:text-red-700"
                                    >
                                      <ArchiveIcon size={14} />
                                      <span>Archive Competency</span>
                                    </DropdownMenuItem>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </Card.Header>

                        {/* ── Competency Lessons ── */}
                        <div className="flex flex-col gap-3 bg-white">
                          {compLessons.length > 0 ? (
                            compLessons.map(renderLessonItem)
                          ) : (
                            <div className="flex items-center justify-between border-2 border-dashed border-black bg-[#FFFDF0] p-4">
                              <div className="flex items-center gap-2 text-xs font-bold text-black">
                                <BookOpen size={16} className="text-black" />
                                <span>No lessons assigned to this competency yet.</span>
                              </div>
                              {onAddLessonToCompetency && (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => onAddLessonToCompetency(comp.competency_id)}
                                  className="border-2 border-black bg-white hover:bg-yellow-50 text-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                >
                                  <Plus size={14} />
                                  Create First Lesson
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </Card>
                    </ContextMenu.Trigger>

                    <ContextMenu.Content className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] min-w-[160px] p-1 rounded font-semibold text-xs z-50">
                      {onAddLessonToCompetency && (
                        <ContextMenu.Item
                          onClick={() => onAddLessonToCompetency(comp.competency_id)}
                          className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
                        >
                          <Plus size={14} />
                          <span>Add Lesson</span>
                        </ContextMenu.Item>
                      )}
                      {openCompetencyForm && (
                        <ContextMenu.Item
                          onClick={() => openCompetencyForm(comp)}
                          className="flex items-center gap-2 cursor-pointer px-2.5 py-2 hover:bg-yellow-100 rounded focus:bg-yellow-100 text-xs font-bold"
                        >
                          <Pencil size={14} />
                          <span>Edit Competency</span>
                        </ContextMenu.Item>
                      )}
                      {onArchiveCompetency && (
                        <>
                          {(onAddLessonToCompetency || openCompetencyForm) && (
                            <ContextMenu.Separator className="my-1 border-b border-black" />
                          )}
                          <ContextMenu.Item
                            variant="destructive"
                            onClick={() => onArchiveCompetency(comp.competency_id)}
                            className="flex items-center gap-2 cursor-pointer px-2.5 py-2 text-red-600 hover:bg-red-50 hover:text-red-700 rounded focus:bg-red-50 focus:text-red-700 text-xs font-bold"
                          >
                            <Trash2 size={14} />
                            <span>Archive Competency</span>
                          </ContextMenu.Item>
                        </>
                      )}
                    </ContextMenu.Content>
                  </ContextMenu>
                );
              })}

            {/* ── Standalone / Unassigned Lessons Section (Bottom, Collapsible) ── */}
            {showUnassigned && (
              <Card className="flex flex-col">
                <Card.Header className="flex items-start gap-1 px-1 mb-0">
                  <Card.Title className="text-base text-lg font-bold text-black">
                    Unassigned Lessons
                  </Card.Title>
                </Card.Header>

                <div className="flex flex-col gap-3 bg-white">
                  {unassignedLessons.map(renderLessonItem)}
                </div>

                <p className="text-xs text-muted-foreground hidden sm:block px-1">
                  All lessons must belong to a learning competency.
                </p>
              </Card>
            )}

            {/* ── Empty State when no competencies and no lessons exist ── */}
            {competencies.length === 0 && unassignedLessons.length === 0 && (
              <Card className="block border-2 border-black p-8 text-center bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <Card.Content className="flex flex-col items-center gap-3">
                  <Card.Title className="text-base font-bold">
                    No Competencies or Lessons Yet
                  </Card.Title>
                  <p className="max-w-md text-sm font-normal text-gray-500">
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
        </div>

        {/* ── Right Side: Subject Overview ── */}
        <aside className="order-first flex flex-col gap-3 sm:grid sm:grid-cols-3 lg:flex lg:flex-col min-w-0 lg:order-none lg:sticky lg:top-4">
          <OverviewCard
            title="Lesson Mastery"
            count={`${overviewMastery}%`}
            statDescription="Average graded classwork performance"
          />
          <OverviewCard
            title="Classwork Assigned"
            count={String(classworkCount ?? 0)}
            statDescription="Active classworks in this subject"
          />
          <OverviewCard
            title="Completion Percentage"
            count={`${overviewCompletion}%`}
            statDescription="Average submitted classwork completion"
          />
        </aside>
      </div>

      {/* ── Archive Lesson Confirmation Modal ── */}
      {lessonToArchive && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4"
        >
          <Card className="block w-full max-w-md border-2 border-black bg-background text-foreground shadow-[4px_4px_0_#000]">
            <div className="flex items-center justify-between border-b-2 border-black bg-red-100 px-5 py-3">
              <div className="flex items-center gap-2 text-red-800">
                <Archive size={18} />
                <Card.Title className="mb-0 text-base font-bold text-red-800">
                  Archive Lesson?
                </Card.Title>
              </div>
              <button
                type="button"
                onClick={() => setLessonToArchive(null)}
                disabled={isArchivingLesson}
                className="rounded p-1 hover:bg-white/60 disabled:opacity-50 cursor-pointer"
                aria-label="Close archive confirmation"
              >
                <X size={16} />
              </button>
            </div>
            <Card.Content className="space-y-3 p-5">
              <p className="text-sm font-medium">
                Are you sure you want to archive{" "}
                <span className="font-bold">"{lessonToArchive.title}"</span>?
              </p>
              <p className="text-xs text-gray-600">
                This hides the lesson from the teacher lesson list and student
                lesson views. You can restore it later from the backend archive
                flow.
              </p>
            </Card.Content>
            <div className="flex justify-end gap-3 border-t-2 border-black px-5 py-4 bg-gray-50">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLessonToArchive(null)}
                disabled={isArchivingLesson}
                className="border-black font-bold"
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={async () => {
                  if (!lessonToArchive) return;
                  setIsArchivingLesson(true);
                  try {
                    if (onArchiveLesson) {
                      await onArchiveLesson(lessonToArchive);
                    } else {
                      const res = await apiFetch(
                        `/api/v1/lessons/${lessonToArchive.lesson_id}/archive`,
                        { method: "PUT" },
                      );
                      if (!res.ok) throw new Error("Unable to archive lesson.");
                      toast.success("Lesson archived.");
                    }
                    setLessonToArchive(null);
                  } catch (err) {
                    toast.error(
                      err instanceof Error
                        ? err.message
                        : "Unable to archive lesson.",
                    );
                  } finally {
                    setIsArchivingLesson(false);
                  }
                }}
                disabled={isArchivingLesson}
                className="border-2 border-black bg-red-600 text-white font-bold hover:bg-red-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                {isArchivingLesson ? "Archiving..." : "Archive Lesson"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
