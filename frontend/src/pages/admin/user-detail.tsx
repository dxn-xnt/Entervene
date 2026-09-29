import AppLayout from "../../layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import ConfirmAlertDialog from "@/components/retroui/ConfirmAlertDialog";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Progress } from "@/components/retroui/Progress";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { ToggleSwitch } from "@/components/retroui/ToggleSwitch";
import { OverviewCard } from "@/components/overview-cards";
import { useToast } from "@/components/retroui/use-toast";
import { UserProfileHeader } from "@/components/profile-header";
import {
  archiveUser,
  getUserAnalytics,
  getUserDetail,
  resendUserInvitation,
  updateUser,
  type TeacherHandledClass,
  type TeacherHandledSubject,
  type UpdateUserPayload,
  type UserAnalytics,
  type UserDetail,
  type UserRole,
} from "../../lib/api";
import { mergeAnalytics } from "../../mocks/userAnalytics";
import { Archive, BookOpen, Clock, GraduationCap, Layers, Pencil, RefreshCw, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function sectionName(section: string | null | undefined) {
  if (!section) return null;
  const match = section.match(/^\d+-(.+)$/);
  return match ? match[1] : section;
}

function valueNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

type StatusStyle = {
  label: string;
  variant: "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
};

const COMMON_STATUS_OPTIONS = ["active", "pending", "inactive", "suspended", "archived"];
const STUDENT_STATUS_OPTIONS = ["active", "no section assigned", "graduated", "archived", "transferred", "dropped"];

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

export default function AdminUserDetail() {
  const toast = useToast();
  const { userId, role } = useParams<{ userId: string; role: UserRole }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [analytics, setAnalytics] = useState<UserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    setLoading(true);
    setError(null);

    Promise.all([
      getUserDetail(userId).catch(() => null),
      getUserAnalytics(userId).catch(() => null),
    ])
      .then(([detail, metrics]) => {
        if (!active) return;
        if (detail) {
          setUser(detail);
        } else {
          setUser({
            id: userId,
            name: "Student",
            first_name: "Student",
            last_name: "",
            email: "student@school.edu.ph",
            role: (role as UserRole) || "student",
            account_status: "active",
            created_at: new Date().toISOString(),
          });
        }
        setAnalytics(metrics);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Unable to load user.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId, role]);

  const effectiveRole = user?.role ?? role ?? "student";
  const data = useMemo(() => mergeAnalytics(effectiveRole, analytics), [effectiveRole, analytics]);
  const isPending = (user?.account_status || "").toLowerCase() === "pending";
  const isArchived = (user?.account_status || "").toLowerCase() === "archived";
  const [resending, setResending] = useState(false);
  const statusStyle = getStatusStyle(user?.account_status);
  const actionDisabledReason = isPending
    ? "Pending accounts cannot be edited or archived until the invitation is accepted."
    : undefined;

  async function handleResendInvitation() {
    if (!userId) return;
    setResending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await resendUserInvitation(userId);
      setNotice(res.message || "Invitation resent successfully.");
      toast.success({ title: "Invitation resent" });
      const updated = await getUserDetail(userId);
      setUser(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resend invitation.");
      toast.error({ title: "Failed to resend invitation", description: err instanceof Error ? err.message : undefined });
    } finally {
      setResending(false);
    }
  }

  async function handleUpdate(payload: UpdateUserPayload) {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateUser(userId, payload);
      setUser(updated);
      setEditOpen(false);
      setNotice("User updated successfully.");
      toast.success({ title: "User updated" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user.");
      toast.error({ title: "Unable to update user", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleArchive() {
    if (!userId) return;
    setArchiving(true);
    setError(null);
    setNotice(null);
    try {
      await archiveUser(userId);
      const updated = await getUserDetail(userId);
      setUser(updated);
      setArchiveOpen(false);
      setNotice("User archived successfully.");
      toast.success({ title: "User archived" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive user.");
      toast.error({ title: "Unable to archive user", description: err instanceof Error ? err.message : undefined });
    } finally {
      setArchiving(false);
    }
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">

            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <Breadcrumb className="min-w-0 overflow-hidden">
                  <Breadcrumb.List className="flex-nowrap">
                    <Breadcrumb.Item>
                      <Breadcrumb.Link
                        href="/admin/users"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/admin/users");
                        }}
                      >
                        Users
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link
                        href={`/admin/users?tab=${effectiveRole}`}
                        onClick={(e) => {
                          e.preventDefault();
                          navigate(`/admin/users?tab=${effectiveRole}`);
                        }}
                        className="capitalize"
                      >
                        {effectiveRole}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    {user && (
                      <>
                        <Breadcrumb.Separator />
                        <Breadcrumb.Item>
                          <Breadcrumb.Page>
                            {user.name}
                          </Breadcrumb.Page>
                        </Breadcrumb.Item>
                      </>
                    )}
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              {user && (
                <div className="flex w-full flex-wrap items-center gap-2 md:w-auto [&_button]:px-2 [&_button]:text-xs md:[&_button]:px-4 md:[&_button]:text-sm">
                  {isPending && (
                    <Button
                      type="button"
                      variant="default"
                      onClick={handleResendInvitation}
                      disabled={resending}
                      className="gap-2"
                      title="Send a new invitation email with an updated 48-hour activation link"
                    >
                      <RefreshCw className={cn("size-3.5", resending && "animate-spin")} />
                      Resend Invitation
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => setEditOpen(true)}
                    disabled={isPending || isArchived}
                    title={actionDisabledReason}
                    className="gap-2"
                  >
                    <Pencil className="size-3.5" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setArchiveOpen(true)}
                    disabled={isPending || isArchived}
                    title={actionDisabledReason}
                    className="gap-2"
                  >
                    <Archive className="size-3.5" />
                    Archive
                  </Button>
                </div>
              )}
            </header>

            <div className="border-t border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-3">

              {!loading && error && (
                <Alert status="error">
                  <Alert.Description>{error}</Alert.Description>
                </Alert>
              )}

              {!loading && notice && (
                <Alert status="success">
                  <Alert.Description>{notice}</Alert.Description>
                </Alert>
              )}

              {!loading && user && isPending && user.email_status === "failed" && (
                <Alert status="error" className="border-2 border-red-500 bg-red-50 text-red-900">
                  <Alert.Description className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span>
                      <strong>Invitation Email Failed:</strong> The invitation email could not be delivered to <strong>{user.email}</strong>.
                    </span>
                    <Button
                      size="sm"
                      variant="default"
                      className="bg-red-600 hover:bg-red-700 text-white shrink-0 shadow-none"
                      onClick={handleResendInvitation}
                      disabled={resending}
                    >
                      Resend Invitation
                    </Button>
                  </Alert.Description>
                </Alert>
              )}

              {!loading && user && (
                <div className="space-y-3">
                  <UserProfileHeader
                    name={user.name}
                    role={user.role}
                    subtitle={
                      user.role === "student"
                        ? [user.grade_level ? `Grade ${user.grade_level}` : null, sectionName(user.section) ?? "No section assigned"].filter(Boolean).join(" - ")
                        : user.email
                    }
                    extra={user.role === "student" ? user.email : undefined}
                    avatarVariant={user.role === "student" ? "student" : user.role === "teacher" ? "teacher" : "default"}
                    statusLabel={statusStyle.label}
                    statusVariant={statusStyle.variant}
                    isPending={isPending}
                  />
                  {effectiveRole === "student" && <StudentAnalytics data={data} />}
                  {effectiveRole === "teacher" && <TeacherAnalytics user={user} data={data} />}
                  {effectiveRole === "admin" && <AdminAnalytics data={data} />}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {user && editOpen && (
        <EditUserModal
          user={user}
          saving={saving}
          onClose={() => setEditOpen(false)}
          onSubmit={handleUpdate}
        />
      )}

      {user && archiveOpen && (
        <ArchiveUserDialog
          archiving={archiving}
          onCancel={() => setArchiveOpen(false)}
          onConfirm={handleArchive}
        />
      )}
    </AppLayout>
  );
}


function initialEditForm(user: UserDetail): UpdateUserPayload {
  const nameParts = user.name.split(" ");
  return {
    first_name: user.first_name || nameParts[0] || "",
    middle_name: user.middle_name || "",
    last_name: user.last_name || nameParts.slice(1).join(" ") || "",
    email: user.email,
    account_status: user.account_status || "active",
    contact_number: user.contact_number || "",
    address: user.address || "",
    employment_status: user.employment_status || "",
    grade_level: user.grade_level ?? null,
    section: sectionName(user.section) || "",
    prior_gwa: user.prior_gwa ?? null,
  };
}

function statusOptionsForRole(role: UserRole) {
  return role === "student" ? STUDENT_STATUS_OPTIONS : COMMON_STATUS_OPTIONS;
}

function labelize(value: string) {
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function EditUserModal({
  user,
  saving,
  onClose,
  onSubmit,
}: {
  user: UserDetail;
  saving: boolean;
  onClose: () => void;
  onSubmit: (payload: UpdateUserPayload) => void;
}) {
  const [form, setForm] = useState<UpdateUserPayload>(() => initialEditForm(user));
  const isStudent = user.role === "student";
  const isTeacher = user.role === "teacher";

  function setField<K extends keyof UpdateUserPayload>(field: K, value: UpdateUserPayload[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({
      ...form,
      first_name: form.first_name.trim(),
      middle_name: form.middle_name?.trim() || "",
      last_name: form.last_name.trim(),
      email: form.email.trim().toLowerCase(),
      contact_number: form.contact_number?.trim() || "",
      address: form.address?.trim() || "",
      employment_status: form.employment_status?.trim() || "",
      section: form.section?.trim() || null,
      prior_gwa: form.prior_gwa !== undefined && form.prior_gwa !== null && String(form.prior_gwa).trim() !== "" ? Number(form.prior_gwa) : null,
    });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size="2xl">
        <Dialog.Header position="static">
          <div>
            <h2 className="font-sans text-xl font-bold">Edit User</h2>
            <p className="text-sm font-normal">Update profile information only. Role changes are handled separately.</p>
          </div>
        </Dialog.Header>

        <form onSubmit={submit}>
          <section className="grid gap-4 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <EditField label="First Name">
                <Input
                  value={form.first_name}
                  onChange={(event) => setField("first_name", event.target.value)}
                  required
                  className="w-full"
                />
              </EditField>
              <EditField label="Middle Name">
                <Input
                  value={form.middle_name || ""}
                  onChange={(event) => setField("middle_name", event.target.value)}
                  className="w-full"
                />
              </EditField>
              <EditField label="Last Name">
                <Input
                  value={form.last_name}
                  onChange={(event) => setField("last_name", event.target.value)}
                  required
                  className="w-full"
                />
              </EditField>
            </div>

            <EditField label="Email Address">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setField("email", event.target.value)}
                required
                className="w-full"
              />
            </EditField>

            <EditField label="Account Status">
              <Select
                value={form.account_status}
                onValueChange={(val) => setField("account_status", val)}
              >
                <Select.Trigger className="w-full min-w-0">
                  <Select.Value placeholder="Select status" />
                </Select.Trigger>
                <Select.Content>
                  {statusOptionsForRole(user.role).map((status) => (
                    <Select.Item key={status} value={status}>
                      {labelize(status)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
            </EditField>

            {isStudent && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <EditField label="Current Year Level">
                    <Select
                      value={form.grade_level !== null && form.grade_level !== undefined ? String(form.grade_level) : ""}
                      onValueChange={(val) => setField("grade_level", val ? Number(val) : null)}
                    >
                      <Select.Trigger className="w-full min-w-0">
                        <Select.Value placeholder="Select..." />
                      </Select.Trigger>
                      <Select.Content>
                        {[7, 8, 9, 10, 11, 12].map((grade) => (
                          <Select.Item key={grade} value={String(grade)}>
                            Grade {grade}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </EditField>
                  <EditField label="Current Section">
                    <Input
                      value={form.section || ""}
                      placeholder="Optional"
                      onChange={(event) => setField("section", event.target.value)}
                      className="w-full"
                    />
                  </EditField>
                </div>
                <EditField label="General Average (Prior GWA)">
                  <Input
                    type="number"
                    step="0.01"
                    min="60"
                    max="100"
                    value={form.prior_gwa !== null && form.prior_gwa !== undefined ? String(form.prior_gwa) : ""}
                    placeholder="e.g. 88.50 (Optional)"
                    onChange={(event) => {
                      const val = event.target.value;
                      setField("prior_gwa", val === "" ? null : Number(val));
                    }}
                    className={`w-full ${user.has_computed_gwa ? "opacity-60 bg-muted/30" : ""}`}
                  />
                  {user.has_computed_gwa && (
                    <p className="mt-1 text-[11px] text-muted-foreground font-semibold">
                      Fallback only — this student has a computed average from prior year grades. The computed value is used for sectioning.
                    </p>
                  )}
                </EditField>
              </>
            )}

            {isTeacher && (
              <>
                <EditField label="Contact Number">
                  <Input
                    value={form.contact_number || ""}
                    onChange={(event) => setField("contact_number", event.target.value)}
                    className="w-full"
                  />
                </EditField>
                <EditField label="Employment Status">
                  <Select
                    value={form.employment_status || ""}
                    onValueChange={(val) => setField("employment_status", val)}
                  >
                    <Select.Trigger className="w-full min-w-0">
                      <Select.Value placeholder="Select status" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="Regular/Permanent">Regular/Permanent</Select.Item>
                      <Select.Item value="Substitute">Substitute</Select.Item>
                      <Select.Item value="Probationary">Probationary</Select.Item>
                    </Select.Content>
                  </Select>
                </EditField>
              </>
            )}

            {(isTeacher || isStudent) && (
              <EditField label="Address">
                <textarea
                  rows={3}
                  className="w-full resize-none rounded border-2 border-border bg-background px-4 py-2 text-sm text-foreground shadow-md transition focus:outline-hidden focus:shadow-xs"
                  value={form.address || ""}
                  onChange={(event) => setField("address", event.target.value)}
                />
              </EditField>
            )}
          </section>

          <Dialog.Footer position="static">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}

function EditField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

function ArchiveUserDialog({
  archiving,
  onCancel,
  onConfirm,
}: {
  archiving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmAlertDialog
      title="Archive User"
      description="Are you sure you want to archive this account? Archived users will no longer appear in the default active user list, but their records and analytics will be preserved."
      confirmLabel={archiving ? "Archiving..." : "Archive"}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card className="w-full p-4">
      <Card.Header className="p-0 mb-3">
        <Card.Title className="text-lg font-bold leading-tight mb-0">{title}</Card.Title>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </Card.Header>
      <Card.Content className="p-0">{children}</Card.Content>
    </Card>
  );
}

function SubjectBars({ rows }: { rows: Array<Record<string, number | string>> }) {
  if (!rows || rows.length === 0) {
    return <p className="py-4 text-center text-xs text-muted-foreground">No subject performance records available.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const value = valueNumber(row.value);
        return (
          <div key={`${row.subject}-${index}`} className="grid grid-cols-[130px_minmax(0,1fr)_36px] items-center gap-2 text-xs">
            <span className="truncate">{row.subject}</span>
            <Progress value={Math.max(4, Math.min(value, 100))} className="h-2" />
            <span className="text-right font-semibold">{value}%</span>
          </div>
        );
      })}
    </div>
  );
}

function SmallLineChart({ data, xKey }: { data: Array<Record<string, number | string>>; xKey: string }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-36 items-center justify-center text-xs text-muted-foreground">
        No period performance data recorded yet.
      </div>
    );
  }
  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
        <LineChart data={data}>
          <CartesianGrid stroke="#e5e1d8" vertical={false} />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis hide domain={[0, 100]} />
          <Tooltip />
          <Line type="monotone" dataKey="score" stroke="#dc2626" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

type OverviewMetric = {
  title: string;
  count: string;
  stat?: string;
  statDescription?: string;
  trend?: "up" | "down";
};

function OverviewGrid({ metrics }: { metrics: OverviewMetric[] }) {
  const colClass =
    metrics.length === 2
      ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-2"
      : metrics.length === 1
        ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-1"
        : "grid gap-3 md:grid-cols-2";

  return (
    <div className={colClass}>
      {metrics.map((metric) => (
        <OverviewCard key={metric.title} {...metric} />
      ))}
    </div>
  );
}

function TeacherHandledSideCard({
  handledSubjects = [],
  handledClasses = [],
  className,
}: {
  handledSubjects?: TeacherHandledSubject[];
  handledClasses?: TeacherHandledClass[];
  className?: string;
}) {
  const [activeTab, setActiveTab] = useState<"subjects" | "classes">("subjects");
  const [search, setSearch] = useState("");

  const filteredSubjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return handledSubjects;
    return handledSubjects.filter(
      (s) =>
        s.subject_name.toLowerCase().includes(q) ||
        (s.subject_code && s.subject_code.toLowerCase().includes(q)) ||
        s.sections?.some((sec) => sec.toLowerCase().includes(q)) ||
        s.grade_levels?.some((gl) => gl.toLowerCase().includes(q))
    );
  }, [handledSubjects, search]);

  const filteredClasses = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return handledClasses;
    return handledClasses.filter(
      (c) =>
        c.section_name.toLowerCase().includes(q) ||
        (c.grade_level && String(c.grade_level).includes(q)) ||
        c.subjects?.some((sub) => sub.toLowerCase().includes(q))
    );
  }, [handledClasses, search]);

  return (
    <Card className={cn("flex flex-col h-full p-4 bg-background", className)}>
      <Card.Header className="p-0">
        {/* Switch / Toggle header */}
        <ToggleSwitch
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as "subjects" | "classes")}
          size="sm"
        >
          <ToggleSwitch.Item value="subjects">
            <BookOpen className="size-3.5 shrink-0" />
            <span>Subjects</span>
          </ToggleSwitch.Item>
          <ToggleSwitch.Item value="classes">
            <GraduationCap className="size-3.5 shrink-0" />
            <span>Classes</span>
          </ToggleSwitch.Item>
        </ToggleSwitch>
      </Card.Header>

      {/* Card Content Area */}
      <Card.Content className="p-0 flex flex-col overflow-y-auto gap-2">
        {activeTab === "subjects" ? (
          filteredSubjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground px-4">
              <BookOpen className="size-8 opacity-30 mb-2" />
              <p className="text-xs font-semibold">No subjects assigned</p>
              <p className="text-[11px] opacity-75 mt-0.5">No subject loads are currently mapped to this teacher.</p>
            </div>
          ) : (
            filteredSubjects.map((subject) => (
              <Card
                variant="squares"
                key={subject.subject_id}
                className="w-full flex flex-col shadow-none"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-bold text-md truncate leading-tight block" title={subject.subject_name}>
                      {subject.subject_name}
                    </h4>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {subject.is_core ? (
                      <Badge variant="secondary" size="sm" className="text-[10px]">
                        Core
                      </Badge>
                    ) : (
                      <Badge variant="secondary" size="sm" className="text-[10px]">
                        Applied
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between text-[12px] text-muted-foreground">
                  {subject.grade_levels && subject.grade_levels.length > 0 && (
                    <span className="font-semibold text-foreground">{subject.grade_levels.join(", ")}</span>
                  )}
                  {subject.weekly_hours !== undefined && subject.weekly_hours > 0 && (
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {subject.weekly_hours} hrs/wk
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <Layers className="size-3" />
                    {subject.class_count ?? subject.sections?.length ?? 0} {subject.class_count === 1 ? "class" : "classes"}
                  </span>
                </div>

                {subject.sections && subject.sections.length > 0 && (
                  <div className="flex flex-row gap-2 items-center align-center mt-1">
                    <div className="text-[11px] font-medium text-muted-foreground">Assigned Sections:</div>
                    <div className="flex flex-wrap gap-2">
                      {subject.sections.map((sec, idx) => (
                        <Badge
                          key={`${sec}-${idx}`}
                          variant="outline"
                          size="sm"
                          className="text-[10px] py-0.5 px-1.5 font-medium bg-white"
                        >
                          {sec}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))
          )
        ) : (
          filteredClasses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center text-muted-foreground px-4">
              <GraduationCap className="size-8 opacity-30 mb-2" />
              <p className="text-xs font-semibold">No classes assigned</p>
              <p className="text-[11px] opacity-75 mt-0.5">No class sections are currently handled by this teacher.</p>
            </div>
          ) : (
            filteredClasses.map((cls) => (
              <Card
                variant="squares"
                key={cls.class_id}
                className="w-full overflow-x-auto shadow-none"
              >
                <div className="flex flex-col items-start justify-between gap-2">
                  <div className="w-full flex-1 flex flex-row gap-2 items-center justify-between">
                    <h4 className="font-bold text-lg truncate leading-tight block" title={cls.section_name}>{cls.section_name}</h4>
                    {cls.is_adviser && (
                      <Badge variant="solid" size="sm" className="text-[11px] shrink-0">
                        Adviser
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-row justify-between w-full align-center items-center">
                    {cls.grade_level && (
                      <span className="text-[12px] font-semibold text-muted-foreground">
                        Grade {cls.grade_level}
                      </span>
                    )}
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Users className="size-3" />
                        {cls.student_count ?? 0} {cls.student_count === 1 ? "student" : "students"}
                      </span>
                    </div>
                  </div>
                </div>

                {cls.subjects && cls.subjects.length > 0 && (
                  <div className="flex flex-row gap-2 mt-2">
                    <div className="text-[10px] font-medium text-muted-foreground whitespace-nowrap mt-0.5">Subjects Taught:</div>
                    <div className="flex flex-wrap gap-2">
                      {cls.subjects.map((sub, idx) => (
                        <Badge
                          key={`${sub}-${idx}`}
                          variant="outline"
                          size="sm"
                          className="text-[10px] py-0.5 px-1.5 font-medium"
                        >
                          {sub}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            ))
          )
        )}
      </Card.Content>
    </Card>
  );
}

function TeacherAnalytics({ user, data }: { user: UserDetail; data: ReturnType<typeof mergeAnalytics> }) {
  const summary = data.summary;
  const rawHours = user.workload_hours ?? (summary.workloadHours !== undefined && summary.workloadHours !== null ? Number(summary.workloadHours) : null);
  const loadCount = user.load_count ?? (summary.loadCount !== undefined && summary.loadCount !== null ? Number(summary.loadCount) : user.class_count ?? valueNumber(summary.classesHandled, 0));
  const workloadDisplay = rawHours !== null && rawHours > 0 ? `${rawHours} hrs` : rawHours !== null ? "0 hrs" : `${loadCount} loads`;

  const classCount = user.class_count ?? (summary.classesHandled !== undefined && summary.classesHandled !== null ? Number(summary.classesHandled) : 0);
  const totalStudents = summary.totalStudents !== undefined && summary.totalStudents !== null ? Number(summary.totalStudents) : null;

  const subjectCount = user.subjects?.length || (summary.subjectsHandled !== undefined && summary.subjectsHandled !== null ? Number(summary.subjectsHandled) : 0);
  const subjectsList = user.subjects && user.subjects.length > 0 ? user.subjects : [];

  const rawPerf = summary.classPerformance;
  const hasPerf = rawPerf !== null && rawPerf !== undefined && rawPerf !== "N/A" && rawPerf !== "Unavailable";
  const numericPerf = hasPerf ? Number(rawPerf) : null;
  const perfDisplay = numericPerf !== null && !isNaN(numericPerf) ? `${Math.round(numericPerf)}%` : "N/A";

  const handledSubjects = user.handled_subjects ?? data.handled_subjects ?? [];
  const handledClasses = user.handled_classes ?? data.handled_classes ?? [];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px] items-stretch">
      {/* Left Column: Stat Cards & Analytics Panels */}
      <div className="flex flex-col gap-3 min-w-0">
        <OverviewGrid metrics={[

          {
            title: "Class Handled",
            count: String(classCount),
            stat: totalStudents !== null && totalStudents > 0 ? `${totalStudents} ${totalStudents === 1 ? "student" : "students"}` : undefined,
            statDescription: totalStudents !== null && totalStudents > 0 ? "total enrolled in assigned classes" : "assigned class sections",
          },
          {
            title: "Subjects Handled",
            count: String(subjectCount),
            stat: `+ ${String(subjectCount)}`,
            statDescription: subjectCount > 0 ? "subjects assigned" : "distinct subjects taught",
          },
          {
            title: "Class Performance",
            count: perfDisplay,
            stat: numericPerf !== null && !isNaN(numericPerf) ? (numericPerf >= 75 ? "Passing average" : "Needs support") : undefined,
            statDescription: numericPerf !== null && !isNaN(numericPerf) ? "score across classwork" : "no graded assessments yet",
          },
          {
            title: "Workload",
            count: workloadDisplay,
            stat: loadCount > 0 ? `${loadCount} ${loadCount === 1 ? "load" : "loads"}` : undefined,
            statDescription: "scheduled weekly teaching load",
          },
        ]} />

        <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
          <Panel title="Period Class Performance" subtitle="Average student score across all handled subjects">
            <SmallLineChart data={data.period_performance} xKey="period" />
          </Panel>
          <Panel title="Subject Breakdown" subtitle="Avg. score per subject handled">
            <SubjectBars rows={data.subject_breakdown} />
          </Panel>
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
          <StudentSnapshot />
        </div>
      </div>

      {/* Right Column: Full-height Side Card with Subjects / Classes Toggle */}
      <div className="flex flex-col h-full min-h-[480px]">
        <TeacherHandledSideCard
          handledSubjects={handledSubjects}
          handledClasses={handledClasses}
        />
      </div>
    </div>
  );
}

function StudentAnalytics({ data }: { data: ReturnType<typeof mergeAnalytics> }) {
  const summary = data.summary;
  const lms = data.lms_behavior;
  const weakSubjects = data.subject_mastery
    .filter((row) => valueNumber(row.value, 100) < 75)
    .map((row) => String(row.subject));
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-lg font-bold">Subject Overview</h2>
            <div className="text-right text-sm font-bold text-red-600">
              {summary.failureRisk}
              <div className="text-[10px] font-normal text-foreground">{summary.modelConfidence} model confidence</div>
            </div>
          </div>
          <OverviewGrid metrics={[
            { title: "Written Works Average", count: String(displayMetric(summary.writtenWorksAverage)), statDescription: "out of 100" },
            { title: "Performance Average", count: String(displayMetric(summary.performanceAverage)), statDescription: "out of 100" },
            {
              title: "Completion Rate",
              count: typeof summary.completionRate === "number" ? `${summary.completionRate}%` : String(displayMetric(summary.completionRate)),
              statDescription: "activities done",
            },
          ]} />
        </div>
        <Panel title="LMS Behavior">
          <div className="grid gap-2">
            <MiniStat label="Total logins" value={lms.totalLogins} />
            <MiniStat label="Avg session" value={lms.averageSession} />
            <MiniStat label="Missed activities" value={lms.missedActivities} />
            <MiniStat label="On time submissions" value={lms.onTimeSubmissions} />
          </div>
        </Panel>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Subject Mastery">
          <SubjectBars rows={data.subject_mastery} />
          <div className="mt-4 text-[10px]">
            Weak Subjects:{" "}
            <span className="font-bold">
              {weakSubjects.length ? weakSubjects.join(", ") : "No weak subject data available"}
            </span>
          </div>
        </Panel>
        <Panel title="Score Trend">
          <SmallLineChart data={data.score_trend} xKey="month" />
        </Panel>
      </div>
      <ClassworkTable rows={data.classwork} />
    </>
  );
}

function AdminAnalytics({ data }: { data: ReturnType<typeof mergeAnalytics> }) {
  const summary = data.summary;
  return (
    <>
      <OverviewGrid metrics={[
        { title: "Classes Made", count: String(valueNumber(summary.classesMade)), stat: "2+", statDescription: "increased from previous academic year" },
        { title: "Subject Loads Assigned", count: String(valueNumber(summary.subjectLoadsAssigned)), stat: "2+", statDescription: "increased from previous academic year" },
        { title: "Subjects Added", count: String(valueNumber(summary.subjectsAdded)), stat: "8%", statDescription: "increased from previous academic year" },
      ]} />
      <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr]">
        <Panel title="Subject Breakdown" subtitle="Avg. score per subject handled">
          <SubjectBars rows={data.subject_breakdown} />
        </Panel>
        <ActivityFeed rows={data.activity_feed} />
      </div>
    </>
  );
}

function MiniStat({ label, value }: { label: string; value: unknown }) {
  return (
    <Card className="border border-border p-3 shadow-none">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-black">{String(value)}</div>
    </Card>
  );
}

function ActivityFeed({ rows }: { rows: Array<Record<string, string>> }) {
  return (
    <Panel title="Recent Activity" subtitle="Latest action logged">
      {!rows || rows.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">No recent activity logged.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={`${row.title}-${index}`} className="border-b border-black/10 pb-2 last:border-0">
              <div className="text-xs font-bold">{row.title}</div>
              <div className="text-[10px] text-muted-foreground">{row.timestamp}</div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function StudentSnapshot() {
  const rows = Array.from({ length: 5 }, (_, index) => index);
  return (
    <Panel title="Student Performance Snapshot" subtitle="Top at-risk students across all sections">
      <Table wrapperClassName="border-0 shadow-none">
        <Table.Header className="bg-transparent text-muted-foreground border-b border-black/10 font-normal text-[10px]">
          <Table.Row className="hover:bg-transparent">
            <Table.Head className="h-6 px-0 text-[10px] font-normal text-muted-foreground">Student</Table.Head>
            <Table.Head className="h-6 px-0 text-[10px] font-normal text-muted-foreground">Subject</Table.Head>
            <Table.Head className="h-6 px-0 text-right text-[10px] font-normal text-muted-foreground">Score</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => (
            <Table.Row key={row} className="border-b border-black/10 hover:bg-transparent text-xs">
              <Table.Cell className="py-1.5 px-0">John Doe</Table.Cell>
              <Table.Cell className="py-1.5 px-0">Science 10</Table.Cell>
              <Table.Cell className="py-1.5 px-0 text-right font-semibold">98%</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table>
    </Panel>
  );
}

function ClassworkTable({ rows }: { rows: Array<Record<string, number | string | null>> }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-bold">Classwork</h2>
      <Table wrapperClassName="border-black">
        <Table.Header>
          <Table.Row>
            <Table.Head className="text-xs font-semibold">Classwork Name</Table.Head>
            <Table.Head className="text-xs font-semibold">Type</Table.Head>
            <Table.Head className="text-xs font-semibold">Subject</Table.Head>
            <Table.Head className="text-xs font-semibold">Status</Table.Head>
            <Table.Head className="text-right text-xs font-semibold">Score</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.length > 0 ? (
            rows.map((row, index) => (
              <Table.Row key={`${row.name}-${index}`}>
                <Table.Cell className="font-semibold text-xs">{row.name}</Table.Cell>
                <Table.Cell className="text-xs">{row.type}</Table.Cell>
                <Table.Cell className="font-semibold text-xs">{row.subject}</Table.Cell>
                <Table.Cell className="text-xs">
                  <Badge variant="outline" size="sm" className="text-[10px] py-0.5">
                    {row.status}
                  </Badge>
                </Table.Cell>
                <Table.Cell className="text-right font-bold text-xs">{row.score}</Table.Cell>
              </Table.Row>
            ))
          ) : (
            <Table.Row>
              <Table.Cell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                No classwork records are available yet.
              </Table.Cell>
            </Table.Row>
          )}
        </Table.Body>
      </Table>
    </section>
  );
}

function displayMetric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number(value.toFixed(2));
  }
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  return "Unavailable";
}

