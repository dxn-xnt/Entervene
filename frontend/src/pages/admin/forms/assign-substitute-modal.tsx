"use client";

import * as React from "react";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Text } from "@/components/retroui/Text";
import { Badge } from "@/components/retroui/Badge";
import {
  getUsers,
  getTeacherSubjectLoads,
  createBulkSubstitutions,
  type User,
  type TeacherLoadSummaryItem,
} from "@/lib/api";
import { AlertCircle, Calendar, CheckSquare, Clock, Info, Loader2, Square, UserCheck, Users } from "lucide-react";


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
      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err?.message || "Failed to load assigned subject loads for this teacher.");
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

  const regularFaculty = React.useMemo(() => {
    return candidateTeachers.filter(
      (t) => (t.employment_status || "").trim().toLowerCase() !== "substitute"
    );
  }, [candidateTeachers]);

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
    setSelectedLoadIds((prev) =>
      prev.includes(loadId) ? prev.filter((id) => id !== loadId) : [...prev, loadId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOriginalStaffId) {
      setErrorMsg("Please select the teacher going on leave.");
      return;
    }
    if (selectedLoadIds.length === 0) {
      setErrorMsg("Please select at least one subject load to cover.");
      return;
    }
    if (!selectedSubstituteStaffId) {
      setErrorMsg("Please select a substitute teacher.");
      return;
    }
    if (selectedSubstituteStaffId === selectedOriginalStaffId) {
      setErrorMsg("Substitute teacher cannot be the same as the original teacher.");
      return;
    }
    if (!startDate) {
      setErrorMsg("Please select a start date.");
      return;
    }
    if (endDate && endDate < startDate) {
      setErrorMsg("End date cannot be earlier than start date.");
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
      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to assign substitute.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Content size="lg" className="max-w-2xl max-h-[90vh] flex flex-col">
      <Dialog.Header position="static">
        <div className="flex items-center gap-2">
          <UserCheck className="h-5 w-5 text-primary" />
          <Text as="h5" className="font-sans text-lg font-bold">
            Assign Substitute Teacher
          </Text>
        </div>
      </Dialog.Header>

      <form onSubmit={handleSubmit} className="space-y-4 pt-2 overflow-y-auto px-1 flex-1">
        {errorMsg && (
          <Alert status="error" className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="text-sm">{errorMsg}</div>
          </Alert>
        )}

        {/* 1. Teacher on Leave */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Teacher on Leave (Original Teacher)
          </label>
          {initialStaffId ? (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/40 font-medium text-sm">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>{initialStaffName || initialStaffId}</span>
              </div>
              <Badge variant="secondary">ID: {initialStaffId}</Badge>
            </div>
          ) : (
            <select
              value={selectedOriginalStaffId}
              onChange={(e) => setSelectedOriginalStaffId(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
              disabled={isLoadingTeachers}
            >
              <option value="">-- Select Teacher on Leave --</option>
              {teachers.map((t) => (
                <option key={t.staff_id || t.id} value={t.staff_id}>
                  {t.name} ({t.staff_id}) {t.employment_status ? `• ${t.employment_status}` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 2. Select Subject Loads (Whole Program Takeover) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <span>Teaching Program to Cover</span>
              {isLoadingLoads && <Loader2 className="h-3 w-3 animate-spin" />}
            </label>

            {availableLoads.length > 0 && (
              <button
                type="button"
                onClick={handleToggleSelectAll}
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
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
              </button>
            )}
          </div>

          {selectedOriginalStaffId ? (
            teacherLoads.length === 0 && !isLoadingLoads ? (
              <div className="p-4 text-center text-sm text-muted-foreground border rounded-lg bg-muted/20">
                No active published subject loads found for this teacher.
              </div>
            ) : (
              <div className="space-y-2">
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
                      <div
                        key={load.subject_load_id}
                        onClick={() => {
                          if (!isCovered) handleToggleLoad(load.subject_load_id);
                        }}
                        className={`p-3 rounded-lg border transition-all flex items-start justify-between ${
                          isCovered
                            ? "opacity-60 bg-muted/30 border-dashed cursor-not-allowed"
                            : isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary cursor-pointer"
                            : "border-border hover:bg-muted/40 cursor-pointer"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={isCovered}
                            onChange={() => {
                              if (!isCovered) handleToggleLoad(load.subject_load_id);
                            }}
                            className="mt-1 rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 pointer-events-none"
                          />
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">
                                {load.subject_name} {load.subject_codename ? `(${load.subject_codename})` : ""}
                              </span>
                              <Badge variant="outline" className="text-xs font-normal">
                                {load.section_name}
                              </Badge>
                              {load.is_active_period && (
                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px]">
                                  Active Term
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
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
                          </div>
                        </div>

                        {isCovered && (
                          <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300 text-xs shrink-0 ml-2">
                            Covered by {load.active_substitute_name}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          ) : (
            <div className="p-3 text-xs text-muted-foreground border rounded-lg bg-muted/10">
              Select a teacher above to view and assign their teaching program.
            </div>
          )}
        </div>

        {/* 3. Select Substitute Teacher (Grouped Dropdown) */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex justify-between items-center">
            <span>Substitute Teacher</span>
            {dedicatedSubs.length > 0 && (
              <span className="text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
                {dedicatedSubs.length} dedicated substitute(s) available
              </span>
            )}
          </label>
          <select
            value={selectedSubstituteStaffId}
            onChange={(e) => setSelectedSubstituteStaffId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={isLoadingTeachers}
          >
            <option value="">-- Select Substitute Teacher --</option>
            {dedicatedSubs.length > 0 && (
              <optgroup label="🌟 Dedicated Substitute Teachers">
                {dedicatedSubs.map((t) => (
                  <option key={t.staff_id || t.id} value={t.staff_id}>
                    {t.name} ({t.staff_id}) • Substitute
                  </option>
                ))}
              </optgroup>
            )}
            {regularFaculty.length > 0 && (
              <optgroup label="Regular / Other Faculty (Peer Coverage)">
                {regularFaculty.map((t) => (
                  <option key={t.staff_id || t.id} value={t.staff_id}>
                    {t.name} ({t.staff_id}) {t.employment_status ? `• ${t.employment_status}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {dedicatedSubs.length === 0 && candidateTeachers.length > 0 && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 rounded border border-amber-200">
              <Info className="h-3.5 w-3.5 shrink-0" />
              <span>No teachers currently have 'Substitute' employment status. You may select regular faculty for peer coverage or update a teacher's status in Users.</span>
            </div>
          )}
        </div>

        {/* 4. Dates & Reason */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>Start Date *</span>
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>Expected End Date (Optional)</span>
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              min={startDate}
            />
            <p className="text-[11px] text-muted-foreground">Leave blank for indefinite duration.</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Reason / Notes
          </label>
          <Input
            type="text"
            placeholder="e.g. Maternity Leave (approx. 6 months)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <Dialog.Footer position="static" className="pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || selectedLoadIds.length === 0 || !selectedSubstituteStaffId}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
