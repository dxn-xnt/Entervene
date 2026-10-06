import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Search,
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
  SortMode,
  TeacherClassLoad,
  TeacherClasswork,
} from "@/types/classwork";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { DialogueSelect } from "@/components/dialogue-select";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
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
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selectedClasswork, setSelectedClasswork] =
    useState<ClassworkDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [detailError, setDetailError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
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

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const result = items.filter((item) => {
      // Must match this specific subject
      if (numericSubjectId && item.subject_id !== numericSubjectId) return false;

      const matchesType =
        typeFilter === "all" ||
        item.classwork_type.toUpperCase() === typeFilter.toUpperCase();
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.subject_name?.toLowerCase().includes(normalizedSearch);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "published" ? item.is_published : !item.is_published);
      return matchesType && matchesSearch && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const first = new Date(a.created_at ?? 0).getTime();
      const second = new Date(b.created_at ?? 0).getTime();
      return sortMode === "oldest" ? first - second : second - first;
    });
  }, [typeFilter, items, search, sortMode, statusFilter, numericSubjectId]);

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
      const classIdQuery = classId ? `?class_id=${classId}` : "";
      const res = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${cw.classwork_id}${classIdQuery}`,
      );
      const targetAssignment =
        (classId
          ? cw.assignments?.find((a) => String(a.class_id) === String(classId))
          : undefined) ?? cw.assignments?.[0];

      if (res.ok) {
        const fullDetail = (await res.json()) as ClassworkDetail & {
          assignments?: TeacherClasswork["assignments"];
        };
        const fetchedAssignment =
          (classId
            ? fullDetail.assignments?.find(
                (a) => String(a.class_id) === String(classId),
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
            (classId ? Number(classId) : 0),
          section_name: fullDetail.section_name ?? sectionName ?? null,
          due_date: fullDetail.due_date ?? fetchedAssignment?.due_date ?? null,
        });
      } else {
        setSelectedClasswork({
          classwork_assignment_id: targetAssignment?.classwork_assignment_id ?? 0,
          classwork_id: cw.classwork_id,
          class_id: targetAssignment?.class_id ?? (classId ? Number(classId) : 0),
          section_name: sectionName ?? null,
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search classwork..."
              className="h-10 w-full border-black pl-9 pr-3"
            />
          </label>

          <Select
            value={typeFilter}
            onValueChange={setTypeFilter}
          >
            <Select.Trigger className="w-full sm:w-44 border-black">
              <Select.Value placeholder="All types" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                <Select.Item value="all">All types</Select.Item>
                <Select.Item value="READING">Readings</Select.Item>
                <Select.Item value="ACTIVITY">Activities</Select.Item>
                <Select.Item value="ASSIGNMENT">Assignments</Select.Item>
                <Select.Item value="QUIZ">Quizzes</Select.Item>
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

        {(statusFilter !== "all" || typeFilter !== "all") && (
          <div className="flex flex-wrap items-center gap-2">
            {typeFilter !== "all" && (
              <Badge
                variant="secondary"
                size="sm"
                className="flex w-fit items-center gap-2 capitalize cursor-pointer"
                onClick={() => setTypeFilter("all")}
              >
                Type: {typeFilter.toLowerCase()}
                <X size={13} />
              </Badge>
            )}
            {statusFilter !== "all" && (
              <Badge
                variant="secondary"
                size="sm"
                className="flex w-fit items-center gap-2 capitalize cursor-pointer"
                onClick={() => setStatusFilter("all")}
              >
                Status: {statusFilter}
                <X size={13} />
              </Badge>
            )}
          </div>
        )}

        {isLoading ? (
          <p className="py-12 text-center text-sm font-semibold text-gray-500">
            Loading classworks...
          </p>
        ) : filteredItems.length > 0 ? (
          <section className="space-y-3">
            {filteredItems.map((item) => (
              <ClassworkCard
                key={item.classwork_id}
                item={item}
                onOpen={(cw) => void openClassworkDetail(cw)}
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
        sectionName={sectionName}
      />
    </div>
  );
}
