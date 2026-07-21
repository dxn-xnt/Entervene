import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Plus,
  Search,
} from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import ClassCard from "@/components/admin/classes/ClassCard";
import AddClassModal from "@/components/admin/classes/modals/AddClassModal";
import ArchiveClassModal from "@/components/admin/classes/modals/ArchiveClassModal";
import EditClassModal from "@/components/admin/classes/modals/EditClassModal";
import { archiveClass, getClasses } from "@/lib/api";
import type {
  ClassListItem,
  GetClassesResponse,
  StatusFilter,
} from "@/types/adminClasses";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import AddSubjectLoadModal from "./forms/add-subject-load";
import { OverviewCard } from "@/components/overview-cards";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminClasses() {
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

  const refreshClasses = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      setClassList(
        await getClasses(statusFilter === "Archived" ? "archived" : "active"),
      );
    } catch (error: unknown) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load classes.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void refreshClasses();
  }, [refreshClasses]);

  const handleArchive = useCallback(async () => {
    if (!archiveTarget || isArchiving) return;

    setIsArchiving(true);
    setArchiveError("");
    setNotice("");
    try {
      const result = await archiveClass(archiveTarget.class_id);
      await refreshClasses();
      setArchiveTarget(null);
      setNotice(result.message || "Class archived successfully.");
    } catch (error: unknown) {
      setArchiveError(
        error instanceof Error ? error.message : "Unable to archive class.",
      );
    } finally {
      setIsArchiving(false);
    }
  }, [archiveTarget, isArchiving, refreshClasses]);

  const classes = useMemo(() => classList?.classes ?? [], [classList]);

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

  const summary = classList?.summary ?? {
    total_classes: 0,
    active_classes: 0,
    archived_classes: 0,
    students_assigned: 0,
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                    Classes
                  </h1>
                  {/* <p className="text-sm text-black/70">
                    Manage class sections, advisers, students, subject load, and
                    schedules.
                  </p> */}
                </div>
              </div>
              <div className="flex flex-row gap-2">
                <Button
                  onClick={() => setShowNewClass(true)}
                >
                  <Plus className="size-4 mr-2" /> New Class
                </Button>
                <Dialog>
                  <Dialog.Trigger>
                    <Button variant={"outline"}>
                      <Plus className="size-4 mr-2" /> Add Subject Load
                    </Button>
                  </Dialog.Trigger>
                  <AddSubjectLoadModal />
                </Dialog>
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-border" />

            {notice && (
              <p className="border-2 border-black bg-[#bbf7d0] p-3 text-sm font-bold shadow-[3px_3px_0_#000]">
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
              <label className="relative shadow-md hover:shadow-none transition-shadow">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search class or adviser..."
                  className="h-10 w-full shadow-none border-black pl-9 pr-3"
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
              {isLoading ? (
                <StatePanel message="Loading classes..." />
              ) : loadError ? (
                <StatePanel
                  message="Unable to load classes."
                  detail={loadError}
                >
                  <button
                    className="rounded-md border border-black bg-[#79bd80] px-3 py-1 text-xs font-bold shadow-[2px_2px_0_#000]"
                    onClick={() => void refreshClasses()}
                  >
                    Retry
                  </button>
                </StatePanel>
              ) : !classes.length ? (
                <StatePanel
                  message="No classes found."
                  detail="Create a new class to get started."
                />
              ) : grouped.length === 0 ? (
                <StatePanel message="No classes match the selected filters." />
              ) : (
                grouped.map((group) => (
                  <Card
                    key={group.levelName}
                    className="bg-primary"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-xl font-bold">{group.levelName}</h2>
                      <div className="flex flex-row gap-3">
                        <Badge variant={"outline"} className="border-border">
                          {group.classes.length} subject
                          {group.classes.length !== 1 ? "s" : ""}
                        </Badge>
                        <Badge variant={"outline"} className="border-border">
                          {group.classes.length} section
                          {group.classes.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>

                    </div>
                    <div
                      className={`grid gap-3 md:grid-cols-2 ${group.classes.length > 2 ? "xl:grid-cols-3" : ""
                        }`}
                    >
                      {group.classes.map((item) => (
                        <ClassCard
                          key={item.class_id}
                          item={item}
                          onEdit={() => setEditTarget(item)}
                          onArchive={() => {
                            setArchiveError("");
                            setNotice("");
                            setArchiveTarget(item);
                          }}
                        />
                      ))}
                    </div>
                  </Card>
                ))
              )}
            </section>
          </div>
        </div>
      </div>

      {showNewClass && (
        <AddClassModal
          onClose={() => setShowNewClass(false)}
          onClassesCreated={() => void refreshClasses()}
        />
      )}

      {editTarget && (
        <EditClassModal
          classId={editTarget.class_id}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
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

function StatePanel({
  message,
  detail,
  children,
}: {
  message: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-lg border-2 border-black p-8 text-center text-sm text-black/60 shadow-[3px_3px_0_#000]">
      <p className="font-bold text-black">{message}</p>
      {detail && <p className="mt-1">{detail}</p>}
      {children && <div className="mt-3 flex justify-center">{children}</div>}
    </div>
  );
}
