"use client";

import * as React from "react";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { useToast } from "@/components/retroui/Toast";
import {
  getSubstituteAvailability,
  type SubstituteAvailability,
  getUsers,
  getTeacherSubjectLoads,
  createBulkSubstitutions,
  type User,
  type TeacherLoadSummaryItem,
} from "@/lib/api";
import { BookOpen, Calendar, CheckSquare, Clock, Square, Users } from "lucide-react";
import { RoleBadge } from "@/components/role-badge";


interface AssignSubstituteModalProps {
  initialStaffId?: string;
  initialStaffName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AssignSubstituteModal({
  initialStaffId,
  initialStaffName,
  onClose,
  onSuccess,
}: AssignSubstituteModalProps) {
  const toast = useToast();
  const [teachers, setTeachers] = React.useState<User[]>([]);
  const [isLoadingTeachers, setIsLoadingTeachers] = React.useState(true);

  const [selectedOriginalStaffId, setSelectedOriginalStaffId] = React.useState<string>(initialStaffId || "");
  const [teacherLoads, setTeacherLoads] = React.useState<TeacherLoadSummaryItem[]>([]);
  const [isLoadingLoads, setIsLoadingLoads] = React.useState(false);
  const [selectedLoadIds, setSelectedLoadIds] = React.useState<number[]>([]);

  const [selectedSubstituteStaffId, setSelectedSubstituteStaffId] = React.useState<string>("");
  const [startDate, setStartDate] = React.useState<string>(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = React.useState<string>("");
  const [reason, setReason] = React.useState<string>("Maternity Leave");

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = React.useState(0);
  const validationMessages = ["Please select the teacher going on leave.", "Please select at least one subject load to cover.", "Please select a substitute teacher.", "Substitute teacher cannot be the same as the original teacher.", "Please select a start date.", "End date cannot be earlier than start date."];
  const validationError = errorMsg && validationMessages.includes(errorMsg) ? errorMsg : null;
  const failValidation = (message: string) => { setErrorMsg(message); setValidationAttempt((attempt) => attempt + 1); };

  // Load teachers list
  React.useEffect(() => {
    let isMounted = true;
    async function loadTeachers() {
      try {
        const users = await getUsers({ role: "teacher", status: "active" });
        if (isMounted) {
          setTeachers(users.filter((u) => u.staff_id));
        }
      } catch (err) {
        console.error("Failed to load teachers", err);
        if (isMounted) setErrorMsg("Unable to load teachers. Close and reopen this dialog to try again.");
      } finally {
        if (isMounted) setIsLoadingTeachers(false);
      }
    }
    loadTeachers();
    return () => {
      isMounted = false;
    };
  }, []);

  // Fetch subject loads when original teacher changes
  React.useEffect(() => {
    if (!selectedOriginalStaffId) {
      setTeacherLoads([]);
      setSelectedLoadIds([]);
      return;
    }

    let isMounted = true;
    async function fetchLoads() {
      setIsLoadingLoads(true);
      setErrorMsg(null);
      try {
        const loads = await getTeacherSubjectLoads(selectedOriginalStaffId);
        if (isMounted) {
          setTeacherLoads(loads);
          // Default: auto-select all un-substituted loads in the active period (or all un-substituted loads if none active)
          const activeAvailable = loads.filter((l) => l.is_active_period && !l.has_active_substitution);
          if (activeAvailable.length > 0) {
            setSelectedLoadIds(activeAvailable.map((l) => l.subject_load_id));
          } else {
            const allAvailable = loads.filter((l) => !l.has_active_substitution);
            setSelectedLoadIds(allAvailable.map((l) => l.subject_load_id));
          }
        }
      } catch (err: unknown) {
        if (isMounted) {
          setErrorMsg(err instanceof Error ? err.message : "Failed to load assigned subject loads for this teacher.");
        }
      } finally {
        if (isMounted) setIsLoadingLoads(false);
      }
    }
    fetchLoads();
    return () => {
      isMounted = false;
    };
  }, [selectedOriginalStaffId]);

  // Group candidate substitutes
  const candidateTeachers = React.useMemo(() => {
    return teachers.filter((t) => t.staff_id !== selectedOriginalStaffId);
  }, [teachers, selectedOriginalStaffId]);

  const dedicatedSubs = React.useMemo(() => {
    return candidateTeachers.filter(
      (t) => (t.employment_status || "").trim().toLowerCase() === "substitute"
    );
  }, [candidateTeachers]);

  const [availability, setAvailability] = React.useState<SubstituteAvailability[]>([]);
  const [availabilityKey, setAvailabilityKey] = React.useState("");
  const [availabilityError, setAvailabilityError] = React.useState<string | null>(null);
  const [availabilityAttempt, setAvailabilityAttempt] = React.useState(0);
  const requestKey = JSON.stringify([selectedOriginalStaffId, selectedLoadIds, startDate, endDate]);
  const canCheck = selectedLoadIds.length > 0 && Boolean(startDate) && (!endDate || endDate >= startDate) && !isLoadingLoads;
  const availabilityReady = canCheck && availabilityKey === requestKey && !availabilityError;
  React.useEffect(() => {
    let current = true;
    setAvailabilityError(null);
    if (!canCheck) return;
    const timer = window.setTimeout(() => {
      getSubstituteAvailability({ subject_load_ids: selectedLoadIds, start_date: startDate, end_date: endDate || null })
        .then((items) => {
          if (!current) return;
          setAvailability(items);
          setAvailabilityKey(requestKey);
          setSelectedSubstituteStaffId((id) => items.some((item) => item.staff_id === id && item.status !== "conflict") ? id : "");
        })
        .catch((error: unknown) => {
          if (current) setAvailabilityError(error instanceof Error ? error.message : "Unable to check availability.");
        });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); };
  }, [canCheck, requestKey, availabilityAttempt, selectedLoadIds, startDate, endDate]);

  // Available loads that are not already substituted
  const availableLoads = React.useMemo(() => {
    return teacherLoads.filter((l) => !l.has_active_substitution);
  }, [teacherLoads]);

  const allAvailableSelected = availableLoads.length > 0 && availableLoads.every((l) => selectedLoadIds.includes(l.subject_load_id));

  const handleToggleSelectAll = () => {
    if (allAvailableSelected) {
      setSelectedLoadIds([]);
    } else {
      setSelectedLoadIds(availableLoads.map((l) => l.subject_load_id));
    }
  };

  const handleToggleLoad = (loadId: number) => {
    if (errorMsg === "Please select at least one subject load to cover.") setErrorMsg(null);
    setSelectedLoadIds((prev) =>
      prev.includes(loadId) ? prev.filter((id) => id !== loadId) : [...prev, loadId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOriginalStaffId) {
      failValidation("Please select the teacher going on leave.");
      return;
    }
    if (selectedLoadIds.length === 0) {
      failValidation("Please select at least one subject load to cover.");
      return;
    }
    if (!selectedSubstituteStaffId) {
      failValidation("Please select a substitute teacher.");
      return;
    }
    if (selectedSubstituteStaffId === selectedOriginalStaffId) {
      failValidation("Substitute teacher cannot be the same as the original teacher.");
      return;
    }
    if (!startDate) {
      failValidation("Please select a start date.");
      return;
    }
    if (endDate && endDate < startDate) {
      failValidation("End date cannot be earlier than start date.");
      return;
    }

    if (!availabilityReady) {
      failValidation("Check teacher availability before assigning a substitute.");
      return;
    }
    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await createBulkSubstitutions({
        subject_load_ids: selectedLoadIds,
        substitute_staff_id: selectedSubstituteStaffId,
        start_date: startDate,
        end_date: endDate.trim() ? endDate : null,
        reason: reason.trim() || undefined,
      });
      toast.success({ title: "Substitute assigned" });
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to assign substitute.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Content size="lg" className="w-[calc(100%-2rem)] max-w-2xl lg:max-w-2xl max-h-[90svh] overflow-hidden font-sans">
      <Dialog.Header className="shrink-0 gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Dialog.Title className="font-head text-lg leading-tight">
            Assign Substitute Teacher
          </Dialog.Title>
        </div>
      </Dialog.Header>

      <form onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
        <section className="flex flex-col gap-4 p-5">
          <AdminValidationAlert message={validationError ? null : errorMsg} attempt={validationAttempt} />

          {/* 1. Teacher on Leave */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">
              Teacher on Leave (Original Teacher)
            </label>
            {initialStaffId ? (
              <Card className="flex items-center justify-between p-3 bg-muted/40 font-medium text-sm">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>{initialStaffName || initialStaffId}</span>
                  <RoleBadge role="teacher" />
                </div>
                <Badge variant="surface">ID: {initialStaffId}</Badge>
              </Card>
            ) : (
              <Select
                value={selectedOriginalStaffId}
                onChange={(e) => { setSelectedOriginalStaffId(e.target.value); if (e.target.value) setErrorMsg(null); }}
                disabled={isLoadingTeachers}
              >
                <Select.Trigger id="original-teacher" className="w-full" aria-invalid={validationError === "Please select the teacher going on leave."} aria-describedby={validationError === "Please select the teacher going on leave." ? "original-teacher-error" : undefined}>
                  <Select.Value placeholder="Select Teacher on Leave..." />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {teachers.map((t) => (
                      <Select.Item key={t.staff_id || t.id} value={t.staff_id || t.id}>
                        {t.name} ({t.staff_id || t.id}) {t.employment_status ? `• ${t.employment_status === "Regular/Permanent" ? "Permanent" : t.employment_status}` : ""}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
            )}
            {validationError === "Please select the teacher going on leave." && <FormMessage id="original-teacher-error">{validationError}</FormMessage>}
          </div>

          {/* 2. Select Subject Loads (Whole Program Takeover) */}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                <span>Teaching Program to Cover</span>
                {isLoadingLoads && <Loader size="sm" />}
              </label>

              {availableLoads.length > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  autoIcon={false}
                  onClick={handleToggleSelectAll}
                  className="h-8 shrink-0 gap-1.5 whitespace-nowrap text-xs font-semibold"
                >
                  {allAvailableSelected ? (
                    <>
                      <CheckSquare className="h-3.5 w-3.5" />
                      <span>Deselect All</span>
                    </>
                  ) : (
                    <>
                      <Square className="h-3.5 w-3.5" />
                      <span>Select All (Entire Program)</span>
                    </>
                  )}
                </Button>
              )}
            </div>

            {selectedOriginalStaffId ? (
              teacherLoads.length === 0 && !isLoadingLoads ? (
                <EmptyStateCard
                  compact
                  icon={<BookOpen />}
                  title="No teaching program available"
                  description="No active published subject loads found for this teacher."
                />
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-muted-foreground flex justify-between items-center px-1">
                    <span>Click individual cards or select all to assign the entire program.</span>
                    <span className="font-semibold text-foreground">
                      {selectedLoadIds.length} of {teacherLoads.length} selected
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto pr-1">
                    {teacherLoads.map((load) => {
                      const isSelected = selectedLoadIds.includes(load.subject_load_id);
                      const isCovered = load.has_active_substitution;

                      return (
                        <Card
                          key={load.subject_load_id}
                          variant={isSelected && !isCovered ? "primary" : "default"}
                          onClick={() => {
                            if (!isCovered) handleToggleLoad(load.subject_load_id);
                          }}
                          className={`flex flex-col gap-2 p-3 transition-all ${isCovered
                              ? "opacity-60 bg-muted/30 border-dashed cursor-not-allowed"
                              : isSelected
                                ? "border-border cursor-pointer"
                                : "hover:bg-muted/40 cursor-pointer"
                            }`}
                        >
                          <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3">
                            <div className="flex min-w-0 items-start gap-3">
                              <Checkbox
                                type="button"
                                variant="solid"
                                checked={isSelected}
                                disabled={isCovered}
                                onClick={(event) => event.stopPropagation()}
                                onCheckedChange={() => {
                                  if (!isCovered) handleToggleLoad(load.subject_load_id);
                                }}
                                size="md"
                                className="shrink-0 border-foreground"
                              />
                              <span className="min-w-0 text-sm font-semibold">
                                {load.subject_name} {load.subject_codename ? `(${load.subject_codename})` : ""}
                              </span>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                              <Badge variant="outline" size="sm" className="font-normal">
                                {load.section_name}
                              </Badge>
                              {load.is_active_period && (
                                <Badge variant="surface" size="sm">
                                  Active Term
                                </Badge>
                              )}
                              {isCovered && (
                                <Badge variant="outline" size="sm">
                                  Covered by {load.active_substitute_name}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {load.start_time && load.end_time
                                    ? `${load.start_time} - ${load.end_time}`
                                    : "No fixed time"}
                                </span>
                                <span>• {load.period_name}</span>
                                {load.days_of_week && load.days_of_week.length > 0 && (
                                  <span>• {load.days_of_week.map((d) => d.slice(0, 3)).join(", ")}</span>
                                )}
                          </div>

                        </Card>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                Select a teacher above to view and assign their teaching program.
              </p>
            )}
            {validationError === "Please select at least one subject load to cover." && <FormMessage>{validationError}</FormMessage>}
          </div>

          {/* 3. Select Substitute Teacher (Grouped Dropdown) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground flex justify-between items-center">
              <span>Substitute Teacher</span>
              {dedicatedSubs.length > 0 && (
                <span className="text-xs font-normal text-primary">
                  {dedicatedSubs.length} dedicated substitute(s)
                </span>
              )}
            </label>
            <Select
              value={selectedSubstituteStaffId}
              onChange={(e) => { setSelectedSubstituteStaffId(e.target.value); if (e.target.value && e.target.value !== selectedOriginalStaffId) setErrorMsg(null); }}
              disabled={isLoadingTeachers}
            >
              <Select.Trigger id="substitute-teacher" className="w-full" aria-invalid={validationError?.toLowerCase().includes("substitute teacher") ?? false} aria-describedby={validationError?.toLowerCase().includes("substitute teacher") ? "substitute-teacher-error" : undefined}>
                <Select.Value placeholder="Select Substitute Teacher..." />
              </Select.Trigger>
              <Select.Content>
                {(["recommended", "unverified", "conflict"] as const).map((status) => {
                  const items = availability.filter((item) => item.status === status);
                  if (!items.length) return null;
                  return (
                    <Select.Group key={status}>
                      <Select.Label>{status === "recommended" ? "Available teachers" : status === "unverified" ? "Schedule unverified" : "Schedule conflicts"}</Select.Label>
                      {items.map((item) => {
                        const teacher = candidateTeachers.find((t) => t.staff_id === item.staff_id);
                        if (!teacher) return null;
                        return (
                          <Select.Item key={item.staff_id} value={item.staff_id} disabled={status === "conflict"} textValue={teacher.name}>
                            <span className="flex flex-col gap-1">
                              <span className="flex flex-wrap items-center gap-2">
                                <span>{teacher.name} ({item.staff_id})</span>
                                {status === "recommended" && <Badge variant="surface" size="sm">Recommended</Badge>}
                              </span>
                              {item.reason && <span className="text-sm text-muted-foreground">{item.reason}</span>}
                            </span>
                          </Select.Item>
                        );
                      })}
                    </Select.Group>
                  );
                })}
              </Select.Content>
            </Select>
            {canCheck && !availabilityReady && !availabilityError && <p role="status" className="text-sm text-muted-foreground">Checking teacher availability...</p>}
            {!canCheck && <p className="text-sm text-muted-foreground">Select teaching loads and valid assignment dates to check availability.</p>}
            {availabilityError && <div role="alert" className="flex items-center gap-2"><FormMessage>{availabilityError}</FormMessage><Button type="button" size="sm" variant="outline" onClick={() => setAvailabilityAttempt((value) => value + 1)}>Retry</Button></div>}
            {availabilityReady && !availability.some((item) => item.status !== "conflict") && <EmptyStateCard compact icon={<Users />} title="No available teachers" description="Try different loads or assignment dates." />}
            {availabilityReady && availability.find((item) => item.staff_id === selectedSubstituteStaffId)?.status === "unverified" && <p className="text-sm text-muted-foreground">Schedule cannot be fully verified. Review the teacher?s timetable before assigning.</p>}
            {validationError?.toLowerCase().includes("substitute teacher") && <FormMessage id="substitute-teacher-error">{validationError}</FormMessage>}
            {dedicatedSubs.length === 0 && candidateTeachers.length > 0 && (
              <Text as="p" className="text-xs text-muted-foreground">
                  No teachers currently have &apos;Substitute&apos; employment status. You may select regular faculty for peer coverage or update a teacher&apos;s status in Users.
              </Text>
            )}
          </div>

          {/* 4. Dates & Reason */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Calendar className="size-4 shrink-0 text-foreground" />
                <span>Start Date <span className="text-destructive">*</span></span>
              </label>
              <Input
                id="substitution-start-date"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); if (e.target.value) setErrorMsg(null); }}
                required
                aria-invalid={validationError === "Please select a start date."}
                aria-describedby={validationError === "Please select a start date." ? "substitution-start-date-error" : undefined}
              />
              {validationError === "Please select a start date." && <FormMessage id="substitution-start-date-error">{validationError}</FormMessage>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Calendar className="size-4 shrink-0 text-foreground" />
                <span>Expected End Date (Optional)</span>
              </label>
              <Input
                id="substitution-end-date"
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); if (!e.target.value || e.target.value >= startDate) setErrorMsg(null); }}
                min={startDate}
                aria-invalid={validationError === "End date cannot be earlier than start date."}
                aria-describedby={validationError === "End date cannot be earlier than start date." ? "substitution-end-date-error" : undefined}
              />
              {validationError === "End date cannot be earlier than start date." && <FormMessage id="substitution-end-date-error">{validationError}</FormMessage>}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold text-foreground">
              Reason / Notes
            </label>
            <Input
              type="text"
              placeholder="e.g. Maternity Leave (approx. 6 months)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </section>

        <Dialog.Footer>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || !availabilityReady || selectedLoadIds.length === 0 || !selectedSubstituteStaffId}
          >
            {isSubmitting ? (
              <>
                <Loader size="sm" className="mr-2" />
                Assigning ({selectedLoadIds.length} loads)...
              </>
            ) : (
              `Confirm Assignment (${selectedLoadIds.length} loads)`
            )}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  );
}
