import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import ClassworkCard from "@/pages/teacher/classworks/classwork-card";
import { Badge } from "@/components/retroui/Badge";
import { isQuizType } from "@/lib/classwork-utils";
import type {
  ClassworkKind,
  ClassworkTracking,
  SortMode,
  TeacherClassLoad,
  TeacherClasswork,
} from "@/types/classwork";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { DialogueSelect } from "@/components/dialogue-select";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import CreateClassworkModal from "@/pages/teacher/forms/create-classwork";
import CreateClassworkQuizModal from "@/pages/teacher/forms/create-classwork-quiz";
import ClassworkDetailModal from "@/pages/teacher/forms/classwork-detail-modal";
import type { ClassworkDetail } from "./types";



const classworkCreateOptions: Array<{
  type: ClassworkKind;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
    {
      type: "READING",
      title: "Reading",
      description: "Create and publish class topics or resources for learners",
      icon: BookOpen,
    },
    {
      type: "QUIZ",
      title: "Quiz",
      description: "Build and assign quizzes to assess learner understanding",
      icon: ClipboardList,
    },
    {
      type: "ASSIGNMENT",
      title: "Assignment",
      description: "Post tasks or projects for students to complete and submit",
      icon: FileText,
    },
    {
      type: "ACTIVITY",
      title: "Activity",
      description: "Design interactive tasks to enhance learner engagement",
      icon: CheckSquare,
    },
  ];


const typeFilterOptions: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "READING", label: "Readings" },
  { value: "ACTIVITY", label: "Activities" },
  { value: "ASSIGNMENT", label: "Assignments" },
  { value: "QUIZ", label: "Quizzes" },
];

interface SubjectClassworkTabProps {
  classId?: string | number;
  subjectId: string | number;
  subjectName?: string;
  sectionName?: string;
  isCreateOpen?: boolean;
  onCloseCreate?: () => void;
}

