import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Text } from "@/components/retroui/Text";
import { TimePickerSingle, type TimeValue } from "@/components/retroui/TimePicker";
import {
  getSubjectLoadStudioData,
  validateSubjectLoads,
  autoScheduleSubjectLoads,
  batchSaveSubjectLoads,
  type SubjectLoadItem,
  type SubjectLoadStudioData,
  type ConflictItem,
  type TeacherWorkloadItem,
} from "@/lib/api";
import BreakConfigDrawer, { type PeriodTemplateSlotItem } from "@/pages/admin/forms/BreakConfigDrawer";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Send,
  AlertCircle,
  Plus,
  Trash2,
  Wand2,
  Sparkles,
  Zap,
  Settings,
  Unlock,
  Globe,
  Layers,
  ChevronDown,
} from "lucide-react";

function stringToTimeValue(str?: string | null, fallbackHour = 8): TimeValue {
  if (!str) return { hour: fallbackHour, minute: 0, period: "AM" };
  const parts = str.split(":");
  if (parts.length < 2) return { hour: fallbackHour, minute: 0, period: "AM" };
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  let p = "AM";
  if (h >= 12) {
    p = "PM";
    if (h > 12) h -= 12;
  } else if (h === 0) {
    h = 12;
  }
  return { hour: h, minute: m, period: p };
}

