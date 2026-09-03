import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Filter,
  Plus,
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
  TabId,
  TeacherClassLoad,
  TeacherClasswork,
} from "@/types/classwork";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import CreateClassworkModal from "@/pages/teacher/forms/create-classwork";
import CreateClassworkQuizModal from "@/pages/teacher/forms/create-classwork-quiz";
import ClassworkView from "@/pages/teacher/classwork-view";

const classworkTabs: Array<TabItem<TabId>> = [
  { id: "all", label: "All", icon: ClipboardList },
  { id: "readings", label: "Readings", icon: BookOpen },
  { id: "activities", label: "Activities", icon: CheckSquare },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "quizzes", label: "Quizzes", icon: ClipboardList },
];

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

const classworkTabType: Partial<Record<TabId, string>> = {
  readings: "READING",
  activities: "ACTIVITY",
  assignments: "ASSIGNMENT",
  quizzes: "QUIZ",
};

interface SubjectClassworkTabProps {
  classId?: string | number;
  subjectId: string | number;
  subjectName?: string;
  sectionName?: string;
}

export default function SubjectClassworkTab({
  classId: _classId,
  subjectId,
  subjectName: _subjectName,
  sectionName: _sectionName,
}: SubjectClassworkTabProps) {
  const numericSubjectId = Number(subjectId);

  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
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
    const targetType = classworkTabType[activeTab];
    const normalizedSearch = search.trim().toLowerCase();
    const result = items.filter((item) => {
      // Must match this specific subject
      if (numericSubjectId && item.subject_id !== numericSubjectId) return false;

      const matchesType =
        !targetType || item.classwork_type.toUpperCase() === targetType;
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
  }, [activeTab, items, search, sortMode, statusFilter, numericSubjectId]);

  const openCreateWizard = () => {
    const preferredType = classworkTabType[activeTab] as ClassworkKind | undefined;
    setSelectedType(preferredType ?? null);
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    setShowCreateWizard(false);
    setSelectedType(null);
  };

  const cycleSort = () => {
    setSortMode((current) =>
      current === "newest"
        ? "oldest"
        : current === "oldest"
          ? "title"
          : "newest",
    );
  };

  if (selected) {
    return (
      <ClassworkView
        classwork={selected}
        onClose={() => setSelected(null)}
        onUpdated={(updated) => {
          setItems((current) =>
            current.map((item) =>
              item.classwork_id === updated.classwork_id ? updated : item,
            ),
          );
          setSelected(updated);
        }}
        onArchived={(classworkId) => {
          setItems((current) =>
            current.filter((item) => item.classwork_id !== classworkId),
          );
          setSelected(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Text as="h3" className="text-xl font-bold">
            Classwork
          </Text>
        </div>

        <Button
          type="button"
          onClick={openCreateWizard}
          className="gap-2"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">New Classwork</span>
          <span className="sm:hidden">New</span>
        </Button>
      </header>

      <Tabs
        tabs={classworkTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <main className="flex flex-col gap-4 pt-1">
        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <label className="relative shadow-md transition-shadow hover:shadow-none">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search classwork..."
              className="h-10 w-full border-black pl-9 pr-3 shadow-none"
            />
          </label>

          <Button
            variant="outline"
            size="md"
            onClick={() => setShowFilters((current) => !current)}
            className="gap-1.5"
          >
            <Filter size={15} />
            Add Filter
          </Button>

          <Button
            variant="outline"
            size="md"
            onClick={cycleSort}
            className="gap-1.5"
            title={`Current sort: ${sortMode}`}
          >
            {sortMode === "title" ? (
              <ArrowDownAZ size={15} />
            ) : (
              <ArrowUpDown size={15} />
            )}
            Sort By
          </Button>

          {statusFilter !== "all" && (
            <Badge
              variant="secondary"
              size="sm"
              className="flex w-fit items-center gap-2 capitalize cursor-pointer"
              onClick={() => setStatusFilter("all")}
            >
              {statusFilter}
              <X size={13} />
            </Badge>
          )}
        </div>

        {showFilters && (
          <section className="grid gap-3 rounded-lg border border-black bg-[#F6E9B2] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:grid-cols-2">
            <label className="text-xs font-bold">
              Publication status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
              >
                <option value="all">All statuses</option>
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </label>
          </section>
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
                onOpen={(cw) => setSelected(cw)}
              />
            ))}
          </section>
        ) : (
          <Card className="flex flex-col justify-center items-center p-8">
            <ClipboardList className="mx-auto mb-2 text-gray-400" size={28} />
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
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => setSelectedType(option.type)}
                        className="rounded-lg border-2 border-black bg-[#7ABA78] p-5 text-left shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 cursor-pointer text-black"
                      >
                        <div className="flex items-center gap-2">
                          <Icon size={20} className="text-black" />
                          <h3 className="text-lg font-bold text-black">
                            {option.title}
                          </h3>
                        </div>
                        <p className="mt-2 text-xs font-semibold text-black/80">
                          {option.description}
                        </p>
                      </button>
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
    </div>
  );
}
