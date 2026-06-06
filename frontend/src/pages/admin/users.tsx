import AddUserModal from "../../components/admin/AddUserModal";
import { Badge } from "../../components/retroui/Badge";
import { Input } from "../../components/retroui/Input";
import { Loader } from "../../components/retroui/Loader";
import Tabs from "../../components/Tabs";
import AppLayout from "../../layouts/app-layout";
import { getUsers, type User, type UserRole } from "../../lib/api";
import {
  AlertTriangle,
  ArrowDownUp,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Filter,
  GraduationCap,
  Plus,
  School,
  Search,
  UserCog,
  Users,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = UserRole;

type GradeFilter = "all" | 7 | 8 | 9 | 10 | 11 | 12;
type StatusFilter = "all" | "active" | "pending" | "inactive" | "suspended" | "archived" | "graduated" | "transferred" | "dropped" | "no section assigned";

// ─── Constants ────────────────────────────────────────────────────────────────

const GRADE_LEVELS: GradeFilter[] = ["all", 7, 8, 9, 10, 11, 12];

const tabs: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "admin", label: "Admin", icon: <UserCog className="size-3.5" /> },
  { id: "teacher", label: "Teachers", icon: <BookOpen className="size-3.5" /> },
  { id: "student", label: "Students", icon: <GraduationCap className="size-3.5" /> },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function visibleSubjects(subjects: string[] | undefined) {
  return {
    shown: subjects?.slice(0, 2) ?? [],
    extra: Math.max((subjects?.length ?? 0) - 2, 0),
  };
}

type StatusStyle = { badge: string; dot: string; label: string };
const USER_ROW_HOVER =
  "hover:bg-accent hover:text-sidebar-accent-foreground hover:border-y hover:border-border";
const STATUS_BADGE_BASE =
  "inline-flex h-6 w-28 items-center justify-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold";

function getStatusStyle(status: string | undefined | null): StatusStyle {
  switch ((status || "").toLowerCase()) {
    case "active":
      return { badge: "bg-emerald-50 border-emerald-300 text-emerald-700", dot: "bg-emerald-500", label: "Active" };
    case "pending":
      return { badge: "bg-amber-50 border-amber-300 text-amber-700", dot: "bg-amber-400", label: "Pending" };
    case "inactive":
      return { badge: "bg-slate-100 border-slate-300 text-slate-500", dot: "bg-slate-400", label: "Inactive" };
    case "suspended":
      return { badge: "bg-red-50 border-red-300 text-red-600", dot: "bg-red-500", label: "Suspended" };
    case "archived":
      return { badge: "bg-zinc-100 border-zinc-300 text-zinc-600", dot: "bg-zinc-500", label: "Archived" };
    case "graduated":
      return { badge: "bg-blue-50 border-blue-300 text-blue-700", dot: "bg-blue-500", label: "Graduated" };
    case "transferred":
      return { badge: "bg-violet-50 border-violet-300 text-violet-700", dot: "bg-violet-500", label: "Transferred" };
    case "dropped":
      return { badge: "bg-red-50 border-red-300 text-red-600", dot: "bg-red-500", label: "Dropped" };
    case "no section assigned":
      return { badge: "bg-amber-50 border-amber-300 text-amber-700", dot: "bg-amber-400", label: "No Section" };
    default:
      return {
        badge: "bg-slate-100 border-slate-200 text-slate-600",
        dot: "bg-slate-400",
        label: status ? status.charAt(0).toUpperCase() + status.slice(1) : "Unknown",
      };
  }
}

function parseSectionInfo(section: string | undefined | null): { grade: number; sectionName: string } | null {
  if (!section) return null;
  const match = section.match(/^(\d+)-(.+)$/);
  if (match) {
    return { grade: parseInt(match[1], 10), sectionName: match[2] };
  }
  return { grade: 0, sectionName: section };
}

