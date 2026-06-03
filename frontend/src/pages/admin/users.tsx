import AddUserModal from "@/components/admin/AddUserModal";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Table } from "@/components/retroui/Table";
import Tabs from "@/components/Tabs";
import AppLayout from "@/layouts/app-layout";
import { getUsers, type User, type UserRole } from "@/lib/api";
import { useCallback, useEffect, useMemo, useState } from "react";

type TabId = "all" | UserRole;

const tabs: { id: TabId; label: string }[] = [
  { id: "all", label: "All Users" },
  { id: "admin", label: "Admin" },
  { id: "teacher", label: "Teachers" },
  { id: "student", label: "Students" },
];

const roleLabels: Record<UserRole, string> = {
  admin: "Admin",
  teacher: "Teacher",
  student: "Student",
};

const roleClasses: Record<UserRole, string> = {
  admin: "bg-rose-100 text-rose-800 outline-rose-300",
  teacher: "bg-sky-100 text-sky-800 outline-sky-300",
  student: "bg-emerald-100 text-emerald-800 outline-emerald-300",
};

function formatCreatedDate(value: string) {
  if (!value) return "Unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function AdminUsers() {
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedRole = useMemo(
    () => (activeTab === "all" ? undefined : activeTab),
    [activeTab],
  );

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await getUsers({
        role: selectedRole,
        search: debouncedSearch,
      });
      setUsers(data);
    } catch (err) {
      setUsers([]);
      setError(err instanceof Error ? err.message : "Unable to load users.");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, selectedRole]);

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
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <div className="flex flex-col gap-3 px-2 md:flex-row md:items-center md:justify-between">
              <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
              <button
                onClick={() => setModalOpen(true)}
                className="flex w-fit items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
                style={{ background: "#5c8f5c" }}
              >
                <span aria-hidden="true" className="text-lg leading-none">
                  +
                </span>
                New User
              </button>
            </div>

            <div className="flex flex-col gap-4 px-2">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={(id) => setActiveTab(id as TabId)} />

              <div className="max-w-md">
                <Input
                  aria-label="Search users"
                  placeholder="Search by name or email"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="mx-2 rounded border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="px-2">
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>Name</Table.Head>
                    <Table.Head>Email</Table.Head>
                    <Table.Head>Role</Table.Head>
                    <Table.Head>Date Created</Table.Head>
                    <Table.Head className="text-right">Actions</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {loading && (
                    <Table.Row>
                      <Table.Cell colSpan={5}>
                        <div className="flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground">
                          <Loader size="sm" />
                          Loading users
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  )}

                  {!loading && users.length === 0 && (
                    <Table.Row>
                      <Table.Cell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                        No users found
                      </Table.Cell>
                    </Table.Row>
                  )}

                  {!loading &&
                    users.map((user) => (
                      <Table.Row key={user.id}>
                        <Table.Cell className="font-medium">{user.name}</Table.Cell>
                        <Table.Cell>{user.email}</Table.Cell>
                        <Table.Cell>
                          <Badge variant="outline" size="sm" className={roleClasses[user.role]}>
                            {roleLabels[user.role]}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>{formatCreatedDate(user.created_at)}</Table.Cell>
                        <Table.Cell className="text-right text-sm text-muted-foreground">
                          -
                        </Table.Cell>
                      </Table.Row>
                    ))}
                </Table.Body>
              </Table>
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