export default function SubjectClassworkTab({
  classId,
  subjectId,
  sectionName,
  isCreateOpen,
  onCloseCreate,
}: SubjectClassworkTabProps) {
  const numericSubjectId = Number(subjectId);

  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [lessons, setLessons] = useState<Array<{ lesson_id: number; title: string }>>([]);
  const [lessonFilter, setLessonFilter] = useState("all");
  const [sectionFilter, setSectionFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [trackingByClasswork, setTrackingByClasswork] = useState<
    Record<string, ClassworkTracking>
  >({});
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selectedClasswork, setSelectedClasswork] =
    useState<ClassworkDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");
  const [, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClassworks = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [classworksResponse, loadsResponse] = await Promise.all([
        apiFetch("/api/v1/classwork-assignments/my-classworks"),
        apiFetch("/api/v1/classwork-assignments/teacher/classes"),
      ]);
      if (!classworksResponse.ok || !loadsResponse.ok) {
        throw new Error("Unable to load your classworks.");
      }
      const allLoads = (await loadsResponse.json()) as TeacherClassLoad[];
      const allItems = (await classworksResponse.json()) as TeacherClasswork[];
      setLoads(allLoads);
      setItems(allItems);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load your classworks.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadClassworks();
  }, [loadClassworks]);

  useEffect(() => {
    let isMounted = true;
    const loadLessons = async () => {
      try {
        const url =
          classId && numericSubjectId
            ? `/api/v1/lessons/my-class/${classId}/subject/${numericSubjectId}`
            : `/api/v1/lessons/my-lessons`;
        const res = await apiFetch(url);
        if (res.ok && isMounted) {
          const data = await res.json();
          const list = Array.isArray(data) ? data : [];
          setLessons(
            list.filter(
              (l: any) =>
                !l.is_archived &&
                (!numericSubjectId || l.subject_id === numericSubjectId || !l.subject_id),
            ),
          );
        }
      } catch (err) {
        console.error("Failed to load lessons", err);
      }
    };
    void loadLessons();
    return () => {
      isMounted = false;
    };
  }, [classId, numericSubjectId]);

  const subjects = useMemo(
    () =>
      Array.from(
        new Map(
          loads.map((load) => [
            load.subject_id,
            { id: load.subject_id, name: load.subject_name },
          ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [loads],
  );

  const classSections = useMemo(
    () =>
      Array.from(
        new Map(
          loads
            .filter(
              (load) =>
                !numericSubjectId || load.subject_id === numericSubjectId,
            )
            .map((load) => [
              load.class_id,
              { id: load.class_id, name: load.section_name },
            ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [loads, numericSubjectId],
  );

  const availableLessons = useMemo(() => {
    const map = new Map<number, string>();
    lessons.forEach((l) => map.set(l.lesson_id, l.title));
    items.forEach((item) => {
      if (numericSubjectId && item.subject_id !== numericSubjectId) return;
      item.linked_lessons?.forEach((ll) => {
        if (!map.has(ll.lesson_id)) {
          map.set(ll.lesson_id, ll.title);
        }
      });
    });
    return Array.from(map.entries()).map(([lesson_id, title]) => ({
      lesson_id,
      title,
    }));
  }, [lessons, items, numericSubjectId]);

  const filteredItems = useMemo(() => {
    const result = items.filter((item) => {
      // Must match this specific subject
      if (numericSubjectId && item.subject_id !== numericSubjectId) return false;

      const matchesType =
        typeFilter === "all" ||
        item.classwork_type.toUpperCase() === typeFilter.toUpperCase();
      const matchesLesson =
        lessonFilter === "all" ||
        Boolean(
          item.linked_lessons?.some(
            (l) => String(l.lesson_id) === lessonFilter,
          ),
        );
      const matchesSection =
        sectionFilter === "all" ||
        Boolean(
          item.assignments?.some(
            (a) => String(a.class_id) === sectionFilter,
          ),
        );
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "published" ? item.is_published : !item.is_published);
      return matchesType && matchesLesson && matchesSection && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const first = new Date(a.created_at ?? 0).getTime();
      const second = new Date(b.created_at ?? 0).getTime();
      return sortMode === "oldest" ? first - second : second - first;
    });
  }, [typeFilter, items, lessonFilter, sectionFilter, sortMode, statusFilter, numericSubjectId]);

  const effectiveClassId = sectionFilter;
  const selectedSectionName =
    sectionFilter !== "all"
      ? classSections.find((s) => String(s.id) === sectionFilter)?.name ?? sectionName
      : undefined;

  useEffect(() => {
    const trackableItems = filteredItems.filter((item) => {
      if (!item.assignments || item.assignments.length === 0) return false;
      const cacheKey = `${item.classwork_id}:${effectiveClassId}`;
      return !trackingByClasswork[cacheKey];
    });
    if (!trackableItems.length) return;

    let cancelled = false;
    void Promise.all(
      trackableItems.map(async (item) => {
        const cacheKey = `${item.classwork_id}:${effectiveClassId}`;
        let url: string;
        if (!effectiveClassId || effectiveClassId === "all") {
          url = `/api/v1/submissions/classwork/${item.classwork_id}/tracking`;
        } else {
          const assignment = item.assignments?.find(
            (a) => String(a.class_id) === String(effectiveClassId),
          );
          if (assignment) {
            url = `/api/v1/submissions/assignment/${assignment.classwork_assignment_id}/tracking`;
          } else {
            url = `/api/v1/submissions/classwork/${item.classwork_id}/tracking`;
          }
        }
        const response = await apiFetch(url);
        if (!response.ok) {
          throw new Error(
            `Unable to load submission summary for ${item.classwork_id}.`,
          );
        }
        const summary = (await response.json()) as ClassworkTracking;
        return { key: cacheKey, summary };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setTrackingByClasswork((current) => ({
          ...current,
          ...Object.fromEntries(
            results.map(({ key, summary }) => [key, summary]),
          ),
        }));
      })
      .catch(() => {
        // The list remains useful even when an individual tracking summary is unavailable.
      });

    return () => {
      cancelled = true;
    };
  }, [filteredItems, effectiveClassId, trackingByClasswork]);

  const openCreateWizard = () => {
    const preferredType =
      typeFilter !== "all" ? (typeFilter as ClassworkKind) : undefined;
    setSelectedType(preferredType ?? null);
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    setShowCreateWizard(false);
    setSelectedType(null);
    onCloseCreate?.();
  };

  useEffect(() => {
    if (isCreateOpen) {
      openCreateWizard();
    }
  }, [isCreateOpen]);

  const cycleSort = () => {
    setSortMode((current) =>
      current === "newest"
        ? "oldest"
        : current === "oldest"
          ? "title"
          : "newest",
    );
  };

  const openClassworkDetail = async (cw: TeacherClasswork) => {
    setDetailLoadingId(cw.classwork_id);
    setDetailError("");
    try {
      const activeClassId =
        effectiveClassId !== "all" ? effectiveClassId : undefined;
      const classIdQuery = activeClassId ? `?class_id=${activeClassId}` : "";
      const res = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${cw.classwork_id}${classIdQuery}`,
      );
      const targetAssignment =
        (activeClassId
          ? cw.assignments?.find((a) => String(a.class_id) === String(activeClassId))
          : undefined) ?? cw.assignments?.[0];

      if (res.ok) {
        const fullDetail = (await res.json()) as ClassworkDetail & {
          assignments?: TeacherClasswork["assignments"];
        };
        const fetchedAssignment =
          (activeClassId
            ? fullDetail.assignments?.find(
              (a) => String(a.class_id) === String(activeClassId),
            )
            : undefined) ??
          fullDetail.assignments?.[0] ??
          targetAssignment;

        setSelectedClasswork({
          ...fullDetail,
          classwork_assignment_id:
            fullDetail.classwork_assignment_id ??
            fetchedAssignment?.classwork_assignment_id ??
            0,
          class_id:
            fullDetail.class_id ??
            fetchedAssignment?.class_id ??
            (activeClassId ? Number(activeClassId) : 0),
          section_name: fullDetail.section_name ?? selectedSectionName ?? null,
          due_date: fullDetail.due_date ?? fetchedAssignment?.due_date ?? null,
        });
      } else {
        setSelectedClasswork({
          classwork_assignment_id: targetAssignment?.classwork_assignment_id ?? 0,
          classwork_id: cw.classwork_id,
          class_id: targetAssignment?.class_id ?? (activeClassId ? Number(activeClassId) : 0),
          section_name: selectedSectionName ?? null,
          title: cw.title,
          description: cw.description,
          instructions: cw.instructions,
          classwork_type: cw.classwork_type,
          classwork_category: cw.classwork_category,
          due_date: targetAssignment?.due_date ?? null,
          total_points: cw.total_points,
          is_published: targetAssignment?.is_published ?? cw.is_published ?? true,
          show_scores: targetAssignment?.show_scores ?? cw.show_scores ?? true,
          attachments: cw.attachments ?? [],
        });
      }
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Unable to load classwork details.",
      );
    } finally {
      setDetailLoadingId(null);
    }
  };

  const closeClassworkDetail = () => {
    setSelectedClasswork(null);
    setDetailLoadingId(null);
    setDetailError("");
  };

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <main className="flex flex-col gap-4 pt-1">
        {error && (
          <div className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex w-full flex-row justify-between gap-3 sm:flex-row sm:items-center">
          <div className="w-full min-w-0 flex-1 lg:max-w-md">
            <Select
              value={lessonFilter}
              onValueChange={(val) => setLessonFilter(val)}
            >
              <Select.Trigger className="h-10 w-full border-2 border-black bg-white text-sm">
                <Select.Value placeholder="Filter by lesson" />
              </Select.Trigger>
              <Select.Content className="border-2 border-black bg-white max-h-72 overflow-y-auto">
                <Select.Item value="all">All Lessons</Select.Item>
                {availableLessons.map((lesson) => (
                  <Select.Item
                    key={lesson.lesson_id}
                    value={String(lesson.lesson_id)}
                  >
                    {lesson.title}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select>
          </div>

          <div className="flex flex-row gap-2">
            <Select
              value={sectionFilter}
              onValueChange={setSectionFilter}
            >
              <Select.Trigger className="w-full sm:w-44 border-black">
                <Select.Value placeholder="All sections" />
              </Select.Trigger>
              <Select.Content className="max-h-72 overflow-y-auto">
                <Select.Group>
                  <Select.Item value="all">All sections</Select.Item>
                  {classSections.map((sec) => (
                    <Select.Item key={sec.id} value={String(sec.id)}>
                      {sec.name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>

            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
            >
              <Select.Trigger className="w-full sm:w-44 border-black">
                <Select.Value placeholder="All statuses" />
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="all">All statuses</Select.Item>
                  <Select.Item value="published">Published</Select.Item>
                  <Select.Item value="draft">Draft</Select.Item>
                </Select.Group>
              </Select.Content>
            </Select>

            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex"><Button
                variant="outline"
                size="md"
                onClick={cycleSort}
                className="gap-1.5"
              >
                {sortMode === "title" ? (
                  <ArrowDownAZ size={15} />
                ) : (
                  <ArrowUpDown size={15} />
                )}
                Sort By
              </Button></span>} />
              <TooltipContent>Sorted by {sortMode}</TooltipContent>
            </Tooltip>
          </div>


        </div>

        <div className="flex items-center gap-2 overflow-x-auto -mb-2 justify-between">
          <div className="flex flex-row gap-2 pb-1 overflow-x-auto">
            <span className="shrink-0 text-sm font-regular text-muted-foreground self-center">
              Type:
            </span>
            {typeFilterOptions.map((opt) => (
              <Button
                key={opt.value}
                autoIcon={false}
                variant={typeFilter === opt.value ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(opt.value)}
                className="shrink-0 border-black shadow-none"
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>

        {statusFilter !== "all" && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              size="sm"
              className="flex w-fit items-center gap-2 capitalize cursor-pointer"
              onClick={() => setStatusFilter("all")}
            >
              Status: {statusFilter}
              <X size={13} />
            </Badge>
          </div>
        )}

        {filteredItems.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 items-stretch">
            {filteredItems.map((item) => (
              <ClassworkCard
                key={item.classwork_id}
                item={item}
                tracking={
                  trackingByClasswork[
                    `${item.classwork_id}:${effectiveClassId}`
                  ]
                }
                showClassworkType={true}
                showSubject={false}
                onOpen={(cw) => void openClassworkDetail(cw)}
                onReload={() => {
                  void loadClassworks();
                }}
              />
            ))}
          </section>
        ) : (
          <Card className="flex flex-col justify-center items-center p-12">
            {/* <ClipboardList className="mx-auto mb-2 text-gray-400" size={28} /> */}
            <p className="font-bold">No classworks found</p>
            <p className="mt-1 text-sm text-gray-500">
              No classwork items match the selected filter criteria for this subject.
            </p>
          </Card>
        )}
      </main>

      {/* Creation Modal Wizard Dialog */}
      <Dialog
        open={showCreateWizard}
        onOpenChange={(open) => {
          if (!open) closeCreateWizard();
        }}
      >
        {showCreateWizard &&
          (selectedType === null ? (
            <Dialog.Content size="lg">
              <Dialog.Header position="fixed" asChild>
                <div className="flex items-center justify-between w-full">
                  <Text as="h5" className="font-sans text-xl font-bold">
                    Choose Classwork Type
                  </Text>
                  <button
                    type="button"
                    onClick={closeCreateWizard}
                    className="cursor-pointer text-black hover:text-gray-200"
                  >
                    <X size={18} />
                  </button>
                </div>
              </Dialog.Header>
              <section className="p-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  {classworkCreateOptions.map((option) => {
                    return (
                      <DialogueSelect
                        key={option.type}
                        title={option.title}
                        description={option.description}
                        icon={option.icon}
                        onClick={() => setSelectedType(option.type)}
                      />
                    );
                  })}
                </div>
              </section>
              <Dialog.Footer position="fixed">
                <Button
                  type="button"
                  variant="outline"
                  onClick={closeCreateWizard}
                >
                  Cancel
                </Button>
              </Dialog.Footer>
            </Dialog.Content>
          ) : isQuizType(selectedType) ? (
            <CreateClassworkQuizModal
              selectedType={selectedType}
              subjects={subjects}
              loads={loads}
              initialSubjectId={numericSubjectId ? String(numericSubjectId) : undefined}
              onClose={closeCreateWizard}
              onSuccess={async () => {
                await loadClassworks();
                closeCreateWizard();
              }}
              onBack={() => setSelectedType(null)}
            />
          ) : (
            <CreateClassworkModal
              selectedType={selectedType}
              subjects={subjects}
              loads={loads}
              initialSubjectId={numericSubjectId ? String(numericSubjectId) : undefined}
              onClose={closeCreateWizard}
              onSuccess={async () => {
                await loadClassworks();
                closeCreateWizard();
              }}
              onBack={() => setSelectedType(null)}
            />
          ))}
      </Dialog>

      <ClassworkDetailModal
        selectedClasswork={selectedClasswork}
        detailLoadingId={detailLoadingId}
        detailError={detailError}
        onClose={closeClassworkDetail}
        sectionName={selectedSectionName}
      />
    </div>
  );
}