function getStudentGradeLevel(user: User): number | null {
  const parsedGrade = parseSectionInfo(user.section)?.grade;
  return parsedGrade && parsedGrade > 0 ? parsedGrade : user.grade_level ?? null;
}

function getSectionDisplayName(section: string | undefined | null): string | null {
  return parseSectionInfo(section)?.sectionName ?? null;
}

function groupStudents(students: User[]): Map<string, User[]> {
  const map = new Map<string, User[]>();
  const UNASSIGNED = "__unassigned__";

  for (const student of students) {
    const key = student.section ? student.section : UNASSIGNED;
    const bucket = map.get(key) ?? [];
    bucket.push(student);
    map.set(key, bucket);
  }

  const sorted = new Map<string, User[]>();
  if (map.has(UNASSIGNED)) sorted.set(UNASSIGNED, map.get(UNASSIGNED)!);

  const sectionKeys = [...map.keys()]
    .filter((k) => k !== UNASSIGNED)
    .sort((a, b) => {
      const pa = parseSectionInfo(a);
      const pb = parseSectionInfo(b);
      if (pa && pb) {
        if (pa.grade !== pb.grade) return pa.grade - pb.grade;
        return pa.sectionName.localeCompare(pb.sectionName);
      }
      return a.localeCompare(b);
    });

  for (const k of sectionKeys) sorted.set(k, map.get(k)!);
  return sorted;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("teacher");
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers({
        role: activeTab,
        search: debouncedSearch,
        status: activeTab === "student" && statusFilter !== "all" ? statusFilter : undefined,
      });
      setUsers(data);
    } catch (err) {
      setUsers([]);
      setError(err instanceof Error ? err.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch, statusFilter]);

  const emptyText = useMemo(() => {
    if (activeTab === "teacher") return "No teachers found";
    if (activeTab === "student") return "No students found";
    return "No admins found";
  }, [activeTab]);

  useEffect(() => {
    setGradeFilter("all");
    setStatusFilter("all");
    setCollapsedSections(new Set());
  }, [activeTab]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  const filteredStudents = useMemo(() => {
    if (activeTab !== "student") return users;
    return users.filter((u) => {
      if (statusFilter !== "all" && (u.account_status ?? "").toLowerCase() !== statusFilter) return false;
      if (gradeFilter !== "all") {
        const grade = getStudentGradeLevel(u);
        if (grade !== gradeFilter) return false;
      }
      return true;
    });
  }, [users, activeTab, gradeFilter, statusFilter]);

  const studentGroups = useMemo(
    () => (activeTab === "student" ? groupStudents(filteredStudents) : new Map()),
    [activeTab, filteredStudents],
  );

  const studentStats = useMemo(() => {
    if (activeTab !== "student") return null;
    return {
      total: users.length,
      active: users.filter((u) => (u.account_status ?? "").toLowerCase() === "active").length,
      pending: users.filter((u) => (u.account_status ?? "").toLowerCase() === "pending").length,
      unassigned: users.filter((u) => !u.section).length,
    };
  }, [users, activeTab]);

  function toggleSection(key: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openUser(user: User) {
    navigate(`/admin/users/${user.role}/${user.id}`);
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-5">

            {/* ── Header ── */}
            <header className="flex items-center justify-between">
              <h1 className="text-4xl font-bold tracking-tight">User Management</h1>
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
              >
                <Plus className="size-4" />
                New User
              </button>
            </header>

            {/* ── Tabs ── */}
            <div className="-mx-4 border-b border-black/40 md:-mx-6">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as TabId)} />
            </div>

            <div className="flex flex-col gap-3 px-4 md:px-6">

              {/* ── Search + controls row ── */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative max-w-md flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search users"
                    className="h-9 rounded-md border border-black/70 pl-9 shadow-none"
                    placeholder={activeTab === "student" ? "Search student..." : "Search user"}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-5 text-xs">
                  <button className="flex items-center gap-1.5">
                    <Filter className="size-4" />
                    Add Filter
                  </button>
                  <button className="flex items-center gap-1.5">
                    <ArrowDownUp className="size-4" />
                    Sort By
                  </button>
                </div>
              </div>

              {/* ── Student-specific controls ── */}
              {activeTab === "student" && (
                <>
                  {/* ── Summary stat cards — aligned to classes.tsx SummaryCard ── */}
                  {studentStats && !loading && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <StatCard
                        label="Total Students"
                        value={studentStats.total}
                        icon={<Users className="size-5" />}
                      />
                      <StatCard
                        label="Active"
                        value={studentStats.active}
                        color="green"
                        icon={<GraduationCap className="size-5" />}
                      />
                      <StatCard
                        label="Pending"
                        value={studentStats.pending}
                        color={studentStats.pending > 0 ? "amber" : undefined}
                        icon={<School className="size-5" />}
                      />
                      <StatCard
                        label="Unassigned"
                        value={studentStats.unassigned}
                        color={studentStats.unassigned > 0 ? "amber" : undefined}
                        icon={<AlertTriangle className="size-5" />}
                      />
                    </div>
                  )}

                  {/* Grade filter pills */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <span className="shrink-0 text-xs font-medium text-muted-foreground">Grade:</span>
                    {GRADE_LEVELS.map((g) => (
                      <button
                        key={g}
                        onClick={() => setGradeFilter(g)}
                        className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                          gradeFilter === g
                            ? "border-black bg-black text-white"
                            : "border-black/30 bg-background text-muted-foreground hover:border-black/60 hover:text-foreground"
                        }`}
                      >
                        {g === "all" ? "All" : `Grade ${g}`}
                      </button>
                    ))}
                    <div className="ml-auto shrink-0">
                      <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                        className="h-7 rounded-md border border-black/30 bg-background px-2 text-xs font-medium text-muted-foreground hover:border-black/60"
                      >
                        <option value="all">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="inactive">Inactive</option>
                        <option value="suspended">Suspended</option>
                        <option value="archived">Archived</option>
                        <option value="graduated">Graduated</option>
                        <option value="transferred">Transferred</option>
                        <option value="dropped">Dropped</option>
                        <option value="no section assigned">No Section Assigned</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {/* ── Error ── */}
              {error && (
                <div className="rounded border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {/* ── Loading ── */}
              {loading && (
                <div className="flex items-center justify-center gap-3 rounded-xl border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
                  <Loader size="sm" />
                  Loading users
                </div>
              )}

              {/* ── Student grouped view ── */}
              {!loading && activeTab === "student" && (
                <>
                  {studentGroups.size === 0 && (
                    <div className="rounded-xl border border-black bg-background py-12 text-center text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
                      {emptyText}
                    </div>
                  )}
                  {[...studentGroups.entries()].map(([key, groupUsers]) => (
                    <SectionGroup
                      key={key}
                      sectionKey={key}
                      users={groupUsers}
                      collapsed={collapsedSections.has(key)}
                      onToggle={() => toggleSection(key)}
                      onOpenUser={openUser}
                    />
                  ))}
                </>
              )}

              {/* ── Teacher / Admin flat view ── */}
              {!loading && activeTab !== "student" && (
                <>
                  {!loading && users.length > 0 && <TableHeader activeTab={activeTab} />}
                  <div className="overflow-hidden rounded-xl border border-black bg-background shadow-[4px_5px_0_#000]">
                    {users.length === 0 && (
                      <div className="py-12 text-center text-sm text-muted-foreground">{emptyText}</div>
                    )}
                    {users.map((user) => (
                      <UserRow key={user.id} user={user} activeTab={activeTab} onOpenUser={openUser} />
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <AddUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onUserAdded={() => {
          setModalOpen(false);
          void fetchUsers();
        }}
      />
    </AppLayout>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

/**
 * Aligned to SummaryCard from classes.tsx:
 * - border border-black + shadow-[3px_3px_0_#000]
 * - bg-[#fffdf5] cream background
 * - label as text-sm font-bold with icon top-right
 * - value as text-3xl font-black
 * - color variants applied to the value only
 */
function StatCard({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color?: "green" | "amber" | "red";
  icon?: ReactNode;
}) {
  const valueColor =
    color === "green"
      ? "text-emerald-700"
      : color === "amber"
        ? "text-amber-700"
        : color === "red"
          ? "text-red-600"
          : "";

  return (
    <div className="rounded-lg border border-black bg-[#fffdf5] p-4 shadow-[3px_3px_0_#000]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p className={`mt-3 text-3xl font-black ${valueColor}`}>{value}</p>
    </div>
  );
}

const UNASSIGNED_KEY = "__unassigned__";

function SectionGroup({
  sectionKey,
  users,
  collapsed,
  onToggle,
  onOpenUser,
}: {
  sectionKey: string;
  users: User[];
  collapsed: boolean;
  onToggle: () => void;
  onOpenUser: (user: User) => void;
}) {
  const isUnassigned = sectionKey === UNASSIGNED_KEY;
  const info = isUnassigned ? null : parseSectionInfo(sectionKey);

  const headerLabel = isUnassigned
    ? "Unassigned — awaiting section"
    : info
      ? info.grade > 0
        ? `Grade ${info.grade} — ${info.sectionName}`
        : info.sectionName
      : sectionKey;

  return (
    <div
      className={`overflow-hidden rounded-xl border shadow-[3px_4px_0_#000] ${
        isUnassigned ? "border-amber-400" : "border-black"
      }`}
    >
      <button
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
          isUnassigned
            ? "bg-amber-50 hover:bg-accent hover:text-sidebar-accent-foreground"
            : "bg-background hover:bg-accent hover:text-sidebar-accent-foreground"
        }`}
        aria-expanded={!collapsed}
      >
        {isUnassigned ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        ) : (
          <Users className="size-4 shrink-0 text-muted-foreground" />
        )}

        <span className={`flex-1 text-sm font-semibold ${isUnassigned ? "text-amber-800" : ""}`}>
          {headerLabel}
        </span>

        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            isUnassigned
              ? "border-amber-300 bg-amber-100 text-amber-700"
              : "border-black/20 bg-muted/50 text-muted-foreground"
          }`}
        >
          {users.length} student{users.length !== 1 ? "s" : ""}
        </span>

        {collapsed ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {!collapsed && (
        <div className="bg-background">
          <div
            className={`grid gap-3 border-t px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${
              isUnassigned ? "border-amber-300 bg-amber-50/60" : "border-black/20 bg-muted/30"
            } ${isUnassigned ? "grid-cols-[minmax(0,1fr)_120px_120px_90px]" : "grid-cols-[minmax(0,1fr)_120px_150px_90px]"}`}
          >
            <span>Name</span>
            <span className="text-center">Status</span>
            <span className="text-center">{isUnassigned ? "Grade level" : "Section"}</span>
            <span className="text-right">Average</span>
          </div>

          {users.map((user) => (
            <StudentRow key={user.id} user={user} showGrade={isUnassigned} onOpenUser={onOpenUser} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentRow({ user, showGrade, onOpenUser }: { user: User; showGrade: boolean; onOpenUser: (user: User) => void }) {
  const status = getStatusStyle(user.account_status);
  const gradeLevel = getStudentGradeLevel(user);
  const sectionName = getSectionDisplayName(user.section);

  return (
    <button
      type="button"
      onClick={() => onOpenUser(user)}
      className={`grid w-full items-center gap-3 border-t border-black/10 px-4 py-2.5 last:border-b-0 ${
        showGrade
          ? "grid-cols-[minmax(0,1fr)_120px_120px_90px]"
          : "grid-cols-[minmax(0,1fr)_120px_150px_90px]"
      } text-left transition-colors ${USER_ROW_HOVER}`}
    >
      <NameCell name={user.name} subtitle={user.email} />

      <span className={`justify-self-center ${STATUS_BADGE_BASE} ${status.badge}`}>
        <span className={`size-1.5 rounded-full ${status.dot}`} />
        {status.label}
      </span>

      <div className="flex justify-center">
        {showGrade ? (
          gradeLevel ? (
            <span className="rounded-md border border-black/20 bg-muted/40 px-2 py-0.5 text-[11px] font-medium">
              Grade {gradeLevel}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )
        ) : sectionName ? (
          <Badge variant="outline" size="sm" className="bg-background text-[10px] font-medium">
            {sectionName}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">No section</span>
        )}
      </div>

      <div className="justify-self-end text-right font-black leading-none">
        {user.average != null ? (
          <>
            <span className="text-lg">{user.average}</span>
            <span className="text-xs font-semibold">%</span>
          </>
        ) : (
          <span className="text-sm font-normal text-muted-foreground">—</span>
        )}
      </div>
    </button>
  );
}

// ─── Teacher / Admin components (unchanged) ───────────────────────────────────

function TableHeader({ activeTab }: { activeTab: TabId }) {
  if (activeTab === "teacher") {
    return (
      <div className="hidden grid-cols-[minmax(220px,1fr)_120px_minmax(180px,1fr)_110px] gap-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
        <span>Name</span>
        <span>Status</span>
        <span className="text-center">Subjects</span>
        <span className="text-right">Classes</span>
      </div>
    );
  }
  return (
    <div className="hidden grid-cols-[minmax(200px,1fr)_120px_minmax(160px,1fr)] gap-3 px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
      <span>Name / Email</span>
      <span>Status</span>
      <span className="text-right">Joined</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string | undefined | null }) {
  const style = getStatusStyle(status);
  return (
    <span className={`${STATUS_BADGE_BASE} ${style.badge}`}>
      <span className={`size-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

function UserRow({ user, activeTab, onOpenUser }: { user: User; activeTab: TabId; onOpenUser: (user: User) => void }) {
  const { shown, extra } = visibleSubjects(user.subjects);

  if (activeTab === "teacher") {
    return (
      <button
        type="button"
        onClick={() => onOpenUser(user)}
        className={`grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-black/50 px-3 py-2.5 text-left transition-colors last:border-b-0 md:grid-cols-[minmax(220px,1fr)_120px_minmax(180px,1fr)_110px] ${USER_ROW_HOVER}`}
      >
        <NameCell name={user.name} />
        <div className="hidden justify-self-center md:block">
          <StatusBadge status={user.account_status} />
        </div>
        <div className="hidden flex-wrap justify-center gap-1.5 md:flex">
          {shown.length > 0 ? (
            shown.map((subject) => (
              <Badge key={subject} variant="outline" size="sm" className="bg-background text-[10px] font-medium">
                {subject}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">No subjects</span>
          )}
          {extra > 0 && (
            <Badge variant="outline" size="sm" className="bg-background text-[10px] font-medium">
              +{extra}
            </Badge>
          )}
        </div>
        <div className="flex items-center justify-end gap-1 text-xs font-semibold">
          <School className="size-3.5" />
          {user.class_count ?? 0}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpenUser(user)}
      className={`grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-black/50 px-3 py-2.5 text-left transition-colors last:border-b-0 md:grid-cols-[minmax(200px,1fr)_120px_minmax(160px,1fr)] ${USER_ROW_HOVER}`}
    >
      <NameCell name={user.name} subtitle={user.email} />
      <div className="hidden justify-self-center md:block">
        <StatusBadge status={user.account_status} />
      </div>
      <div className="hidden items-center justify-end gap-1.5 text-xs text-muted-foreground md:flex">
        <UsersRound className="size-3.5" />
        {user.created_at || "—"}
      </div>
    </button>
  );
}

function NameCell({ name, subtitle }: { name: string; subtitle?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px] font-semibold text-amber-900">
        {name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{name}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
    </div>
  );
}