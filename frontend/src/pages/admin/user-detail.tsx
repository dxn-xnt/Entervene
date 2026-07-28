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
import { OverviewCard } from "@/components/overview-cards";
import { UserProfileHeader } from "@/components/profile-header";
import {
  archiveUser,
  getUserAnalytics,
  getUserDetail,
  updateUser,
  type UpdateUserPayload,
  type UserAnalytics,
  type UserDetail,
  type UserRole,
} from "../../lib/api";
import { mergeAnalytics } from "../../mocks/userAnalytics";
import { Archive, Pencil } from "lucide-react";
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
  const actionDisabledReason = isPending
    ? "Pending accounts cannot be edited or archived until the invitation is accepted."
    : undefined;

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update user.");
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to archive user.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">

            {/* Breadcrumb Header with Context Actions */}
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <Breadcrumb>
                  <Breadcrumb.List className="text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black flex items-center gap-2">
                    <Breadcrumb.Item>
                      <Breadcrumb.Link
                        href="/admin/users"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/admin/users");
                        }}
                        className="text-muted-foreground"
                      >
                        User Management
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Link
                        href="/admin/users"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate("/admin/users");
                        }}
                        className="text-xl text-muted-foreground font-semibold capitalize"
                      >
                        {effectiveRole}
                      </Breadcrumb.Link>
                    </Breadcrumb.Item>
                    {user && (
                      <>
                        <Breadcrumb.Separator />
                        <Breadcrumb.Item>
                          <Breadcrumb.Page className="text-black font-extrabold">
                            {user.name}
                          </Breadcrumb.Page>
                        </Breadcrumb.Item>
                      </>
                    )}
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              {user && (
                <div className="flex items-center gap-2">
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
            <div className="-mx-4 md:-mx-6 border-b-2 border-border -mt-[1px]" />

            {/* {loading && (
              <Card className="flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
                <Loader size="sm" />
                Loading user details
              </Card>
            )} */}

            {!loading && error && (
              <Alert status="error" className="mb-4">
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}

            {!loading && notice && (
              <Alert status="success" className="mb-4">
                <Alert.Description>{notice}</Alert.Description>
              </Alert>
            )}

            {!loading && user && (
              <div className="space-y-3">
                <UserProfileHeader
                  name={user.name}
                  subtitle={
                    user.role === "student"
                      ? [user.grade_level ? `Grade ${user.grade_level}` : null, sectionName(user.section) ?? "No section assigned"].filter(Boolean).join(" - ")
                      : user.email
                  }
                  extra={user.role === "student" ? user.email : undefined}
                  avatarVariant={user.role === "student" ? "student" : user.role === "teacher" ? "teacher" : "default"}
                  statusLabel={getStatusStyle(user.account_status).label}
                  statusVariant={getStatusStyle(user.account_status).variant}
                  isPending={(user.account_status || "").toLowerCase() === "pending"}
                />

                {effectiveRole === "student" && <StudentAnalytics user={user} data={data} />}
                {effectiveRole === "teacher" && <TeacherAnalytics user={user} data={data} />}
                {effectiveRole === "admin" && <AdminAnalytics data={data} />}
              </div>
            )}
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
    });
  }

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content size="xl" className="border-2 border-black shadow-[6px_7px_0_#000] p-0 overflow-hidden">
        <Dialog.Header className="px-5 py-4 border-b border-black/30 bg-background text-foreground flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Edit User</h2>
            <p className="text-xs text-muted-foreground">Update profile information only. Role changes are handled separately.</p>
          </div>
        </Dialog.Header>

        <form onSubmit={submit}>
          <div className="grid max-h-[70vh] gap-3 overflow-y-auto px-5 py-4">
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
                <Select.Trigger className="w-full bg-background border-2 border-black">
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
              <div className="grid gap-3 md:grid-cols-2">
                <EditField label="Current Year Level">
                  <Select
                    value={form.grade_level !== null && form.grade_level !== undefined ? String(form.grade_level) : ""}
                    onValueChange={(val) => setField("grade_level", val ? Number(val) : null)}
                  >
                    <Select.Trigger className="w-full bg-background border-2 border-black">
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
                  <Input
                    value={form.employment_status || ""}
                    onChange={(event) => setField("employment_status", event.target.value)}
                    className="w-full"
                  />
                </EditField>
              </>
            )}

            {(isTeacher || isStudent) && (
              <EditField label="Address">
                <textarea
                  rows={3}
                  className="w-full rounded border-2 border-black bg-background px-4 py-2 text-sm text-foreground shadow-md transition focus:outline-hidden focus:shadow-xs resize-none"
                  value={form.address || ""}
                  onChange={(event) => setField("address", event.target.value)}
                />
              </EditField>
            )}
          </div>

          <Dialog.Footer className="flex justify-end gap-2 border-t border-black/30 px-5 py-4">
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
    <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
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
    <Card className="p-4 shadow-[4px_5px_0_#000] w-full">
      <Card.Header className="p-0 mb-3">
        <Card.Title className="text-lg font-bold leading-tight mb-0">{title}</Card.Title>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </Card.Header>
      <Card.Content className="p-0">{children}</Card.Content>
    </Card>
  );
}