function timeValueToString(tv: TimeValue): string {
  let h = tv.hour;
  if (tv.period === "PM" && h < 12) h += 12;
  if (tv.period === "AM" && h === 12) h = 0;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(tv.minute)}`;
}

function isSubjectOfferedForClass(
  sub: { subject_id: number; academic_level_id: number },
  cls: { academic_level_id: number; pathway?: string | null },
  offerings: Array<{ subject_id: number; academic_level_id: number; pathway?: string | null }>
): boolean {
  if (sub.academic_level_id !== cls.academic_level_id) return false;
  if (!offerings || offerings.length === 0) return true;

  const clsPathway = (cls.pathway || "general").toLowerCase();

  return offerings.some((so) => {
    if (so.subject_id !== sub.subject_id || so.academic_level_id !== cls.academic_level_id) {
      return false;
    }
    const soPathway = (so.pathway || "general").toLowerCase();
    return (
      soPathway === "both" ||
      soPathway === clsPathway ||
      (soPathway === "general" && clsPathway === "general")
    );
  });
}

const DAYS = [
  { key: "MON", label: "M" },
  { key: "TUE", label: "T" },
  { key: "WED", label: "W" },
  { key: "THU", label: "Th" },
  { key: "FRI", label: "F" },
];

export default function SubjectLoadStudio() {
  const [studioData, setStudioData] = useState<SubjectLoadStudioData | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState<number | null>(null);
  const [selectedGradeId, setSelectedGradeId] = useState<string>("all");
  const [loads, setLoads] = useState<SubjectLoadItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [teacherWorkloads, setTeacherWorkloads] = useState<TeacherWorkloadItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [isBreakDrawerOpen, setIsBreakDrawerOpen] = useState<boolean>(false);
  const [periodTemplateSlots, setPeriodTemplateSlots] = useState<PeriodTemplateSlotItem[]>([]);
  const [isToolsOpen, setIsToolsOpen] = useState<boolean>(false);
  const [isPublishOpen, setIsPublishOpen] = useState<boolean>(false);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const [expandedIssueRule, setExpandedIssueRule] = useState<string | null>(null);

  const activeGroupKey = useMemo(() => {
    if (selectedGradeId === "all") return "JHS_45MIN";
    const levelObj = studioData?.academic_levels.find((l) => String(l.academic_level_id) === selectedGradeId);
    const grade = levelObj?.grade_level || 7;
    if (grade >= 11) {
      const classInLevel = studioData?.classes.find((c) => String(c.academic_level_id) === selectedGradeId);
      const name = (classInLevel?.section_name || "").toLowerCase();
      if (name.includes("del mundo") || name.includes("reyes")) return "SHS_DELMUNDO_REYES";
      return "SHS_CAMPOS_ZARA";
    }
    return "JHS_45MIN";
  }, [selectedGradeId, studioData]);

  const activeGroupBreakSlots = useMemo(() => {
    return periodTemplateSlots.filter((s) => s.template_group === activeGroupKey && s.is_locked_break);
  }, [periodTemplateSlots, activeGroupKey]);

  const levelClassIds = useMemo(() => {
    if (selectedGradeId === "all") return new Set<number>();
    return new Set((studioData?.classes || []).filter((c) => String(c.academic_level_id) === selectedGradeId).map((c) => c.class_id));
  }, [selectedGradeId, studioData]);

  const isCurrentPublished = useMemo(() => {
    const targetLoads = selectedGradeId !== "all"
      ? loads.filter((l) => levelClassIds.has(l.class_id))
      : loads;
    if (targetLoads.length === 0) return false;
    const hasUnassigned = targetLoads.some((l) => !l.staff_id);
    if (hasUnassigned) return false;
    return targetLoads.every((l) => l.status === "published");
  }, [loads, selectedGradeId, levelClassIds]);

  const currentVersionNumber = useMemo(() => {
    return loads[0]?.version || 1;
  }, [loads]);

  const prePublishChecklistCount = useMemo(() => {
    const errorRules = new Set(conflicts.filter((c) => c.severity === "error").map((c) => c.rule));
    return Math.max(0, 6 - errorRules.size);
  }, [conflicts]);

  const groupedIssues = useMemo(() => {
    const map: Record<string, { title: string; explanation: string; severity: "error" | "warning"; items: typeof conflicts }> = {};

    conflicts.forEach((conf) => {
      let key = conf.rule || "UNSPECIFIED_RULE";
      let title = key.replace(/_/g, " ");
      let explanation = conf.message || "Conflict error detected.";
      let severity = conf.severity || "error";

      if (key === "MATH_SCIENCE_DURATION_MISMATCH" || key === "DURATION_MISMATCH") {
        key = "DURATION_MISMATCH";
        title = "Period shorter than subject requires";
        explanation = "Math & Science core subjects need 60 min/day. The active break schedule leaves 45-min periods, so every Math/Science slot falls short by 15 min.";
        severity = "warning";
      } else if (key === "TEACHER_DOUBLE_BOOKING") {
        key = "TEACHER_DOUBLE_BOOKING";
        title = "Teacher double-booked";
        explanation = "Assigned teacher has overlapping period commitments across two classes.";
        severity = "error";
      } else if (key === "SECTION_DOUBLE_BOOKING") {
        key = "SECTION_DOUBLE_BOOKING";
        title = "Section double-booked";
        explanation = "Section has two subjects scheduled at the exact same time slot.";
        severity = "error";
      } else if (key === "BREAK_TIME_VIOLATION") {
        key = "BREAK_TIME_VIOLATION";
        title = "Break time overlap";
        explanation = "Subject schedule overlaps with locked Homeroom, Recess, or Lunch walls.";
        severity = "error";
      } else if (key === "TEACHER_CAPACITY_LIMIT") {
        key = "TEACHER_CAPACITY_LIMIT";
        title = "Teacher workload capacity exceeded";
        explanation = "Assigned daily or weekly teaching hours exceed max capacity policy limits.";
        severity = "error";
      }

      if (!map[key]) {
        map[key] = { title, explanation, severity, items: [] };
      }
      map[key].items.push(conf);
    });

    return Object.values(map);
  }, [conflicts]);

  const handleHighlightKey = (key: string | undefined, classId?: number | null) => {
    if (!key) return;

    if (classId && studioData) {
      const targetClass = studioData.classes.find((c) => c.class_id === classId);
      if (targetClass && selectedGradeId !== "all" && String(targetClass.academic_level_id) !== selectedGradeId) {
        setSelectedGradeId(String(targetClass.academic_level_id));
      }
    }

    setHighlightedKey(key);
    setTimeout(() => {
      const targetId = `subject-row-${key}`;
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);

    setTimeout(() => {
      setHighlightedKey((prev) => (prev === key ? null : prev));
    }, 2500);
  };

  // Load studio data
  const loadStudio = useCallback(async (periodId?: number) => {
    setIsLoading(true);
    setNotice(null);
    try {
      const data = await getSubjectLoadStudioData(periodId);
      setStudioData(data);
      setSelectedPeriodId(data.active_period_id);
      if ((data as any).period_template_slots) {
        setPeriodTemplateSlots((data as any).period_template_slots);
      }

      // Initialize subject loads: populate missing loads from section x subject combinations
      const existing = data.existing_loads || [];
      const periodIdToUse = data.active_period_id;

      const initialLoads: SubjectLoadItem[] = [];

      const offerings = data.subject_offerings || [];

      (data.classes || []).forEach((cls) => {
        // Find subjects matching class academic level & pathway offering for this period
        const levelSubjects = (data.subjects || []).filter((sub) =>
          isSubjectOfferedForClass(sub, cls, offerings)
        );

        levelSubjects.forEach((sub) => {
          const matched = existing.filter(
            (ex) => ex.class_id === cls.class_id && ex.subject_id === sub.subject_id
          );

          if (matched.length > 0) {
            matched.forEach((m, idx) => {
              initialLoads.push({
                _key: m.subject_load_id
                  ? `sl_${m.subject_load_id}`
                  : `slot_${cls.class_id}_${sub.subject_id}_${idx}`,
                subject_load_id: m.subject_load_id,
                class_id: m.class_id,
                subject_id: m.subject_id,
                staff_id: m.staff_id || null,
                academic_period_id: periodIdToUse,
                start_time: m.start_time || null,
                end_time: m.end_time || null,
                days_of_week: m.days_of_week || [],
                status: m.status || "draft",
              });
            });
          } else {
            // No DB record yet — create synthetic draft load so unassigned counts are accurate
            initialLoads.push({
              _key: `new_${cls.class_id}_${sub.subject_id}`,
              subject_load_id: undefined,
              class_id: cls.class_id,
              subject_id: sub.subject_id,
              staff_id: null,
              academic_period_id: periodIdToUse,
              start_time: null,
              end_time: null,
              days_of_week: [],
              status: "draft",
              is_locked: false,
            });
          }
        });
      });

      setLoads(initialLoads);

      // Trigger initial conflict validation
      if (initialLoads.length > 0) {
        const valRes = await validateSubjectLoads(periodIdToUse, initialLoads);
        setConflicts(valRes.conflicts);
        setTeacherWorkloads(valRes.teacher_workloads);
      }
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to load Subject Load Studio.",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStudio();
  }, [loadStudio]);

  // Run validation whenever loads change
  const runValidation = useCallback(
    async (updatedLoads: SubjectLoadItem[]) => {
      if (!selectedPeriodId) return;
      try {
        const valRes = await validateSubjectLoads(selectedPeriodId, updatedLoads);
        setConflicts(valRes.conflicts);
        setTeacherWorkloads(valRes.teacher_workloads);
      } catch (e) {
        console.error("Validation error:", e);
      }
    },
    [selectedPeriodId]
  );

  // Load update handlers
  const handleTeacherChange = (classId: number, subjectId: number, staffId: string | null) => {
    const updated = loads.map((item) =>
      item.class_id === classId && item.subject_id === subjectId
        ? { ...item, staff_id: staffId === "none" ? null : staffId, status: "draft", is_locked: false }
        : item
    );
    setLoads(updated);
    void runValidation(updated);
  };

  const handleTimeChange = (
    slotKey: string,
    field: "start_time" | "end_time",
    val: string
  ) => {
    const updated = loads.map((item) => {
      if (item._key !== slotKey) return item;

      const newItem = { ...item, [field]: val, status: "draft", is_locked: false };

      // When start_time switches to PM, auto-force end_time to PM too
      if (field === "start_time") {
        const startTv = stringToTimeValue(val);
        if (startTv.period === "PM") {
          const endTv = stringToTimeValue(item.end_time, 9);
          if (endTv.period === "AM") {
            const pmHour = endTv.hour >= 1 && endTv.hour <= 9 ? endTv.hour : 12;
            newItem.end_time = timeValueToString({ hour: pmHour, minute: endTv.minute, period: "PM" });
          }
        }
      }

      return newItem;
    });
    setLoads(updated);
    void runValidation(updated);
  };

  const handleToggleDay = (slotKey: string, dayKey: string) => {
    const updated = loads.map((item) => {
      if (item._key === slotKey) {
        const currentDays = item.days_of_week || [];
        const newDays = currentDays.includes(dayKey)
          ? currentDays.filter((d) => d !== dayKey)
          : [...currentDays, dayKey];
        return { ...item, days_of_week: newDays, status: "draft", is_locked: false };
      }
      return item;
    });
    setLoads(updated);
    void runValidation(updated);
  };

  const handleAddSlot = (classId: number, subjectId: number) => {
    const existingSlots = loads.filter(
      (l) => l.class_id === classId && l.subject_id === subjectId
    );
    const firstSlot = existingSlots[0];
    const uniqueId = Math.random().toString(36).substring(2, 7);
    const newKey = `slot_${classId}_${subjectId}_${Date.now()}_${uniqueId}`;

    // Pick unselected day if available
    const usedDays = new Set(existingSlots.flatMap((s) => s.days_of_week || []));
    const allDays = ["THU", "FRI", "TUE", "MON", "WED"];
    const defaultDay = allDays.find((d) => !usedDays.has(d)) || "THU";

    const newSlot: SubjectLoadItem = {
      _key: newKey,
      class_id: classId,
      subject_id: subjectId,
      staff_id: firstSlot?.staff_id || null,
      academic_period_id: selectedPeriodId || 1,
      start_time: "13:00",
      end_time: "14:00",
      days_of_week: [defaultDay],
      status: "draft",
    };

    const updated = [...loads, newSlot];
    setLoads(updated);
    void runValidation(updated);
  };

  const handleRemoveSlot = (slotKey: string) => {
    const updated = loads.filter((l) => l._key !== slotKey);
    setLoads(updated);
    void runValidation(updated);
  };

  // Auto-schedule entire studio or single section
  const handleAutoSchedule = async (targetClassId?: number, mode: "standard" | "teacher_swap" = "standard") => {
    if (!selectedPeriodId) return;
    setIsLoading(true);
    setNotice(null);
    try {
      let currentLoads = [...loads];
      let targetClassIds: number[] = [];
      if (targetClassId) {
        const targetClass = studioData?.classes.find((c) => c.class_id === targetClassId);
        const pairedClass = studioData?.classes.find(
          (c) =>
            c.class_id !== targetClassId &&
            (c.class_id === targetClass?.paired_class_id ||
              c.academic_level_id === targetClass?.academic_level_id)
        );
        targetClassIds = [targetClassId, pairedClass?.class_id].filter(
          (id): id is number => typeof id === "number"
        );
      }

      const targetClasses = targetClassId
        ? studioData?.classes.filter((c) => targetClassIds.includes(c.class_id)) || []
        : studioData?.classes || [];

      targetClasses.forEach((cls) => {
        const offerings = studioData?.subject_offerings || [];

        const levelSubjects = (studioData?.subjects || []).filter((sub) =>
          isSubjectOfferedForClass(sub, cls, offerings)
        );
        levelSubjects.forEach((sub) => {
          const hasSlot = currentLoads.some(
            (l) => l.class_id === cls.class_id && l.subject_id === sub.subject_id
          );
          if (!hasSlot) {
            currentLoads.push({
              _key: `slot_${cls.class_id}_${sub.subject_id}_${Date.now()}`,
              class_id: cls.class_id,
              subject_id: sub.subject_id,
              staff_id: null,
              academic_period_id: selectedPeriodId,
              start_time: null,
              end_time: null,
              days_of_week: [],
              status: "draft",
            });
          }
        });
      });

      const loadsToProcess = targetClassId
        ? currentLoads.filter((l) => targetClassIds.includes(l.class_id))
        : currentLoads;

      const effectiveMode = targetClassId ? "teacher_swap" : mode;
      const res = await autoScheduleSubjectLoads(selectedPeriodId, loadsToProcess, effectiveMode);

      // Merge updated scheduled loads back into full loads array
      const scheduledMap = new Map(
        res.scheduled_loads.map((sl) => [`${sl.class_id}_${sl.subject_id}`, sl])
      );

      const mergedLoads = currentLoads.map((item) => {
        const key = `${item.class_id}_${item.subject_id}`;
        const match = scheduledMap.get(key);
        if (match && (targetClassId === undefined || targetClassIds.includes(item.class_id))) {
          return {
            ...item,
            start_time: match.start_time || "08:00",
            end_time: match.end_time || "10:00",
            days_of_week: match.days_of_week && match.days_of_week.length > 0 ? match.days_of_week : ["MON", "WED"],
            status: "draft",
            is_locked: false,
          };
        }
        return item;
      });

      setLoads(mergedLoads);
      setConflicts(res.conflicts);
      setTeacherWorkloads(res.teacher_workloads);

      const errCount = res.conflicts.filter((c) => c.severity === "error").length;
      const warnCount = res.conflicts.filter((c) => c.severity === "warning").length;

      if (errCount > 0) {
        setNotice({
          message: `Auto-fit complete. Detected ${errCount} conflict(s). Please review highlighted errors.`,
          type: "error",
        });
      } else if (warnCount > 0) {
        setNotice({
          message: `Auto-fit complete with ${warnCount} warning(s). Please check conflict tracker.`,
          type: "error",
        });
      } else {
        setNotice({
          message: targetClassId
            ? "Successfully auto-fitted section timetable without conflicts!"
            : "Successfully auto-generated conflict-free timetables for all subjects!",
          type: "success",
        });
      }
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : "Failed to auto-generate timetable.",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Preset pattern applications
  const handleApplyPreset = (classId: number, subjectId: number, pattern: "2day" | "3day" | "4day") => {
    let days: string[] = ["MON", "WED"];
    let startTime = "08:00";
    let endTime = "10:00";

    if (pattern === "2day") {
      days = ["MON", "WED"];
      startTime = "08:00";
      endTime = "10:00";
    } else if (pattern === "3day") {
      days = ["MON", "WED", "FRI"];
      startTime = "08:00";
      endTime = "09:20";
    } else if (pattern === "4day") {
      days = ["MON", "TUE", "WED", "THU"];
      startTime = "08:00";
      endTime = "09:00";
    }

    const updated = loads.map((l) =>
      l.class_id === classId && l.subject_id === subjectId
        ? { ...l, days_of_week: days, start_time: startTime, end_time: endTime, status: "draft", is_locked: false }
        : l
    );
    setLoads(updated);
    void runValidation(updated);
  };

  // Save / Publish
  const handleSave = async (
    action: "draft" | "publish",
    publishScope: "all" | "level" | "section" = "all",
    targetClassId?: number | null
  ) => {
    if (!selectedPeriodId || isSaving) return;
    setIsSaving(true);
    setNotice(null);

    try {
      const levelIdToSave = selectedGradeId !== "all" ? Number(selectedGradeId) : 1;
      const res = await batchSaveSubjectLoads(
        selectedPeriodId,
        levelIdToSave,
        action,
        loads,
        publishScope,
        publishScope === "level" ? levelIdToSave : null,
        targetClassId ?? null
      );

      setConflicts(res.conflicts);
      setNotice({
        message: res.message,
        type: "success",
      });

      // Optimistic update: immediately flip in-memory load statuses
      // so section badges update instantly without waiting for DB reload
      setLoads((prev) =>
        prev.map((l) => {
          const isInScope =
            publishScope === "section"
              ? l.class_id === targetClassId
              : publishScope === "level"
                ? levelClassIds.has(l.class_id)
                : true; // "all"

          if (action === "publish" && isInScope && Boolean(l.staff_id)) {
            return { ...l, status: "published", is_locked: true };
          }
          if (action === "draft" && isInScope) {
            return { ...l, status: "draft", is_locked: false };
          }
          return l;
        })
      );

      // Refresh studio data to sync with DB
      void loadStudio(selectedPeriodId);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : `Failed to ${action} subject loads.`,
        type: "error",
      });
    } finally {
      setIsSaving(false);
      setIsPublishOpen(false);
    }
  };

  // Filtered classes to display in Left Pane
  const filteredClasses = useMemo(() => {
    if (!studioData) return [];
    return studioData.classes.filter((cls) => {
      if (selectedGradeId !== "all" && String(cls.academic_level_id) !== selectedGradeId) {
        return false;
      }
      return true;
    });
  }, [studioData, selectedGradeId]);

  // Compute teacher availability helper
  const getTeacherAvailabilityStatus = (staffId: string, classId: number, subjectId: number) => {
    const targetLoad = loads.find((l) => l.class_id === classId && l.subject_id === subjectId);
    if (!targetLoad || !targetLoad.start_time || !targetLoad.end_time) return "Available";

    // Check if staff has overlap at target time
    const staffLoads = loads.filter(
      (l) =>
        l.staff_id === staffId &&
        !(l.class_id === classId && l.subject_id === subjectId) &&
        l.start_time &&
        l.end_time
    );

    for (const sl of staffLoads) {
      const commonDays = (targetLoad.days_of_week || []).filter((d) =>
        (sl.days_of_week || []).includes(d)
      );
      if (commonDays.length > 0) {
        const s1 = parseMin(targetLoad.start_time);
        const e1 = parseMin(targetLoad.end_time);
        const s2 = parseMin(sl.start_time);
        const e2 = parseMin(sl.end_time);
        if (s1 < e2 && s2 < e1) {
          return `⚠️ Conflict (Overlap at ${sl.start_time})`;
        }
      }
    }
    return "Available";
  };

  const parseMin = (t?: string | null) => {
    if (!t) return 0;
    const parts = t.split(":");
    return Number(parts[0]) * 60 + (Number(parts[1]) || 0);
  };

  // Check if a specific load has an error conflict
  const getLoadConflict = (classId: number, subjectId: number) => {
    const key = `${classId}_${subjectId}`;
    return conflicts.find(
      (c) => c.affected_key === key || (c.class_id === classId && c.subject_id === subjectId)
    );
  };

  const errorConflictsCount = conflicts.filter((c) => c.severity === "error").length;
  const warningConflictsCount = conflicts.filter((c) => c.severity === "warning").length;
  // School-wide unassigned count (used for Master Schedule strict guard)
  const unassignedTotal = loads.filter((l) => !l.staff_id).length;

  const unassignedInCurrentScope = useMemo(() => {
    if (selectedGradeId !== "all") {
      return loads.filter((l) => levelClassIds.has(l.class_id) && !l.staff_id).length;
    }
    return unassignedTotal;
  }, [selectedGradeId, levelClassIds, loads, unassignedTotal]);

  // Grade-level publish: only blocks if current scope has unassigned
  const isGradeLevelPublishDisabled = isSaving || errorConflictsCount > 0 || unassignedInCurrentScope > 0;
  // Master Schedule publish: strictly blocks if ANY subject school-wide is unassigned
  const isMasterPublishDisabled = isSaving || errorConflictsCount > 0 || unassignedTotal > 0;
  // Alias for main header button (depends on current view)
  const isHeaderPublishDisabled = selectedGradeId !== "all" ? isGradeLevelPublishDisabled : isMasterPublishDisabled;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-4 p-4 md:p-6">
          {/* Header */}
          <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <div>
                <Breadcrumb>
                  <Breadcrumb.List>
                    <Breadcrumb.Item>
                      <Breadcrumb.Link href="/admin/classes">Classes</Breadcrumb.Link>
                    </Breadcrumb.Item>
                    <Breadcrumb.Separator />
                    <Breadcrumb.Item>
                      <Breadcrumb.Page>Subject Load Studio</Breadcrumb.Page>
                    </Breadcrumb.Item>
                  </Breadcrumb.List>
                </Breadcrumb>
                <div className="flex items-center gap-2 mt-1">
                  <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                    Subject Load Studio
                  </h1>
                  <Badge
                    size="sm"
                    className={`border-2 border-black font-bold px-2.5 py-0.5 shadow-[2px_2px_0_#000] text-xs ${isCurrentPublished
                      ? "bg-emerald-300 text-emerald-950"
                      : "bg-amber-300 text-amber-950"
                      }`}
                  >
                    {isCurrentPublished ? `🔒 PUBLISHED v${currentVersionNumber}.0` : `📝 DRAFT v${currentVersionNumber}.0`}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Sticky Action Controls */}
            <div className="flex flex-wrap items-center gap-3 self-end md:self-auto">
              <button
                type="button"
                disabled={isSaving}
                onClick={() => void handleSave("draft")}
                className="text-xs font-bold text-black/70 hover:text-black transition-colors px-2 py-1"
              >
                Save Draft
              </button>

              {/* Setup Tools Retro Dropdown */}
              <div className="relative">
                <Button
                  variant="outline"
                  disabled={isLoading || isSaving}
                  onClick={() => setIsToolsOpen((prev) => !prev)}
                  className="border-2 border-black bg-white hover:bg-gray-100 shadow-[2px_2px_0_#000] font-bold text-xs"
                >
                  <Wand2 className="size-3.5 mr-1.5 text-black" />
                  <span>Tools ▾</span>
                </Button>

                {isToolsOpen && (
                  <div
                    className="absolute right-0 mt-1 w-56 bg-white border-2 border-black shadow-[3px_3px_0_#000] p-1.5 z-50 flex flex-col gap-1 rounded"
                    onMouseLeave={() => setIsToolsOpen(false)}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsOpen(false);
                        setIsBreakDrawerOpen(true);
                      }}
                      className="text-xs font-bold text-left px-2.5 py-1.5 hover:bg-purple-100 flex items-center gap-2 rounded transition-colors"
                    >
                      <Settings className="size-3.5 text-purple-900" />
                      <span>Edit Break Timelines</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsOpen(false);
                        void handleAutoSchedule(undefined, "teacher_swap");
                      }}
                      className="text-xs font-bold text-left px-2.5 py-1.5 hover:bg-sky-100 flex items-center gap-2 rounded transition-colors"
                    >
                      <Zap className="size-3.5 text-sky-900" />
                      <span>Auto-Teacher Swap</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsToolsOpen(false);
                        void handleAutoSchedule(undefined, "standard");
                      }}
                      className="text-xs font-bold text-left px-2.5 py-1.5 hover:bg-amber-100 flex items-center gap-2 rounded transition-colors"
                    >
                      <Sparkles className="size-3.5 text-amber-900" />
                      <span>Auto-Generate All</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Publish Dropdown & Action */}
              <div className="relative flex items-center">
                <Button
                  variant="default"
                  disabled={isHeaderPublishDisabled}
                  onClick={() => {
                    const scope = selectedGradeId !== "all" ? "level" : "all";
                    void handleSave("publish", scope);
                  }}
                  className={`border-2 border-black border-r-0 rounded-r-none shadow-[2px_2px_0_#000] font-bold text-xs ${isHeaderPublishDisabled
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed opacity-60"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}
                  title={
                    unassignedInCurrentScope > 0
                      ? `Assign all ${unassignedInCurrentScope} unassigned teacher(s) in this ${selectedGradeId !== "all" ? "grade level" : "school"} before publishing`
                      : errorConflictsCount > 0
                        ? `Fix ${errorConflictsCount} conflict errors before publishing`
                        : "Publish official schedule"
                  }
                >
                  <Send className="size-3.5 mr-1.5" />
                  {selectedGradeId !== "all"
                    ? `Publish Grade Level`
                    : `Publish Master Schedule`}
                </Button>
                <Button
                  variant="default"
                  disabled={isHeaderPublishDisabled}
                  onClick={() => setIsPublishOpen((prev) => !prev)}
                  className={`border-2 border-black rounded-l-none px-2 shadow-[2px_2px_0_#000] font-bold text-xs ${isHeaderPublishDisabled
                    ? "bg-gray-300 text-gray-600 cursor-not-allowed opacity-60"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}
                  title="Publishing options"
                >
                  <ChevronDown className="size-3.5" />
                </Button>

                {isPublishOpen && (
                  <div
                    className="absolute right-0 top-full mt-1 w-64 bg-white border-2 border-black shadow-[3px_3px_0_#000] p-1.5 z-50 flex flex-col gap-1 rounded"
                    onMouseLeave={() => setIsPublishOpen(false)}
                  >
                    {selectedGradeId !== "all" && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsPublishOpen(false);
                          void handleSave("publish", "level");
                        }}
                        className="text-xs font-bold text-left px-2.5 py-2 hover:bg-emerald-100 flex items-center gap-2 rounded transition-colors text-emerald-950"
                      >
                        <Layers className="size-3.5 text-emerald-700" />
                        <div>
                          <div>Publish Current Grade Level</div>
                          <div className="text-[10px] text-muted-foreground font-normal">Publish only loads in this selected grade level</div>
                        </div>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={isMasterPublishDisabled}
                      onClick={() => {
                        if (isMasterPublishDisabled) return;
                        setIsPublishOpen(false);
                        void handleSave("publish", "all");
                      }}
                      title={
                        unassignedTotal > 0
                          ? `Cannot publish master schedule: ${unassignedTotal} subject(s) school-wide have no assigned teacher`
                          : errorConflictsCount > 0
                            ? "Fix all schedule conflicts before publishing master schedule"
                            : "Publish all sections & grades school-wide"
                      }
                      className={`text-xs font-bold text-left px-2.5 py-2 flex items-center gap-2 rounded transition-colors ${isMasterPublishDisabled
                        ? "text-gray-400 cursor-not-allowed opacity-60 bg-gray-50"
                        : "hover:bg-purple-100 text-purple-950"
                        }`}
                    >
                      <Globe className="size-3.5 text-purple-700" />
                      <div>
                        <div>Publish Master Schedule</div>
                        <div className="text-[10px] text-muted-foreground font-normal">
                          {unassignedTotal > 0
                            ? `⚠️ ${unassignedTotal} unassigned subject(s) school-wide`
                            : "Publish all sections & grades school-wide"}
                        </div>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="border-b-2 border-black -mt-1" />

          {/* Notice Alert */}
          {notice && (
            <div
              className={`p-3 border-2 border-black text-sm font-bold shadow-[3px_3px_0_#000] flex items-center gap-2 ${notice.type === "success" ? "bg-[#bbf7d0]" : "bg-[#fecdd3]"
                }`}
            >
              {notice.type === "success" ? (
                <CheckCircle2 className="size-5 text-emerald-800" />
              ) : (
                <AlertTriangle className="size-5 text-rose-800" />
              )}
              {notice.message}
            </div>
          )}

          {/* Filters & Status Bar */}
          <section className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center bg-card p-4 border-2 border-black shadow-[3px_3px_0_#000]">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider block mb-1">
                Academic Period
              </label>
              <Select
                value={String(selectedPeriodId || "")}
                onValueChange={(val) => {
                  const pId = Number(val);
                  setSelectedPeriodId(pId);
                  void loadStudio(pId);
                }}
              >
                <Select.Trigger className="w-full h-9 border-2 border-black">
                  <Select.Value placeholder="Select Period" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {studioData?.academic_periods.map((p) => (
                      <Select.Item key={p.academic_period_id} value={String(p.academic_period_id)}>
                        {p.period_name} {p.is_active ? "(Active)" : ""}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
            </div>

            <div>
              <label className="text-xs font-bold uppercase tracking-wider block mb-1">
                Grade Level
              </label>
              <Select
                value={selectedGradeId}
                onValueChange={(val) => setSelectedGradeId(val)}
              >
                <Select.Trigger className="w-full h-9 border-2 border-black">
                  <Select.Value placeholder="All Grade Levels" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    <Select.Item value="all">All Grade Levels</Select.Item>
                    {studioData?.academic_levels.map((lvl) => (
                      <Select.Item key={lvl.academic_level_id} value={String(lvl.academic_level_id)}>
                        {lvl.level_name}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center justify-end gap-2 pt-4 md:pt-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-1 border-2 border-black font-bold shadow-[1px_1px_0_#000] ${prePublishChecklistCount === 6 ? "bg-emerald-100 text-emerald-950" : "bg-amber-100 text-amber-950"
                    }`}
                >
                  <CheckCircle2 className="size-3.5 text-emerald-700" />
                  <span>Checklist <strong>{prePublishChecklistCount}/6 passed</strong></span>
                </span>

                {errorConflictsCount > 0 ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 border-2 border-black bg-red-100 text-red-950 font-bold shadow-[1px_1px_0_#000]">
                    <AlertCircle className="size-3.5 text-red-700" />
                    <span>✕ <strong>{errorConflictsCount} conflicts</strong> — must resolve to publish</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 border-2 border-black bg-emerald-50 text-emerald-900 font-bold shadow-[1px_1px_0_#000]">
                    <span>Conflicts: <strong>0</strong></span>
                  </span>
                )}

                {warningConflictsCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 border-2 border-black bg-amber-100 text-amber-950 font-bold shadow-[1px_1px_0_#000]">
                    <AlertTriangle className="size-3.5 text-amber-700" />
                    <span>⚠️ <strong>{warningConflictsCount} warnings</strong></span>
                  </span>
                )}

                {unassignedTotal > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 border-2 border-black bg-red-50 text-red-900 font-bold shadow-[1px_1px_0_#000]">
                    <span><strong>{unassignedTotal}</strong> unassigned</span>
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Section Group Timetable Control Bar */}
          <section className="flex flex-wrap items-center justify-between gap-3 bg-purple-50/90 p-3.5 border-2 border-black shadow-[3px_3px_0_#000]">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-purple-900" />
              <span className="text-xs font-bold uppercase tracking-wider text-purple-950">
                Active Section Group Break Schedule ({activeGroupKey}):
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {activeGroupBreakSlots.length === 0 ? (
                <span className="text-xs text-muted-foreground font-semibold">Standard Defaults Active</span>
              ) : (
                activeGroupBreakSlots.map((b) => (
                  <Badge key={`${b.template_group}_${b.display_order}`} size="sm" className="border-2 border-black font-bold bg-white text-black shadow-[1px_1px_0_#000]">
                    {b.slot_type === "HOMEROOM" ? "🌅 " : b.slot_type === "LUNCH" ? "🍱 " : "☕ "}
                    {b.slot_name}: {b.start_time}–{b.end_time}
                  </Badge>
                ))
              )}
              <button
                type="button"
                onClick={() => setIsBreakDrawerOpen(true)}
                className="text-xs font-bold border border-black bg-purple-200 hover:bg-purple-300 text-purple-950 px-2 py-0.5 rounded shadow-[1px_1px_0_#000] ml-1"
              >
                ⚙️ Adjust Breaks
              </button>
            </div>
          </section>

          {isLoading ? (
            <RetroCard className="p-8 text-center border-2 border-black bg-accent font-bold">
              Loading Subject Load Studio...
            </RetroCard>
          ) : (
            /* Two Pane Layout */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* LEFT PANE: Section Schedule List */}
              <main className="lg:col-span-8 flex flex-col gap-6">
                {filteredClasses.length === 0 ? (
                  <RetroCard className="p-8 text-center border-2 border-black bg-accent">
                    <Text as="h3" className="font-bold text-lg">
                      No Class Sections Found
                    </Text>
                    <Text as="p" className="text-sm text-muted-foreground mt-1">
                      Select a different Grade Level or create classes in the admin dashboard.
                    </Text>
                  </RetroCard>
                ) : (
                  filteredClasses.map((cls) => {
                    const offerings = studioData?.subject_offerings || [];
                    const classSubjects = (studioData?.subjects || []).filter((sub) =>
                      isSubjectOfferedForClass(sub, cls, offerings)
                    );

                    const sectionLoads = loads.filter((l) => l.class_id === cls.class_id);
                    const sectionUnassignedCount = sectionLoads.filter((l) => !l.staff_id).length;
                    const hasUnassigned = sectionUnassignedCount > 0 || classSubjects.length === 0;
                    // Section is published when: no unassigned, has loads, every load is status="published"
                    const isSectionPublished = !hasUnassigned && sectionLoads.length > 0 && sectionLoads.every((l) => l.status === "published");
                    const sectionHasErrors = conflicts.some(
                      (c) => c.severity === "error" && (c.class_id === cls.class_id || (c.affected_key && c.affected_key.startsWith(`${cls.class_id}_`)))
                    );
                    const isPublishSectionDisabled = isSaving || sectionHasErrors || sectionUnassignedCount > 0;

                    return (
                      <RetroCard
                        key={cls.class_id}
                        className="border-2 border-black shadow-[4px_4px_0_#000] p-4 bg-background"
                      >
                        <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-4 flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Text as="h3" className="font-bold text-xl">
                              Section: {cls.section_name}
                            </Text>
                            <Badge
                              size="sm"
                              className={`border-2 border-black font-bold text-[10px] px-2 py-0.5 shadow-[1px_1px_0_#000] ${isSectionPublished
                                ? "bg-emerald-200 text-emerald-950"
                                : "bg-amber-200 text-amber-950"
                                }`}
                            >
                              {isSectionPublished ? "🔒 PUBLISHED" : "📝 DRAFT"}
                            </Badge>
                            {(() => {
                              if (!cls.pathway || cls.pathway === "general") return null;
                              const formatted = cls.pathway
                                .replace(/_/g, " ")
                                .replace(/\b\w/g, (l) => l.toUpperCase())
                                .replace(/Stem/i, "STEM");

                              return (
                                <Badge variant="surface" size="sm" className="border-2 border-black font-bold uppercase text-[10px] bg-emerald-100 text-emerald-950 border-emerald-800">
                                  {formatted}
                                </Badge>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {isSectionPublished ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSaving}
                                onClick={() => void handleSave("draft", "section", cls.class_id)}
                                className="border-2 border-black bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-bold shadow-[1px_1px_0_#000]"
                                title="Revert this section to draft status to allow edits"
                              >
                                <Unlock className="size-3.5 mr-1 text-amber-800" />
                                Unlock Section
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isPublishSectionDisabled}
                                onClick={() => void handleSave("publish", "section", cls.class_id)}
                                className={`border-2 border-black font-bold text-xs shadow-[1px_1px_0_#000] ${isPublishSectionDisabled
                                  ? "bg-gray-200 text-gray-500 cursor-not-allowed opacity-70"
                                  : "bg-emerald-100 hover:bg-emerald-200 text-emerald-950"
                                  }`}
                                title={
                                  sectionUnassignedCount > 0
                                    ? `Assign all ${sectionUnassignedCount} unassigned teacher(s) in this section before publishing`
                                    : sectionHasErrors
                                      ? "Fix schedule conflicts in this section before publishing"
                                      : "Publish only this section's schedule"
                                }
                              >
                                <Send className="size-3.5 mr-1 text-emerald-800" />
                                Publish Section
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleAutoSchedule(cls.class_id)}
                              className="border-2 border-black bg-amber-50 hover:bg-amber-100 text-xs font-bold shadow-[1px_1px_0_#000]"
                            >
                              <Wand2 className="size-3.5 mr-1 text-amber-800" />
                              Auto-Fit Section
                            </Button>
                            <Text as="p" className="text-xs text-muted-foreground font-bold">
                              {classSubjects.length} Curriculum Subjects
                            </Text>
                          </div>
                        </div>

                        {classSubjects.length === 0 ? (
                          <div className="p-6 text-center border-2 border-dashed border-black/30 bg-muted/20 my-2">
                            <Text as="p" className="text-sm font-bold text-muted-foreground">
                              No subjects offered in Curriculum Plan for {cls.section_name} in this term.
                            </Text>
                            <Text as="p" className="text-xs text-muted-foreground mt-1">
                              Go to &quot;Subjects &rarr; Curriculum Plan&quot; to enable subject offerings.
                            </Text>
                          </div>
                        ) : (
                          <Table wrapperClassName="overflow-visible">
                            <Table.Header className="font-sans border-b-2 border-black bg-muted/30">
                              <Table.Row>
                                <Table.Head className="font-bold text-black">Subject</Table.Head>
                                <Table.Head className="font-bold text-black">Days & Presets</Table.Head>
                                <Table.Head className="font-bold text-black">Time Slot</Table.Head>
                                <Table.Head className="font-bold text-black">Assigned Teacher</Table.Head>
                              </Table.Row>
                            </Table.Header>
                            <Table.Body>
                              {classSubjects.map((sub) => {
                                const subjectSlots = loads.filter(
                                  (l) => l.class_id === cls.class_id && l.subject_id === sub.subject_id
                                );

                                let scheduledWeeklyHours = 0;
                                subjectSlots.forEach((sl) => {
                                  const dur = (parseMin(sl.end_time) - parseMin(sl.start_time)) / 60;
                                  const numDays = (sl.days_of_week || []).length;
                                  if (dur > 0 && numDays > 0) {
                                    scheduledWeeklyHours += dur * numDays;
                                  }
                                });

                                const conflict = getLoadConflict(cls.class_id, sub.subject_id);
                                const isHighlighted =
                                  highlightedKey === `${cls.class_id}_${sub.subject_id}`;

                                return (
                                  <Table.Row
                                    key={sub.subject_id}
                                    id={`subject-row-${cls.class_id}_${sub.subject_id}`}
                                    className={`transition-all duration-200 border-b border-black/20 ${isHighlighted
                                      ? "bg-amber-200 border-4 border-black ring-4 ring-amber-400 shadow-xl"
                                      : conflict
                                        ? conflict.severity === "error"
                                          ? "bg-red-50/70 border-l-4 border-l-red-600"
                                          : "bg-amber-50/70 border-l-4 border-l-amber-500"
                                        : "hover:bg-gray-50/80"
                                      }`}
                                  >
                                    {/* Subject Column */}
                                    <Table.Cell className="py-2.5 px-3 align-middle min-w-[210px]">
                                      <div className="flex flex-col gap-1">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-bold text-sm text-black">
                                            {sub.subject_name}
                                          </span>
                                          {conflict && (
                                            <span
                                              className={`text-[11px] font-bold px-1.5 py-0.5 rounded border border-black ${conflict.severity === "error" ? "bg-red-200 text-red-950" : "bg-amber-200 text-amber-950"
                                                }`}
                                              title={conflict.message}
                                            >
                                              ⚠️ {conflict.severity === "error" ? "Conflict" : "15 min short"}
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                          <Badge variant="surface" size="sm" className="border border-black font-mono font-bold bg-amber-100 text-black text-[10px]">
                                            {sub.subject_codename || `SUB-${sub.subject_id}`}
                                          </Badge>
                                          {(sub.is_math_or_science || /math|science|physics|chemistry|biology/i.test(sub.subject_name)) && (
                                            <span className="text-[10px] font-bold text-purple-900 bg-purple-100 px-1.5 py-0.5 border border-purple-800 rounded">
                                              1 hr Core
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </Table.Cell>

                                    {/* Days & Time Slot Columns */}
                                    <Table.Cell colSpan={2} className="py-2.5 px-2 align-middle">
                                      {subjectSlots.length === 0 ? (
                                        <span className="text-xs italic text-muted-foreground font-semibold py-1 inline-block">
                                          Unscheduled — click &quot;+ Add Slot&quot; to assign schedule
                                        </span>
                                      ) : (
                                        <div className="flex flex-col gap-2">
                                          {subjectSlots.map((slot, sIdx) => {
                                            const slotKey = slot._key || `slot_${cls.class_id}_${sub.subject_id}_${sIdx}`;
                                            return (
                                              <div key={slotKey} className="flex flex-wrap items-center gap-2.5">
                                                {/* Days Chips */}
                                                <div className="flex flex-wrap gap-0.5">
                                                  {DAYS.map((d) => {
                                                    const isSelected = (slot.days_of_week || []).includes(d.key);
                                                    return (
                                                      <button
                                                        key={d.key}
                                                        type="button"
                                                        onClick={() => handleToggleDay(slotKey, d.key)}
                                                        className={`size-6 text-[11px] font-bold border-2 border-black transition-all ${isSelected
                                                          ? "bg-primary text-primary-foreground shadow-[1px_1px_0_#000]"
                                                          : "bg-background text-foreground opacity-50 hover:opacity-100"
                                                          }`}
                                                      >
                                                        {d.label}
                                                      </button>
                                                    );
                                                  })}
                                                </div>

                                                {/* Time Picker */}
                                                <div className="flex items-center gap-1">
                                                  <TimePickerSingle
                                                    value={stringToTimeValue(slot.start_time, 8)}
                                                    onChange={(newStart) =>
                                                      handleTimeChange(slotKey, "start_time", timeValueToString(newStart))
                                                    }
                                                  />
                                                  <span className="text-xs font-bold text-muted-foreground">–</span>
                                                  <TimePickerSingle
                                                    value={stringToTimeValue(slot.end_time, 9)}
                                                    lockedPeriod={stringToTimeValue(slot.start_time, 8).period === "PM" ? "PM" : undefined}
                                                    onChange={(newEnd) =>
                                                      handleTimeChange(slotKey, "end_time", timeValueToString(newEnd))
                                                    }
                                                  />
                                                </div>

                                                {/* Delete slot button */}
                                                {subjectSlots.length > 1 && (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleRemoveSlot(slotKey)}
                                                    className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 border border-red-300 rounded ml-1"
                                                    title="Remove this time slot"
                                                  >
                                                    <Trash2 className="size-3.5" />
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </Table.Cell>

                                    {/* Smart Teacher Dropdown & Workload Bar */}
                                    <Table.Cell className="py-2.5 px-3 align-middle">
                                      {(() => {
                                        const currentStaffId = subjectSlots[0]?.staff_id;
                                        const teacherObj = (studioData?.teachers || []).find((t) => t.staff_id === currentStaffId);
                                        const currentStatusText = currentStaffId
                                          ? getTeacherAvailabilityStatus(
                                            currentStaffId,
                                            cls.class_id,
                                            sub.subject_id
                                          )
                                          : "";
                                        const currentHasConflict = currentStatusText.includes("Conflict");

                                        // Compute teacher workload hours
                                        const tWorkload = teacherWorkloads.find((w) => w.staff_id === currentStaffId);
                                        const weeklyHours = tWorkload?.total_weekly_hours || 0;
                                        const maxWeeklyHours = 30.0;
                                        const pct = Math.min(100, Math.round((weeklyHours / maxWeeklyHours) * 100));

                                        const rowKey = `${cls.class_id}_${sub.subject_id}`;
                                        const isRowMenuOpen = openRowKey === rowKey;

                                        return (
                                          <div className="flex items-center gap-2">
                                            <div className="flex flex-col gap-1">
                                              <Select
                                                value={currentStaffId || "none"}
                                                onValueChange={(val) =>
                                                  handleTeacherChange(cls.class_id, sub.subject_id, val)
                                                }
                                              >
                                                <Select.Trigger
                                                  className={`w-[170px] h-8 border-2 border-black font-bold text-xs transition-colors ${!currentStaffId
                                                    ? "bg-red-50 text-red-900 border-red-500 shadow-[1px_1px_0_#000]"
                                                    : currentHasConflict
                                                      ? "bg-red-100 text-red-950 border-red-600 font-bold"
                                                      : "bg-white text-black shadow-[1px_1px_0_#000]"
                                                    }`}
                                                >
                                                  <div className="flex items-center justify-between w-full overflow-hidden">
                                                    <Select.Value placeholder="Select Teacher" />
                                                    {currentHasConflict && (
                                                      <span className="text-red-600 text-xs font-bold shrink-0 ml-1" title={currentStatusText}>
                                                        ⚠️
                                                      </span>
                                                    )}
                                                  </div>
                                                </Select.Trigger>
                                                <Select.Content>
                                                  <Select.Group>
                                                    <Select.Item value="none">
                                                      <span className="italic text-red-700 font-bold">
                                                        -- Unassigned --
                                                      </span>
                                                    </Select.Item>
                                                    {(studioData?.teachers || [])
                                                      .filter(
                                                        (t) =>
                                                          !t.staff_id.toUpperCase().startsWith("ADM") &&
                                                          !t.name.toLowerCase().includes("admin")
                                                      )
                                                      .map((t) => {
                                                        const statusText = getTeacherAvailabilityStatus(
                                                          t.staff_id,
                                                          cls.class_id,
                                                          sub.subject_id
                                                        );
                                                        const hasConflict = statusText.includes("Conflict");

                                                        return (
                                                          <Select.Item key={t.staff_id} value={t.staff_id}>
                                                            <div className="flex flex-col text-xs py-0.5">
                                                              <span className="font-bold">{t.name}</span>
                                                              {hasConflict && (
                                                                <span className="text-red-600 font-semibold text-[11px] leading-tight">
                                                                  {statusText}
                                                                </span>
                                                              )}
                                                            </div>
                                                          </Select.Item>
                                                        );
                                                      })}
                                                  </Select.Group>
                                                </Select.Content>
                                              </Select>

                                              {/* Inline Teacher Workload Capacity Indicator */}
                                              {currentStaffId && teacherObj && (
                                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground">
                                                  <div className="w-12 h-1.5 bg-gray-200 border border-black rounded-full overflow-hidden">
                                                    <div
                                                      className={`h-full ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-500" : "bg-emerald-500"
                                                        }`}
                                                      style={{ width: `${pct}%` }}
                                                    />
                                                  </div>
                                                  <span>{weeklyHours.toFixed(1)}h/wk</span>
                                                </div>
                                              )}
                                            </div>

                                            {/* Row Action Overflow Menu (⋯) */}
                                            <div className="relative">
                                              <button
                                                type="button"
                                                onClick={() => setOpenRowKey(isRowMenuOpen ? null : rowKey)}
                                                className="size-7 border-2 border-black bg-white hover:bg-gray-100 font-bold shadow-[1px_1px_0_#000] flex items-center justify-center text-xs rounded"
                                                title="Row Presets & Options"
                                              >
                                                ⋯
                                              </button>

                                              {isRowMenuOpen && (
                                                <div
                                                  className="absolute right-0 mt-1 w-44 bg-white border-2 border-black shadow-[3px_3px_0_#000] p-1 z-50 flex flex-col gap-1 rounded"
                                                  onMouseLeave={() => setOpenRowKey(null)}
                                                >
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setOpenRowKey(null);
                                                      handleAddSlot(cls.class_id, sub.subject_id);
                                                    }}
                                                    className="text-[11px] font-bold text-left px-2 py-1 hover:bg-neutral-100 flex items-center gap-1 rounded"
                                                  >
                                                    <Plus className="size-3 text-primary" />
                                                    <span>+ Add Time Slot</span>
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setOpenRowKey(null);
                                                      handleApplyPreset(cls.class_id, sub.subject_id, "2day");
                                                    }}
                                                    className="text-[11px] font-bold text-left px-2 py-1 hover:bg-sky-100 text-sky-950 rounded"
                                                  >
                                                    Preset: 2-Day (MW 2h)
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setOpenRowKey(null);
                                                      handleApplyPreset(cls.class_id, sub.subject_id, "3day");
                                                    }}
                                                    className="text-[11px] font-bold text-left px-2 py-1 hover:bg-purple-100 text-purple-950 rounded"
                                                  >
                                                    Preset: 3-Day (MWF 1.3h)
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </Table.Cell>
                                  </Table.Row>
                                );
                              })}
                            </Table.Body>
                          </Table>
                        )}
                      </RetroCard>
                    );
                  })
                )}
              </main>

              {/* RIGHT PANE: Live Conflict Tracker & Teacher Workload */}
              <aside className="lg:col-span-4 flex flex-col gap-6">
                {/* Grouped Issues Card (Root-Cause Aggregated) */}
                <RetroCard className="border-2 border-black shadow-[4px_4px_0_#000] p-4 bg-background">
                  <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-5 text-amber-600" />
                      <Text as="h3" className="font-bold text-lg">
                        Issues ({conflicts.length})
                      </Text>
                    </div>
                  </div>

                  {conflicts.length === 0 ? (
                    <div className="p-4 bg-emerald-50 border-2 border-black text-emerald-900 font-bold text-xs flex items-center gap-2 shadow-[2px_2px_0_#000]">
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-700" />
                      <span>All schedules and workloads are valid! No conflicts detected.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 max-h-[440px] overflow-y-auto pr-1">
                      {groupedIssues.map((group) => {
                        const isExpanded = expandedIssueRule === group.title;
                        return (
                          <div
                            key={group.title}
                            className={`p-3 border-2 border-black text-xs transition-all shadow-[2px_2px_0_#000] ${group.severity === "error"
                              ? "bg-red-50 text-red-950 border-red-800"
                              : "bg-amber-50 text-amber-950 border-amber-800"
                              }`}
                          >
                            <div className="flex items-center justify-between font-bold mb-1">
                              <span className="text-sm font-bold">{group.title}</span>
                              <span
                                className={`px-2 py-0.5 border border-black font-bold text-xs rounded ${group.severity === "error" ? "bg-red-200 text-red-950" : "bg-amber-200 text-amber-950"
                                  }`}
                              >
                                {group.items.length}
                              </span>
                            </div>
                            <p className="font-medium text-xs leading-relaxed text-black/80 mb-2">
                              {group.explanation}
                            </p>

                            <button
                              type="button"
                              onClick={() => setExpandedIssueRule(isExpanded ? null : group.title)}
                              className="text-xs font-bold underline hover:text-black transition-colors flex items-center gap-1 mt-1"
                            >
                              <span>{isExpanded ? "Hide details ▲" : `Show affected items (${group.items.length}) ▾`}</span>
                            </button>

                            {isExpanded && (
                              <div className="mt-2.5 pt-2 border-t border-black/20 flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                                {group.items.map((conf, cIdx) => (
                                  <div
                                    key={cIdx}
                                    onClick={() => {
                                      const targetKey = conf.affected_key || (conf.class_id && conf.subject_id ? `${conf.class_id}_${conf.subject_id}` : undefined);
                                      handleHighlightKey(targetKey, conf.class_id);
                                    }}
                                    className="p-1.5 bg-white border border-black text-[11px] font-semibold cursor-pointer hover:bg-gray-100 flex items-center justify-between rounded"
                                  >
                                    <span className="truncate pr-2">{conf.message}</span>
                                    <span className="text-[10px] font-bold underline shrink-0">View</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </RetroCard>

                {/* Teacher Workload Capacity Card */}
                <RetroCard className="border-2 border-black shadow-[4px_4px_0_#000] p-4 bg-background">
                  <div className="flex flex-col gap-1 border-b-2 border-black pb-3 mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="size-5 text-blue-600" />
                      <Text as="h3" className="font-bold text-lg">
                        Teacher Capacity Tracker
                      </Text>
                    </div>
                    <span className="text-[11px] font-bold text-muted-foreground">
                      Limits: Max 6.0 hrs/day • Max 4 subjects/day
                    </span>
                  </div>

                  <div className="flex flex-col gap-4 max-h-[420px] overflow-y-auto pr-1">
                    {teacherWorkloads.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic font-semibold">
                        Assign teachers to subject loads to monitor workload capacity.
                      </p>
                    ) : (
                      teacherWorkloads.map((tw) => (
                        <div
                          key={tw.staff_id}
                          className={`p-3 border-2 border-black text-xs ${tw.has_capacity_warning ? "bg-red-50 border-red-600" : "bg-muted/20"
                            }`}
                        >
                          <div className="flex items-center justify-between font-bold mb-1">
                            <span className="text-sm">{tw.staff_name}</span>
                            <span className="font-mono">
                              {tw.total_weekly_hours.toFixed(1)} hrs/wk
                            </span>
                          </div>

                          {/* Daily Breakdown */}
                          <div className="grid grid-cols-5 gap-1 mt-2">
                            {["MON", "TUE", "WED", "THU", "FRI"].map((dayKey) => {
                              const hrs = tw.daily_hours[dayKey] || 0;
                              const subCount = tw.daily_subjects_count[dayKey] || 0;
                              const isOverLimit = hrs > 6.0 || subCount > 4;

                              return (
                                <div
                                  key={dayKey}
                                  className={`flex flex-col items-center p-1 border text-[10px] font-bold ${isOverLimit
                                    ? "bg-red-200 border-red-700 text-red-900"
                                    : hrs > 0
                                      ? "bg-emerald-100 border-emerald-700 text-emerald-900"
                                      : "bg-background border-black/30 text-muted-foreground"
                                    }`}
                                >
                                  <span>{dayKey.slice(0, 2)}</span>
                                  <span className="font-mono text-[11px] mt-0.5">
                                    {hrs > 0 ? `${hrs.toFixed(1)}h` : "-"}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </RetroCard>
              </aside>
            </div>
          )}
        </div>
      </div>

      <BreakConfigDrawer
        open={isBreakDrawerOpen}
        onClose={() => setIsBreakDrawerOpen(false)}
        initialSlots={periodTemplateSlots}
        onSaved={() => void loadStudio(selectedPeriodId || undefined)}
      />
    </AppLayout>
  );
}
