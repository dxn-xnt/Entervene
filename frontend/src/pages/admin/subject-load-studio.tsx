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
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Save,
  Send,
  UserCheck,
  AlertCircle,
  Plus,
  Trash2,
  Wand2,
  Sparkles,
  Zap,
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

      // Initialize subject loads: populate missing loads from section x subject combinations
      const existing = data.existing_loads || [];
      const periodIdToUse = data.active_period_id;

      const initialLoads: SubjectLoadItem[] = [];

      const offerings = data.subject_offerings || [];

      data.classes.forEach((cls) => {
        // Find subjects matching class academic level & pathway offering for this period
        const levelSubjects = data.subjects.filter((sub) => {
          if (sub.academic_level_id !== cls.academic_level_id) return false;
          if (offerings.length > 0) {
            const clsPathway = (cls.pathway || "general").toLowerCase();
            return offerings.some(
              (so) =>
                so.subject_id === sub.subject_id &&
                so.academic_level_id === cls.academic_level_id &&
                (so.pathway === "both" ||
                  so.pathway.toLowerCase() === clsPathway ||
                  (so.pathway === "general" && clsPathway === "general"))
            );
          }
          return true;
        });

        levelSubjects.forEach((sub) => {
          const matched = existing.filter(
            (ex) => ex.class_id === cls.class_id && ex.subject_id === sub.subject_id
          );

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
        ? { ...item, staff_id: staffId === "none" ? null : staffId }
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

      const newItem = { ...item, [field]: val };

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
        return { ...item, days_of_week: newDays };
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
        const clsPathway = (cls.pathway || "general").toLowerCase();

        const levelSubjects = (studioData?.subjects || []).filter((sub) => {
          if (sub.academic_level_id !== cls.academic_level_id) return false;
          if (offerings.length > 0) {
            return offerings.some(
              (so) =>
                so.subject_id === sub.subject_id &&
                so.academic_level_id === cls.academic_level_id &&
                (so.pathway === "both" ||
                  so.pathway.toLowerCase() === clsPathway ||
                  (so.pathway === "general" && clsPathway === "general"))
            );
          }
          return true;
        });
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
        ? { ...l, days_of_week: days, start_time: startTime, end_time: endTime }
        : l
    );
    setLoads(updated);
    void runValidation(updated);
  };

  // Save / Publish
  const handleSave = async (action: "draft" | "publish") => {
    if (!selectedPeriodId || isSaving) return;
    setIsSaving(true);
    setNotice(null);

    try {
      const levelIdToSave = selectedGradeId !== "all" ? Number(selectedGradeId) : 1;
      const res = await batchSaveSubjectLoads(selectedPeriodId, levelIdToSave, action, loads);

      setConflicts(res.conflicts);
      setNotice({
        message: res.message,
        type: "success",
      });

      // Refresh studio data
      void loadStudio(selectedPeriodId);
    } catch (err) {
      setNotice({
        message: err instanceof Error ? err.message : `Failed to ${action} subject loads.`,
        type: "error",
      });
    } finally {
      setIsSaving(false);
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
  const unassignedCount = loads.filter((l) => !l.staff_id).length;

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
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-1">
                  Subject Load Studio
                </h1>
              </div>
            </div>

            {/* Sticky Action Controls */}
            <div className="flex flex-wrap items-center gap-2 self-end md:self-auto">
              <Button
                variant="default"
                disabled={isLoading || isSaving}
                onClick={() => void handleAutoSchedule(undefined, "teacher_swap")}
                className="bg-sky-400 text-black hover:bg-sky-500 border-2 border-black shadow-[2px_2px_0_#000] font-bold"
                title="CTU Master Pattern: Auto-swap teachers back-to-back between paired sections"
              >
                <Zap className="size-4 mr-2 text-black" />
                Auto-Teacher Swap
              </Button>
              <Button
                variant="default"
                disabled={isLoading || isSaving}
                onClick={() => void handleAutoSchedule(undefined, "standard")}
                className="bg-amber-400 text-black hover:bg-amber-500 border-2 border-black shadow-[2px_2px_0_#000] font-bold"
              >
                <Sparkles className="size-4 mr-2 text-black" />
                Auto-Generate All
              </Button>
              <Button
                variant="outline"
                disabled={isSaving}
                onClick={() => void handleSave("draft")}
                className="border-2 border-black shadow-[2px_2px_0_#000]"
              >
                <Save className="size-4 mr-2" />
                Save Draft
              </Button>
              <Button
                variant="default"
                disabled={isSaving || errorConflictsCount > 0}
                onClick={() => void handleSave("publish")}
                className="border-2 border-black shadow-[2px_2px_0_#000]"
              >
                <Send className="size-4 mr-2" />
                Publish Schedule
              </Button>
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
              <Badge variant="outline" className="border-2 border-black py-1 px-2.5 font-bold">
                <UserCheck className="size-3.5 mr-1 text-amber-600" />
                {unassignedCount} Unassigned Subjects
              </Badge>
              <Badge
                variant={errorConflictsCount > 0 ? "solid" : "outline"}
                className={`border-2 border-black py-1 px-2.5 font-bold ${errorConflictsCount > 0 ? "bg-red-500 text-white" : ""
                  }`}
              >
                <AlertCircle className="size-3.5 mr-1" />
                {errorConflictsCount} Conflicts
              </Badge>
              {warningConflictsCount > 0 && (
                <Badge variant="surface" className="border-2 border-black py-1 px-2.5 font-bold bg-amber-100">
                  <AlertTriangle className="size-3.5 mr-1 text-amber-700" />
                  {warningConflictsCount} Warnings
                </Badge>
              )}
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
                    const clsPathway = (cls.pathway || "general").toLowerCase();

                    const classSubjects = (studioData?.subjects || []).filter((sub) => {
                      if (sub.academic_level_id !== cls.academic_level_id) return false;
                      if (offerings.length > 0) {
                        return offerings.some(
                          (so) =>
                            so.subject_id === sub.subject_id &&
                            so.academic_level_id === cls.academic_level_id &&
                            (so.pathway === "both" ||
                              so.pathway.toLowerCase() === clsPathway ||
                              (so.pathway === "general" && clsPathway === "general"))
                        );
                      }
                      return true;
                    });

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
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleAutoSchedule(cls.class_id)}
                              className="border-2 border-black bg-amber-100 hover:bg-amber-200 text-xs font-bold shadow-[1px_1px_0_#000]"
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
                                    className={`transition-all duration-300 border-b border-black/20 ${isHighlighted
                                        ? "bg-amber-200 border-4 border-black ring-4 ring-amber-400 shadow-xl scale-[1.01]"
                                        : conflict
                                          ? conflict.severity === "error"
                                            ? "bg-red-50/90 border-2 border-red-500"
                                            : "bg-amber-50/90 border-2 border-amber-500"
                                          : ""
                                      }`}
                                  >
                                    {/* Subject Column */}
                                    <Table.Cell className="align-top py-3 min-w-[200px]">
                                      <div className="flex flex-col gap-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-bold text-base text-black">
                                            {sub.subject_name}
                                          </span>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                          <Badge variant="surface" size="sm" className="border border-black font-mono font-bold bg-amber-100 text-black">
                                            {sub.subject_codename || `SUB-${sub.subject_id}`}
                                          </Badge>
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1 mt-1">
                                          <button
                                            type="button"
                                            onClick={() => handleAddSlot(cls.class_id, sub.subject_id)}
                                            className="text-[11px] font-bold flex items-center gap-0.5 text-black hover:bg-neutral-100 border border-black px-1.5 py-0.5 rounded bg-white shadow-[1px_1px_0_#000]"
                                          >
                                            <Plus className="size-3 text-primary" />
                                            <span>Slot</span>
                                          </button>

                                          <button
                                            type="button"
                                            title="Apply 2-Day (MW 2h/day) Preset"
                                            onClick={() => handleApplyPreset(cls.class_id, sub.subject_id, "2day")}
                                            className="text-[10px] font-bold border border-black px-1.5 py-0.5 rounded bg-sky-100 hover:bg-sky-200 text-sky-950 shadow-[1px_1px_0_#000]"
                                          >
                                            Preset: 2-Day
                                          </button>
                                          <button
                                            type="button"
                                            title="Apply 3-Day (MWF 1.3h/day) Preset"
                                            onClick={() => handleApplyPreset(cls.class_id, sub.subject_id, "3day")}
                                            className="text-[10px] font-bold border border-black px-1.5 py-0.5 rounded bg-purple-100 hover:bg-purple-200 text-purple-950 shadow-[1px_1px_0_#000]"
                                          >
                                            Preset: 3-Day
                                          </button>
                                        </div>

                                        {conflict && (
                                          <div
                                            className={`mt-1 text-xs font-bold p-1.5 border border-black flex items-start gap-1 ${conflict.severity === "error"
                                                ? "bg-red-200 text-red-900"
                                                : "bg-amber-200 text-amber-900"
                                              }`}
                                          >
                                            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                                            <span>{conflict.message}</span>
                                          </div>
                                        )}
                                      </div>
                                    </Table.Cell>

                                    {/* Days & Time Slot Columns */}
                                    <Table.Cell colSpan={2} className="align-top py-3 px-2">
                                      {subjectSlots.length === 0 ? (
                                        <span className="text-xs italic text-muted-foreground font-semibold py-1 inline-block">
                                          Unscheduled — click "+ Add Time Slot" to assign schedule
                                        </span>
                                      ) : (
                                        <div className="flex flex-col gap-3">
                                          {subjectSlots.map((slot, sIdx) => {
                                            const slotKey = slot._key || `slot_${cls.class_id}_${sub.subject_id}_${sIdx}`;
                                            return (
                                              <div key={slotKey} className="flex flex-wrap items-center gap-3 pb-2 border-b border-black/10 last:border-b-0 last:pb-0">
                                                {/* Days Chips */}
                                                <div className="flex flex-wrap gap-1">
                                                  {DAYS.map((d) => {
                                                    const isSelected = (slot.days_of_week || []).includes(d.key);
                                                    return (
                                                      <button
                                                        key={d.key}
                                                        type="button"
                                                        onClick={() => handleToggleDay(slotKey, d.key)}
                                                        className={`size-7 text-xs font-bold border-2 border-black transition-all ${isSelected
                                                            ? "bg-primary text-primary-foreground shadow-[1px_1px_0_#000] translate-y-[-1px]"
                                                            : "bg-background text-foreground opacity-60 hover:opacity-100"
                                                          }`}
                                                      >
                                                        {d.label}
                                                      </button>
                                                    );
                                                  })}
                                                </div>

                                                {/* Time Picker */}
                                                <div className="flex items-center gap-1.5">
                                                  <TimePickerSingle
                                                    value={stringToTimeValue(slot.start_time, 8)}
                                                    onChange={(newStart) =>
                                                      handleTimeChange(slotKey, "start_time", timeValueToString(newStart))
                                                    }
                                                  />
                                                  <span className="text-xs font-bold text-muted-foreground">to</span>
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
                                                    <Trash2 className="size-4" />
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </Table.Cell>

                                    {/* Smart Teacher Dropdown — Single Per Subject */}
                                    <Table.Cell className="align-top py-3">
                                      {(() => {
                                        const currentStaffId = subjectSlots[0]?.staff_id;
                                        const currentStatusText = currentStaffId
                                          ? getTeacherAvailabilityStatus(
                                            currentStaffId,
                                            cls.class_id,
                                            sub.subject_id
                                          )
                                          : "";
                                        const currentHasConflict = currentStatusText.includes("Conflict");

                                        return (
                                          <Select
                                            value={currentStaffId || "none"}
                                            onValueChange={(val) =>
                                              handleTeacherChange(cls.class_id, sub.subject_id, val)
                                            }
                                          >
                                            <Select.Trigger
                                              className={`w-[190px] h-9 border-2 border-black shadow-none font-medium text-xs transition-colors ${currentHasConflict
                                                  ? "border-red-600 bg-red-50 text-red-950 font-bold"
                                                  : ""
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
                                                  <span className="italic text-muted-foreground font-semibold">
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
                {/* Active Conflicts Card */}
                <RetroCard className="border-2 border-black shadow-[4px_4px_0_#000] p-4 bg-background">
                  <div className="flex items-center justify-between border-b-2 border-black pb-3 mb-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="size-5 text-amber-600" />
                      <Text as="h3" className="font-bold text-lg">
                        Conflict Tracker ({conflicts.length})
                      </Text>
                    </div>
                  </div>

                  {conflicts.length === 0 ? (
                    <div className="p-4 bg-emerald-50 border-2 border-black text-emerald-900 font-bold text-xs flex items-center gap-2">
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-700" />
                      <span>All schedules and workloads are valid! No conflicts detected.</span>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
                      {conflicts.map((conf, idx) => (
                        <div
                          key={idx}
                          onClick={() => {
                            const targetKey = conf.affected_key || (conf.class_id && conf.subject_id ? `${conf.class_id}_${conf.subject_id}` : undefined);
                            handleHighlightKey(targetKey, conf.class_id);
                          }}
                          className={`p-3 border-2 border-black text-xs font-medium cursor-pointer transition-all hover:translate-x-1 ${conf.severity === "error"
                              ? "bg-red-100 text-red-950 border-red-800"
                              : "bg-amber-100 text-amber-950 border-amber-800"
                            }`}
                        >
                          <div className="flex items-center justify-between font-bold mb-1">
                            <span className="uppercase tracking-wider text-[10px] px-1.5 py-0.5 border border-black bg-white">
                              {conf.rule.replace(/_/g, " ")}
                            </span>
                            {conf.affected_key && (
                              <span className="underline text-[11px]">Click to highlight</span>
                            )}
                          </div>
                          <p className="font-semibold leading-snug">{conf.message}</p>
                        </div>
                      ))}
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
    </AppLayout>
  );
}