function SubjectBars({ rows }: { rows: Array<Record<string, number | string>> }) {
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
  return (
    <div className="h-36">
      <ResponsiveContainer width="100%" height="100%">
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

function TeacherAnalytics({ user, data }: { user: UserDetail; data: ReturnType<typeof mergeAnalytics> }) {
  const summary = data.summary;
  return (
    <>
      <div className="grid gap-3 md:grid-cols-3">
        <OverviewCard
          title="Class Handled"
          count={String(user.class_count ?? valueNumber(summary.classesHandled))}
          stat="2+"
          statDescription="increased from previous academic year"
        />
        <OverviewCard
          title="Subjects Handled"
          count={String(user.subjects?.length || valueNumber(summary.subjectsHandled))}
          stat="2+"
          statDescription="increased from previous academic year"
        />
        <OverviewCard
          title="Class Performance"
          count={`${valueNumber(summary.classPerformance)}%`}
          stat="8%"
          statDescription="increased from previous academic year"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Period Class Performance" subtitle="Average student score across all handled subjects">
          <SmallLineChart data={data.period_performance} xKey="period" />
        </Panel>
        <Panel title="Subject Breakdown" subtitle="Avg. score per subject handled">
          <SubjectBars rows={data.subject_breakdown} />
        </Panel>
      </div>
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <ActivityFeed rows={data.activity_feed} />
        <StudentSnapshot />
      </div>
    </>
  );
}

function StudentAnalytics({ data }: { user: UserDetail; data: ReturnType<typeof mergeAnalytics> }) {
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
          <div className="grid gap-3 md:grid-cols-3">
            <OverviewCard
              title="Written Works Average"
              count={String(displayMetric(summary.writtenWorksAverage))}
              statDescription="out of 100"
            />
            <OverviewCard
              title="Performance Average"
              count={String(displayMetric(summary.performanceAverage))}
              statDescription="out of 100"
            />
            <OverviewCard
              title="Completion Rate"
              count={
                typeof summary.completionRate === "number"
                  ? `${summary.completionRate}%`
                  : String(displayMetric(summary.completionRate))
              }
              statDescription="activities done"
            />
          </div>
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
      <div className="grid gap-3 md:grid-cols-3">
        <OverviewCard
          title="Classes Made"
          count={String(valueNumber(summary.classesMade))}
          stat="2+"
          statDescription="increased from previous academic year"
        />
        <OverviewCard
          title="Subject Loads Assigned"
          count={String(valueNumber(summary.subjectLoadsAssigned))}
          stat="2+"
          statDescription="increased from previous academic year"
        />
        <OverviewCard
          title="Subjects Added"
          count={String(valueNumber(summary.subjectsAdded))}
          stat="8%"
          statDescription="increased from previous academic year"
        />
      </div>
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
    <Card className="p-3 border border-black/60 shadow-none hover:shadow-none">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-2xl font-black">{String(value)}</div>
    </Card>
  );
}

function ActivityFeed({ rows }: { rows: Array<Record<string, string>> }) {
  return (
    <Panel title="Recent Activity" subtitle="Latest action logged">
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={`${row.title}-${index}`} className="border-b border-black/10 pb-2 last:border-0">
            <div className="text-xs font-bold">{row.title}</div>
            <div className="text-[10px] text-muted-foreground">{row.timestamp}</div>
          </div>
        ))}
      </div>
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
      <Table wrapperClassName="shadow-[4px_5px_0_#000] rounded-lg overflow-hidden border-2 border-black">
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

