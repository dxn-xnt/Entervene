import AddUserModal from "@/components/admin/AddUserModal";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import Tabs from "@/components/Tabs";
import AppLayout from "@/layouts/app-layout";
import { getUsers, type User, type UserRole } from "@/lib/api";
import {
  ArrowDownUp,
  BookOpen,
  Filter,
  GraduationCap,
  Plus,
  School,
  Search,
  UserCog,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type TabId = UserRole;

const tabs: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "admin", label: "Admin", icon: <UserCog className="size-3.5" /> },
  { id: "teacher", label: "Teachers", icon: <BookOpen className="size-3.5" /> },
  { id: "student", label: "Students", icon: <GraduationCap className="size-3.5" /> },
];

function visibleSubjects(subjects: string[] | undefined) {
  return {
    shown: subjects?.slice(0, 2) ?? [],
    extra: Math.max((subjects?.length ?? 0) - 2, 0),
  };
}

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<TabId>("teacher");
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getUsers({
        role: activeTab,
        search: debouncedSearch,
      });
      setUsers(data);
    } catch (err) {
      setUsers([]);
      setError(err instanceof Error ? err.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedSearch]);

  const emptyText = useMemo(() => {
    if (activeTab === "teacher") return "No teachers found";
    if (activeTab === "student") return "No students found";
    return "No admins found";
  }, [activeTab]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 py-4 md:py-5">
            <div className="flex items-center justify-between px-4 md:px-6">
              <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
              <button
                onClick={() => setModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
              >
                <Plus className="size-4" />
                New User
              </button>
            </div>

            <div className="border-b border-black/40 px-4 md:px-6">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as TabId)} />
            </div>

            <div className="flex flex-col gap-3 px-4 md:px-6">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative max-w-md flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search users"
                    className="h-9 rounded-md border border-black/70 pl-9 shadow-none"
                    placeholder="Search user"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
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

              {error && (
                <div className="rounded border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-black bg-background shadow-[4px_5px_0_#000]">
                {loading && (
                  <div className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground">
                    <Loader size="sm" />
                    Loading users
                  </div>
                )}

                {!loading && users.length === 0 && (
                  <div className="py-12 text-center text-sm text-muted-foreground">{emptyText}</div>
                )}

                {!loading &&
                  users.map((user) => (
                    <UserRow key={user.id} user={user} activeTab={activeTab} />
                  ))}
              </div>
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

function UserRow({ user, activeTab }: { user: User; activeTab: TabId }) {
  const { shown, extra } = visibleSubjects(user.subjects);

  return (
    <div className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-black/50 px-3 py-2 last:border-b-0 md:grid-cols-[minmax(220px,1fr)_minmax(180px,1fr)_110px]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-7 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-[13px]">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{user.name}</div>
          {activeTab === "admin" && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
        </div>
      </div>

      {activeTab === "teacher" && (
        <>
          <div className="hidden flex-wrap justify-center gap-2 md:flex">
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
                {extra}+
              </Badge>
            )}
          </div>
          <div className="flex items-center justify-end gap-1 text-xs font-semibold">
            <School className="size-3.5" />
            Classes: {user.class_count ?? 0}
          </div>
        </>
      )}

      {activeTab === "student" && (
        <>
          <div className="hidden justify-center md:flex">
            <Badge variant="outline" size="sm" className="bg-background text-[10px] font-medium">
              {user.section ?? "No section"}
            </Badge>
          </div>
          <div className="text-right text-xl font-black leading-none">
            {user.average ?? "-"}
            {user.average != null && <span className="text-sm font-semibold">%</span>}
          </div>
        </>
      )}

      {activeTab === "admin" && (
        <>
          <div className="hidden text-sm text-muted-foreground md:block">{user.created_at || "No date"}</div>
          <div className="flex justify-end">
            <UsersRound className="size-4 text-muted-foreground" />
          </div>
        </>
      )}
    </div>
  );
}
