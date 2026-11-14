import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Plus,
  Search,
  School,
} from "lucide-react";
import { Link } from "react-router-dom";
import { routes } from "@/../routes";
import AppLayout from "@/layouts/app-layout";
import ClassCard from "@/components/admin/classes/class-card";
import AddClassModal from "./forms/add-class";
import ArchiveClassModal from "@/pages/admin/forms/classes/archive-class";
import EditClassModal from "@/pages/admin/forms/classes/edit-class";
import { archiveClass, getClasses } from "@/lib/api";
import type {
  ClassListItem,
  GetClassesResponse,
  StatusFilter,
} from "@/types/adminClasses";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { OverviewCard } from "@/components/overview-cards";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Badge } from "@/components/retroui/Badge";
import { Accordion } from "@/components/retroui/Accordion";
import { useToast } from "@/components/retroui/Toast";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { LoadingPanel } from "@/components/loading-panel";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";

export default function AdminClasses() {
  const toast = useToast();
  const { selectedYearId, selectedYear, isLoading: isContextLoading } = useAcademicPeriod();
  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [showNewClass, setShowNewClass] = useState(false);
  const [editTarget, setEditTarget] = useState<ClassListItem | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ClassListItem | null>(
    null,
  );
  const [classList, setClassList] = useState<GetClassesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [archiveError, setArchiveError] = useState("");
  const [isArchiving, setIsArchiving] = useState(false);
  const [notice, setNotice] = useState("");

  const currentRequestIdRef = useRef(0);

  const loadClassesForYear = useCallback(
    async (yearId: number | null, status: StatusFilter) => {
      const requestId = ++currentRequestIdRef.current;
      setIsLoading(true);
      setLoadError("");
      // Immediately clear the previous year's class list so old data is never shown
      setClassList(null);

      if (yearId == null) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await getClasses(
          status === "Archived" ? "archived" : "active",
          yearId
        );
        if (requestId === currentRequestIdRef.current) {
          const strictlyYearClasses = (response.classes ?? []).filter(
            (c) => c.academic_year.academic_year_id === yearId
          );
          const hasAlienClasses = strictlyYearClasses.length !== (response.classes ?? []).length;
          const sanitizedResponse: GetClassesResponse = hasAlienClasses
            ? {
                summary: {
                  total_classes: strictlyYearClasses.length,
                  active_classes: strictlyYearClasses.filter(
                    (c) => normalizedStatus(c.class_status) === "active"
                  ).length,
                  archived_classes: strictlyYearClasses.filter(
                    (c) => normalizedStatus(c.class_status) === "archived"
                  ).length,
                  students_assigned: strictlyYearClasses.reduce(
                    (sum, c) => sum + (c.student_count || 0),
                    0
                  ),
                },
                classes: strictlyYearClasses,
              }
            : response;

          setClassList(sanitizedResponse);
        }
      } catch (error: unknown) {
        if (requestId === currentRequestIdRef.current) {
          setLoadError(
            error instanceof Error ? error.message : "Unable to load classes."
          );
        }
      } finally {
        if (requestId === currentRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    setYearFilter("All");
    void loadClassesForYear(selectedYearId, statusFilter);
  }, [selectedYearId, statusFilter, loadClassesForYear]);

  const refreshClasses = useCallback(() => {
    return loadClassesForYear(selectedYearId, statusFilter);
  }, [loadClassesForYear, selectedYearId, statusFilter]);

  const handleArchive = useCallback(async () => {
    if (!archiveTarget || isArchiving) return;

    setIsArchiving(true);
    setArchiveError("");
    setNotice("");
    try {
      const result = await archiveClass(archiveTarget.class_id);
      toast.success({ title: "Class archived", description: result.message });
      await refreshClasses();
      setArchiveTarget(null);
      setNotice(result.message || "Class archived successfully.");
    } catch (error: unknown) {
      toast.error({ title: "Unable to archive class", description: error instanceof Error ? error.message : undefined });
      setArchiveError(
        error instanceof Error ? error.message : "Unable to archive class.",
      );
    } finally {
      setIsArchiving(false);
    }
  }, [archiveTarget, isArchiving, refreshClasses, toast]);

  const classes = useMemo(() => {
    if (!classList || selectedYearId == null) return [];
    return (classList.classes ?? []).filter(
      (item) => item.academic_year.academic_year_id === selectedYearId
    );
  }, [classList, selectedYearId]);

  const gradeOptions = useMemo(() => {
    const byLevel = new Map<number, { label: string; gradeLevel: number }>();
    classes.forEach((item) =>
      byLevel.set(item.academic_level.academic_level_id, {
        label: item.academic_level.level_name,
        gradeLevel: item.academic_level.grade_level,
      }),
    );
    return [
      "All",
      ...Array.from(byLevel.values())
        .sort((a, b) => a.gradeLevel - b.gradeLevel)
        .map((item) => item.label),
    ];
  }, [classes]);

  const yearOptions = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(classes.map((item) => item.academic_year.year_label)),
      ).sort(),
    ],
    [classes],
  );

  const filteredClasses = useMemo(() => {
    const searchTerm = search.trim().toLocaleLowerCase();
    return classes.filter((item) => {
      const adviserName = adviserDisplayName(item);
      const text = [
        item.section_name,
        item.academic_level.level_name,
        item.pathway?.name ?? "",
        adviserName,
        item.adviser?.staff_id ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase();
      return (
        (!searchTerm || text.includes(searchTerm)) &&
        (gradeFilter === "All" ||
          item.academic_level.level_name === gradeFilter) &&
        (yearFilter === "All" ||
          item.academic_year.year_label === yearFilter) &&
        (statusFilter === "All" ||
          normalizedStatus(item.class_status) ===
          statusFilter.toLocaleLowerCase())
      );
    });
  }, [classes, gradeFilter, search, statusFilter, yearFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<
      number,
      { levelName: string; gradeLevel: number; classes: ClassListItem[] }
    >();
    filteredClasses.forEach((item) => {
      const key = item.academic_level.academic_level_id;
      const group = groups.get(key) ?? {
        levelName: item.academic_level.level_name,
        gradeLevel: item.academic_level.grade_level,
        classes: [],
      };
      group.classes.push(item);
      groups.set(key, group);
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        classes: [...group.classes].sort((a, b) =>
          a.section_name.localeCompare(b.section_name),
        ),
      }))
      .sort((a, b) => a.gradeLevel - b.gradeLevel);
  }, [filteredClasses]);

  const summary = useMemo(() => {
    if (!classList || selectedYearId == null) {
      return {
        total_classes: 0,
        active_classes: 0,
        archived_classes: 0,
        students_assigned: 0,
      };
    }
    const allMatch = (classList.classes ?? []).every(
      (item) => item.academic_year.academic_year_id === selectedYearId
    );
    if (allMatch && classList.summary) {
      return classList.summary;
    }
    const matchingClasses = (classList.classes ?? []).filter(
      (item) => item.academic_year.academic_year_id === selectedYearId
    );
    const activeCount = matchingClasses.filter(
      (c) => normalizedStatus(c.class_status) === "active"
    ).length;
    const archivedCount = matchingClasses.filter(
      (c) => normalizedStatus(c.class_status) === "archived"
    ).length;
    const studentsAssigned = matchingClasses.reduce(
      (sum, c) => sum + (c.student_count || 0),
      0
    );
    return {
      total_classes: matchingClasses.length,
      active_classes: activeCount,
      archived_classes: archivedCount,
      students_assigned: studentsAssigned,
    };
  }, [classList, selectedYearId]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <div>
                  <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                    Classes
                  </h1>
                </div>
              </div>
              <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-row [&_button]:min-w-0">
                <Dialog open={showNewClass} onOpenChange={setShowNewClass}>
                  <Dialog.Trigger className="w-full md:w-auto">
                    <Button size="header" className="w-full justify-center whitespace-nowrap md:w-auto">
                      <Plus className="size-4" /> New Class
                    </Button>
                  </Dialog.Trigger>
                  {showNewClass && (
                    <AddClassModal
                      classes={classes}
                      onClose={() => setShowNewClass(false)}
                      onClassesCreated={() => { toast.success({ title: "Classes created" }); void refreshClasses(); }}
                    />
                  )}
                </Dialog>
                <Link to={routes.admin.subjectLoadStudio} className="w-full md:w-auto">
                  <Button size="header" variant={"outline"} className="w-full justify-center whitespace-nowrap md:w-auto">
                    <Plus className="size-4" /> Subject Load Studio
                  </Button>
                </Link>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {notice && (
                <p role="status" className="text-sm text-muted-foreground">
                  {notice}
                </p>
              )}

              <section className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <OverviewCard
                  title={"Total Classes"}
                  count={String(summary.total_classes)}
                />
                <OverviewCard
                  title={"Active Classes"}
                  count={String(summary.active_classes)}
                />
                <OverviewCard
                  title={"Archived Classes"}
                  count={String(summary.archived_classes)}
                />
                <OverviewCard
                  title={"Students Assigned"}
                  count={String(summary.students_assigned)}
                />
              </section>

              <div className="grid gap-3 md:grid-cols-[1fr_160px_160px] py-2">
                <label className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                  <Input
                    variant="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search class or adviser..."
                    className="w-full"
                  />
                </label>
                <Select value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}>
                  <Select.Trigger className="w-full">
                    <Select.Value placeholder="" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {yearOptions.map((year) => (
                        <Select.Item key={year} value={year}>{year}</Select.Item>
                      ))}
                    </Select.Group>
                  </Select.Content>
                </Select>

                <Select value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                  <Select.Trigger className="w-full">
                    <Select.Value placeholder="" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      <Select.Item value={"All"}>All Statuses</Select.Item>
                      <Select.Item value={"Active"}>Active</Select.Item>
                      <Select.Item value={"Archived"}>Archived</Select.Item>
                    </Select.Group>
                  </Select.Content>
                </Select>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-sm font-regular text-muted-foreground">
                  Grade:
                </span>
                {gradeOptions.map((grade) => (
                  <Button
                    key={grade}
                    autoIcon={false}
                    variant={gradeFilter === grade ? "default" : "outline"}
                    size="sm"
                    onClick={() => setGradeFilter(grade)}
                    className="shrink-0 border-black shadow-none"
                  >
                    {grade}
                  </Button>
                ))}
                <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
                  {/* <button className="flex items-center gap-1.5 font-semibold text-black/70 hover:text-black">
                    <Filter className="size-4" /> Add Filter
                  </button>
                  <button className="flex items-center gap-1.5 font-semibold text-black/70 hover:text-black">
                    <ArrowDownUp className="size-4" /> Sort By
                  </button> */}
                </div>
              </div>

              <section className="grid gap-4">
                {isLoading || isContextLoading ? (
                  <LoadingPanel label="Loading classes..." />
                ) : loadError ? (
                  <ClassesEmptyState icon={<AlertTriangle />} title="Unable to load classes" description={loadError} actionLabel="Retry" onAction={() => void refreshClasses()} />
                ) : !classes.length ? (
                  <ClassesEmptyState
                    icon={<School />}
                    title={selectedYear ? `No classes in ${selectedYear.year_label}` : "No classes yet"}
                    description={
                      selectedYear
                        ? `There are no classes configured for academic year ${selectedYear.year_label}. Create a class to start organizing students and subjects.`
                        : "Create a class to start organizing students and subjects."
                    }
                    actionLabel="New Class"
                    onAction={() => setShowNewClass(true)}
                  />
                ) : grouped.length === 0 ? (
                  <ClassesEmptyState icon={<Search />} title={search.trim() ? "No classes match your search" : "No classes match these filters"} description={search.trim() ? "Try another class or adviser name, or clear your filters." : "Choose another grade, year, or status to see classes."} actionLabel="Clear filters" onAction={() => { setSearch(""); setGradeFilter("All"); setYearFilter("All"); setStatusFilter("All"); }} />
                ) : (
                  <Accordion
                    multiple
                    defaultValue={grouped.map((group) => group.levelName)}
                    className="flex flex-col gap-4"
                  >
                    {grouped.map((group) => (
                      <Accordion.Item
                        key={group.levelName}
                        value={group.levelName}
                        className="border-2 border-border bg-background shadow-md overflow-hidden rounded"
                      >
                        <Accordion.Header className="items-center px-4 py-3 bg-primary text-foreground">
                          <div className="flex items-center justify-between w-full mr-2">
                            <h2 className="text-xl font-bold">{group.levelName}</h2>
                            <div className="flex items-center gap-2">
                              <Badge size="sm" variant="outline" className="border-border bg-background">
                                {group.classes.length} section
                                {group.classes.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>
                          </div>
                        </Accordion.Header>

                        <Accordion.Content className="p-4 pt-3 border-t-2 border-border bg-background">
                          <div className="pt-1 flex gap-3 overflow-x-auto pb-2 w-full min-w-0">
                            {group.classes.map((item) => (
                              <ClassCard
                                key={item.class_id}
                                item={item}
                                onEdit={() => setTimeout(() => setEditTarget(item), 0)}
                                onArchive={() => {
                                  setArchiveError("");
                                  setNotice("");
                                  setArchiveTarget(item);
                                }}
                              />
                            ))}
                          </div>
                        </Accordion.Content>
                      </Accordion.Item>
                    ))}

                  </Accordion>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
      {editTarget && (
        <EditClassModal
          classId={editTarget.class_id}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            toast.success({ title: "Class updated" });
            setEditTarget(null);
            void refreshClasses();
          }}
        />
      )}

      {archiveTarget && (
        <ArchiveClassModal
          classRecord={archiveTarget}
          isArchiving={isArchiving}
          error={archiveError}
          onClose={() => {
            if (isArchiving) return;
            setArchiveError("");
            setArchiveTarget(null);
          }}
          onConfirm={handleArchive}
        />
      )}
    </AppLayout>
  );
}

function adviserDisplayName(item: ClassListItem) {
  return item.adviser
    ? [
      item.adviser.first_name,
      item.adviser.middle_name,
      item.adviser.last_name,
      item.adviser.suffix,
    ]
      .filter(Boolean)
      .join(" ")
    : "No adviser assigned";
}

function normalizedStatus(status: string) {
  return status.trim().toLocaleLowerCase();
}

function ClassesEmptyState({ icon, title, description, actionLabel, onAction }: {
  icon: ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Empty className="transition-shadow hover:shadow-none">
      <EmptyHeader>
        <EmptyMedia><div className="flex size-10 items-center justify-center border-2 border-black bg-primary text-black [&_svg]:size-5" aria-hidden="true">{icon}</div></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <Button size="sm" className="gap-1.5" onClick={onAction}>{actionLabel}</Button>
    </Empty>
  );
}
