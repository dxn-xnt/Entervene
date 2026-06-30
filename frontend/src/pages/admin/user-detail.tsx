import { Loader } from "../../components/retroui/Loader";
import AppLayout from "../../layouts/app-layout";
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
import { Archive, ChevronLeft, ChevronRight, Pencil } from "lucide-react";
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

type StatusStyle = { badge: string; dot: string; label: string };

const STATUS_BADGE_BASE =
  "inline-flex h-6 w-28 items-center justify-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold";
const COMMON_STATUS_OPTIONS = ["active", "pending", "inactive", "suspended", "archived"];
const STUDENT_STATUS_OPTIONS = ["active", "no section assigned", "graduated", "archived", "transferred", "dropped"];
const EDIT_INPUT_CLASS = "w-full rounded-md border border-black/40 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-black";

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

function statusLabel(user: UserDetail) {
  return user.account_status ? user.account_status.charAt(0).toUpperCase() + user.account_status.slice(1) : "Unknown";
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

    Promise.all([getUserDetail(userId), getUserAnalytics(userId)])
      .then(([detail, metrics]) => {
        if (!active) return;
        setUser(detail);
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
  }, [userId]);

  const effectiveRole = user?.role ?? role ?? "student";
  const data = useMemo(() => mergeAnalytics(effectiveRole, analytics), [effectiveRole, analytics]);

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
      <div className="flex flex-1 flex-col px-4 py-4 md:px-6">
        <div className="mb-4 flex items-center gap-2 border-b border-black/30 pb-3">
          <button
            onClick={() => navigate("/admin/users")}
            className="grid size-7 place-items-center rounded-md hover:bg-muted"
            aria-label="Back to users"
          >
            <ChevronLeft className="size-4" />
          </button>
          <h1 className="text-2xl font-bold">User Management</h1>
          <ChevronRight className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold capitalize">{effectiveRole}</span>
          {user && (
            <>
              <ChevronRight className="size-4 text-muted-foreground" />
              <span className="truncate text-sm font-semibold">{user.name}</span>
            </>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-3 rounded-xl border border-black bg-background py-12 text-sm text-muted-foreground shadow-[4px_5px_0_#000]">
            <Loader size="sm" />
            Loading user details
          </div>
        )}

        {!loading && error && (
          <div className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && notice && (
          <div className="rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        )}

        {!loading && user && (
          <div className="space-y-3">
            <button
              onClick={() => navigate("/admin/users")}
              className="flex items-center gap-1 text-lg font-bold hover:underline"
            >
              <ChevronLeft className="size-4" />
              {effectiveRole === "teacher" ? "Teachers" : effectiveRole === "student" ? "Students" : "Admins"}
            </button>

            <ProfileHeader user={user} onEdit={() => setEditOpen(true)} onArchive={() => setArchiveOpen(true)} />

            {effectiveRole === "student" && <StudentAnalytics user={user} data={data} />}
            {effectiveRole === "teacher" && <TeacherAnalytics user={user} data={data} />}
            {effectiveRole === "admin" && <AdminAnalytics data={data} />}
          </div>
        )}
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

function ProfileHeader({ user, onEdit, onArchive }: { user: UserDetail; onEdit: () => void; onArchive: () => void }) {
  const section = sectionName(user.section);
  const status = getStatusStyle(user.account_status);
  const isPending = (user.account_status || "").toLowerCase() === "pending";
  const isArchived = (user.account_status || "").toLowerCase() === "archived";
  const actionDisabledReason = isPending
    ? "Pending accounts cannot be edited or archived until the invitation is accepted."
    : undefined;
  const subtitle =
    user.role === "student"
      ? [user.grade_level ? `Grade ${user.grade_level}` : null, section ?? "No section assigned"].filter(Boolean).join(" - ")
      : user.email;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-black bg-background px-4 py-3 shadow-[4px_5px_0_#000]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-full border border-amber-700 bg-amber-200 text-lg font-bold text-amber-900">
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <div className="truncate text-lg font-bold">{user.name}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
          {user.role === "student" && <div className="truncate text-xs text-muted-foreground">{user.email}</div>}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <div className="flex items-center gap-2">
          <span className={`${STATUS_BADGE_BASE} ${status.badge}`}>
            <span className={`size-1.5 rounded-full ${status.dot}`} />
            {statusLabel(user)}
          </span>
          <button
            type="button"
            onClick={onEdit}
            disabled={isPending || isArchived}
            title={actionDisabledReason}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-black bg-background px-3 text-xs font-semibold transition hover:bg-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
          <button
            type="button"
            onClick={onArchive}
            disabled={isPending || isArchived}
            title={actionDisabledReason}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Archive className="size-3.5" />
            Archive
          </button>
        </div>
        {isPending && (
          <div className="max-w-[360px] text-right text-[10px] font-medium leading-snug text-muted-foreground">
            Pending accounts can be managed after the invitation is accepted.
          </div>
        )}
      </div>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" onClick={onClose}>
      <form
        onSubmit={submit}
        className="w-full max-w-xl rounded-xl border-2 border-black bg-background shadow-[6px_7px_0_#000]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-black/30 px-5 py-4">
          <h2 className="text-lg font-bold">Edit User</h2>
          <p className="text-xs text-muted-foreground">Update profile information only. Role changes are handled separately.</p>
        </div>

        <div className="grid max-h-[70vh] gap-3 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 md:grid-cols-3">
            <EditField label="First Name">
              <input className={EDIT_INPUT_CLASS} value={form.first_name} onChange={(event) => setField("first_name", event.target.value)} required />
            </EditField>
            <EditField label="Middle Name">
              <input className={EDIT_INPUT_CLASS} value={form.middle_name || ""} onChange={(event) => setField("middle_name", event.target.value)} />
            </EditField>
            <EditField label="Last Name">
              <input className={EDIT_INPUT_CLASS} value={form.last_name} onChange={(event) => setField("last_name", event.target.value)} required />
            </EditField>
          </div>

          <EditField label="Email Address">
            <input
              type="email"
              className={EDIT_INPUT_CLASS}
              value={form.email}
              onChange={(event) => setField("email", event.target.value)}
              required
            />
          </EditField>

          <EditField label="Account Status">
            <select
              className={EDIT_INPUT_CLASS}
              value={form.account_status}
              onChange={(event) => setField("account_status", event.target.value)}
            >
              {statusOptionsForRole(user.role).map((status) => (
                <option key={status} value={status}>
                  {labelize(status)}
                </option>
              ))}
            </select>
          </EditField>

          {isStudent && (
            <div className="grid gap-3 md:grid-cols-2">
              <EditField label="Current Year Level">
                <select
                  className={EDIT_INPUT_CLASS}
                  value={form.grade_level ?? ""}
                  onChange={(event) => setField("grade_level", event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Select...</option>
                  {[7, 8, 9, 10, 11, 12].map((grade) => (
                    <option key={grade} value={grade}>
                      Grade {grade}
                    </option>
                  ))}
                </select>
              </EditField>
              <EditField label="Current Section">
                <input
                  className={EDIT_INPUT_CLASS}
                  value={form.section || ""}
                  placeholder="Optional"
                  onChange={(event) => setField("section", event.target.value)}
                />
              </EditField>
            </div>
          )}

          {isTeacher && (
            <>
              <EditField label="Contact Number">
                <input className={EDIT_INPUT_CLASS} value={form.contact_number || ""} onChange={(event) => setField("contact_number", event.target.value)} />
              </EditField>
              <EditField label="Employment Status">
                <input className={EDIT_INPUT_CLASS} value={form.employment_status || ""} onChange={(event) => setField("employment_status", event.target.value)} />
              </EditField>
            </>
          )}

          {(isTeacher || isStudent) && (
            <EditField label="Address">
              <textarea
                rows={3}
                className={`${EDIT_INPUT_CLASS} resize-none`}
                value={form.address || ""}
                onChange={(event) => setField("address", event.target.value)}
              />
            </EditField>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-black/30 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-md border border-black/30 px-4 py-2 text-sm font-semibold hover:bg-muted">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md border-2 border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[2px_2px_0_#000] disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl border-2 border-black bg-background p-5 shadow-[6px_7px_0_#000]"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-3 text-lg font-bold">Archive User</h2>
        <p className="text-sm">Are you sure you want to archive this account?</p>
        <p className="mt-3 text-sm text-muted-foreground">
          Archived users will no longer appear in the default active user list, but their records and analytics will be preserved.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-black/30 px-4 py-2 text-sm font-semibold hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            disabled={archiving}
            onClick={onConfirm}
            className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-60"
          >
            {archiving ? "Archiving..." : "Archive"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, suffix, note }: { label: string; value: number | string; suffix?: string; note?: string }) {
  return (
    <div className="rounded-lg border border-black bg-background p-4 shadow-[4px_5px_0_#000]">
      <div className="mb-2 text-sm font-bold">{label}</div>
      <div className="text-4xl font-black leading-none">
        {value}
        {suffix && <span className="text-lg">{suffix}</span>}
      </div>
      {note && <div className="mt-2 text-[10px] text-muted-foreground">{note}</div>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-black bg-background p-4 shadow-[4px_5px_0_#000]">
      <div className="mb-3">
        <h2 className="text-lg font-bold leading-tight">{title}</h2>
        {subtitle && <p className="text-[10px] text-muted-foreground">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function SubjectBars({ rows }: { rows: Array<Record<string, number | string>> }) {
  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const value = valueNumber(row.value);
        const color = value < 60 ? "bg-red-500" : value < 85 ? "bg-amber-400" : "bg-emerald-700";
        return (
          <div key={`${row.subject}-${index}`} className="grid grid-cols-[130px_minmax(0,1fr)_36px] items-center gap-2 text-xs">
            <span className="truncate">{row.subject}</span>
            <div className="h-2 overflow-hidden rounded-full border border-black/20 bg-muted">
              <div className={`h-full ${color}`} style={{ width: `${Math.max(4, Math.min(value, 100))}%` }} />
            </div>
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
        <MetricCard label="Class Handled" value={user.class_count ?? valueNumber(summary.classesHandled)} note="2+ increased from previous academic year" />
        <MetricCard label="Subjects Handled" value={user.subjects?.length || valueNumber(summary.subjectsHandled)} note="2+ increased from previous academic year" />
        <MetricCard label="Class Performance" value={valueNumber(summary.classPerformance)} suffix="%" note="8% increased from previous academic year" />
      </div>
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Panel title="Period Class Performance" subtitle="Average student score across all handled subjects">
          <SmallLineChart data={data.quarterly_performance} xKey="quarter" />
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
            <MetricCard label="Written Works Average" value={valueNumber(summary.writtenWorksAverage)} note="out of 100" />
            <MetricCard label="Performance Average" value={valueNumber(summary.performanceAverage)} note="out of 100" />
            <MetricCard label="Completion Rate" value={valueNumber(summary.completionRate)} suffix="%" note="activities done" />
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
            Weak Subjects: <span className="font-bold">Science and Filipino</span>
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
        <MetricCard label="Classes Made" value={valueNumber(summary.classesMade)} note="2+ increased from previous academic year" />
        <MetricCard label="Subject Loads Assigned" value={valueNumber(summary.subjectLoadsAssigned)} note="2+ increased from previous academic year" />
        <MetricCard label="Subjects Added" value={valueNumber(summary.subjectsAdded)} note="8% increased from previous academic year" />
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
    <div className="rounded border border-black/60 px-3 py-2">
      <div className="text-xs font-medium">{label}</div>
      <div className="text-2xl font-black">{String(value)}</div>
    </div>
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
      <div className="grid grid-cols-[1fr_1fr_40px] gap-2 border-b pb-1 text-[10px] text-muted-foreground">
        <span>Student</span>
        <span>Subject</span>
        <span className="text-right">Score</span>
      </div>
      {rows.map((row) => (
        <div key={row} className="grid grid-cols-[1fr_1fr_40px] gap-2 border-b border-black/10 py-1.5 text-xs">
          <span>John Doe</span>
          <span>Science 10</span>
          <span className="text-right">98%</span>
        </div>
      ))}
    </Panel>
  );
}

function ClassworkTable({ rows }: { rows: Array<Record<string, number | string | null>> }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-bold">Classwork</h2>
      <div className="overflow-hidden rounded-lg border border-black bg-background shadow-[4px_5px_0_#000]">
        <div className="grid grid-cols-[minmax(150px,1fr)_80px_160px_100px_80px] gap-2 border-b border-black/30 px-3 py-2 text-xs font-semibold">
          <span>Classwork Name</span>
          <span>Type</span>
          <span>Subject</span>
          <span>Status</span>
          <span className="text-right">Score</span>
        </div>
        {rows.map((row, index) => (
          <div key={`${row.name}-${index}`} className="grid grid-cols-[minmax(150px,1fr)_80px_160px_100px_80px] gap-2 border-b border-black/10 px-3 py-2 text-xs last:border-0">
            <span className="font-semibold">{row.name}</span>
            <span>{row.type}</span>
            <span className="font-semibold">{row.subject}</span>
            <span>{row.status}</span>
            <span className="text-right font-bold">{row.score}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
