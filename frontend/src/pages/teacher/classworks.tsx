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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { apiFetch } from "@/lib/api";
import ClassworkCard from "./classworks/classwork-card";
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
import CreateClassworkModal from "./forms/create-classwork";
import CreateClassworkQuizModal from "./forms/create-classwork-quiz";
import ClassworkView from "./classwork-view";

const tabs: Array<TabItem<TabId>> = [
  { id: "all", label: "All", icon: ClipboardList },
  { id: "readings", label: "Readings", icon: BookOpen },
  { id: "activities", label: "Activities", icon: CheckSquare },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "quizzes", label: "Quizzes", icon: ClipboardList },
];

const createOptions: Array<{
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

const tabType: Partial<Record<TabId, string>> = {
  readings: "READING",
  activities: "ACTIVITY",
  assignments: "ASSIGNMENT",
  quizzes: "QUIZ",
};

export default function Classworks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const suppressAutoOpenRef = useRef(false);
  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClassworks = useCallback(async () => {
    // Load real teacher-owned classworks plus active class targets for filters and creation.
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
      const loadData = (await loadsResponse.json()) as TeacherClassLoad[];
      setItems((await classworksResponse.json()) as TeacherClasswork[]);
      setLoads(loadData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load your classworks.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClassworks();
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

  const classSections = useMemo(
    () =>
      Array.from(
        new Map(
          loads.map((load) => [
            load.class_id,
            { id: load.class_id, name: load.section_name },
          ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [loads],
  );

  const filteredItems = useMemo(() => {
    const targetType = tabType[activeTab];
    const normalizedSearch = search.trim().toLowerCase();
    const result = items.filter((item) => {
      const matchesType =
        !targetType || item.classwork_type.toUpperCase() === targetType;
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.subject_name?.toLowerCase().includes(normalizedSearch);
      const matchesSubject =
        subjectFilter === "all" || item.subject_id === Number(subjectFilter);
      const matchesClass =
        classFilter === "all" ||
        item.assignments?.some((a) => a.class_id === Number(classFilter));
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "published" ? item.is_published : !item.is_published);
      return (
        matchesType &&
        matchesSearch &&
        matchesSubject &&
        matchesClass &&
        matchesStatus
      );
    });

    return result.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const first = new Date(a.created_at ?? 0).getTime();
      const second = new Date(b.created_at ?? 0).getTime();
      return sortMode === "oldest" ? first - second : second - first;
    });
  }, [activeTab, classFilter, items, search, sortMode, statusFilter, subjectFilter]);

  const openCreateWizard = () => {
    const preferredType = tabType[activeTab] as ClassworkKind | undefined;
    setSelectedType(preferredType ?? null);
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    setShowCreateWizard(false);
    setSelectedType(null);
  };

  const openClassworkDetail = useCallback(
    (item: TeacherClasswork) => {
      suppressAutoOpenRef.current = false;
      setSelected(item);
      setSearchParams({ classworkId: String(item.classwork_id) });
    },
    [setSearchParams],
  );

  useEffect(() => {
    const classworkId = Number(searchParams.get("classworkId"));
    if (!classworkId) {
      suppressAutoOpenRef.current = false;
      return;
    }
    if (suppressAutoOpenRef.current || selected?.classwork_id === classworkId)
      return;
    const target = items.find((item) => item.classwork_id === classworkId);
    if (target) {
      openClassworkDetail(target);
    }
  }, [items, openClassworkDetail, searchParams, selected?.classwork_id]);

  const closeClassworkDetail = () => {
    suppressAutoOpenRef.current = true;
    setSelected(null);
    setSearchParams({}, { replace: true });
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

  return (
    <AppLayout>
      {selected ? (
        <ClassworkView
          classwork={selected}
          onClose={closeClassworkDetail}
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
            closeClassworkDetail();
          }}
        />
      ) : (
        // Main list view
        <>
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold">Classwork</h1>
              </div>

              <Button
                type="button"
                onClick={openCreateWizard}
                className="gap-2"
              >
                <Plus size={17} />
                <span className="hidden sm:inline">New Classwork</span>
                <span className="sm:hidden">New</span>
              </Button>
            </header>

            <Tabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>

          <main className="flex flex-col gap-4 px-5 py-4 pt-0!">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-3 py-2 md:grid-cols-[1fr_auto_auto]">
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

              {subjectFilter !== "all" && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="flex w-fit items-center gap-2"
                  onClick={() => setSubjectFilter("all")}
                >
                  {
                    subjects.find(
                      (subject) => subject.id === Number(subjectFilter),
                    )?.name
                  }
                  <X size={13} />
                </Badge>
              )}

              {classFilter !== "all" && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="flex w-fit items-center gap-2"
                  onClick={() => setClassFilter("all")}
                >
                  {
                    classSections.find(
                      (section) => section.id === Number(classFilter),
                    )?.name
                  }
                  <X size={13} />
                </Badge>
              )}

              {statusFilter !== "all" && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="flex w-fit items-center gap-2 capitalize"
                  onClick={() => setStatusFilter("all")}
                >
                  {statusFilter}
                  <X size={13} />
                </Badge>
              )}
            </div>

            {showFilters && (
              <section className="grid gap-3 rounded-lg border border-black bg-[#F6E9B2] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:grid-cols-3">
                <label className="text-xs font-bold">
                  Subject
                  <select
                    value={subjectFilter}
                    onChange={(event) => setSubjectFilter(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
                  >
                    <option value="all">All subjects</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold">
                  Section / Class
                  <select
                    value={classFilter}
                    onChange={(event) => setClassFilter(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
                  >
                    <option value="all">All sections</option>
                    {classSections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </select>
                </label>
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
                    onOpen={openClassworkDetail}
                  />
                ))}
              </section>
            ) : (
              <Card className="flex flex-col justify-center items-center">
                <ClipboardList
                  className="mx-auto mb-2 "
                  size={24}
                />
                <p className="font-bold">No classworks found</p>
                <p className="mt-1 text-sm text-gray-500">
                  Try another tab, search term, or filter.
                </p>
              </Card>
            )}
          </main>

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
                        className="cursor-pointer text-white hover:text-gray-200"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </Dialog.Header>
                  <section className="p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {createOptions.map((option) => {
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
                  initialSubjectId={subjectFilter !== "all" ? subjectFilter : undefined}
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
                  initialSubjectId={subjectFilter !== "all" ? subjectFilter : undefined}
                  onClose={closeCreateWizard}
                  onSuccess={async () => {
                    await loadClassworks();
                    closeCreateWizard();
                  }}
                  onBack={() => setSelectedType(null)}
                />
              ))}
          </Dialog>
        </>
      )}
    </AppLayout>
  );
}
