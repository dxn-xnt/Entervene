import AppLayout from "../../layouts/app-layout";
import AddUserModal from "./forms/add-user";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "../../components/retroui/Badge";
import { Table } from "../../components/retroui/Table";
import { Input } from "../../components/retroui/Input";
import { Loader } from "../../components/retroui/Loader";
import { Avatar } from "../../components/retroui/Avatar";
import { Tabs, type TabItem } from "../../components/retroui/Tabs";
import { getUsers, type User, type UserRole } from "../../lib/api";
import {
  BookOpen,
  GraduationCap,
  Plus,
  School,
  Search,
  UserCog,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/retroui/Accordion";
import { cn } from "@/lib/utils";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

// ─── Types ────────────────────────────────────────────────────────────────────

type TabId = UserRole;

type GradeFilter = "all" | 7 | 8 | 9 | 10 | 11 | 12;
type StatusFilter =
  | "all"
  | "active"
  | "pending"
  | "inactive"
  | "suspended"
  | "archived"
  | "graduated"
  | "transferred"
  | "dropped"
  | "no section assigned";

// ─── Constants ────────────────────────────────────────────────────────────────

const GRADE_LEVELS: GradeFilter[] = ["all", 7, 8, 9, 10, 11, 12];

const tabs: TabItem<TabId>[] = [
  { id: "admin", label: "Admin", icon: UserCog },
  { id: "teacher", label: "Teachers", icon: BookOpen },
  { id: "student", label: "Students", icon: GraduationCap },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function visibleSubjects(subjects: string[] | undefined) {
  return {
    shown: subjects?.slice(0, 2) ?? [],
    extra: Math.max((subjects?.length ?? 0) - 2, 0),
  };
}

type StatusStyle = {
  label: string;
  variant: "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
};

function getStatusStyle(status: string | undefined | null): StatusStyle {
  switch ((status || "").toLowerCase()) {
    case "active":
      return { label: "Active", variant: "secondary" };
    case "pending":
      return { label: "Pending", variant: "outline" };
    case "inactive":
      return { label: "Inactive", variant: "default" };
    case "suspended":
      return { label: "Suspended", variant: "solid" };
    case "archived":
      return { label: "Archived", variant: "default" };
    case "graduated":
      return { label: "Graduated", variant: "solid" };
    case "transferred":
      return { label: "Transferred", variant: "solid" };
    case "dropped":
      return { label: "Dropped", variant: "solid" };
    case "no section assigned":
      return { label: "No Section", variant: "outline" };
    default:
      return {
        label: status
          ? status.charAt(0).toUpperCase() + status.slice(1)
          : "Unknown",
        variant: "default",
      };
  }
}

function parseSectionInfo(
  section: string | undefined | null,
): { grade: number; sectionName: string } | null {
  if (!section) return null;
  const trimmed = section.trim();
  const match = trimmed.match(/^(?:Grade\s*)?(\d+)\s*(?:[-–—]\s*|\s+)?(.*)$/i);
  if (match && match[1]) {
    const grade = parseInt(match[1], 10);
    const rest = match[2]?.trim();
    return { grade, sectionName: rest || trimmed };
  }
  return { grade: 0, sectionName: trimmed };
}

function getStudentGradeLevel(user: User): number | null {
  const parsedGrade = parseSectionInfo(user.section)?.grade;
  return parsedGrade && parsedGrade > 0
    ? parsedGrade
    : (user.grade_level ?? null);
}

function getSectionDisplayName(
  section: string | undefined | null,
): string | null {
  return parseSectionInfo(section)?.sectionName ?? null;
}

function getGroupGrade(key: string, bucket: User[]): number {
  const info = parseSectionInfo(key);
  if (info && info.grade > 0) return info.grade;
  for (const student of bucket) {
    const g = getStudentGradeLevel(student);
    if (g && g > 0) return g;
  }
  return 999;
}

function groupStudents(students: User[], sortBy: "A-Z" | "Z-A" = "A-Z"): Map<string, User[]> {
  const map = new Map<string, User[]>();
  const UNASSIGNED = "__unassigned__";

  for (const student of students) {
    const key = student.section ? student.section : UNASSIGNED;
    const bucket = map.get(key) ?? [];
    bucket.push(student);
    map.set(key, bucket);
  }

  for (const bucket of map.values()) {
    bucket.sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortBy === "Z-A" ? -cmp : cmp;
    });
  }

  const sectionKeys = [...map.keys()]
    .filter((k) => k !== UNASSIGNED)
    .sort((a, b) => {
      const bucketA = map.get(a) ?? [];
      const bucketB = map.get(b) ?? [];
      const gradeA = getGroupGrade(a, bucketA);
      const gradeB = getGroupGrade(b, bucketB);

      if (gradeA !== gradeB) {
        return gradeA - gradeB;
      }
      const pa = parseSectionInfo(a);
      const pb = parseSectionInfo(b);
      const nameA = pa?.sectionName ?? a;
      const nameB = pb?.sectionName ?? b;
      return nameA.localeCompare(nameB);
    });

  const sorted = new Map<string, User[]>();
  for (const k of sectionKeys) {
    sorted.set(k, map.get(k)!);
  }

  if (map.has(UNASSIGNED)) {
    sorted.set(UNASSIGNED, map.get(UNASSIGNED)!);
  }

  return sorted;
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AdminUsers() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "teacher") as TabId;
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [gradeFilter, setGradeFilter] = useState<GradeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortBy, setSortBy] = useState<"A-Z" | "Z-A">("A-Z");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getUsers({
        role: activeTab,
        search: debouncedSearch,
        status:
          activeTab === "student" && statusFilter !== "all"
            ? statusFilter
            : undefined,
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
      if (
        statusFilter !== "all" &&
        (u.account_status ?? "").toLowerCase() !== statusFilter
      )
        return false;
      if (gradeFilter !== "all") {
        const grade = getStudentGradeLevel(u);
        if (grade !== gradeFilter) return false;
      }
      return true;
    });
  }, [users, activeTab, gradeFilter, statusFilter]);

  const studentGroups = useMemo(
    () =>
      activeTab === "student"
        ? groupStudents(filteredStudents, sortBy)
        : new Map<string, User[]>(),
    [activeTab, filteredStudents, sortBy],
  );

  const displayUsers = useMemo(() => {
    if (activeTab === "student") return filteredStudents;
    return [...users].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortBy === "Z-A" ? -cmp : cmp;
    });
  }, [users, activeTab, filteredStudents, sortBy]);

  function openUser(user: User) {
    navigate(`/admin/users/${user.role}/${user.id}`);
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">User Management</h1>
              </div>
              <Button
                className="gap-2"
                onClick={() => setModalOpen(true)}
              >
                <Plus className="size-4" />
                New User
              </Button>
            </header>

            <Tabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />

            <div className="flex flex-col gap-3">
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

                {activeTab === "student" ? (
                  <Select
                    value={statusFilter}
                    onValueChange={(val) =>
                      setStatusFilter(val as StatusFilter)
                    }
                  >
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="all">All Statuses</Select.Item>
                        <Select.Item value="active">Active</Select.Item>
                        <Select.Item value="pending">Pending</Select.Item>
                        <Select.Item value="inactive">Inactive</Select.Item>
                        <Select.Item value="suspended">Suspended</Select.Item>
                        <Select.Item value="archived">Archived</Select.Item>
                        <Select.Item value="graduated">Graduated</Select.Item>
                        <Select.Item value="transferred">Transferred</Select.Item>
                        <Select.Item value="dropped">Dropped</Select.Item>
                        <Select.Item value="no section assigned">
                          No Section Assigned
                        </Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                ) : (
                  <Select
                    value={statusFilter}
                    onValueChange={(val) =>
                      setStatusFilter(val as StatusFilter)
                    }
                  >
                    <Select.Trigger>
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value="all">All Statuses</Select.Item>
                        <Select.Item value="active">Active</Select.Item>
                        <Select.Item value="inactive">Inactive</Select.Item>
                        <Select.Item value="suspended">Suspended</Select.Item>
                        <Select.Item value="archived">Archived</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>
                )}

                <Select
                  value={sortBy}
                  onValueChange={(val) => setSortBy(val as "A-Z" | "Z-A")}
                >
                  <Select.Trigger className="w-full">
                    <Select.Value placeholder="Sort By" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      <Select.Item value={"A-Z"}>A-Z</Select.Item>
                      <Select.Item value={"Z-A"}>Z-A</Select.Item>
                    </Select.Group>
                  </Select.Content>
                </Select>
              </div>

              {activeTab === "student" && (
                <>
                  {/* {studentStats && !loading && (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <OverviewCard
                        title="Total Students"
                        count={String(studentStats.total)}
                      />
                      <OverviewCard
                        title="Active"
                        count={String(studentStats.active)}
                      />
                      <OverviewCard
                        title="Pending"
                        count={String(studentStats.pending)}
                      />
                      <OverviewCard
                        title="Unassigned"
                        count={String(studentStats.unassigned)}
                      />
                    </div>
                  )} */}

                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    <span className="shrink-0 text-sm font-regular text-muted-foreground">
                      Grade:
                    </span>
                    {GRADE_LEVELS.map((g) => (
                      <Button
                        key={g}
                        onClick={() => setGradeFilter(g)}
                        variant={gradeFilter === g ? "default" : "outline"}
                        size="sm"
                        className="shrink-0 border-black shadow-none"
                      >
                        {g === "all" ? "All" : `Grade ${g}`}
                      </Button>

                    ))}
                  </div>
                </>
              )}

              {error && (
                <div className="rounded border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {loading && (
                <div className="flex items-center justify-center gap-3 rounded-xl border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
                  <Loader size="sm" />
                  Loading users
                </div>
              )}

              {!loading && activeTab === "student" && (
                <>
                  {studentGroups.size === 0 && (
                    <div className="">
                      <Empty className="shadow-md hover:shadow-none transition-shadow">
                        <EmptyHeader>
                          <EmptyMedia>
                            <div className="flex -space-x-2 *:data-[slot=avatar]:size-12 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background *:data-[slot=avatar]:grayscale">
                              <Avatar variant="student" >
                                <Avatar.Image
                                  src="/avatars/student-avatars/3.svg"
                                  alt="@shadcn" />
                                <Avatar.Fallback>CN</Avatar.Fallback>
                              </Avatar>
                              <Avatar variant="student" >
                                <Avatar.Image
                                  src="/avatars/student-avatars/2.svg"
                                  alt="@maxleiter"
                                />
                                <Avatar.Fallback>LR</Avatar.Fallback>
                              </Avatar>
                              <Avatar variant="student" >
                                <Avatar.Image
                                  src="/avatars/student-avatars/1.svg"
                                  alt="@evilrabbit"
                                />
                                <Avatar.Fallback>ER</Avatar.Fallback>
                              </Avatar>
                            </div>
                          </EmptyMedia>
                          <EmptyTitle>No Student Enrolled</EmptyTitle>
                          <EmptyDescription className="text-center whitespace-nowrap">
                            Students will appear here once they are enrolled in a section.
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button size="sm" variant="default">
                            Enroll Student
                          </Button>
                        </EmptyContent>
                      </Empty>
                    </div>
                  )}
                  <Accordion
                    multiple
                    value={[...studentGroups.keys()].filter((k) => !collapsedSections.has(k))}
                    onValueChange={(values) => {
                      const collapsed = [...studentGroups.keys()].filter(
                        (k) => !values.includes(k)
                      );
                      setCollapsedSections(new Set(collapsed));
                    }}
                    className="flex flex-col gap-3"
                  >
                    {[...studentGroups.entries()].map(([key, groupUsers]) => {
                      const isUnassigned = key === UNASSIGNED_KEY;
                      const info = isUnassigned ? null : parseSectionInfo(key);
                      const groupGrade = isUnassigned ? 0 : getGroupGrade(key, groupUsers);

                      const headerLabel = isUnassigned
                        ? "Unassigned — awaiting section"
                        : info
                          ? info.grade > 0
                            ? `Grade ${info.grade} — ${info.sectionName}`
                            : groupGrade > 0 && groupGrade < 999
                              ? `Grade ${groupGrade} — ${info.sectionName}`
                              : info.sectionName
                          : key;

                      return (
                        <AccordionItem
                          key={key}
                          value={key}
                          className={isUnassigned ? "border-amber-400" : ""}
                        >
                          <AccordionTrigger
                            className={cn(
                              "items-center py-2.5 text-sm font-semibold transition-colors",
                              // isUnassigned
                              //   ? "bg-amber-50 hover:bg-accent hover:text-sidebar-accent-foreground"
                              //   : "bg-background hover:bg-accent hover:text-sidebar-accent-foreground"
                            )}
                          >
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                              <span
                                className={cn(
                                  "truncate flex-1 text-lg font-bold text-left",
                                  isUnassigned ? "text-amber-800" : ""
                                )}
                              >
                                {headerLabel}
                              </span>
                              <Badge
                                variant="secondary"
                                size="sm"
                                className="mr-2"
                              >
                                {groupUsers.length} student{groupUsers.length !== 1 ? "s" : ""}
                              </Badge>
                            </div>

                          </AccordionTrigger>

                          <AccordionContent className="p-0 border-t-2 border-border">
                            <Table className="border-none shadow-none" wrapperClassName="overflow-hidden">
                              <Table.Header className="font-sans">
                                <Table.Row>
                                  <Table.Head>Name</Table.Head>
                                  <Table.Head className="text-center w-36">Status</Table.Head>
                                  <Table.Head className="text-center w-64">
                                    {isUnassigned ? "Grade level" : "Section"}
                                  </Table.Head>
                                  <Table.Head className="text-right w-36">Average</Table.Head>
                                </Table.Row>
                              </Table.Header>
                              <Table.Body>
                                {groupUsers.map((user) => (
                                  <StudentRow
                                    key={user.id}
                                    user={user}
                                    showGrade={isUnassigned}
                                    onOpenUser={openUser}
                                  />
                                ))}
                              </Table.Body>
                            </Table>
                          </AccordionContent>
                        </AccordionItem>
                      );
                    })}
                  </Accordion>
                </>
              )}

              {!loading && activeTab !== "student" && (
                <>
                  {displayUsers.length === 0 ? (
                    <div className="rounded-xl border border-black bg-background py-12 text-center text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
                      {emptyText}
                    </div>
                  ) : (
                    <div className="overflow-hidden border border-black bg-background shadow-[4px_5px_0_#000]">
                      <Table className="border-1 shadow-none">
                        <Table.Header className="font-sans">
                          <Table.Row>
                            <Table.Head>Name</Table.Head>
                            <Table.Head className="text-center w-36">Status</Table.Head>
                            {activeTab === "teacher" ? (
                              <>
                                <Table.Head className="text-center w-48">Subjects</Table.Head>
                                <Table.Head className="text-right w-28">Classes</Table.Head>
                              </>
                            ) : (
                              <Table.Head className="text-right w-36">Joined</Table.Head>
                            )}
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {displayUsers.map((user) => (
                            <UserRow
                              key={user.id}
                              user={user}
                              activeTab={activeTab}
                              onOpenUser={openUser}
                            />
                          ))}
                        </Table.Body>
                      </Table>
                    </div>
                  )}
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

const UNASSIGNED_KEY = "__unassigned__";



function StudentRow({
  user,
  showGrade,
  onOpenUser,
}: {
  user: User;
  showGrade: boolean;
  onOpenUser: (user: User) => void;
}) {
  const gradeLevel = getStudentGradeLevel(user);
  const sectionName = getSectionDisplayName(user.section);

  return (
    <Table.Row
      onClick={() => onOpenUser(user)}
      className="cursor-pointer"
    >
      <Table.Cell>
        <NameCell name={user.name} subtitle={user.email} role={user.role} />
      </Table.Cell>

      <Table.Cell className="text-center w-36">
        <StatusBadge status={user.account_status} />
      </Table.Cell>

      <Table.Cell className="text-center w-40">
        <div className="flex justify-center">
          {showGrade ? (
            gradeLevel ? (
              <Badge
                variant="outline"
                size="sm"
              >
                Grade {gradeLevel}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )
          ) : sectionName ? (
            <Badge
              variant="outline"
              size="sm"
            >
              {sectionName}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">No section</span>
          )}
        </div>
      </Table.Cell>

      <Table.Cell className="text-right w-28">
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
      </Table.Cell>
    </Table.Row>
  );
}

// ─── Teacher / Admin components (unchanged) ───────────────────────────────────

function StatusBadge({ status }: { status: string | undefined | null }) {
  const style = getStatusStyle(status);
  return (
    <Badge
      size="sm"
      variant={style.variant}
    >
      {style.label}
    </Badge>
  );
}

function UserRow({
  user,
  activeTab,
  onOpenUser,
}: {
  user: User;
  activeTab: TabId;
  onOpenUser: (user: User) => void;
}) {
  const { shown, extra } = visibleSubjects(user.subjects);

  if (activeTab === "teacher") {
    return (
      <Table.Row
        onClick={() => onOpenUser(user)}
        className="cursor-pointer"
      >
        <Table.Cell>
          <NameCell name={user.name} subtitle={user.email} role={user.role} />
        </Table.Cell>
        <Table.Cell className="text-center w-36">
          <StatusBadge status={user.account_status} />
        </Table.Cell>
        <Table.Cell className="text-center w-48">
          <div className="flex flex-wrap justify-center gap-1.5">
            {shown.length > 0 ? (
              shown.map((subject) => (
                <Badge
                  key={subject}
                  variant="outline"
                  size="sm"
                  className="bg-background text-[10px] font-medium"
                >
                  {subject}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No subjects</span>
            )}
            {extra > 0 && (
              <Badge
                variant="outline"
                size="sm"
                className="bg-background text-[10px] font-medium"
              >
                +{extra}
              </Badge>
            )}
          </div>
        </Table.Cell>
        <Table.Cell className="text-right w-28">
          <div className="flex items-center justify-end gap-1 text-xs font-semibold">
            <School className="size-3.5" />
            {user.class_count ?? 0}
          </div>
        </Table.Cell>
      </Table.Row>
    );
  }

  return (
    <Table.Row
      onClick={() => onOpenUser(user)}
      className="cursor-pointer"
    >
      <Table.Cell>
        <NameCell name={user.name} subtitle={user.email} role={user.role} />
      </Table.Cell>
      <Table.Cell className="text-center w-36">
        <StatusBadge status={user.account_status} />
      </Table.Cell>
      <Table.Cell className="text-right w-36">
        <div className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <UsersRound className="size-3.5" />
          {user.created_at || "—"}
        </div>
      </Table.Cell>
    </Table.Row>
  );
}

function NameCell({
  name,
  subtitle,
  role,
}: {
  name: string;
  subtitle?: string;
  role: "admin" | "teacher" | "student";
}) {
  const defaultAvatar =
    role === "student"
      ? "/avatars/student-avatars/1.svg"
      : "/avatars/teacher-avatars/12.svg";

  return (
    <div className="flex min-w-0 max-w-72 items-center gap-3">
      <Avatar
        variant={role === "student" ? "student" : "teacher"}
        className="size-10 shrink-0"
      >
        <Avatar.Image src={defaultAvatar} alt={name} />
        <Avatar.Fallback>{name.charAt(0).toUpperCase()}</Avatar.Fallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{name}</div>
        {subtitle && (
          <div className="truncate text-xs text-muted-foreground">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
