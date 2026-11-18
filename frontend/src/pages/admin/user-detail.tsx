import AppLayout from "../../layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { AdminBreadcrumb as Breadcrumb } from "@/components/admin/admin-breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { FormMessage, NoChangesMessage } from "@/components/retroui/FormMessage";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { optionalNumber } from "@/lib/form-changes";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Select } from "@/components/retroui/Select";
import { ToggleSwitch } from "@/components/retroui/ToggleSwitch";
import { OverviewCard } from "@/components/overview-cards";
import { useToast } from "@/components/retroui/Toast";
import { UserProfileHeader } from "@/components/profile-header";
import { EmptyStateCard } from "./subjects/components/empty-state-card";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import {
  ApiRequestError,
  archiveUser,
  getClasses,
  getClassSchedule,
  getMySchedule,
  getSubjectLoadStudioData,
  getSubjects,
  getUserAnalytics,
  getUserDetail,
  resendUserInvitation,
  updateUser,
  type DynamicScheduleResponse,
  type DynamicScheduleRow,
  type TeacherHandledSubject,
  type UpdateUserPayload,
  type UserAnalytics,
  type UserDetail,
  type UserRole,
} from "../../lib/api";
import { DynamicScheduleTable } from "@/components/dynamic-schedule-table";
import {
  Archive,
  BookOpen,
  CalendarDays,
  Clock,
  Layers,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

function sectionName(section: string | null | undefined) {
  if (!section) return null;
  const match = section.match(/^\d+-(.+)$/);
  return match ? match[1] : section;
}

function valueNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

type NormalizedUserAnalytics = Omit<UserAnalytics, "summary" | "lms_behavior"> & {
  summary: Record<string, number | string | null>;
  lms_behavior: Record<string, number | string | null>;
};

function normalizeAnalytics(analytics: UserAnalytics | null): NormalizedUserAnalytics {
  return {
    summary: analytics?.summary ?? {},
    lms_behavior: analytics?.lms_behavior ?? {},
    subject_mastery: analytics?.subject_mastery ?? [],
    score_trend: analytics?.score_trend ?? [],
    historical_performance: analytics?.historical_performance ?? [],
    period_performance: analytics?.period_performance ?? [],
    quarterly_performance: analytics?.quarterly_performance ?? [],
    subject_breakdown: analytics?.subject_breakdown ?? [],
    activity_feed: analytics?.activity_feed ?? [],
    classwork: analytics?.classwork ?? [],
    handled_subjects: analytics?.handled_subjects ?? [],
    handled_classes: analytics?.handled_classes ?? [],
  };
}

type StatusStyle = {
  label: string;
  variant: "default" | "secondary" | "outline" | "solid" | "surface" | "ghost";
};

const COMMON_STATUS_OPTIONS = [
  "active",
  "pending",
  "inactive",
  "suspended",
  "archived",
];
const STUDENT_STATUS_OPTIONS = [
  "active",
  "no section assigned",
  "graduated",
  "archived",
  "transferred",
  "dropped",
];

function getStatusStyle(status: string | undefined | null): StatusStyle {
  switch ((status || "").toLowerCase()) {
    case "active":
      return { label: "Active", variant: "secondary" };
    case "pending":
      return { label: "Pending", variant: "default" };
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
  const { selectedPeriodId, selectedYearId } = useAcademicPeriod();
  const navigate = useNavigate();
  const [user, setUser] = useState<UserDetail | null>(null);
  const [analytics, setAnalytics] = useState<UserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);

  useEffect(() => {
    const onAvatarUpdated = (event: Event) => {
      const { userId: updatedId, avatar } = (
        event as CustomEvent<{ userId: string; avatar: string | null }>
      ).detail;
      if (updatedId === userId)
        setUser((current) => (current ? { ...current, avatar } : current));
    };
    window.addEventListener("enterve:avatar-updated", onAvatarUpdated);
    return () =>
      window.removeEventListener("enterve:avatar-updated", onAvatarUpdated);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    setLoading(true);
    setError(null);
    setUser(null);
    setAnalytics(null);

    Promise.all([
      getUserDetail(userId, selectedYearId),
      getUserAnalytics(userId, selectedPeriodId),
    ])
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
  }, [userId, selectedPeriodId, selectedYearId]);

  const effectiveRole = user?.role ?? role ?? "student";
  const data = useMemo(() => normalizeAnalytics(analytics), [analytics]);
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
      await resendUserInvitation(userId);
      toast.success({ title: "Invitation resent" });
      const updated = await getUserDetail(userId, selectedYearId);
      setUser(updated);
    } catch (err: unknown) {
      toast.error({
        title: "Failed to resend invitation",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setResending(false);
    }
  }

  async function handleUpdate(payload: UpdateUserPayload) {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setEditError(null);
    setNotice(null);
    try {
      const updated = await updateUser(userId, payload);
      setUser(updated);
      setEditOpen(false);
      toast.success({ title: "User updated" });
    } catch (err) {
      if (
        err instanceof ApiRequestError &&
        (err.status === 400 || err.status === 422)
      )
        setEditError(err.message);
      else
        toast.error({
          title: "Unable to update user",
          description: err instanceof Error ? err.message : undefined,
        });
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
      const updated = await getUserDetail(userId, selectedYearId);
      setUser(updated);
      setArchiveOpen(false);
      setNotice("User archived successfully.");
      toast.success({ title: "User archived" });
    } catch (err) {
      toast.error({
        title: "Unable to archive user",
        description: err instanceof Error ? err.message : undefined,
      });
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
              <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
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
                          <Breadcrumb.Page>{user.name}</Breadcrumb.Page>
                        </Breadcrumb.Item>
                      </>
                    )}
                  </Breadcrumb.List>
                </Breadcrumb>
              </div>

              {user && (
                <div className="flex w-full shrink-0 flex-wrap items-center gap-2 md:w-auto">
                  {isPending && (
                    <Button
                      type="button"
                      size="header"
                      variant="default"
                      onClick={handleResendInvitation}
                      disabled={resending}
                      className="gap-2"
                    >
                      <RefreshCw
                        className={cn("size-4", resending && "animate-spin")}
                      />
                      Resend Invitation
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="header"
                    variant="default"
                    onClick={() => {
                      setEditError(null);
                      setEditOpen(true);
                    }}
                    disabled={isPending || isArchived}
                    title={actionDisabledReason}
                    className="gap-2"
                  >
                    <Pencil className="size-4" />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    size="header"
                    variant="outline"
                    onClick={() => setArchiveOpen(true)}
                    disabled={isPending || isArchived}
                    title={actionDisabledReason}
                    className="gap-2"
                  >
                    <Archive className="size-4" />
                    Archive
                  </Button>
                </div>
              )}
            </header>

            <div className="border-t-2 border-border -mt-[1px] px-3 py-3 sm:px-4 sm:py-4 md:px-6 flex flex-col gap-3">
              {!loading && error && (
                <AdminValidationAlert message={error} />
              )}

              {!loading && notice && (
                <Alert status="success">
                  <Alert.Description>{notice}</Alert.Description>
                </Alert>
              )}

              {!loading &&
                user &&
                isPending &&
                user.email_status === "failed" && (
                  <Alert
                    status="error"
                  >
                    <Alert.Description className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <span>
                        <strong>Invitation Email Failed:</strong> The invitation
                        email could not be delivered to{" "}
                        <strong>{user.email}</strong>.
                      </span>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="shrink-0 shadow-none"
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
                    avatar={user.avatar}
                    role={user.role}
                    subtitle={
                      user.role === "student"
                        ? [
                            user.grade_level
                              ? `Grade ${user.grade_level}`
                              : null,
                            sectionName(user.section) ?? "No section assigned",
                          ]
                            .filter(Boolean)
                            .join(" - ")
                        : user.email
                    }
                    extra={user.role === "student" ? user.email : undefined}
                    avatarVariant={
                      user.role === "student"
                        ? "student"
                        : user.role === "teacher"
                          ? "teacher"
                          : "default"
                    }
                    statusLabel={statusStyle.label}
                    statusVariant={statusStyle.variant}
                    isPending={isPending}
                  />
                  {effectiveRole === "student" && (
                    <StudentAnalytics
                      user={user}
                      selectedPeriodId={selectedPeriodId}
                      selectedYearId={selectedYearId}
                    />
                  )}
                  {effectiveRole === "teacher" && (
                    <TeacherAnalytics
                      data={data}
                      user={user}
                      selectedPeriodId={selectedPeriodId}
                    />
                  )}
                  {effectiveRole === "admin" && (
                    <AdminAnalytics
                      data={data}
                      selectedPeriodId={selectedPeriodId}
                      selectedYearId={selectedYearId}
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {user && editOpen && (
        <EditUserModal
          key={user.id}
          user={user}
          saving={saving}
          error={editError}
          onClearError={() => setEditError(null)}
          onClose={() => setEditOpen(false)}
          onSubmit={handleUpdate}
        />
      )}

      {user && archiveOpen && (
        <ArchiveUserDialog
          userName={user.name}
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
  error,
  onClearError,
  onClose,
  onSubmit,
}: {
  user: UserDetail;
  saving: boolean;
  error?: string | null;
  onClearError: () => void;
  onClose: () => void;
  onSubmit: (payload: UpdateUserPayload) => void;
}) {
  const [form, setForm] = useState<UpdateUserPayload>(() =>
    initialEditForm(user),
  );
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<"first_name" | "last_name" | "email" | "prior_gwa", string>>
  >({});
  const [validationAttempt, setValidationAttempt] = useState(0);
  const normalize = (value: UpdateUserPayload) => ({
    ...value,
    first_name: value.first_name.trim(),
    middle_name: value.middle_name?.trim() || "",
    last_name: value.last_name.trim(),
    email: value.email.trim().toLowerCase(),
    contact_number: value.contact_number?.trim() || "",
    address: value.address?.trim() || "",
    employment_status: value.employment_status?.trim() || "",
    section: value.section?.trim() || null,
    prior_gwa: optionalNumber(value.prior_gwa),
  });
  const changes = useEditFormChanges({
    resetKey: user.id,
    initialValues: normalize(initialEditForm(user)),
    values: normalize(form),
  });
  const isStudent = user.role === "student";
  const isTeacher = user.role === "teacher";

  function setField<K extends keyof UpdateUserPayload>(
    field: K,
    value: UpdateUserPayload[K],
  ) {
    onClearError();
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "first_name" || field === "last_name" || field === "email") {
      const valid =
        field === "email"
          ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())
          : !!String(value).trim();
      if (valid)
        setFieldErrors((current) => ({ ...current, [field]: undefined }));
    }
    if (
      field === "prior_gwa" &&
      (value == null ||
        value === "" ||
        (Number.isFinite(Number(value)) &&
          Number(value) >= 60 &&
          Number(value) <= 100))
    )
      setFieldErrors((current) => ({ ...current, prior_gwa: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!changes.guardChanges()) return;
    const errors: typeof fieldErrors = {};
    if (!form.first_name.trim()) errors.first_name = "Enter a first name.";
    if (!form.last_name.trim()) errors.last_name = "Enter a last name.";
    if (!form.email.trim()) errors.email = "Enter an email address.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      errors.email = "Enter a valid email address.";
    if (
      form.prior_gwa != null &&
      String(form.prior_gwa).trim() !== "" &&
      (!Number.isFinite(Number(form.prior_gwa)) ||
        Number(form.prior_gwa) < 60 ||
        Number(form.prior_gwa) > 100)
    )
      errors.prior_gwa = "Enter a prior GWA from 60 to 100.";
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
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
      prior_gwa:
        form.prior_gwa !== undefined &&
        form.prior_gwa !== null &&
        String(form.prior_gwa).trim() !== ""
          ? Number(form.prior_gwa)
          : null,
    });
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content size="2xl">
        <Dialog.Header position="static">
          <h2 className="font-sans text-xl font-bold">Edit User</h2>
        </Dialog.Header>

        <form onSubmit={submit} noValidate>
          <section className="grid gap-4 p-4">
            <Dialog.Description className="text-sm text-muted-foreground">
              Role changes are handled separately.
            </Dialog.Description>
            <AdminValidationAlert message={error} attempt={validationAttempt} />
            <div className="grid gap-3 md:grid-cols-3">
              <EditField label="First Name">
                <Input
                  id="edit-user-first-name"
                  aria-invalid={!!fieldErrors.first_name}
                  aria-describedby={
                    fieldErrors.first_name
                      ? "edit-user-first-name-error"
                      : undefined
                  }
                  value={form.first_name}
                  onChange={(event) =>
                    setField("first_name", event.target.value)
                  }
                  required
                  className="w-full"
                />
                <FormMessage id="edit-user-first-name-error">
                  {fieldErrors.first_name}
                </FormMessage>
              </EditField>
              <EditField label="Middle Name">
                <Input
                  value={form.middle_name || ""}
                  onChange={(event) =>
                    setField("middle_name", event.target.value)
                  }
                  className="w-full"
                />
              </EditField>
              <EditField label="Last Name">
                <Input
                  id="edit-user-last-name"
                  aria-invalid={!!fieldErrors.last_name}
                  aria-describedby={
                    fieldErrors.last_name
                      ? "edit-user-last-name-error"
                      : undefined
                  }
                  value={form.last_name}
                  onChange={(event) =>
                    setField("last_name", event.target.value)
                  }
                  required
                  className="w-full"
                />
                <FormMessage id="edit-user-last-name-error">
                  {fieldErrors.last_name}
                </FormMessage>
              </EditField>
            </div>

            <EditField label="Email Address">
              <Input
                id="edit-user-email"
                aria-invalid={!!fieldErrors.email}
                aria-describedby={
                  fieldErrors.email ? "edit-user-email-error" : undefined
                }
                type="email"
                value={form.email}
                onChange={(event) => setField("email", event.target.value)}
                required
                className="w-full"
              />
              <FormMessage id="edit-user-email-error">
                {fieldErrors.email}
              </FormMessage>
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
                      value={
                        form.grade_level !== null &&
                        form.grade_level !== undefined
                          ? String(form.grade_level)
                          : ""
                      }
                      onValueChange={(val) =>
                        setField("grade_level", val ? Number(val) : null)
                      }
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
                      onChange={(event) =>
                        setField("section", event.target.value)
                      }
                      className="w-full"
                    />
                  </EditField>
                </div>
                <EditField label="General Average (Prior GWA)">
                  <Input
                    id="edit-user-prior-gwa"
                    aria-invalid={!!fieldErrors.prior_gwa}
                    aria-describedby={
                      fieldErrors.prior_gwa
                        ? "edit-user-prior-gwa-error"
                        : undefined
                    }
                    type="number"
                    step="0.01"
                    min="60"
                    max="100"
                    value={
                      form.prior_gwa !== null && form.prior_gwa !== undefined
                        ? String(form.prior_gwa)
                        : ""
                    }
                    placeholder="e.g. 88.50 (Optional)"
                    onChange={(event) => {
                      const val = event.target.value;
                      setField("prior_gwa", val === "" ? null : Number(val));
                    }}
                    className={`w-full ${user.has_computed_gwa ? "opacity-60 bg-muted/30" : ""}`}
                  />
                  <FormMessage id="edit-user-prior-gwa-error">
                    {fieldErrors.prior_gwa}
                  </FormMessage>
                  {user.has_computed_gwa && (
                    <p className="mt-1 text-[11px] text-muted-foreground font-semibold">
                      Fallback only — this student has a computed average from
                      prior year grades. The computed value is used for
                      sectioning.
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
                    onChange={(event) =>
                      setField("contact_number", event.target.value)
                    }
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
                      <Select.Item value="Regular/Permanent">
                        Permanent
                      </Select.Item>
                      <Select.Item value="Substitute">Substitute</Select.Item>
                      <Select.Item value="Probationary">
                        Probationary
                      </Select.Item>
                    </Select.Content>
                  </Select>
                </EditField>
              </>
            )}

            {(isTeacher || isStudent) && (
              <EditField label="Address">
                <textarea
                  rows={3}
                  className="w-full resize-none rounded! border-2 border-border bg-background px-4 py-2 text-sm text-foreground shadow-md transition focus:outline-hidden focus:shadow-xs"
                  value={form.address || ""}
                  onChange={(event) => setField("address", event.target.value)}
                />
              </EditField>
            )}
          </section>

          <Dialog.Footer position="static">
            <NoChangesMessage message={changes.noChangesMessage} />
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !changes.hasChanges}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}

function EditField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

function ArchiveUserDialog({
  userName,
  archiving,
  onCancel,
  onConfirm,
}: {
  userName: string;
  archiving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title="Archive User"
      confirmationTitle={
        <p className="text-base">
          Are you sure you want to archive <strong>{userName}</strong>?
        </p>
      }
      description="Archived users will no longer appear in the default active user list, but their records and analytics will be preserved."
      confirmLabel={archiving ? "Archiving user..." : "Archive User"}
      confirmVariant="destructive"
      isLoading={archiving}
      onCancel={onCancel}
      onConfirm={onConfirm}
      size="md"
    />
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
    metrics.length === 3
      ? "grid gap-3 sm:grid-cols-3"
      : metrics.length === 2
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

const SCHEDULE_DAY_MAP: Record<string, string> = {
  MON: "M",
  MONDAY: "M",
  M: "M",
  TUE: "T",
  TUESDAY: "T",
  T: "T",
  WED: "W",
  WEDNESDAY: "W",
  W: "W",
  THU: "Th",
  THURSDAY: "Th",
  TH: "Th",
  FRI: "F",
  FRIDAY: "F",
  F: "F",
};

function formatClock12(hhmm?: string | null): string {
  if (!hhmm) return "";
  const parts = hhmm.split(":");
  if (parts.length < 2) return hhmm;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

function TeacherAnalytics({
  data,
  user,
  selectedPeriodId,
}: {
  data: NormalizedUserAnalytics;
  user: UserDetail;
  selectedPeriodId?: number | null;
}) {
  const [activeTab, setActiveTab] = useState<"subjects" | "schedule">("subjects");
  const [scheduleData, setScheduleData] = useState<DynamicScheduleResponse | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(true);

  const handledSubjects: TeacherHandledSubject[] =
    data.handled_subjects && data.handled_subjects.length > 0
      ? data.handled_subjects
      : user.handled_subjects ?? [];

  useEffect(() => {
    let isMounted = true;

    async function loadTeacherSchedule() {
      if (!user.staff_id) {
        if (isMounted) {
          setScheduleData(null);
          setIsScheduleLoading(false);
        }
        return;
      }
      setIsScheduleLoading(true);
      try {
        const studioData = await getSubjectLoadStudioData(selectedPeriodId ?? undefined).catch(
          () => null,
        );
        if (studioData) {
          const teacherLoads = studioData.existing_loads.filter(
            (load) =>
              load.staff_id === user.staff_id &&
              load.is_active_version !== false &&
              (load.status === "published" || load.status === "active"),
          );
          if (teacherLoads.length > 0) {
            const subjectMap = new Map(
              studioData.subjects.map((s) => [s.subject_id, s]),
            );
            const classMap = new Map(
              studioData.classes.map((c) => [c.class_id, c]),
            );
            const rows: DynamicScheduleRow[] = teacherLoads.map((load) => {
              const sub = subjectMap.get(load.subject_id);
              const cls = classMap.get(load.class_id);
              const startFmt = formatClock12(load.start_time);
              const endFmt = formatClock12(load.end_time);
              const days = (load.days_of_week || []).map(
                (d) => SCHEDULE_DAY_MAP[d.toUpperCase()] || d,
              );
              return {
                type: "class",
                subject_load_id: load.subject_load_id ?? undefined,
                subject: sub?.subject_name ?? `Subject #${load.subject_id}`,
                subject_codename: sub?.subject_codename ?? "",
                teacher: user.name,
                section_name: cls?.section_name ?? "",
                start_time: load.start_time || "00:00",
                end_time: load.end_time || "00:00",
                time: startFmt && endFmt ? `${startFmt} - ${endFmt}` : "",
                days: days.length > 0 ? days : ["M", "T", "W", "Th", "F"],
                slot_type: "CLASS",
              };
            });

            const firstClass = classMap.get(teacherLoads[0].class_id);
            const templateGroup = firstClass?.period_template_group || "JHS";
            const breakSlots = (studioData.period_template_slots || []).filter(
              (slot) =>
                slot.template_group === templateGroup &&
                (slot.slot_type === "HOMEROOM" ||
                  slot.slot_type === "RECESS" ||
                  slot.slot_type === "LUNCH"),
            );
            for (const b of breakSlots) {
              const startFmt = formatClock12(b.start_time);
              const endFmt = formatClock12(b.end_time);
              rows.push({
                type: "break",
                label: b.slot_name,
                start_time: b.start_time,
                end_time: b.end_time,
                time: startFmt && endFmt ? `${startFmt} - ${endFmt}` : "",
                slot_type: b.slot_type,
              });
            }
            rows.sort((a, b) => (a.start_time || "00:00").localeCompare(b.start_time || "00:00"));
            if (isMounted) {
              setScheduleData({ is_published: true, schedule: rows });
              return;
            }
          } else {
            if (isMounted) {
              setScheduleData({ is_published: false, schedule: [] });
              return;
            }
          }
        }

        const fallback = await getMySchedule(selectedPeriodId ?? undefined, user.staff_id);
        if (isMounted) setScheduleData(fallback);
      } catch (err) {
        console.error("Failed to load teacher schedule:", err);
        if (isMounted) setScheduleData(null);
      } finally {
        if (isMounted) setIsScheduleLoading(false);
      }
    }

    void loadTeacherSchedule();
    return () => {
      isMounted = false;
    };
  }, [user.staff_id, user.name, selectedPeriodId]);

  const summary = data.summary;
  const rawHours =
    summary.workloadHours !== undefined && summary.workloadHours !== null
      ? Number(summary.workloadHours)
      : null;
  const loadCount =
    summary.loadCount !== undefined && summary.loadCount !== null
      ? Number(summary.loadCount)
      : valueNumber(summary.classesHandled, 0);
  const workloadDisplay =
    rawHours !== null && rawHours > 0
      ? `${rawHours} hrs`
      : rawHours !== null
        ? "0 hrs"
        : `${loadCount} loads`;

  const classCount =
    summary.classesHandled !== undefined && summary.classesHandled !== null
      ? Number(summary.classesHandled)
      : user.handled_classes?.length ?? 0;
  const totalStudents =
    summary.totalStudents !== undefined && summary.totalStudents !== null
      ? Number(summary.totalStudents)
      : null;

  const subjectCount =
    summary.subjectsHandled !== undefined && summary.subjectsHandled !== null && Number(summary.subjectsHandled) > 0
      ? Number(summary.subjectsHandled)
      : handledSubjects.length;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] items-start min-w-0">
      {/* Main Column: Toggle between Subject Itemlines and Subject Load Timetable */}
      <div className="flex flex-col gap-3 min-w-0">
        <div>
          <ToggleSwitch
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as "subjects" | "schedule")}
            size="sm"
          >
            <ToggleSwitch.Item value="subjects">
              <BookOpen className="size-3.5 shrink-0" />
              <span>Subjects</span>
            </ToggleSwitch.Item>
            <ToggleSwitch.Item value="schedule">
              <CalendarDays className="size-3.5 shrink-0" />
              <span>Subject Load</span>
            </ToggleSwitch.Item>
          </ToggleSwitch>
        </div>

        {activeTab === "subjects" ? (
          handledSubjects.length === 0 ? (
            <EmptyStateCard
              icon={<BookOpen aria-hidden="true" />}
              shadow
              title="No subjects assigned"
              description="No subject loads are currently mapped to this teacher."
            />
          ) : (
            <div className="grid gap-2 min-w-0">
              {handledSubjects.map((subject) => (
                <Card key={subject.subject_id} className="block w-full p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-bold text-lg leading-tight truncate">
                          {subject.subject_name}
                        </h4>
                        <Badge variant="secondary" size="sm" className="text-[10px]">
                          {subject.is_core ? "Core" : "Applied"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {[
                          subject.grade_levels?.length ? subject.grade_levels.join(", ") : null,
                          subject.sections?.length
                            ? `Sections: ${subject.sections.join(", ")}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" • ") || "Assigned subject"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground shrink-0">
                      {subject.weekly_hours !== undefined && subject.weekly_hours > 0 && (
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <Clock className="size-3.5" />
                          {subject.weekly_hours} hrs/wk
                        </span>
                      )}
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Layers className="size-3.5" />
                        {subject.class_count ?? subject.sections?.length ?? 0}{" "}
                        {(subject.class_count ?? subject.sections?.length ?? 0) === 1
                          ? "class"
                          : "classes"}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : !isScheduleLoading && (!scheduleData?.is_published || !scheduleData.schedule.length) ? (
          <EmptyStateCard
            icon={<CalendarDays aria-hidden="true" />}
            shadow
            title="No published schedule yet"
            description="This teacher’s timetable will appear here once their subject loads are published."
          />
        ) : (
          <DynamicScheduleTable
            schedule={scheduleData?.schedule || []}
            isPublished={scheduleData?.is_published}
            isLoading={isScheduleLoading}
            showTeacher={false}
            showSection={true}
          />
        )}
      </div>

      {/* Right Side Column: Stacked Overview Cards */}
      <aside className="flex flex-col gap-3 min-w-0">
        <OverviewCard
          title="Class Handled"
          count={String(classCount)}
          stat={
            totalStudents !== null && totalStudents > 0
              ? `${totalStudents} ${totalStudents === 1 ? "student" : "students"}`
              : undefined
          }
          statDescription={
            totalStudents !== null && totalStudents > 0
              ? "total enrolled in assigned classes"
              : "assigned class sections"
          }
        />
        <OverviewCard
          title="Subjects Handled"
          count={String(subjectCount)}
          stat={`+ ${String(subjectCount)}`}
          statDescription={
            subjectCount > 0 ? "subjects assigned" : "distinct subjects taught"
          }
        />
        <OverviewCard
          title="Workload"
          count={workloadDisplay}
          stat={
            loadCount > 0
              ? `${loadCount} ${loadCount === 1 ? "load" : "loads"}`
              : undefined
          }
          statDescription="scheduled weekly teaching load"
        />
      </aside>
    </div>
  );
}

function StudentAnalytics({
  user,
  selectedPeriodId,
  selectedYearId,
}: {
  user: UserDetail;
  selectedPeriodId?: number | null;
  selectedYearId?: number | null;
}) {
  const [scheduleData, setScheduleData] = useState<DynamicScheduleResponse | null>(null);
  const [isScheduleLoading, setIsScheduleLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadSchedule() {
      setIsScheduleLoading(true);
      try {
        let targetClassId = user.class_id ?? null;
        const targetSection = sectionName(user.section);

        if (!targetClassId && targetSection) {
          const classesRes = await getClasses("active", selectedYearId);
          const matched = classesRes.classes.find(
            (cls) =>
              cls.section_name.trim().toLowerCase() === targetSection.trim().toLowerCase() &&
              (!user.grade_level || cls.academic_level.grade_level === user.grade_level),
          );
          targetClassId = matched?.class_id ?? null;
        }

        if (!targetClassId) {
          if (isMounted) setScheduleData(null);
          return;
        }

        const data = await getClassSchedule(targetClassId, selectedPeriodId ?? undefined);
        if (isMounted) setScheduleData(data);
      } catch (err) {
        console.error("Failed to load student class schedule:", err);
        if (isMounted) setScheduleData(null);
      } finally {
        if (isMounted) setIsScheduleLoading(false);
      }
    }

    void loadSchedule();
    return () => {
      isMounted = false;
    };
  }, [user.class_id, user.section, user.grade_level, selectedPeriodId, selectedYearId]);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-bold">Subject Load Schedule</h2>
      {!isScheduleLoading && (!scheduleData?.is_published || !scheduleData.schedule.length) ? (
        <EmptyStateCard
          icon={<CalendarDays />}
          shadow
          title="No published schedule yet"
          description={
            user.section
              ? "This section’s schedule will appear here once its subject loads are published."
              : "Assign this student to a section to view their subject load schedule."
          }
        />
      ) : (
        <DynamicScheduleTable
          schedule={scheduleData?.schedule || []}
          isPublished={scheduleData?.is_published}
          isLoading={isScheduleLoading}
        />
      )}
    </section>
  );
}

function AdminAnalytics({
  data,
  selectedPeriodId,
  selectedYearId,
}: {
  data: NormalizedUserAnalytics;
  selectedPeriodId?: number | null;
  selectedYearId?: number | null;
}) {
  const summary = data.summary;
  const hasBackendCounts =
    summary.classesMade !== undefined &&
    summary.subjectLoadsAssigned !== undefined &&
    summary.subjectsAdded !== undefined;

  const [fallbackCounts, setFallbackCounts] = useState<{
    classesMade: number;
    subjectLoadsAssigned: number;
    subjectsAdded: number;
  } | null>(null);

  useEffect(() => {
    if (hasBackendCounts) return;
    let isMounted = true;

    Promise.all([
      getClasses("active", selectedYearId).catch(() => null),
      getSubjectLoadStudioData(selectedPeriodId ?? undefined).catch(() => null),
      getSubjects({ status: "active" }).catch(() => null),
    ]).then(([classesRes, studioRes, subjectsRes]) => {
      if (!isMounted) return;
      setFallbackCounts({
        classesMade: classesRes?.classes.length ?? 0,
        subjectLoadsAssigned: studioRes?.existing_loads.length ?? 0,
        subjectsAdded: subjectsRes?.subjects.length ?? 0,
      });
    });

    return () => {
      isMounted = false;
    };
  }, [hasBackendCounts, selectedPeriodId, selectedYearId]);

  const classesMade = summary.classesMade ?? fallbackCounts?.classesMade ?? 0;
  const subjectLoadsAssigned =
    summary.subjectLoadsAssigned ?? fallbackCounts?.subjectLoadsAssigned ?? 0;
  const subjectsAdded = summary.subjectsAdded ?? fallbackCounts?.subjectsAdded ?? 0;

  return (
    <OverviewGrid
      metrics={[
        {
          title: "Classes Made",
          count: String(displayMetric(classesMade)),
          statDescription: "classes created",
        },
        {
          title: "Subject Loads Assigned",
          count: String(displayMetric(subjectLoadsAssigned)),
          statDescription: "subject loads assigned",
        },
        {
          title: "Subjects Added",
          count: String(displayMetric(subjectsAdded)),
          statDescription: "subjects created",
        },
      ]}
    />
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
