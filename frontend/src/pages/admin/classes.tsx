import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownUp,
  BookOpen,
  CheckCircle2,
  Filter,
  Plus,
  Search,
  Users,
} from "lucide-react";
import AppLayout from "@/layouts/app-layout";
import ClassCard from "@/components/admin/classes/ClassCard";
import SummaryCard from "@/components/admin/classes/SummaryCard";
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
          <div className="flex flex-col gap-3 p-4">
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
              <button
                className="flex items-center gap-1.5 rounded-lg border border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
                onClick={() => setShowNewClass(true)}
              >
                <Plus className="size-4" /> New Class
              </button>
            </header>

            <div className="-mx-4 md:-mx-6 border-b border-black/40" />

            {notice && (
              <p className="border-2 border-black bg-[#bbf7d0] p-3 text-sm font-bold shadow-[3px_3px_0_#000]">
                {notice}
              </p>
            )}

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCard
                label="Total Classes"
                value={summary.total_classes}
                icon={<BookOpen className="size-5" />}
              />
              <SummaryCard
                label="Active Classes"
                value={summary.active_classes}
                icon={<CheckCircle2 className="size-5" />}
              />
              <SummaryCard
                label="Archived Classes"
                value={summary.archived_classes}
                icon={<Archive className="size-5" />}
              />
              <SummaryCard
                label="Students Assigned"
                value={summary.students_assigned}
                icon={<Users className="size-5" />}
              />
            </section>

            <section className="rounded-lg border-2 border-black p-4 shadow-[3px_3px_0_#000]">
              <div className="grid gap-3 md:grid-cols-[1fr_160px_140px]">
                <label className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search class or adviser..."
                    className="h-10 w-full rounded-md border border-black pl-9 pr-3 text-sm outline-none"
                  />
                </label>
                <select
                  value={yearFilter}
                  onChange={(event) => setYearFilter(event.target.value)}
                  className="h-10 rounded-md border border-black px-3 text-sm outline-none"
                >
                  {yearOptions.map((year) => (
                    <option key={year}>{year}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as StatusFilter)
                  }
                  className="h-10 rounded-md border border-black px-3 text-sm outline-none"
                >
                  <option value="All">All Statuses</option>
                  <option value="Active">Active</option>
                  <option value="Archived">Archived</option>
                </select>
              </div>

              <div className="my-3 border-t border-black/10" />

              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <span className="shrink-0 text-xs font-semibold text-black/50">
                  Grade:
                </span>
                {gradeOptions.map((grade) => (
                  <button
                    key={grade}
                    onClick={() => setGradeFilter(grade)}
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                      gradeFilter === grade
                        ? "border-black bg-black text-white"
                        : "border-black/30 bg-transparent text-black/60 hover:border-black/60 hover:text-black"
                    }`}
                  >
                    {grade}
                  </button>
                ))}
                <div className="ml-auto flex shrink-0 items-center gap-3 text-xs">
                  <button className="flex items-center gap-1.5 font-semibold text-black/70 hover:text-black">
                    <Filter className="size-4" /> Add Filter
                  </button>
                  <button className="flex items-center gap-1.5 font-semibold text-black/70 hover:text-black">
                    <ArrowDownUp className="size-4" /> Sort By
                  </button>
                </div>
              </div>
            </section>

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
                  <div
                    key={group.levelName}
                    className="rounded-lg border-2 border-black p-4 shadow-[4px_4px_0_#000]"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-xl font-bold">{group.levelName}</h2>
                      <span className="rounded-full border border-black bg-[#f7e9aa] px-3 py-1 text-xs font-bold text-[#7a5c00]">
                        {group.classes.length} section
                        {group.classes.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div
                      className={`grid gap-3 md:grid-cols-2 ${
                        group.classes.length > 2 ? "xl:grid-cols-3" : ""
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
                  </div>
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
