import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { LoadingPanel } from "@/components/loading-panel";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Table } from "@/components/retroui/Table";
import { Alert } from "@/components/retroui/Alert";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TimePickerSingle, type TimeValue } from "@/components/retroui/TimePicker";
import { SegmentedControl } from "@/components/retroui/SegmentedControl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import {
  apiFetch,
  getSubjectLoadStudioData,
  validateSubjectLoads,
  autoScheduleSubjectLoads,
  batchSaveSubjectLoads,
  unlockSection,
  discardDraft,
  type SubjectLoadItem,
  type SubjectLoadStudioData,
  type ConflictItem,
  type TeacherWorkloadItem,
} from "@/lib/api";
import { canonicalizePathway } from "@/lib/pathways";
import BreakConfigDrawer, { type PeriodTemplateSlotItem } from "@/pages/admin/forms/break-config-drawer";
import AssignTeacherModal, { type TeacherModalTarget } from "@/pages/admin/forms/assign-teacher-modal";
import {
  AlertTriangle,
  CheckCircle2,
  Send,
  AlertCircle,
  Plus,
  Trash2,
  Wand2,
  Sparkles,
  Settings,
  Search,
  Copy,
  Unlock,
  RotateCcw,
  EllipsisIcon,
  User,
  X,
  Clock,
} from "lucide-react";
import { Input } from "@/components/retroui/Input";
import { useSettings } from "@/context/SettingsContext";
import { useAcademicPeriod } from "@/context/AcademicPeriodContext";
import { timeStringToMinutes, validatePeriodTimeRange } from "@/lib/time-utils";
import { cn } from "@/lib/utils";
import { classPathwayLabel } from "@/lib/class-pathway";
import { getLockedSectionIds } from "@/pages/admin/subject-load-lock";
import { getSubjectColor } from "@/lib/subject-colors";
import { teacherAssignmentConflict } from "@/pages/admin/teacher-availability";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";

function conflictKeys(conflict: ConflictItem): string[] {
  return Array.from(new Set([
    ...(conflict.affected_keys || []),
    conflict.affected_key,
    conflict.related_affected_key,
  ].filter((key): key is string => Boolean(key))));
}

function conflictAffectsClass(conflict: ConflictItem, classId: number): boolean {
  return conflict.class_id === classId
    || conflict.related_class_id === classId
    || conflictKeys(conflict).some((key) => key.startsWith(`${classId}_`));
}

function conflictAffectsLoad(conflict: ConflictItem, classId: number, subjectId: number): boolean {
  const key = `${classId}_${subjectId}`;
  return conflictKeys(conflict).includes(key)
    || (conflict.class_id === classId && conflict.subject_id === subjectId)
    || (conflict.related_class_id === classId && conflict.related_subject_id === subjectId);
}

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
    p = "PM"; // Auto-correct to PM for UI display
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

function formatTime12h(str?: string | null): string {
  if (!str) return "";
  const tv = stringToTimeValue(str);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${tv.hour}:${pad(tv.minute)} ${tv.period}`;
}

function isSubjectOfferedForClass(
  sub: { subject_id: number; academic_level_id: number },
  cls: { academic_level_id: number; academic_year_id: number; pathway_id?: number | null },
  offerings: Array<{
    subject_id: number;
    academic_year_id: number;
    academic_level_id: number;
    academic_period_id: number;
    pathway_ids?: number[];
  }>,
  academicPeriodId: number,
): boolean {
  if (sub.academic_level_id !== cls.academic_level_id) return false;

  return offerings.some((so) => {
    if (
      so.subject_id !== sub.subject_id ||
      so.academic_level_id !== cls.academic_level_id ||
      so.academic_year_id !== cls.academic_year_id ||
      so.academic_period_id !== academicPeriodId
    ) {
      return false;
    }

    const eligiblePathwayIds = so.pathway_ids || [];
    return eligiblePathwayIds.length === 0 || (
      cls.pathway_id != null && eligiblePathwayIds.includes(cls.pathway_id)
    );
  });
}

function studioClassPathwayLabel(
  cls: SubjectLoadStudioData["classes"][number],
  levels: Array<{ academic_level_id: number; grade_level?: number }> = []
): string | null {
  return classPathwayLabel({
    gradeLevel: levels.find((level) => level.academic_level_id === cls.academic_level_id)?.grade_level ?? 0,
    requiresPathway: cls.requires_pathway,
    pathwayId: cls.pathway_id,
    pathwayName: cls.pathway_name,
    pathwayEnabled: cls.pathway_is_enabled,
  });
}

const DAYS = [
  { key: "MON", label: "M" },
  { key: "TUE", label: "T" },
  { key: "WED", label: "W" },
  { key: "THU", label: "Th" },
  { key: "FRI", label: "F" },
];

const JHS_REQUIRED_SLOT_NAMES = [
  "Homeroom Guidance", "Period 1", "Period 2", "Morning Recess",
  "Period 3", "Period 4", "Period 5", "Lunch Break",
  "Enhanced Period 1", "Enhanced Period 2", "Afternoon Recess",
  "Period 6", "Period 7",
];

/** A block (or empty cell) on the timetable grid: loads at one time slot across the given days. */
type GridBlockRef = {
  classId: number;
  loadKeys: string[];
  startTime: string;
  endTime: string;
  days: string[];
};

const GRID_DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI"];

function normalizeDayKey(day: string): string {
  if (day === "M") return "MON";
  if (day === "T") return "TUE";
  if (day === "W") return "WED";
  if (day === "Th") return "THU";
  if (day === "F") return "FRI";
  return day;
}

function sortDayKeys(days: string[]): string[] {
  return [...new Set(days.map(normalizeDayKey))].sort(
    (a, b) => GRID_DAY_ORDER.indexOf(a) - GRID_DAY_ORDER.indexOf(b)
  );
}

function makeLoadKey(classId: number, subjectId: number): string {
  return `slot_${classId}_${subjectId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function gridCellId(startTime: string, endTime: string, day: string): string {
  return `${startTime}|${endTime}|${day}`;
}

function parseGridCellId(cellId: string): { startTime: string; endTime: string; day: string } {
  const [startTime, endTime, day] = cellId.split("|");
  return { startTime, endTime, day };
}

/** Moves the `from` days of each load in `from.loadKeys` to the `to` slot/days, splitting loads when needed. */
function relocateLoads(items: SubjectLoadItem[], from: GridBlockRef, to: GridBlockRef): SubjectLoadItem[] {
  const keys = new Set(from.loadKeys);
  const result: SubjectLoadItem[] = [];
  for (const item of items) {
    if (!item._key || !keys.has(item._key)) {
      result.push(item);
      continue;
    }
    const itemDays = (item.days_of_week || []).map(normalizeDayKey);
    const remaining = itemDays.filter((d) => !from.days.includes(d));
    const moved: SubjectLoadItem = {
      ...item,
      start_time: to.startTime,
      end_time: to.endTime,
      days_of_week: sortDayKeys(to.days),
      status: "draft",
      is_locked: false,
    };
    if (remaining.length === 0) {
      result.push(moved);
    } else {
      result.push({ ...item, days_of_week: sortDayKeys(remaining), status: "draft", is_locked: false });
      result.push({ ...moved, _key: makeLoadKey(item.class_id, item.subject_id), subject_load_id: null });
    }
  }
  return result;
}

/** Combines a class's loads that share subject, teacher, and time slot into one multi-day load. */
function mergeAdjacentLoads(items: SubjectLoadItem[], classId: number): SubjectLoadItem[] {
  const merged: SubjectLoadItem[] = [];
  for (const item of items) {
    if (item.class_id !== classId || !item.start_time) {
      merged.push(item);
      continue;
    }
    const idx = merged.findIndex(
      (m) =>
        m.class_id === classId &&
        m.subject_id === item.subject_id &&
        (m.staff_id ?? null) === (item.staff_id ?? null) &&
        m.start_time === item.start_time &&
        m.end_time === item.end_time &&
        !(m.subject_load_id && item.subject_load_id)
    );
    if (idx === -1) {
      merged.push(item);
      continue;
    }
    const existing = merged[idx];
    merged[idx] = {
      ...(existing.subject_load_id ? existing : item),
      days_of_week: sortDayKeys([...(existing.days_of_week || []), ...(item.days_of_week || [])]),
      status: "draft",
      is_locked: false,
    };
  }
  return merged;
}

const TIMETABLE_DAYS = [
  { key: "MON", short: "M", full: "Monday" },
  { key: "TUE", short: "T", full: "Tuesday" },
  { key: "WED", short: "W", full: "Wednesday" },
  { key: "THU", short: "Th", full: "Thursday" },
  { key: "FRI", short: "F", full: "Friday" },
];

function GradeGroupCarousel({
  classes = [],
  academicLevels = [],
  viewMode = "grid",
  onViewModeChange,
  renderHeaderActions,
  hideSectionNav = false,
  activeIdx: controlledActiveIdx,
  onActiveIdxChange,
  children,
}: {
  classes: any[];
  academicLevels?: Array<{ academic_level_id: number; level_name: string; grade_level?: number }>;
  viewMode?: "grid" | "list";
  onViewModeChange?: (mode: "grid" | "list") => void;
  renderHeaderActions?: (activeIdx: number) => React.ReactNode;
  hideSectionNav?: boolean;
  activeIdx?: number;
  onActiveIdxChange?: (idx: number) => void;
  children: React.ReactNode;
}) {
  const [internalActiveIdx, setInternalActiveIdx] = useState(0);
  const activeIdx = controlledActiveIdx !== undefined ? controlledActiveIdx : internalActiveIdx;
  const setActiveIdx = (newIdx: number | ((prev: number) => number)) => {
    const val = typeof newIdx === "function" ? newIdx(activeIdx) : newIdx;
    if (onActiveIdxChange) {
      onActiveIdxChange(val);
    } else {
      setInternalActiveIdx(val);
    }
  };

  // Sync activeIdx if classes list changes
  useEffect(() => {
    if (activeIdx >= classes.length && classes.length > 0) {
      setActiveIdx(0);
    }
  }, [classes.length, activeIdx]);

  return (
    <Card className="@container/card flex min-w-0 w-full flex-col gap-1! overflow-hidden bg-background">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {!hideSectionNav && (
          <div className="flex items-center gap-2 pb-1">
            <span className="shrink-0 text-sm font-regular text-muted-foreground">
              Section:
            </span>
            {classes.length === 0 ? (
              <span className="text-sm text-muted-foreground italic">No sections</span>
            ) : (
              classes.map((cls, idx) => {
                const pathway = studioClassPathwayLabel(cls, academicLevels);
                return (
                  <Button
                    key={cls.class_id || idx}
                    autoIcon={false}
                    variant={activeIdx === idx ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveIdx(idx)}
                    className="shrink-0 border-black shadow-none"
                  >
                    <span>{cls.section_name}</span>
                    {pathway && (
                      <span className="font-normal opacity-90">
                        {" "}— <span>{pathway}</span>
                      </span>
                    )}
                  </Button>
                );
              })
            )}
          </div>
        )}
        {/* View Switcher: Timetable Grid vs List & Section Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {onViewModeChange && (
            <SegmentedControl
              size="sm"
              value={viewMode}
              onValueChange={(val) => onViewModeChange(val as "grid" | "list")}
            >
              <SegmentedControl.Item value="grid">
                Timetable
              </SegmentedControl.Item>
              <SegmentedControl.Item value="list">
                List
              </SegmentedControl.Item>
            </SegmentedControl>
          )}
          {renderHeaderActions ? renderHeaderActions(activeIdx) : null}
        </div>
      </div>

      <div className="w-full min-w-0">
        {Array.isArray(children) ? children[activeIdx] || children[0] : children}
      </div>
    </Card>
  );
}

export default function AdminSubjectLoadStudio() {
  const toast = useToast();
  const [selectedGradeId, setSelectedGradeId] = useState<string>("all");
  const [selectedSectionId, setSelectedSectionId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [studioData, setStudioData] = useState<SubjectLoadStudioData | null>(null);
  const { getSetting } = useSettings();
  const { selectedPeriodId } = useAcademicPeriod();
  const [loads, setLoads] = useState<SubjectLoadItem[]>([]);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [teacherWorkloads, setTeacherWorkloads] = useState<TeacherWorkloadItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [notice, setNotice] = useState<{ title?: string; message: string; type: "success" | "error" } | null>(null);
  const [autoScheduleNotice, setAutoScheduleNotice] = useState<{ title?: string; message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    if (autoScheduleNotice?.type === "success") {
      const timer = setTimeout(() => {
        setAutoScheduleNotice(null);
      }, 6000);
      return () => clearTimeout(timer);
    }
  }, [autoScheduleNotice]);
  const [timeValidationError, setTimeValidationError] = useState<{ slotKey: string; message: string } | null>(null);
  const [highlightedKey, setHighlightedKey] = useState<string | null>(null);
  const [jumpIndex, setJumpIndex] = useState<{ type: "error" | "warning" | "unassigned"; idx: number } | null>(null);
  const [isBreakDrawerOpen, setIsBreakDrawerOpen] = useState<boolean>(false);
  const [periodTemplateSlots, setPeriodTemplateSlots] = useState<PeriodTemplateSlotItem[]>([]);
  const [openRowKey, setOpenRowKey] = useState<string | null>(null);
  const [sectionViewModes, setSectionViewModes] = useState<Record<number, "grid" | "list">>({});
  const [carouselActiveIdx, setCarouselActiveIdx] = useState<number>(0);
  const [discardTargetClass, setDiscardTargetClass] = useState<{ classId: number; sectionName: string } | null>(null);
  const [publishTargetClass, setPublishTargetClass] = useState<{ classId: number; sectionName: string; isRevisionUpdate?: boolean } | null>(null);
  const [teacherModalTarget, setTeacherModalTarget] = useState<TeacherModalTarget | null>(null);
  const lockedSectionIds = useMemo(() => getLockedSectionIds(studioData), [studioData]);
  const isSectionLocked = (classId: number) => lockedSectionIds.has(classId);

  const isJhsClass = useCallback((classId: number) => {
    const cls = studioData?.classes.find((item) => item.class_id === classId);
    const grade = studioData?.academic_levels.find(
      (level) => level.academic_level_id === cls?.academic_level_id
    )?.grade_level;
    return grade != null && grade >= 7 && grade <= 10;
  }, [studioData]);

  const classPeriodSlots = useCallback((classId: number) => {
    const cls = studioData?.classes.find((item) => item.class_id === classId);
    const group = cls?.period_template_group || "JHS_45MIN";
    return periodTemplateSlots
      .filter((slot) => slot.template_group === group && slot.slot_type === "CLASS" && !slot.is_locked_break && slot.slot_id != null)
      .sort((a, b) => a.display_order - b.display_order);
  }, [periodTemplateSlots, studioData]);

  const withAuthoritativeJhsSlots = useCallback((items: SubjectLoadItem[]) => items.map((item) => {
    if (!isJhsClass(item.class_id) || !item.start_time || !item.end_time) return item;
    const matches = classPeriodSlots(item.class_id).filter(
      (slot) => slot.start_time === item.start_time && slot.end_time === item.end_time
    );
    return matches.length === 1
      ? { ...item, slot_id: matches[0].slot_id, start_time: matches[0].start_time, end_time: matches[0].end_time }
      : item;
  }), [classPeriodSlots, isJhsClass]);

  const gradeOptions = useMemo(() => {
    if (!studioData?.academic_levels) return [];
    const sorted = [...studioData.academic_levels].sort((a, b) => a.grade_level - b.grade_level);
    return sorted.map((lvl) => ({
      id: String(lvl.academic_level_id),
      label: lvl.level_name,
    }));
  }, [studioData?.academic_levels]);

  const activeGradeId =
    selectedGradeId && gradeOptions.some((g) => g.id === selectedGradeId)
      ? selectedGradeId
      : gradeOptions[0]?.id || "";

  useEffect(() => {
    if (gradeOptions.length > 0 && (!selectedGradeId || !gradeOptions.some((g) => g.id === selectedGradeId))) {
      setSelectedGradeId(gradeOptions[0].id);
    }
  }, [gradeOptions, selectedGradeId]);

  // Fetch period templates directly on mount
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const query = selectedPeriodId ? `?academic_period_id=${selectedPeriodId}` : "";
        const res = await apiFetch(`/api/v1/subject-loads/period-templates${query}`);
        if (res.ok) {
          const data = (await res.json()) as PeriodTemplateSlotItem[];
          if (data && data.length > 0) {
            setPeriodTemplateSlots(data);
          }
        }
      } catch (err) {
        console.error("Error loading period templates in studio:", err);
      }
    };
    void fetchTemplates();
  }, [selectedPeriodId]);

  const getSectionSlots = useCallback(
    (cls: { class_id: number; period_template_group?: string | null; section_name?: string; academic_level_id: number }) => {
      let groupKey = cls.period_template_group || "JHS_45MIN";
      const levelObj = studioData?.academic_levels.find((l) => l.academic_level_id === cls.academic_level_id);
      const grade = levelObj?.grade_level || 7;
      if (!cls.period_template_group && grade >= 11) {
        const name = (cls.section_name || "").toLowerCase();
        if (name.includes("del mundo") || name.includes("reyes")) {
          groupKey = "SHS_DELMUNDO_REYES";
        } else {
          groupKey = "SHS_CAMPOS_ZARA";
        }
      }

      const groupSlots = periodTemplateSlots.filter((s) => s.template_group === groupKey);
      const sorted = [...groupSlots].sort((a, b) => a.display_order - b.display_order);

      const sectionLoads = loads.filter((l) => l.class_id === cls.class_id && l.start_time && l.end_time);
      const knownStarts = new Set(sorted.map((s) => s.start_time));

      for (const l of sectionLoads) {
        if (l.start_time && !knownStarts.has(l.start_time)) {
          knownStarts.add(l.start_time);
          sorted.push({
            template_group: groupKey,
            slot_name: `Period (${formatTime12h(l.start_time)})`,
            slot_type: "CLASS",
            start_time: l.start_time,
            end_time: l.end_time || l.start_time,
            is_locked_break: false,
            display_order: 99,
          });
        }
      }

      sorted.sort((a, b) => timeStringToMinutes(a.start_time) - timeStringToMinutes(b.start_time));
      return sorted;
    },
    [periodTemplateSlots, studioData, loads]
  );

  // Copy Schedule Modal State
  const [isCopyModalOpen, setIsCopyModalOpen] = useState<boolean>(false);
  const [copySourcePeriodId, setCopySourcePeriodId] = useState<string>("");
  const [copySourceError, setCopySourceError] = useState("");
  const [isCopying, setIsCopying] = useState<boolean>(false);

  const activeGroupKey = useMemo(() => {
    if (!activeGradeId) return "JHS_45MIN";
    const levelObj = studioData?.academic_levels.find((l) => String(l.academic_level_id) === activeGradeId);
    const grade = levelObj?.grade_level || 7;
    const selectedClass = selectedSectionId !== "all"
      ? studioData?.classes.find((c) => String(c.class_id) === selectedSectionId)
      : studioData?.classes.find((c) => String(c.academic_level_id) === activeGradeId);
    if (selectedClass?.period_template_group) return selectedClass.period_template_group;
    if (grade >= 11) {
      const name = (selectedClass?.section_name || "").toLowerCase();
      if (name.includes("del mundo") || name.includes("reyes")) return "SHS_DELMUNDO_REYES";
      return "SHS_CAMPOS_ZARA";
    }
    return "JHS_45MIN";
  }, [activeGradeId, selectedSectionId, studioData]);


  const previousPeriods = useMemo(() => {
    if (!studioData?.academic_periods || !selectedPeriodId) return [];
    return studioData.academic_periods.filter(p => p.academic_period_id < selectedPeriodId);
  }, [studioData, selectedPeriodId]);







  // Load studio data
  const loadStudio = useCallback(async (periodId?: number, preserveNotice = false) => {
    setIsLoading(true);
    setLoadError(false);
    if (!preserveNotice) {
      setNotice(null);
      setAutoScheduleNotice(null);
    }
    try {
      const data = await getSubjectLoadStudioData(periodId);
      setStudioData(data);
      if (data.period_template_slots) {
        setPeriodTemplateSlots(data.period_template_slots);
      }

      // Initialize subject loads: populate missing loads from section x subject combinations
      const existing = data.existing_loads || [];
      const periodIdToUse = data.active_period_id;

      const initialLoads: SubjectLoadItem[] = [];

      const offerings = data.subject_offerings || [];
      const includedExisting = new Set<SubjectLoadItem>();

      const appendExistingLoad = (m: SubjectLoadItem, idx: number, isOfferingEligible: boolean) => {
        includedExisting.add(m);
        initialLoads.push({
          _key: m.subject_load_id
            ? `sl_${m.subject_load_id}`
            : `slot_${m.class_id}_${m.subject_id}_${idx}`,
          _offering_eligible: isOfferingEligible,
          subject_load_id: m.subject_load_id,
          class_id: m.class_id,
          subject_id: m.subject_id,
          staff_id: m.staff_id || null,
          academic_period_id: periodIdToUse,
          slot_id: m.slot_id,
          start_time: m.start_time || null,
          end_time: m.end_time || null,
          days_of_week: m.days_of_week || [],
          status: m.status || "draft",
          is_locked: Boolean(m.is_locked || m.status === "published"),
          logical_load_id: m.logical_load_id,
          section_revision: m.section_revision,
          base_revision: m.status === "published" || m.status === "active"
            ? m.section_revision
            : m.base_revision,
          has_live_data: m.has_live_data,
          dependencies: m.dependencies,
        });
      };

      (data.classes || []).forEach((cls) => {
        // Find subjects matching class academic level & pathway offering for this period
        const levelSubjects = (data.subjects || []).filter((sub) =>
          isSubjectOfferedForClass(sub, cls, offerings, periodIdToUse)
        );

        // Fresh sections receive a safe, deterministic draft timetable. If a
        // section already has scheduled rows, preserve them and leave only new
        // subjects unscheduled for explicit admin placement.
        const hasExistingSchedule = existing.some(
          (load) => load.class_id === cls.class_id && load.start_time && load.end_time
        );
        const templateGroup = cls.period_template_group || "JHS_45MIN";
        const classSlots = (data.period_template_slots || [])
          .filter((slot) => slot.template_group === templateGroup && slot.slot_type === "CLASS" && !slot.is_locked_break && slot.slot_id != null)
          .sort((a, b) => a.display_order - b.display_order);
        const enhancedSlots = classSlots.filter((slot) => slot.slot_name.toLowerCase().startsWith("enhanced"));
        const standardSlots = classSlots.filter((slot) => !slot.slot_name.toLowerCase().startsWith("enhanced"));
        const defaultSchedule = new Map<number, { slot: (typeof classSlots)[number]; days: string[] }>();

        if (!hasExistingSchedule && classSlots.length > 0) {
          const enhancedSubjects = levelSubjects.filter((subject) => subject.is_math_or_science);
          const generalSubjects = levelSubjects.filter((subject) => !subject.is_math_or_science);
          enhancedSubjects.slice(0, enhancedSlots.length).forEach((subject, index) => {
            defaultSchedule.set(subject.subject_id, { slot: enhancedSlots[index], days: ["MON", "TUE", "WED", "THU", "FRI"] });
          });
          const standardSubjects = [...generalSubjects, ...enhancedSubjects.slice(enhancedSlots.length)];
          standardSubjects.slice(0, standardSlots.length).forEach((subject, index) => {
            defaultSchedule.set(subject.subject_id, { slot: standardSlots[index], days: ["MON", "TUE", "WED", "THU", "FRI"] });
          });
          standardSubjects.slice(standardSlots.length, standardSlots.length * 2).forEach((subject, index) => {
            const paired = standardSubjects[index];
            const slot = standardSlots[index];
            if (!paired || !slot) return;
            defaultSchedule.set(paired.subject_id, { slot, days: ["MON", "WED", "FRI"] });
            defaultSchedule.set(subject.subject_id, { slot, days: ["TUE", "THU"] });
          });
        }

        levelSubjects.forEach((sub) => {
          const matched = existing.filter(
            (ex) => ex.class_id === cls.class_id && ex.subject_id === sub.subject_id
          );

          if (matched.length > 0) {
            matched.forEach((m, idx) => {
              appendExistingLoad(m, idx, true);
            });
          } else {
            // No DB record yet — create synthetic draft load so unassigned counts are accurate
            initialLoads.push({
              _key: `new_${cls.class_id}_${sub.subject_id}`,
              _offering_eligible: true,
              subject_load_id: undefined,
              class_id: cls.class_id,
              subject_id: sub.subject_id,
              staff_id: null,
              academic_period_id: periodIdToUse,
              slot_id: defaultSchedule.get(sub.subject_id)?.slot.slot_id ?? null,
              start_time: defaultSchedule.get(sub.subject_id)?.slot.start_time ?? null,
              end_time: defaultSchedule.get(sub.subject_id)?.slot.end_time ?? null,
              days_of_week: defaultSchedule.get(sub.subject_id)?.days ?? [],
              status: "draft",
              is_locked: false,
            });
          }
        });
      });

      // Keep existing rows whose offering was removed or changed visible for
      // review/correction. They are not synthesized as eligible rows and the
      // shared backend validator will continue to block their publication.
      existing.forEach((load, idx) => {
        if (!includedExisting.has(load)) appendExistingLoad(load, idx, false);
      });

      setLoads(initialLoads);

      // Trigger initial conflict validation
      if (initialLoads.length > 0) {
        const valRes = await validateSubjectLoads(periodIdToUse, initialLoads);
        setConflicts(valRes.conflicts);
        setTeacherWorkloads(valRes.teacher_workloads);
      } else {
        setConflicts([]);
        setTeacherWorkloads([]);
      }
    } catch (err) {
      setLoadError(true);
      setNotice({
        title: "Loading Failed",
        message: err instanceof Error ? err.message : "Failed to load Subject Load Studio.",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPeriodId) {
      void loadStudio(selectedPeriodId);
    }
  }, [loadStudio, selectedPeriodId]);

  // Run validation whenever loads change
  const runValidation = useCallback(
    async (updatedLoads: SubjectLoadItem[]) => {
      if (!selectedPeriodId) return;
      try {
        const valRes = await validateSubjectLoads(selectedPeriodId, withAuthoritativeJhsSlots(updatedLoads));
        setConflicts(valRes.conflicts);
        setTeacherWorkloads(valRes.teacher_workloads);
      } catch (e) {
        console.error("Validation error:", e);
      }
    },
    [selectedPeriodId, withAuthoritativeJhsSlots]
  );

  // Load update handlers
  const handleTeacherChange = (classId: number, subjectId: number, staffId: string | null) => {
    if (isSectionLocked(classId)) return;
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
    const item = loads.find(i => i._key === slotKey);
    if (!item) return;
    if (isSectionLocked(item.class_id)) return;

    const start = field === "start_time" ? val : (item.start_time || "00:00");
    const end = field === "end_time" ? val : (item.end_time || "00:00");

    const schoolDayStart = getSetting("school_day_start", "06:00");
    const schoolDayEnd = getSetting("school_day_end", "20:00");

    const errorMsg = validatePeriodTimeRange(start, end, schoolDayStart, schoolDayEnd);
    if (errorMsg) {
      setTimeValidationError({ slotKey, message: errorMsg });
      return; // Reject change
    }
    if (timeValidationError?.slotKey === slotKey) setTimeValidationError(null);

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

  const handlePeriodSlotChange = (slotKey: string, slotId: string) => {
    const item = loads.find((load) => load._key === slotKey);
    if (!item || isSectionLocked(item.class_id)) return;
    const selected = classPeriodSlots(item.class_id).find((slot) => String(slot.slot_id) === slotId);
    if (!selected) return;
    const updated = loads.map((load) => load._key === slotKey ? {
      ...load,
      slot_id: selected.slot_id,
      start_time: selected.start_time,
      end_time: selected.end_time,
      status: "draft",
      is_locked: false,
    } : load);
    setLoads(updated);
    void runValidation(updated);
  };

  const handleToggleDay = (slotKey: string, dayKey: string) => {
    if (loads.some((item) => item._key === slotKey && isSectionLocked(item.class_id))) return;
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
    if (isSectionLocked(classId)) return;
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
    const subject = studioData?.subjects.find((item) => item.subject_id === subjectId);
    const availableSlots = classPeriodSlots(classId);
    const preferredSlots = subject?.is_math_or_science
      ? availableSlots.filter((slot) => slot.slot_name.toLowerCase().startsWith("enhanced"))
      : availableSlots.filter((slot) => !slot.slot_name.toLowerCase().startsWith("enhanced"));
    const selectedSlot = preferredSlots[0] || availableSlots[0];

    const newSlot: SubjectLoadItem = {
      _key: newKey,
      class_id: classId,
      subject_id: subjectId,
      staff_id: firstSlot?.staff_id || null,
      academic_period_id: selectedPeriodId || 1,
      slot_id: selectedSlot?.slot_id ?? null,
      start_time: selectedSlot?.start_time ?? null,
      end_time: selectedSlot?.end_time ?? null,
      days_of_week: [defaultDay],
      status: "draft",
    };

    const updated = [...loads, newSlot];
    setLoads(updated);
    void runValidation(updated);
  };

  const handleRemoveSlot = (slotKey: string) => {
    if (loads.some((item) => item._key === slotKey && isSectionLocked(item.class_id))) return;
    const updated = loads.filter((l) => l._key !== slotKey);
    setLoads(updated);
    void runValidation(updated);
  };

  // ── Timetable grid: drag-to-swap and manual cell assignment ──────────────
  const [gridDragSource, setGridDragSource] = useState<GridBlockRef | null>(null);
  const [gridDragOverId, setGridDragOverId] = useState<string | null>(null);
  const [cellSelection, setCellSelection] = useState<{ classId: number; cells: string[] } | null>(null);

  useEffect(() => {
    if (!cellSelection) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCellSelection(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cellSelection]);

  const handleToggleGridCell = (classId: number, cellId: string, additive: boolean) => {
    if (isSectionLocked(classId)) return;
    setCellSelection((prev) => {
      if (!prev || prev.classId !== classId) return { classId, cells: [cellId] };
      const isSelected = prev.cells.includes(cellId);
      if (additive) {
        const cells = isSelected ? prev.cells.filter((c) => c !== cellId) : [...prev.cells, cellId];
        return cells.length > 0 ? { classId, cells } : null;
      }
      if (isSelected && prev.cells.length === 1) return null;
      return { classId, cells: [cellId] };
    });
  };

  const handleAssignSubjectToCells = (classId: number, subjectId: number) => {
    if (isSectionLocked(classId) || !cellSelection || cellSelection.classId !== classId) return;

    // Group selected cells by time slot so adjacent days become a single grouped load.
    const cellsBySlot = new Map<string, { startTime: string; endTime: string; days: string[] }>();
    for (const cellId of cellSelection.cells) {
      const cell = parseGridCellId(cellId);
      const slotKey = `${cell.startTime}|${cell.endTime}`;
      const entry = cellsBySlot.get(slotKey) ?? { startTime: cell.startTime, endTime: cell.endTime, days: [] };
      if (!entry.days.includes(cell.day)) entry.days.push(cell.day);
      cellsBySlot.set(slotKey, entry);
    }

    let updated = [...loads];
    const subjectLoads = updated.filter((l) => l.class_id === classId && l.subject_id === subjectId);
    const defaultStaffId = subjectLoads.find((l) => l.staff_id)?.staff_id ?? null;

    for (const { startTime, endTime, days } of cellsBySlot.values()) {
      const sortedDays = sortDayKeys(days);
      const authoritativeSlot = classPeriodSlots(classId).find(
        (slot) => slot.start_time === startTime && slot.end_time === endTime
      );
      const sameSlot = updated.find(
        (l) => l.class_id === classId && l.subject_id === subjectId && l.start_time === startTime && l.end_time === endTime
      );
      const unscheduled = updated.find(
        (l) => l.class_id === classId && l.subject_id === subjectId && !l.start_time && (l.days_of_week || []).length === 0
      );

      if (sameSlot) {
        updated = updated.map((l) =>
          l === sameSlot
            ? {
                ...l,
                days_of_week: sortDayKeys([...(l.days_of_week || []).map(normalizeDayKey), ...sortedDays]),
                status: "draft",
                is_locked: false,
              }
            : l
        );
      } else if (unscheduled) {
        updated = updated.map((l) =>
          l === unscheduled
            ? { ...l, slot_id: authoritativeSlot?.slot_id ?? null, start_time: startTime, end_time: endTime, days_of_week: sortedDays, status: "draft", is_locked: false }
            : l
        );
      } else {
        updated.push({
          _key: makeLoadKey(classId, subjectId),
          class_id: classId,
          subject_id: subjectId,
          staff_id: defaultStaffId,
          academic_period_id: selectedPeriodId || 1,
          slot_id: authoritativeSlot?.slot_id ?? null,
          start_time: startTime,
          end_time: endTime,
          days_of_week: sortedDays,
          status: "draft",
          is_locked: false,
        });
      }
    }

    const subjectName = studioData?.subjects.find((s) => s.subject_id === subjectId)?.subject_name ?? "Subject";
    const cellCount = cellSelection.cells.length;
    setLoads(updated);
    setCellSelection(null);
    void runValidation(updated);
    toast.success({
      title: "Subject added",
      description: `${subjectName} was added to ${cellCount} cell${cellCount === 1 ? "" : "s"}.`,
    });
  };

  const handleGridDrop = (classId: number, source: GridBlockRef, target: GridBlockRef) => {
    if (isSectionLocked(classId) || source.classId !== classId || target.classId !== classId) return;
    if (source.startTime === target.startTime && source.days.join() === target.days.join()) return;
    // The same load cannot be swapped with itself (e.g. one load split across non-adjacent days).
    if (source.loadKeys.some((key) => target.loadKeys.includes(key))) return;

    let targetDays = target.days;
    if (target.loadKeys.length === 0) {
      // Dropping on an empty cell keeps the block's length, starting at the dropped day when it fits.
      const dayOrder = TIMETABLE_DAYS.map((d) => d.key);
      const srcIdx = source.days.map((d) => dayOrder.indexOf(d));
      const minIdx = Math.min(...srcIdx);
      const maxIdx = Math.max(...srcIdx);
      const rawOffset = dayOrder.indexOf(target.days[0]) - minIdx;
      const offset = Math.max(-minIdx, Math.min(rawOffset, dayOrder.length - 1 - maxIdx));
      targetDays = srcIdx.map((i) => dayOrder[i + offset]);
    }

    let updated = relocateLoads(loads, source, { ...target, days: targetDays });
    if (target.loadKeys.length > 0) {
      updated = relocateLoads(updated, target, source);
    }
    updated = mergeAdjacentLoads(updated, classId);
    updated = withAuthoritativeJhsSlots(updated);

    setLoads(updated);
    setCellSelection(null);
    void runValidation(updated);
  };

  // Auto-schedule entire studio or single section
  const handleAutoSchedule = async (targetClassId?: number) => {
    if (!selectedPeriodId) return;
    setIsLoading(true);
    setNotice(null);
    setAutoScheduleNotice(null);
    try {
      const currentLoads = [...loads];

      const isClassLocked = isSectionLocked;

      let targetClassIds: number[] = [];
      if (targetClassId) {
        targetClassIds = [targetClassId];
      }

      const candidateClasses = targetClassId
        ? studioData?.classes.filter((c) => targetClassIds.includes(c.class_id)) || []
        : filteredClasses;

      const lockedClassIds = new Set(
        candidateClasses.filter((cls) => isClassLocked(cls.class_id)).map((cls) => cls.class_id)
      );
      const unlockedTargetClasses = candidateClasses.filter((cls) => !lockedClassIds.has(cls.class_id));

      if (unlockedTargetClasses.length === 0) {
        setAutoScheduleNotice({
          title: "All Sections Locked",
          message: targetClassId
            ? "Unlock this section to auto-fit."
            : "Unlock sections to auto-generate.",
          type: "error",
        });
        setIsLoading(false);
        return;
      }

      unlockedTargetClasses.forEach((cls) => {
        const offerings = studioData?.subject_offerings || [];

        const levelSubjects = (studioData?.subjects || []).filter((sub) =>
          isSubjectOfferedForClass(sub, cls, offerings, selectedPeriodId)
        );
        levelSubjects.forEach((sub) => {
          const hasSlot = currentLoads.some(
            (l) => l.class_id === cls.class_id && l.subject_id === sub.subject_id
          );
          if (!hasSlot) {
            currentLoads.push({
              _key: `slot_${cls.class_id}_${sub.subject_id}_${Date.now()}`,
              _offering_eligible: true,
              class_id: cls.class_id,
              subject_id: sub.subject_id,
              staff_id: null,
              academic_period_id: selectedPeriodId,
              start_time: null,
              end_time: null,
              days_of_week: [],
              status: "draft",
              is_locked: false,
            });
          }
        });
      });

      const loadsToProcess = targetClassId
        ? currentLoads.filter((l) => targetClassIds.includes(l.class_id) && l._offering_eligible !== false)
        : currentLoads.filter((l) => l._offering_eligible !== false);

      const res = await autoScheduleSubjectLoads(selectedPeriodId, withAuthoritativeJhsSlots(loadsToProcess), "standard");

      // Merge updated scheduled loads back into full loads array (preserving locked sections)
      const scheduledMap = new Map(
        res.scheduled_loads.map((sl) => [`${sl.class_id}_${sl.subject_id}`, sl])
      );

      const mergedLoads = currentLoads.map((item) => {
        // Preserve locked sections / loads untouched
        if (lockedClassIds.has(item.class_id) || isSectionLocked(item.class_id)) {
          return item;
        }

        const key = `${item.class_id}_${item.subject_id}`;
        const match = scheduledMap.get(key);
        if (match && (targetClassId === undefined || targetClassIds.includes(item.class_id))) {
          return {
            ...item,
            slot_id: match.slot_id ?? null,
            start_time: match.start_time || null,
            end_time: match.end_time || null,
            days_of_week: match.days_of_week || [],
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
      const warnCount = res.conflicts.filter((c) => c.severity === "warning" && c.rule !== "UNASSIGNED_TEACHER").length;
      const unscheduledCount = res.unscheduled_loads?.length ?? 0;
      const unlockedCount = unlockedTargetClasses.length;
      const lockedCount = lockedClassIds.size;
      const preservedNotice = lockedCount > 0 ? ` (${lockedCount} locked section${lockedCount > 1 ? "s" : ""} preserved)` : "";

      if (unscheduledCount > 0) {
        setAutoScheduleNotice({
          title: "Auto-fit Incomplete",
          message: `${unscheduledCount} subject load${unscheduledCount === 1 ? " was" : "s were"} left unscheduled because no conflict-free slot is available${preservedNotice}.`,
          type: "error",
        });
      } else if (errCount > 0) {
        setAutoScheduleNotice({
          title: "Auto-fit Complete",
          message: `Detected ${errCount} ${errCount === 1 ? "conflict" : "conflicts"}${preservedNotice}. Please review highlighted errors.`,
          type: "error",
        });
      } else if (warnCount > 0) {
        setAutoScheduleNotice({
          title: "Auto-fit with Warnings",
          message: `Detected ${warnCount} ${warnCount === 1 ? "warning" : "warnings"}${preservedNotice}. Please check conflict tracker.`,
          type: "error",
        });
      } else {
        setAutoScheduleNotice({
          title: "Auto-fit Successful",
          message: targetClassId
            ? "Section timetable auto-fitted without conflicts!"
            : `Generated timetables for ${unlockedCount} section(s).${lockedCount > 0 ? ` ${lockedCount} locked section(s) preserved.` : ""}`,
          type: "success",
        });
      }
    } catch (err) {
      setAutoScheduleNotice({
        title: "Auto-fit Failed",
        message: err instanceof Error ? err.message : "Unable to generate timetable.",
        type: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyFromTerm = async () => {
    if (!copySourcePeriodId) {
      setCopySourceError("Select a source term.");
      return;
    }

    setIsCopying(true);
    try {
      const res = await apiFetch(`/api/v1/subject-loads/studio-data?academic_period_id=${copySourcePeriodId}`);
      if (!res.ok) throw new Error("Failed to fetch source term data");
      const sourceData = (await res.json()) as SubjectLoadStudioData;

      let sourceLoads = sourceData.existing_loads || [];
      if (activeGradeId) {
        const levelId = parseInt(activeGradeId);
        const classIds = new Set(sourceData.classes.filter(c => c.academic_level_id === levelId).map(c => c.class_id));
        sourceLoads = sourceLoads.filter(l => classIds.has(l.class_id));
      }

      let currentLoads = [...loads];
      if (activeGradeId) {
        const levelId = parseInt(activeGradeId);
        const classIds = new Set(studioData?.classes.filter(c => c.academic_level_id === levelId).map(c => c.class_id));
        currentLoads = currentLoads.filter(l => !classIds.has(l.class_id) || isSectionLocked(l.class_id));
      } else {
        currentLoads = currentLoads.filter((l) => isSectionLocked(l.class_id));
      }

      const destinationPeriodId = studioData?.active_period_id;
      const destinationOfferings = studioData?.subject_offerings || [];
      const newLoads: SubjectLoadItem[] = !destinationPeriodId ? [] : sourceLoads
        .filter((sl) => {
          if (isSectionLocked(sl.class_id)) return false;
          const destinationClass = studioData?.classes.find((cls) => cls.class_id === sl.class_id);
          const destinationSubject = studioData?.subjects.find((sub) => sub.subject_id === sl.subject_id);
          return Boolean(
            destinationClass &&
            destinationSubject &&
            isSubjectOfferedForClass(
              destinationSubject,
              destinationClass,
              destinationOfferings,
              destinationPeriodId,
            )
          );
        })
        .map(sl => ({
          ...sl,
          _key: `copy_${sl.class_id}_${sl.subject_id}_${Math.random().toString(36).substr(2, 5)}`,
          _offering_eligible: true,
          academic_period_id: destinationPeriodId,
          status: "draft",
          is_locked: false,
        }));

      const finalLoads = withAuthoritativeJhsSlots([...currentLoads, ...newLoads]);
      setLoads(finalLoads);
      await runValidation(finalLoads);

      setIsCopyModalOpen(false);
      setNotice({
        title: "Schedule Copied",
        message: `Successfully copied ${newLoads.length} subject loads from the selected term. Please review flagged conflicts and save.`,
        type: "success"
      });
    } catch (err) {
      setNotice({
        title: "Copy Failed",
        message: err instanceof Error ? err.message : "Failed to copy schedule.",
        type: "error"
      });
    } finally {
      setIsCopying(false);
    }
  };

  const handleCopyScheduleFromSection = (
    targetClassId: number,
    sourceClassId: number,
    mode: "stagger" | "exact" = "stagger"
  ) => {
    if (isSectionLocked(targetClassId)) return;
    // ── Step 0: Data-driven bell-schedule compatibility guard ──
    const sourceClass = studioData?.classes.find((c) => c.class_id === sourceClassId);
    const targetClass = studioData?.classes.find((c) => c.class_id === targetClassId);
    const studioPeriodId = studioData?.active_period_id;
    if (!sourceClass || !targetClass || !studioPeriodId) return;

    const sourceGroup = sourceClass.period_template_group;
    const targetGroup = targetClass.period_template_group;

    // Explicit error for missing period_template_group — don't silently guess
    if (!sourceGroup) {
      setNotice({
        title: "Copy Blocked",
        message: `${sourceClass.section_name} has no period template configured. Please assign a bell-schedule template in class settings before copying.`,
        type: "error",
      });
      return;
    }
    if (!targetGroup) {
      setNotice({
        title: "Copy Blocked",
        message: `${targetClass.section_name} has no period template configured. Please assign a bell-schedule template in class settings before copying.`,
        type: "error",
      });
      return;
    }

    // Compare actual CLASS-type period durations from live periodTemplateSlots
    const getTeachableDurations = (templateGroup: string): number[] => {
      return periodTemplateSlots
        .filter((s) => s.template_group === templateGroup && s.slot_type === "CLASS")
        .map((s) => timeStringToMinutes(s.end_time) - timeStringToMinutes(s.start_time))
        .sort((a, b) => a - b);
    };

    const sourceDurations = getTeachableDurations(sourceGroup);
    const targetDurations = getTeachableDurations(targetGroup);
    const sourceSet = JSON.stringify([...new Set(sourceDurations)].sort());
    const targetSet = JSON.stringify([...new Set(targetDurations)].sort());

    if (sourceSet !== targetSet) {
      setNotice({
        title: "Copy Blocked",
        message: `Can't copy — ${sourceClass.section_name} and ${targetClass.section_name} use different bell schedules (${sourceGroup} vs ${targetGroup}).`,
        type: "error",
      });
      return;
    }

    // ── Step 1: Build subject blueprints from source section ──
    const sourceLoads = loads.filter(
      (l) =>
        l.class_id === sourceClassId &&
        l.start_time &&
        l.end_time &&
        l.days_of_week &&
        l.days_of_week.length > 0
    );
    if (sourceLoads.length === 0) return;

    type BlueprintSlot = {
      start_time: string;
      end_time: string;
      days_of_week: string[];
      dayCount: number;
      duration: number;
    };
    type SubjectBlueprint = {
      subjectId: number;
      slots: BlueprintSlot[];
      totalDayCount: number;
    };

    // Group all source loads by subject_id into blueprints
    const blueprintMap = new Map<number, SubjectBlueprint>();
    for (const sl of sourceLoads) {
      if (!sl.start_time || !sl.end_time || !sl.days_of_week) continue;
      const dur = timeStringToMinutes(sl.end_time) - timeStringToMinutes(sl.start_time);
      if (dur <= 0) continue;

      let bp = blueprintMap.get(sl.subject_id);
      if (!bp) {
        bp = { subjectId: sl.subject_id, slots: [], totalDayCount: 0 };
        blueprintMap.set(sl.subject_id, bp);
      }
      bp.slots.push({
        start_time: sl.start_time,
        end_time: sl.end_time,
        days_of_week: [...sl.days_of_week],
        dayCount: sl.days_of_week.length,
        duration: dur,
      });
      bp.totalDayCount += sl.days_of_week.length;
    }

    const offerings = studioData?.subject_offerings || [];
    const targetSubjects = (studioData?.subjects || []).filter((sub) =>
      isSubjectOfferedForClass(sub, targetClass, offerings, studioPeriodId)
    );

    const currentLoads = [...loads];
    const ALL_DAYS = ["MON", "TUE", "WED", "THU", "FRI"];

    // ── Conflict check helpers (read live currentLoads) ──
    const isTeacherBusy = (
      staffId: string | number | null | undefined,
      start_time: string,
      end_time: string,
      checkDays: string[]
    ) => {
      if (!staffId) return false;
      const stMin = timeStringToMinutes(start_time);
      const enMin = timeStringToMinutes(end_time);
      return currentLoads.some((l) => {
        if (String(l.staff_id) !== String(staffId)) return false;
        if (!l.start_time || !l.end_time || !l.days_of_week || l.days_of_week.length === 0)
          return false;
        const lSt = timeStringToMinutes(l.start_time);
        const lEn = timeStringToMinutes(l.end_time);
        const timeOverlap = stMin < lEn && enMin > lSt;
        if (!timeOverlap) return false;
        return checkDays.some((d) => l.days_of_week!.includes(d));
      });
    };

    const isSlotOccupied = (
      classId: number,
      start_time: string,
      end_time: string,
      checkDays: string[]
    ) => {
      const stMin = timeStringToMinutes(start_time);
      const enMin = timeStringToMinutes(end_time);
      return currentLoads.some((l) => {
        if (l.class_id !== classId) return false;
        if (!l.start_time || !l.end_time || !l.days_of_week || l.days_of_week.length === 0)
          return false;
        const lSt = timeStringToMinutes(l.start_time);
        const lEn = timeStringToMinutes(l.end_time);
        const timeOverlap = stMin < lEn && enMin > lSt;
        if (!timeOverlap) return false;
        return checkDays.some((d) => l.days_of_week!.includes(d));
      });
    };

    const isSubjectBusyGlobal = (
      subjectId: number,
      start_time: string,
      end_time: string,
      day: string
    ) => {
      return currentLoads.some(
        (l) =>
          l.subject_id === subjectId &&
          l.class_id !== targetClassId &&
          l.start_time &&
          l.end_time &&
          timeStringToMinutes(start_time) < timeStringToMinutes(l.end_time) &&
          timeStringToMinutes(end_time) > timeStringToMinutes(l.start_time) &&
          l.days_of_week.includes(day)
      );
    };

    // Check if a single day is free for section slot, teacher, and globally
    const isDayFree = (
      classId: number,
      subjectId: number,
      staffId: string | number | null | undefined,
      start_time: string,
      end_time: string,
      day: string
    ) => {
      if (isSlotOccupied(classId, start_time, end_time, [day])) return false;
      if (staffId && isTeacherBusy(staffId, start_time, end_time, [day])) return false;
      // ALWAYS stagger against the sibling section!
      if (isSubjectBusyGlobal(subjectId, start_time, end_time, day)) return false;
      return true;
    };

    const targetTimeSlots = periodTemplateSlots
      .filter((s) => s.template_group === targetGroup && s.slot_type === "CLASS")
      .map((s) => ({
        start_time: s.start_time,
        end_time: s.end_time,
        duration: timeStringToMinutes(s.end_time) - timeStringToMinutes(s.start_time),
      }));

    if (mode === "exact") {
      // ── Exact mode: copy all slots per subject verbatim ──
      targetSubjects.forEach((tsub) => {
        const bp = blueprintMap.get(tsub.subject_id);
        if (!bp) return;

        // Find all target load indices for this subject
        const targetLoadIndices = currentLoads
          .map((l, idx) => (l.class_id === targetClassId && l.subject_id === tsub.subject_id ? idx : -1))
          .filter((idx) => idx !== -1);

        bp.slots.forEach((bpSlot, slotIdx) => {
          if (slotIdx < targetLoadIndices.length) {
            // Update existing slot
            const existingStaffId = currentLoads[targetLoadIndices[slotIdx]].staff_id;
            currentLoads[targetLoadIndices[slotIdx]] = {
              ...currentLoads[targetLoadIndices[slotIdx]],
              staff_id: existingStaffId,
              start_time: bpSlot.start_time,
              end_time: bpSlot.end_time,
              days_of_week: [...bpSlot.days_of_week],
              status: "draft",
              is_locked: false,
            };
          } else {
            // Need a new slot entry for multi-slot subjects
            const uniqueId = Math.random().toString(36).substring(2, 7);
            currentLoads.push({
              _key: `copy_${targetClassId}_${tsub.subject_id}_${slotIdx}_${uniqueId}`,
              class_id: targetClassId,
              subject_id: tsub.subject_id,
              staff_id: targetLoadIndices.length > 0 ? currentLoads[targetLoadIndices[0]].staff_id : null,
              academic_period_id: selectedPeriodId || 1,
              start_time: bpSlot.start_time,
              end_time: bpSlot.end_time,
              days_of_week: [...bpSlot.days_of_week],
              status: "draft",
              is_locked: false,
            });
          }
        });
      });

      setNotice({
        title: "Exact Copy Applied",
        message: `Applied exact time slots to ${targetSubjects.length} subjects for ${targetClass.section_name}.`,
        type: "success",
      });
    } else {
      // ── Stagger mode: day-count-aware conflict-aware assignment ──

      // Step 2–3: Build constraints per subject, matching to blueprint
      type SubjConstraint = {
        subjectId: number;
        loadIdx: number;
        blueprint: SubjectBlueprint;
        staffId: string | number | null | undefined;
      };
      const constraints: SubjConstraint[] = [];

      targetSubjects.forEach((tsub) => {
        const loadIdx = currentLoads.findIndex(
          (l) => l.class_id === targetClassId && l.subject_id === tsub.subject_id
        );
        if (loadIdx === -1) return;

        const bp = blueprintMap.get(tsub.subject_id);
        if (!bp || bp.slots.length === 0) return;

        constraints.push({
          subjectId: tsub.subject_id,
          loadIdx,
          blueprint: bp,
          staffId: currentLoads[loadIdx].staff_id,
        });
      });

      // Sort by longest duration first (most total days) to prevent small subjects from fracturing the grid
      constraints.sort((a, b) => b.blueprint.totalDayCount - a.blueprint.totalDayCount);

      let placedCount = 0;

      for (const cons of constraints) {
        const bp = cons.blueprint;
        let allSlotsPlaced = true;

        for (let slotIdx = 0; slotIdx < bp.slots.length; slotIdx++) {
          const bpSlot = bp.slots[slotIdx];
          const dur = timeStringToMinutes(bpSlot.end_time) - timeStringToMinutes(bpSlot.start_time);

          const candidateSlots = targetTimeSlots.filter(ts => ts.duration === dur);

          // Reorder candidateSlots: nearest distance to original time
          candidateSlots.sort((a, b) => {
            const aMin = timeStringToMinutes(a.start_time);
            const bMin = timeStringToMinutes(b.start_time);
            const origMin = timeStringToMinutes(bpSlot.start_time);
            return Math.abs(aMin - origMin) - Math.abs(bMin - origMin);
          });

          let chosenTimeSlot = null;
          let chosenDays: string[] = [];

          for (const candSlot of candidateSlots) {
            const daysFound: string[] = [];

            // First pass: try original days
            for (const d of bpSlot.days_of_week) {
              if (isDayFree(targetClassId, cons.subjectId, cons.staffId, candSlot.start_time, candSlot.end_time, d)) {
                daysFound.push(d);
              }
            }

            // Second pass: try remaining days
            if (daysFound.length < bpSlot.dayCount) {
              for (const d of ALL_DAYS) {
                if (daysFound.length >= bpSlot.dayCount) break;
                if (!daysFound.includes(d) && isDayFree(targetClassId, cons.subjectId, cons.staffId, candSlot.start_time, candSlot.end_time, d)) {
                  daysFound.push(d);
                }
              }
            }

            if (daysFound.length >= bpSlot.dayCount) {
              chosenTimeSlot = candSlot;
              chosenDays = daysFound;
              break; // found a working time slot!
            }
          }

          if (!chosenTimeSlot) {
            allSlotsPlaced = false;
            if (slotIdx === 0) {
              currentLoads[cons.loadIdx] = {
                ...currentLoads[cons.loadIdx],
                start_time: null,
                end_time: null,
                days_of_week: [],
                status: "draft",
                is_locked: false,
              };
            }
            break;
          }

          if (slotIdx === 0) {
            currentLoads[cons.loadIdx] = {
              ...currentLoads[cons.loadIdx],
              start_time: chosenTimeSlot.start_time,
              end_time: chosenTimeSlot.end_time,
              days_of_week: chosenDays,
              staff_id: cons.staffId as string | null,
              status: "draft",
              is_locked: false,
            };
          } else {
            const uniqueId = Math.random().toString(36).substring(2, 7);
            currentLoads.push({
              _key: `copy_${targetClassId}_${cons.subjectId}_${slotIdx}_${uniqueId}`,
              class_id: targetClassId,
              subject_id: cons.subjectId,
              staff_id: cons.staffId as string | null,
              academic_period_id: selectedPeriodId || 1,
              start_time: chosenTimeSlot.start_time,
              end_time: chosenTimeSlot.end_time,
              days_of_week: chosenDays,
              status: "draft",
              is_locked: false,
            });
          }
        }

        if (allSlotsPlaced) {
          placedCount++;
        }
      }

      setNotice({
        title:
          placedCount === constraints.length
            ? "Copy & Stagger Successful"
            : "Copy & Stagger Partial",
        message:
          placedCount === constraints.length
            ? `Successfully scheduled all ${constraints.length} subjects for ${targetClass.section_name} with 0 teacher conflicts.`
            : `Scheduled ${placedCount} of ${constraints.length} subjects for ${targetClass.section_name}. ${constraints.length - placedCount} subject(s) have a teacher conflict across other sections — please place manually.`,
        type: placedCount === constraints.length ? "success" : "error",
      });
    }

    const normalizedLoads = withAuthoritativeJhsSlots(currentLoads);
    setLoads(normalizedLoads);
    void runValidation(normalizedLoads);
  };

  // Preset pattern applications
  const handleApplyPreset = (classId: number, subjectId: number, pattern: "2day" | "3day" | "4day") => {
    if (isSectionLocked(classId)) return;
    const classObj = studioData?.classes.find((c) => c.class_id === classId);
    const targetGroup = classObj?.period_template_group || "JHS_45MIN";
    const groupClassSlots = periodTemplateSlots.filter((s) => s.template_group === targetGroup && !s.is_locked_break && s.slot_type === "CLASS");
    const firstSlot = groupClassSlots[0];
    const defaultStart = firstSlot?.start_time || null;
    const defaultEnd = firstSlot?.end_time || null;

    let days: string[] = ["MON", "WED"];
    if (pattern === "2day") {
      days = ["MON", "WED"];
    } else if (pattern === "3day") {
      days = ["MON", "WED", "FRI"];
    } else if (pattern === "4day") {
      days = ["MON", "TUE", "WED", "THU"];
    }

    const updated = loads.map((l) =>
      l.class_id === classId && l.subject_id === subjectId
        ? { ...l, days_of_week: days, slot_id: firstSlot?.slot_id ?? null, start_time: defaultStart, end_time: defaultEnd, status: "draft", is_locked: false }
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
      const levelIdToSave = activeGradeId ? Number(activeGradeId) : 1;
      const draftClassIds = new Set(
        loads.filter((load) => !isSectionLocked(load.class_id) && (load.status === "draft" || !load.is_locked)).map((load) => load.class_id)
      );
      const loadsToSave = action === "draft"
        ? withAuthoritativeJhsSlots(loads.filter((load) => draftClassIds.has(load.class_id)))
        : withAuthoritativeJhsSlots(loads.filter((load) => !isSectionLocked(load.class_id)));
      let baseRevToPass: number | null = null;
      if (publishScope === "section" && targetClassId) {
        const sectionLoads = loads.filter((l) => l.class_id === targetClassId);
        const draft = sectionLoads.find((l) => l.status === "draft" && l.base_revision != null);
        const published = sectionLoads.filter((l) => l.status === "published" || l.status === "active");
        baseRevToPass = draft?.base_revision ?? (
          published.length > 0
            ? Math.max(...published.map((l) => l.section_revision ?? 1))
            : null
        );
      }

      const res = await batchSaveSubjectLoads(
        selectedPeriodId,
        levelIdToSave,
        action,
        loadsToSave,
        publishScope,
        publishScope === "level" ? levelIdToSave : null,
        targetClassId ?? null,
        baseRevToPass
      );

      setConflicts(res.conflicts);
      setNotice({
        title: "Save Successful",
        message: res.message,
        type: "success",
      });
      toast.success({
        title: action === "draft" ? "Draft saved" : "Subject loads published",
        description: res.message,
      });

      // Refresh studio data to sync with DB
      void loadStudio(selectedPeriodId);
    } catch (err: any) {
      const detail = err?.data?.detail || err?.message || "";
      if (err?.status === 409) {
        if (typeof detail === "string" && detail.includes("is locked")) {
          setNotice({
            title: "Section Locked",
            message: detail,
            type: "error",
          });
          void loadStudio(selectedPeriodId, true);
        } else if (detail.includes("Cannot remove") || detail.includes("SUBJECT_LOAD_HAS_LIVE_DATA")) {
          setNotice({
            title: "Cannot Remove Populated Subject",
            message: detail,
            type: "error",
          });
        } else if (detail.includes("conflict") || detail.includes("revision")) {
          setNotice({
            title: "Revision Conflict",
            message: `${detail} If the draft remains after reloading, use Discard Draft, then Unlock Section to start from the current published revision. Discarding loses that draft's changes.`,
            type: "error",
          });
          void loadStudio(selectedPeriodId, true);
        } else {
          setNotice({
            title: "Conflict Error",
            message: detail,
            type: "error",
          });
        }
      } else {
        setNotice({
          title: "Save Failed",
          message: err instanceof Error ? err.message : `Failed to ${action} subject loads.`,
          type: "error",
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnlockSection = async (classId: number) => {
    if (!selectedPeriodId || isSaving) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await unlockSection(selectedPeriodId, classId);
      setNotice({
        title: "Section Unlocked",
        message: `Section snapshot v${res.section_revision} created for editing. Live published schedule remains active for students and teachers until you publish changes.`,
        type: "success",
      });
      await loadStudio(selectedPeriodId);
    } catch (err) {
      setNotice({
        title: "Unlock Failed",
        message: err instanceof Error ? err.message : "Failed to unlock section.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscardDraft = async (classId: number) => {
    if (!selectedPeriodId || isSaving) return;
    setIsSaving(true);
    setNotice(null);
    try {
      const res = await discardDraft(selectedPeriodId, classId);
      setNotice({
        title: "Draft Discarded",
        message: `Unpublished draft discarded. Section restored to published baseline (v${res.section_revision}).`,
        type: "success",
      });
      await loadStudio(selectedPeriodId);
    } catch (err) {
      setNotice({
        title: "Discard Failed",
        message: err instanceof Error ? err.message : "Failed to discard draft.",
        type: "error",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Available sections list for section dropdown
  const availableSections = useMemo(() => {
    if (!studioData) return [];
    if (!activeGradeId) return studioData.classes;
    return studioData.classes.filter((cls) => String(cls.academic_level_id) === activeGradeId);
  }, [studioData, activeGradeId]);

  // Filtered classes to display in Left Pane
  const filteredClasses = useMemo(() => {
    if (!studioData) return [];
    return studioData.classes.filter((cls) => {
      if (activeGradeId && String(cls.academic_level_id) !== activeGradeId) {
        return false;
      }
      if (selectedSectionId !== "all" && String(cls.class_id) !== selectedSectionId) {
        return false;
      }
      if (statusFilter !== "all") {
        const isPublished = lockedSectionIds.has(cls.class_id);
        const hasPendingDraft = Boolean(
          studioData.has_pending_draft_by_class?.[cls.class_id] ||
          studioData.has_pending_draft_by_class?.[String(cls.class_id)]
        );
        const norm = statusFilter.toLowerCase();
        if (norm === "published") {
          if (!isPublished || hasPendingDraft) return false;
        } else if (norm === "draft") {
          if (isPublished && !hasPendingDraft) return false;
        } else if (norm === "conflicts") {
          const hasConflicts = conflicts.some(
            (c) => c.severity === "error" && conflictAffectsClass(c, cls.class_id)
          );
          if (!hasConflicts) return false;
        } else if (norm === "active") {
          return true;
        } else if (norm === "archived") {
          return false;
        }
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = (cls.section_name || "").toLowerCase().includes(q);
        const matchPathway = (studioClassPathwayLabel(cls, studioData?.academic_levels) || "").toLowerCase().includes(q)
          || (cls.pathway || "").toLowerCase().includes(q);
        if (!matchName && !matchPathway) return false;
      }
      return true;
    });
  }, [studioData, activeGradeId, selectedSectionId, statusFilter, searchQuery, lockedSectionIds, conflicts]);

  // Compute teacher availability helper
  const getTeacherAvailabilityStatus = (staffId: string, classId: number, subjectId: number) => {
    return teacherAssignmentConflict(
      loads,
      staffId,
      classId,
      subjectId,
      studioData?.classes,
      studioData?.subjects,
    ) ?? "Available";
  };

  const parseMin = (t?: string | null) => {
    if (!t) return 0;
    const parts = t.split(":");
    return Number(parts[0]) * 60 + (Number(parts[1]) || 0);
  };

  // Check if a specific load has an error conflict
  const getLoadConflict = (classId: number, subjectId: number) => {
    return conflicts.find((conflict) => conflictAffectsLoad(conflict, classId, subjectId));
  };

  const errorConflictsCount = conflicts.filter((c) => c.severity === "error").length;
  // School-wide unassigned count (used for Master Schedule strict guard)
  const unassignedTotal = loads.filter((l) => !l.staff_id).length;

  // Sync active carousel section index when filters change
  useEffect(() => {
    if (selectedSectionId !== "all") {
      const idx = filteredClasses.findIndex((c) => String(c.class_id) === selectedSectionId);
      if (idx !== -1) {
        setCarouselActiveIdx(idx);
        return;
      }
    }
    if (carouselActiveIdx >= filteredClasses.length) {
      setCarouselActiveIdx(0);
    }
  }, [selectedSectionId, activeGradeId, statusFilter, searchQuery, filteredClasses.length]);

  // Active section currently displayed on the interface/table
  const activeDisplayedClass = filteredClasses[carouselActiveIdx] || filteredClasses[0] || null;

  // Active displayed section's scoped loads and conflicts
  const activeSectionLoads = useMemo(() => {
    if (!activeDisplayedClass) return [];
    return loads.filter((l) => l.class_id === activeDisplayedClass.class_id);
  }, [loads, activeDisplayedClass]);

  const activeSectionConflicts = useMemo(() => {
    if (!activeDisplayedClass) return [];
    const clsId = activeDisplayedClass.class_id;
    const staffIdsInClass = new Set(activeSectionLoads.map((l) => l.staff_id).filter(Boolean));

    return conflicts.filter((c) => {
      if (conflictAffectsClass(c, clsId)) return true;
      if (c.staff_id && staffIdsInClass.has(c.staff_id)) {
        if (c.rule === "TEACHER_OVERLAP") {
          return activeSectionLoads.some(
            (l) => l.staff_id === c.staff_id && (!c.day || (l.days_of_week || []).includes(c.day))
          );
        }
      }
      return false;
    });
  }, [conflicts, activeDisplayedClass, activeSectionLoads]);

  const activeSectionErrorConflictsCount = useMemo(() => {
    return activeSectionConflicts.filter((c) => c.severity === "error").length;
  }, [activeSectionConflicts]);

  const activeSectionWarningConflictsCount = useMemo(() => {
    return activeSectionConflicts.filter(
      (c) => c.severity === "warning" && c.rule !== "UNASSIGNED_TEACHER"
    ).length;
  }, [activeSectionConflicts]);

  const activeSectionUnassignedTotal = useMemo(() => {
    return activeSectionLoads.filter((l) => !l.staff_id).length;
  }, [activeSectionLoads]);

  const formattedAutoScheduleMessage = useMemo(() => {
    if (!autoScheduleNotice?.message) return "";
    let msg = autoScheduleNotice.message;
    if (autoScheduleNotice.title) {
      const escapedTitle = autoScheduleNotice.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      msg = msg.replace(new RegExp(`^${escapedTitle}[.:,\\s-]*`, "i"), "");
      msg = msg.replace(/^auto-fit complete[.:,\s-]*/i, "");
      msg = msg.replace(/^successfully\s+/i, "");
      msg = msg.replace(/^all sections (in this scope )?are locked[.:,\s-]*/i, "");
      if (msg.length > 0) {
        msg = msg.charAt(0).toUpperCase() + msg.slice(1);
      }
    }
    return msg || autoScheduleNotice.message;
  }, [autoScheduleNotice]);

  // Jump to and highlight conflicting/warning/unassigned slots or rows
  const handleJumpToItem = (type: "error" | "warning" | "unassigned") => {
    if (!activeDisplayedClass) return;
    const clsId = activeDisplayedClass.class_id;

    let targetSubjectIds: number[] = [];

    if (type === "error" || type === "warning") {
      const filtered = activeSectionConflicts.filter((c) =>
        type === "warning"
          ? c.severity === "warning" && c.rule !== "UNASSIGNED_TEACHER"
          : c.severity === "error"
      );
      const subIds = filtered
        .flatMap((c) => {
          const ids: number[] = [];
          if (c.class_id === clsId && c.subject_id) ids.push(c.subject_id);
          if (c.related_class_id === clsId && c.related_subject_id) ids.push(c.related_subject_id);
          for (const key of conflictKeys(c)) {
            const parts = key.split("_");
            if (parts.length >= 2 && Number(parts[0]) === clsId) ids.push(Number(parts[1]));
          }
          return ids;
        })
        .filter((id): id is number => id !== null);

      targetSubjectIds = Array.from(new Set(subIds));
    } else if (type === "unassigned") {
      targetSubjectIds = Array.from(
        new Set(activeSectionLoads.filter((l) => !l.staff_id).map((l) => l.subject_id))
      );
    }

    if (targetSubjectIds.length === 0) return;

    // Cycle through targets if same type clicked repeatedly
    const currentIdx = jumpIndex?.type === type ? (jumpIndex.idx + 1) % targetSubjectIds.length : 0;
    setJumpIndex({ type, idx: currentIdx });

    const targetSubId = targetSubjectIds[currentIdx];
    const key = `${clsId}_${targetSubId}`;
    setHighlightedKey(key);

    // Scroll element into view (both Timetable Card or List Row)
    setTimeout(() => {
      const timetableEl = document.querySelector(`[id="timetable-slot-${key}"]`);
      const rowEl = document.getElementById(`subject-row-${key}`);
      const targetEl = timetableEl || rowEl;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 60);

    // Auto clear highlight after 3.5s
    setTimeout(() => {
      setHighlightedKey((curr) => (curr === key ? null : curr));
    }, 3500);
  };

  // Master Schedule publish: strictly blocks if ANY subject school-wide is unassigned
  const isMasterPublishDisabled = isSaving || errorConflictsCount > 0 || unassignedTotal > 0;

  return (
    <AppLayout>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                  Subject Load
                </h1>
              </div>

              {/* Sticky Action Controls */}
              <div className="grid w-full grid-cols-2 gap-2 [&_button]:w-full md:flex md:w-auto md:flex-wrap md:gap-2 md:self-auto md:[&_button]:w-auto">
                <Button
                  size="header"
                  className="gap-2"
                  variant="outline"
                  disabled={isSaving}
                  onClick={() => void handleSave("draft")}
                >
                  Save Draft
                </Button>

                {/* Edit Break Timelines */}
                <Button
                  size="header"
                  variant="outline"
                  disabled={isLoading || isSaving}
                  onClick={() => setIsBreakDrawerOpen(true)}
                  className="gap-2 cursor-pointer"
                >
                  <Settings className="size-3.5 text-black" />
                  <span>Edit Break Timelines</span>
                </Button>

                {/* Copy from Previous Term */}
                {previousPeriods.length > 0 && (
                  <Button
                    size="header"
                    variant="outline"
                    disabled={isLoading || isSaving}
                    onClick={() => setIsCopyModalOpen(true)}
                    className="gap-2 cursor-pointer"
                  >
                    <Copy className="size-3.5 text-indigo-900" />
                    <span>Copy from Previous Term</span>
                  </Button>
                )}



                {/* Publish Action */}
                <Button
                  size="header"
                  className="col-span-2 gap-2 md:col-auto"
                  variant={isMasterPublishDisabled ? "default" : "outline"}
                  disabled={isMasterPublishDisabled}
                  onClick={() => {
                    if (unassignedTotal > 0) {
                      toast.error({
                        title: "Cannot Publish Master Schedule",
                        description: `Cannot publish master schedule: ${unassignedTotal} subject(s) school-wide have no assigned teacher`,
                      });
                      return;
                    }
                    if (errorConflictsCount > 0) {
                      toast.error({
                        title: "Cannot Publish Master Schedule",
                        description: "Fix all schedule conflicts before publishing master schedule",
                      });
                      return;
                    }
                    void handleSave("publish", "all");
                  }}
                >
                  <Send className="size-3.5" />
                  Publish Master Schedule
                </Button>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-3 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {notice?.type === "error" && <AdminValidationAlert message={notice.message} />}
              {/* Notice Alert Overlay */}
              {notice?.type === "success" && (
                <Alert
                  status={notice.type}
                  position="top-right"
                  duration={5000}
                  onClose={() => setNotice(null)}
                >
                  <div className="flex gap-2.5 items-start">
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-800 mt-0.5" />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {notice.title && (
                        <Alert.Title className="font-bold text-sm text-foreground">
                          {notice.title}
                        </Alert.Title>
                      )}
                      <Alert.Description className="text-muted-foreground text-xs leading-normal break-words">
                        {notice.message}
                      </Alert.Description>
                    </div>
                  </div>
                </Alert>
              )}

              <div className="flex min-w-0 flex-col gap-3">
                {/* Section Schedule List */}
                <main className="flex min-w-0 flex-col gap-3 w-full">
                  {/* Filters & Status Bar */}
                  <section className="flex flex-col gap-3 w-full">
                    <div className="flex flex-row gap-2 w-full">
                      <label className="relative w-full">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                        <Input
                          variant="search"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Search class"
                          className="w-full"
                        />
                      </label>

                      <div className="w-48 shrink-0">
                        <Select
                          value={statusFilter}
                          onValueChange={(val) => setStatusFilter(val)}
                        >
                          <Select.Trigger className="w-full whitespace-nowrap">
                            <Select.Value placeholder="All Statuses" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Group>
                              <Select.Item value="all" className="whitespace-nowrap">All Statuses</Select.Item>
                              <Select.Item value="published" className="whitespace-nowrap">Published</Select.Item>
                              <Select.Item value="draft" className="whitespace-nowrap">Draft</Select.Item>
                              <Select.Item value="conflicts" className="whitespace-nowrap">With Conflicts</Select.Item>
                            </Select.Group>
                          </Select.Content>
                        </Select>
                      </div>

                      <div className="w-48 shrink-0">
                        <Select
                          value={selectedSectionId}
                          onValueChange={(val) => setSelectedSectionId(val)}
                        >
                          <Select.Trigger className="w-full whitespace-nowrap">
                            <Select.Value placeholder="All Sections" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Group>
                              <Select.Item value="all" className="whitespace-nowrap">All Sections</Select.Item>
                              {availableSections.map((cls) => (
                                <Select.Item key={cls.class_id} value={String(cls.class_id)} className="whitespace-nowrap">
                                  {cls.section_name}{studioClassPathwayLabel(cls, studioData?.academic_levels) ? ` — ${studioClassPathwayLabel(cls, studioData?.academic_levels)}` : ""}
                                </Select.Item>
                              ))}
                            </Select.Group>
                          </Select.Content>
                        </Select>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 justify-between">
                      <div className="flex items-center gap-2 pb-1">
                        <span className="shrink-0 text-sm font-regular text-muted-foreground">
                          Grade:
                        </span>
                        {gradeOptions.map((grade) => (
                          <Button
                            key={grade.id}
                            autoIcon={false}
                            variant={activeGradeId === grade.id ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              setSelectedGradeId(grade.id);
                              setSelectedSectionId("all");
                              setCarouselActiveIdx(0);
                              setAutoScheduleNotice(null);
                            }}
                            className="shrink-0 border-black shadow-none"
                          >
                            {grade.label}
                          </Button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Auto-Generate All */}
                        <Button
                          size="sm"
                          disabled={isLoading || isSaving}
                          onClick={() => void handleAutoSchedule()}
                          className="gap-2 cursor-pointer"
                        >
                          <Sparkles className="size-3" />
                          <span>Auto-Generate</span>
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 font-bold">
                      {autoScheduleNotice && (
                        <Badge
                          size="sm"
                          variant="outline"
                          className={cn(
                            "inline-flex items-center gap-1.5 font-bold select-none px-2.5 max-w-full",
                            autoScheduleNotice.type === "success"
                              ? "bg-emerald-50 text-emerald-950 border-emerald-600"
                              : "bg-red-50 text-destructive border-destructive"
                          )}
                          role="status"
                          aria-live="polite"
                        >
                          {autoScheduleNotice.type === "success" ? (
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                          ) : (
                            <AlertCircle className="size-3.5 shrink-0 text-destructive" />
                          )}
                          <span className="truncate max-w-xs sm:max-w-md md:max-w-lg" title={formattedAutoScheduleMessage}>
                            {autoScheduleNotice.title && (
                              <strong className="font-bold mr-1">{autoScheduleNotice.title}:</strong>
                            )}
                            {formattedAutoScheduleMessage}
                          </span>
                          <button
                            type="button"
                            onClick={() => setAutoScheduleNotice(null)}
                            className="ml-1 text-muted-foreground hover:text-black cursor-pointer p-0.5 rounded transition-colors shrink-0"
                            aria-label="Dismiss notice"
                          >
                            <X className="size-3" />
                          </button>
                        </Badge>
                      )}

                      {activeSectionErrorConflictsCount > 0 && (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex"><Badge
                            size="sm"
                            variant="solid"
                            onClick={() => handleJumpToItem("error")}
                            className="bg-destructive inline-flex items-center gap-1.5 cursor-pointer hover:opacity-85 transition-all active:scale-95 select-none"
                          >
                            <AlertCircle className="size-3.5" />
                            {activeSectionErrorConflictsCount} {activeSectionErrorConflictsCount === 1 ? "conflict" : "conflicts"} — must resolve to publish
                          </Badge></span>} />
                          <TooltipContent>Jump to conflict</TooltipContent>
                        </Tooltip>
                      )}

                      {activeSectionWarningConflictsCount > 0 && (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex"><Badge
                            size="sm"
                            variant="surface"
                            onClick={() => handleJumpToItem("warning")}
                            className="inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer hover:opacity-85 bg-yellow transition-all active:scale-95 select-none"
                          >
                            <AlertTriangle className="size-3.5" />
                            {activeSectionWarningConflictsCount} {activeSectionWarningConflictsCount === 1 ? "warning" : "warnings"}
                          </Badge></span>} />
                          <TooltipContent>Jump to warning</TooltipContent>
                        </Tooltip>
                      )}

                      {activeSectionUnassignedTotal > 0 && (
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex"><Badge
                            size="sm"
                            variant="outline"
                            onClick={() => handleJumpToItem("unassigned")}
                            className="cursor-pointer hover:opacity-85 transition-all active:scale-95 select-none"
                          >
                            {activeSectionUnassignedTotal} unassigned
                          </Badge></span>} />
                          <TooltipContent>Jump to unassigned</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </section>

                  {isLoading ? (
                    <LoadingPanel label="Loading class sections..." />
                  ) : loadError ? (
                    <Empty className="transition-shadow hover:shadow-none">
                      <EmptyHeader>
                        <EmptyMedia><div className="flex size-10 items-center justify-center border-2 border-black bg-primary text-black" aria-hidden="true"><AlertTriangle className="size-5" /></div></EmptyMedia>
                        <EmptyTitle>Unable to load class sections</EmptyTitle>
                        <EmptyDescription>Please try again.</EmptyDescription>
                      </EmptyHeader>
                      <Button size="sm" className="gap-1.5" onClick={() => void loadStudio(selectedPeriodId ?? undefined)}>Retry</Button>
                    </Empty>
                  ) : filteredClasses.length === 0 ? (
                    <Empty className="transition-shadow hover:shadow-none">
                      <EmptyHeader>
                        <EmptyMedia><div className="flex size-10 items-center justify-center border-2 border-black bg-primary text-black" aria-hidden="true"><Search className="size-5" /></div></EmptyMedia>
                        <EmptyTitle>{searchQuery.trim() ? "No classes match your search" : studioData?.classes.length ? "No class sections match these filters" : "No class sections yet"}</EmptyTitle>
                        <EmptyDescription>{searchQuery.trim() ? "Try a different class name or clear the search." : studioData?.classes.length ? "Choose another grade level or section to see class schedules." : "Create a class in the Admin Classes page to start assigning subjects."}</EmptyDescription>
                      </EmptyHeader>
                      {(searchQuery.trim() || (gradeOptions.length > 0 && activeGradeId !== gradeOptions[0].id) || selectedSectionId !== "all" || statusFilter !== "all") && (
                        <Button size="sm" onClick={() => { setSearchQuery(""); setSelectedGradeId(gradeOptions[0]?.id || ""); setSelectedSectionId("all"); setStatusFilter("all"); setCarouselActiveIdx(0); }}>Clear filters</Button>
                      )}
                    </Empty>
                  ) : (() => {
                    const renderSectionActions = (cls?: (typeof filteredClasses)[number]) => {
                      if (!cls) return null;

                      const sectionLoads = loads.filter((l) => l.class_id === cls.class_id);
                      const sectionUnassignedCount = sectionLoads.filter((l) => !l.staff_id).length;
                      const isSectionPublished = isSectionLocked(cls.class_id);
                      const sectionErrors = conflicts.filter(
                        (c) => c.severity === "error" && conflictAffectsClass(c, cls.class_id)
                      );
                      const sectionHasErrors = sectionErrors.length > 0;
                      const isPublishSectionDisabled = isSaving || sectionHasErrors || sectionUnassignedCount > 0;

                      const handlePublishSectionClick = () => {
                        if (sectionUnassignedCount > 0) {
                          toast.error({
                            title: "Cannot Publish Section",
                            description: `Section "${cls.section_name}" has ${sectionUnassignedCount} subject(s) without an assigned teacher. Please assign all teachers first.`,
                          });
                          return;
                        }
                        if (sectionHasErrors) {
                          const errorMsg = sectionErrors[0]?.message || "This section has unresolved schedule conflicts.";
                          toast.error({
                            title: "Cannot Publish Section",
                            description: `Section "${cls.section_name}" cannot be published: ${errorMsg}`,
                          });
                          return;
                        }
                        setPublishTargetClass({
                          classId: cls.class_id,
                          sectionName: cls.section_name,
                          isRevisionUpdate: hasPendingDraft,
                        });
                      };

                      const hasPendingDraft = Boolean(
                        studioData?.has_pending_draft_by_class?.[cls.class_id] ||
                        studioData?.has_pending_draft_by_class?.[String(cls.class_id)]
                      );

                      return (
                        <div className="flex items-center gap-2 flex-wrap">
                          {isSectionPublished && !hasPendingDraft ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={isSaving}
                              className="rounded! shadow-sm"
                              onClick={() => void handleUnlockSection(cls.class_id)}
                            >
                              <Unlock className="size-3.5 mr-1" />
                              Unlock Section
                            </Button>
                          ) : hasPendingDraft ? (
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSaving}
                                onClick={() =>
                                  setDiscardTargetClass({
                                    classId: cls.class_id,
                                    sectionName: cls.section_name,
                                  })
                                }
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 shadow-none cursor-pointer"
                              >
                                <RotateCcw className="size-3.5 mr-1" />
                                Discard Draft
                              </Button>
                              <Button
                                size="sm"
                                variant={isPublishSectionDisabled ? "default" : "outline"}
                                disabled={isPublishSectionDisabled}
                                className="gap-2 shadow-none"
                                onClick={handlePublishSectionClick}
                              >
                                <Send className="size-3.5" />
                                Publish
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant={isPublishSectionDisabled ? "default" : "outline"}
                              disabled={isPublishSectionDisabled}
                              className="gap-2"
                              onClick={handlePublishSectionClick}
                            >
                              <Send className="size-3.5" />
                              Publish Section
                            </Button>
                          )}
                          <DropdownMenu>
                            <Tooltip>
                              <TooltipTrigger render={<span className="inline-flex">
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={isSectionPublished || isSaving}
                                    className="rounded! bg-black p-[7px] text-white shadow-none hover:bg-black disabled:bg-black disabled:text-white disabled:opacity-100"
                                    aria-label="More options"
                                    onClick={(e) => e.preventDefault()}
                                  >
                                    <EllipsisIcon className="size-3.5" />
                                  </Button>
                                </DropdownMenuTrigger>
                              </span>} />
                              <TooltipContent>Section actions</TooltipContent>
                            </Tooltip>
                            <DropdownMenuContent align="end" collisionPadding={12} className="w-max min-w-[200px] max-w-[calc(100vw-2rem)] rounded border-2 border-border">
                              <DropdownMenuItem
                                className="gap-2 cursor-pointer"
                                disabled={isSectionPublished || isSaving}
                                onClick={() => void handleAutoSchedule(cls.class_id)}
                              >
                                <Wand2 className="size-4" /> Auto-Fit Section
                              </DropdownMenuItem>

                              {(() => {
                                const siblingSections = (studioData?.classes || []).filter(
                                  (c) => c.class_id !== cls.class_id && c.academic_level_id === cls.academic_level_id
                                );
                                const configuredSiblings = siblingSections.filter((c) =>
                                  loads.some((l) => l.class_id === c.class_id && l.start_time && l.end_time)
                                );

                                if (configuredSiblings.length === 1) {
                                  const sib = configuredSiblings[0];
                                  return (
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger className="gap-2 rounded cursor-pointer">
                                        <Copy className="size-4" />
                                        <span className="min-w-0 whitespace-normal break-words">Copy from <span className="font-bold">{sib.section_name}{studioClassPathwayLabel(sib, studioData?.academic_levels) ? ` — ${studioClassPathwayLabel(sib, studioData?.academic_levels)}` : ""}</span></span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                        <DropdownMenuSubContent collisionPadding={12} className="rounded border-2 border-border min-w-[210px] max-w-[calc(100vw-2rem)] [&_[data-slot=dropdown-menu-item]]:whitespace-normal">
                                          <DropdownMenuItem
                                            className="font-bold"
                                            onClick={() =>
                                              void handleCopyScheduleFromSection(cls.class_id, sib.class_id, "stagger")
                                            }
                                          >
                                            Conflict-Aware Fill (Recommended)
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            className=""
                                            onClick={() =>
                                              void handleCopyScheduleFromSection(cls.class_id, sib.class_id, "exact")
                                            }
                                          >
                                            Exact Match
                                          </DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                      </DropdownMenuPortal>
                                    </DropdownMenuSub>
                                  );
                                }

                                if (configuredSiblings.length > 1) {
                                  return (
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger className="gap-2 rounded cursor-pointer">
                                        <Copy className="size-4" />
                                        <span>Copy Schedule</span>
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuPortal>
                                        <DropdownMenuSubContent collisionPadding={12} className="rounded border-2 border-border min-w-[210px] max-w-[calc(100vw-2rem)]">
                                          {configuredSiblings.map((sib) => (
                                            <DropdownMenuSub key={sib.class_id}>
                                              <DropdownMenuSubTrigger className="rounded cursor-pointer whitespace-normal break-words font-bold focus:bg-gray-100">
                                                {sib.section_name}{studioClassPathwayLabel(sib, studioData?.academic_levels) ? ` — ${studioClassPathwayLabel(sib, studioData?.academic_levels)}` : ""}
                                              </DropdownMenuSubTrigger>
                                              <DropdownMenuPortal>
                                                <DropdownMenuSubContent collisionPadding={12} className="rounded border-2 border-border min-w-[210px] max-w-[calc(100vw-2rem)] [&_[data-slot=dropdown-menu-item]]:whitespace-normal">
                                                  <DropdownMenuItem
                                                    className="cursor-pointer font-bold focus:bg-gray-100"
                                                    onClick={() =>
                                                      void handleCopyScheduleFromSection(cls.class_id, sib.class_id, "stagger")
                                                    }
                                                  >
                                                    Conflict-Aware Fill (Recommended)
                                                  </DropdownMenuItem>
                                                  <DropdownMenuItem
                                                    className="cursor-pointer focus:bg-gray-100"
                                                    onClick={() =>
                                                      void handleCopyScheduleFromSection(cls.class_id, sib.class_id, "exact")
                                                    }
                                                  >
                                                    Exact Match
                                                  </DropdownMenuItem>
                                                </DropdownMenuSubContent>
                                              </DropdownMenuPortal>
                                            </DropdownMenuSub>
                                          ))}
                                        </DropdownMenuSubContent>
                                      </DropdownMenuPortal>
                                    </DropdownMenuSub>
                                  );
                                }
                                return null;
                              })()}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    };

                    const isAllList =
                      filteredClasses.length > 0 &&
                      filteredClasses.every((c) => sectionViewModes[c.class_id] === "list");
                    const currentViewMode: "grid" | "list" = isAllList ? "list" : "grid";

                    return (
                      <GradeGroupCarousel
                        classes={filteredClasses}
                        academicLevels={studioData?.academic_levels || []}
                        viewMode={currentViewMode}
                        activeIdx={carouselActiveIdx}
                        onActiveIdxChange={setCarouselActiveIdx}
                        onViewModeChange={(mode) => {
                          setSectionViewModes((prev) => {
                            const next = { ...prev };
                            filteredClasses.forEach((c) => {
                              next[c.class_id] = mode;
                            });
                            return next;
                          });
                        }}
                        hideSectionNav={selectedSectionId !== "all"}
                        renderHeaderActions={(activeIdx) =>
                          renderSectionActions(filteredClasses[activeIdx] || filteredClasses[0])
                        }
                      >
                        {filteredClasses.map((cls) => {
                          const offerings = studioData?.subject_offerings || [];
                          const sectionLoads = loads.filter((l) => l.class_id === cls.class_id);
                          const invalidDraftSubjectIds = new Set(
                            sectionLoads
                              .filter((load) => load._offering_eligible === false)
                              .map((load) => load.subject_id)
                          );
                          const classSubjects = (studioData?.subjects || []).filter((sub) =>
                            isSubjectOfferedForClass(sub, cls, offerings, studioData?.active_period_id ?? -1) ||
                            invalidDraftSubjectIds.has(sub.subject_id)
                          );
                          const sectionLocked = isSectionLocked(cls.class_id);
                          const sectionTemplateSlots = getSectionSlots(cls);
                          const configuredNames = new Set(sectionTemplateSlots.map((slot) => slot.slot_name));
                          const hasValidTimetable = isJhsClass(cls.class_id)
                            ? cls.period_template_group === "JHS_45MIN" &&
                              (studioData?.jhs_template_audit
                                ? sectionTemplateSlots.length >= JHS_REQUIRED_SLOT_NAMES.length &&
                                  JHS_REQUIRED_SLOT_NAMES.every((name) => configuredNames.has(name))
                                : sectionTemplateSlots.some((slot) => slot.slot_type === "CLASS" && !slot.is_locked_break))
                            : sectionTemplateSlots.some((slot) => slot.slot_type === "CLASS" && !slot.is_locked_break);

                          const timesBySubject = new Map<string, { start: number; end: number }>();
                          for (const l of sectionLoads) {
                            if (!l.start_time) continue;
                            const key = String(l.subject_id);
                            const start = timeStringToMinutes(l.start_time);
                            const end = timeStringToMinutes(l.end_time);
                            const existing = timesBySubject.get(key);
                            if (!existing || start < existing.start) {
                              timesBySubject.set(key, { start, end });
                            }
                          }

                          const sortedClassSubjects = [...classSubjects].sort((a, b) => {
                            const aTimes = timesBySubject.get(String(a.subject_id)) ?? { start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER };
                            const bTimes = timesBySubject.get(String(b.subject_id)) ?? { start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER };
                            if (aTimes.start !== bTimes.start) return aTimes.start - bTimes.start;
                            if (aTimes.end !== bTimes.end) return aTimes.end - bTimes.end;
                            return (a.subject_name || "").localeCompare(b.subject_name || "");
                          });

                          return (
                            <div key={cls.class_id} className="w-full min-w-0 ">
                              {sectionLocked && (
                                <div role="status" className="my-2 rounded border-2 border-black bg-amber-50 px-3 py-2 text-sm">
                                  <strong>Section Locked</strong>
                                  <span className="ml-2">This section is locked. Unlock it to modify subject schedules or teacher assignments.</span>
                                </div>
                              )}
                              <div
                                key={cls.class_id}
                                className="block min-w-0 overflow-hidden shadow-none"
                              >
                                {invalidDraftSubjectIds.size > 0 && (
                                  <AdminValidationAlert
                                    message={`${invalidDraftSubjectIds.size} existing subject load${invalidDraftSubjectIds.size === 1 ? " is" : "s are"} no longer eligible for this year, term, grade, and pathway. ${invalidDraftSubjectIds.size === 1 ? "It is" : "They are"} shown for review but cannot be published until the offering is corrected.`}
                                  />
                                )}
                                {/* <div className="flex items-center justify-between pb-1 flex-wrap gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">

                                    <Badge
                                      size="sm"
                                      variant={isSectionPublished ? "surface" : "default"}
                                    >
                                      {isSectionPublished ? "Published" : "Draft"}
                                    </Badge>

                                    <Badge
                                      size="sm"
                                      variant="solid"
                                    >
                                      {classSubjects.length} Subjects
                                    </Badge>
                                  </div>
                                </div> */}

                                {!hasValidTimetable ? (
                                  <EmptyStateCard
                                    title="Configure the timetable first"
                                    description={`Subject Load for ${cls.section_name} is unavailable until its complete bell schedule is configured. The timetable controls every assignable class period and break.`}
                                    actionLabel="Configure timetable"
                                    onAction={() => setIsBreakDrawerOpen(true)}
                                    icon={<Clock className="size-5" />}
                                  />
                                ) : classSubjects.length === 0 ? (
                                  <Empty className="my-2 shadow-none hover:shadow-none">
                                    <EmptyHeader>
                                      <EmptyMedia><div className="flex size-10 items-center justify-center border-2 border-black bg-primary text-black" aria-hidden="true"><Search className="size-5" /></div></EmptyMedia>
                                      <EmptyTitle>No eligible subject offerings</EmptyTitle>
                                      <EmptyDescription>
                                        Configure active offerings for {cls.section_name}&apos;s academic year, term, grade level, and pathway in Subjects &rarr; Curriculum Plan.
                                      </EmptyDescription>
                                    </EmptyHeader>
                                  </Empty>
                                ) : (sectionViewModes[cls.class_id] || "grid") === "grid" ? (
                                  <>
                                  {!sectionLocked && (
                                    cellSelection?.classId === cls.class_id ? (
                                      <div
                                        role="toolbar"
                                        aria-label="Selected timetable cells"
                                        className="my-2 flex flex-wrap items-center justify-between gap-2 rounded border-2 border-black bg-primary/15 px-3 py-2"
                                      >
                                        <span className="text-sm font-bold text-black">
                                          {cellSelection.cells.length} cell{cellSelection.cells.length === 1 ? "" : "s"} selected
                                          <span className="ml-2 font-normal text-muted-foreground">
                                            Ctrl/⌘ + click to group more cells · Esc to clear
                                          </span>
                                        </span>
                                        <div className="flex items-center gap-2">
                                          <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                              <Button size="sm" className="gap-2">
                                                <Plus className="size-3.5" />
                                                Add Subject
                                              </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent
                                              align="end"
                                              collisionPadding={12}
                                              className="max-h-72 min-w-[220px] overflow-y-auto rounded border-2 border-border"
                                            >
                                              {sortedClassSubjects.map((sub) => (
                                                <DropdownMenuItem
                                                  key={sub.subject_id}
                                                  className="gap-2 cursor-pointer"
                                                  onClick={() => handleAssignSubjectToCells(cls.class_id, sub.subject_id)}
                                                >
                                                  <span
                                                    aria-hidden="true"
                                                    className={cn("size-3 shrink-0 rounded-sm border border-black", getSubjectColor(sub.subject_name, sub.subject_id))}
                                                  />
                                                  {sub.subject_name}
                                                </DropdownMenuItem>
                                              ))}
                                            </DropdownMenuContent>
                                          </DropdownMenu>
                                          <Button size="sm" variant="outline" className="gap-2" onClick={() => setCellSelection(null)}>
                                            <X className="size-3.5" />
                                            Clear
                                          </Button>
                                        </div>
                                      </div>
                                    ) : (
                                      <p className="mt-2 text-xs text-muted-foreground">
                                        Drag a subject onto another to swap them. Click empty cells (Ctrl/⌘ + click to group several) to add a subject.
                                      </p>
                                    )
                                  )}
                                  <Table
                                    className="w-full min-w-[640px] border-collapse bg-background text-sm"
                                    wrapperClassName="h-auto overflow-x-auto rounded border-2 border-black bg-background my-2 shadow-none"
                                  >
                                    <Table.Header className="">
                                      <Table.Row className="border-b-2 border-black">
                                        {/* Sticky time-label corner */}
                                        <Table.Head className="sticky left-0 z-20 w-28 border-b-2 border-r-2 border-black bg-primary px-3 py-2.5 text-left text-base font-bold text-black">
                                          Time
                                        </Table.Head>
                                        {TIMETABLE_DAYS.map((d) => (
                                          <Table.Head
                                            key={d.key}
                                            className="border-b-2 border-r-none border-black bg-primary px-3 py-2.5 text-center text-base font-bold text-black whitespace-nowrap min-w-[120px]"
                                          >
                                            <div>{d.full}</div>
                                          </Table.Head>
                                        ))}
                                      </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                      {sectionTemplateSlots.map((slot, sIdx) => {
                                        const isBreak = slot.is_locked_break || slot.slot_type !== "CLASS";
                                        const timeLabel = `${formatTime12h(slot.start_time)} - ${formatTime12h(slot.end_time)}`;

                                        if (isBreak) {
                                          return (
                                            <Table.Row key={`break_${slot.display_order}_${sIdx}`} className="bg-background border-none">
                                              <Table.Cell className="sticky left-0 z-10 border-r-2 border-t-2 border-black bg-background px-3 py-1 text-xs font-semibold text-foreground whitespace-nowrap">
                                                {timeLabel}
                                              </Table.Cell>
                                              <Table.Cell
                                                colSpan={TIMETABLE_DAYS.length}
                                                className="border-none bg-background px-3 py-1.5 text-center text-xs font-medium text-muted-foreground"
                                              >
                                                {slot.slot_name}
                                              </Table.Cell>
                                            </Table.Row>
                                          );
                                        }

                                        return (
                                          <Table.Row key={`slot_${slot.start_time}_${sIdx}`} className="bg-background border-none hover:bg-background">
                                            {/* Sticky time label */}
                                            <Table.Cell className="sticky left-0 z-10 border-r-2 border-y-2 border-black bg-background px-3 py-2.5 align-middle whitespace-nowrap">
                                              <div className="text-xs font-bold text-black">{timeLabel}</div>
                                            </Table.Cell>
                                            {(() => {
                                              const dayLoads = TIMETABLE_DAYS.map((d, dIdx) => {
                                                const matched = sectionLoads.filter((l) => {
                                                  const hasDay = (l.days_of_week || []).some(
                                                    (day) =>
                                                      day === d.key ||
                                                      day === d.short ||
                                                      (d.key === "THU" && (day === "THU" || day === "Th"))
                                                  );
                                                  if (!hasDay || !l.start_time) return false;
                                                  return l.start_time === slot.start_time;
                                                });
                                                const key = matched.length === 0
                                                  ? `__empty_${dIdx}__`
                                                  : matched.map((l) => `${l.subject_id}:${l.staff_id ?? "unassigned"}`).sort().join("|");
                                                return {
                                                  day: d,
                                                  dayIndex: dIdx,
                                                  matchedLoads: matched,
                                                  key,
                                                };
                                              });

                                              type GroupedDayCell = {
                                                startIdx: number;
                                                endIdx: number;
                                                colSpan: number;
                                                matchedLoads: typeof sectionLoads;
                                              };

                                              const groupedCells: GroupedDayCell[] = [];
                                              dayLoads.forEach((dItem, idx) => {
                                                const prev = groupedCells[groupedCells.length - 1];
                                                if (prev && dItem.matchedLoads.length > 0 && dayLoads[prev.startIdx].key === dItem.key) {
                                                  prev.colSpan += 1;
                                                  prev.endIdx = idx;
                                                } else {
                                                  groupedCells.push({
                                                    startIdx: idx,
                                                    endIdx: idx,
                                                    colSpan: 1,
                                                    matchedLoads: dItem.matchedLoads,
                                                  });
                                                }
                                              });

                                              return groupedCells.map((group) => {
                                                const groupDays = TIMETABLE_DAYS.slice(group.startIdx, group.endIdx + 1).map((d) => d.key);
                                                const blockRef: GridBlockRef = {
                                                  classId: cls.class_id,
                                                  loadKeys: group.matchedLoads.map((l) => l._key).filter((k): k is string => Boolean(k)),
                                                  startTime: slot.start_time,
                                                  endTime: slot.end_time,
                                                  days: groupDays,
                                                };
                                                const dropId = `${cls.class_id}|${slot.start_time}|${group.startIdx}`;
                                                const isDropTarget =
                                                  !sectionLocked && gridDragSource?.classId === cls.class_id;
                                                const isDragOver = isDropTarget && gridDragOverId === dropId;
                                                const dropHandlers = isDropTarget
                                                  ? {
                                                      onDragOver: (e: React.DragEvent) => {
                                                        e.preventDefault();
                                                        e.dataTransfer.dropEffect = "move";
                                                        if (gridDragOverId !== dropId) setGridDragOverId(dropId);
                                                      },
                                                      onDragLeave: (e: React.DragEvent) => {
                                                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                                                          setGridDragOverId((prev) => (prev === dropId ? null : prev));
                                                        }
                                                      },
                                                      onDrop: (e: React.DragEvent) => {
                                                        e.preventDefault();
                                                        if (gridDragSource) handleGridDrop(cls.class_id, gridDragSource, blockRef);
                                                        setGridDragSource(null);
                                                        setGridDragOverId(null);
                                                      },
                                                    }
                                                  : {};
                                                const cellId = gridCellId(slot.start_time, slot.end_time, groupDays[0]);
                                                const isCellSelected =
                                                  cellSelection?.classId === cls.class_id && cellSelection.cells.includes(cellId);

                                                return (
                                                  <Table.Cell
                                                    key={`slot_${slot.start_time}_grp_${group.startIdx}_${group.endIdx}`}
                                                    colSpan={group.colSpan}
                                                    className="border-none px-1.5 py-1 align-top"
                                                    {...dropHandlers}
                                                  >
                                                    {group.matchedLoads.length === 0 ? (
                                                      <div
                                                        role={sectionLocked ? undefined : "button"}
                                                        tabIndex={sectionLocked ? undefined : 0}
                                                        aria-pressed={sectionLocked ? undefined : isCellSelected}
                                                        aria-label={sectionLocked ? undefined : `${TIMETABLE_DAYS[group.startIdx].full} ${timeLabel}`}
                                                        title={sectionLocked ? undefined : "Click to select · Ctrl/⌘ + click to group cells"}
                                                        onClick={(e) => handleToggleGridCell(cls.class_id, cellId, e.ctrlKey || e.metaKey)}
                                                        onKeyDown={(e) => {
                                                          if (e.key === "Enter" || e.key === " ") {
                                                            e.preventDefault();
                                                            handleToggleGridCell(cls.class_id, cellId, e.ctrlKey || e.metaKey);
                                                          }
                                                        }}
                                                        className={cn(
                                                          "flex h-full min-h-[2.75rem] items-center justify-center rounded border-2 border-dashed border-transparent text-black transition-colors focus:outline-none",
                                                          !sectionLocked && "cursor-pointer hover:border-black/40 hover:bg-primary/10 focus-visible:border-black",
                                                          isCellSelected && "border-solid border-black bg-primary/30 hover:bg-primary/30",
                                                          isDragOver && "border-black bg-primary/20"
                                                        )}
                                                      >
                                                        {isCellSelected && <Plus className="size-4" aria-hidden="true" />}
                                                      </div>
                                                    ) : (
                                                      <div
                                                        draggable={!sectionLocked}
                                                        onDragStart={(e) => {
                                                          if (sectionLocked) return;
                                                          e.dataTransfer.effectAllowed = "move";
                                                          e.dataTransfer.setData("text/plain", blockRef.loadKeys.join(","));
                                                          setGridDragSource(blockRef);
                                                          setCellSelection(null);
                                                        }}
                                                        onDragEnd={() => {
                                                          setGridDragSource(null);
                                                          setGridDragOverId(null);
                                                        }}
                                                        className={cn(
                                                          "flex flex-col gap-1 w-full rounded transition-opacity",
                                                          !sectionLocked && "cursor-grab active:cursor-grabbing",
                                                          gridDragSource?.classId === cls.class_id &&
                                                            gridDragSource.startTime === slot.start_time &&
                                                            gridDragSource.days.join() === groupDays.join() &&
                                                            "opacity-50",
                                                          isDragOver && "outline-2 outline-offset-2 outline-dashed outline-black"
                                                        )}
                                                      >
                                                        {group.matchedLoads.length > 1 && (
                                                          <Badge
                                                            variant="outline"
                                                            className="border-red-400 bg-red-50 text-red-700 text-[9px] font-bold self-start"
                                                          >
                                                            ⚠ {group.matchedLoads.length} overlapping
                                                          </Badge>
                                                        )}
                                                        {group.matchedLoads.map((mLoad, mIdx) => {
                                                          const subObj = (studioData?.subjects || []).find(
                                                            (s) => s.subject_id === mLoad.subject_id
                                                          );
                                                          const teacherObj = (studioData?.teachers || []).find(
                                                            (t) => t.staff_id === mLoad.staff_id
                                                          );
                                                          const conflict = getLoadConflict(cls.class_id, mLoad.subject_id);
                                                          const isSlotHighlighted = highlightedKey === `${cls.class_id}_${mLoad.subject_id}`;
                                                          const subjectBg = getSubjectColor(subObj?.subject_name, mLoad.subject_id);

                                                          return (
                                                            <div
                                                              key={mLoad.subject_load_id || mLoad._key || mIdx}
                                                              id={`timetable-slot-${cls.class_id}_${mLoad.subject_id}`}
                                                              role="button"
                                                              tabIndex={0}
                                                              title={conflict ? conflict.message : teacherObj ? `Assigned: ${teacherObj.name}` : "Click to assign teacher"}
                                                              onClick={() => {
                                                                if (!sectionLocked) {
                                                                  setTeacherModalTarget({
                                                                    classId: cls.class_id,
                                                                    className: cls.section_name,
                                                                    subjectId: mLoad.subject_id,
                                                                    subjectName: subObj?.subject_name || `Subject #${mLoad.subject_id}`,
                                                                    currentStaffId: mLoad.staff_id ?? null,
                                                                  });
                                                                }
                                                              }}
                                                              onKeyDown={(e) => {
                                                                if ((e.key === "Enter" || e.key === " ") && !sectionLocked) {
                                                                  e.preventDefault();
                                                                  setTeacherModalTarget({
                                                                    classId: cls.class_id,
                                                                    className: cls.section_name,
                                                                    subjectId: mLoad.subject_id,
                                                                    subjectName: subObj?.subject_name || `Subject #${mLoad.subject_id}`,
                                                                    currentStaffId: mLoad.staff_id ?? null,
                                                                  });
                                                                }
                                                              }}
                                                              className={cn(
                                                                "w-full rounded border-2 border-black px-2 py-1.5 text-xs hover:bg-retro leading-snug shadow-sm cursor-pointer transition-all hover:-translate-y-0.5 active:translate-y-0 focus:outline-none",
                                                                isSlotHighlighted
                                                                  ? " border-primary bg-primary/25 scale-[1.03] shadow-md z-10 animate-pulse"
                                                                  : conflict
                                                                    ? conflict.severity === "error"
                                                                      ? "border-destructive bg-destructive/20 text-destructive-foreground"
                                                                      : "border-amber-400 bg-amber-100/50"
                                                                    : !mLoad.staff_id
                                                                      ? cn("border-dashed border-amber-600/80", subjectBg)
                                                                      : subjectBg
                                                              )}
                                                            >
                                                              <div className="font-bold text-sm leading-tight text-black truncate">
                                                                {subObj?.subject_name || `Subject #${mLoad.subject_id}`}
                                                              </div>
                                                              <div className="text-xs text-muted-foreground truncate">
                                                                {teacherObj
                                                                  ? teacherObj.name
                                                                  : <span className="italic font-medium text-amber-700">Unassigned</span>}
                                                              </div>

                                                            </div>
                                                          );
                                                        })}
                                                      </div>
                                                    )}
                                                  </Table.Cell>
                                                );
                                              });
                                            })()}
                                          </Table.Row>
                                        );
                                      })}
                                    </Table.Body>
                                  </Table>
                                  </>
                                ) : (
                                  <Table
                                    className="min-w-[960px] table-fixed shadow-none"
                                    wrapperClassName="h-auto max-w-full overflow-x-auto overscroll-x-contain shadow-none [scrollbar-width:thin]"
                                  >
                                    <Table.Header className="">
                                      <Table.Row>
                                        <Table.Head className="w-[40%] bg-primary font-bold text-primary-foreground">Subject</Table.Head>
                                        <Table.Head className="w-[36%] bg-primary font-bold text-primary-foreground">Schedule</Table.Head>
                                        <Table.Head className="w-[24%] bg-primary font-bold text-primary-foreground">Assigned Teacher</Table.Head>
                                      </Table.Row>
                                    </Table.Header>
                                    <Table.Body>
                                      {sortedClassSubjects.map((sub) => {
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
                                        const isOfferingEligible = !invalidDraftSubjectIds.has(sub.subject_id);
                                        const isHighlighted =
                                          highlightedKey === `${cls.class_id}_${sub.subject_id}`;

                                        return (
                                          <Table.Row
                                            key={sub.subject_id}
                                            id={`subject-row-${cls.class_id}_${sub.subject_id}`}
                                            className={cn(
                                              "transition-all duration-300",
                                              isHighlighted
                                                ? "bg-primary/25 font-semibold animate-pulse"
                                                : conflict
                                                  ? conflict.severity === "error"
                                                    ? "bg-destructive/10"
                                                    : "bg-amber-50"
                                                  : "hover:bg-accent"
                                            )}
                                          >
                                            {/* Subject Column */}
                                            <Table.Cell className="py-2.5 px-3 align-middle">
                                              <div className="flex min-w-0 flex-col gap-1">
                                                <div className="flex min-w-0 flex-col items-start gap-1.5">
                                                  <span className="w-full truncate font-bold text-base text-black" title={sub.subject_name}>
                                                    {sub.subject_name}
                                                  </span>
                                                  {!isOfferingEligible && (
                                                    <Badge variant="outline" size="sm" className="bg-red-50 text-red-900 border-red-400 font-bold">
                                                      Not offered — cannot publish
                                                    </Badge>
                                                  )}
                                                  {conflict && (
                                                    <span className="max-w-full whitespace-normal break-words rounded border border-black bg-red-100 px-1.5 py-0.5 text-[11px] font-bold" title={conflict.message}>
                                                      {conflict.severity === "error" ? "Conflict" : "Warning"}: {conflict.message}
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                  {/* <Badge variant="default" size="sm">
                                                    {sub.subject_codename || `SUB-${sub.subject_id}`}
                                                  </Badge> */}
                                                  {/* {(() => {
                                                    const hasLive = subjectSlots.some((s) => s.has_live_data);
                                                    const deps = subjectSlots.find((s) => s.dependencies)?.dependencies;
                                                    const eduTotal = deps?.educational_total ?? (hasLive ? (deps?.total ?? 0) : 0);
                                                    const adminTotal = deps?.administrative_total ?? 0;

                                                    if (eduTotal === 0 && adminTotal === 0) return null;

                                                    const eduParts = deps
                                                      ? [
                                                        deps.classwork_assignments ? `${deps.classwork_assignments} classwork` : null,
                                                        deps.student_submissions ? `${deps.student_submissions} submissions` : null,
                                                        deps.assessment_scores ? `${deps.assessment_scores} scores` : null,
                                                        deps.period_grades ? `${deps.period_grades} grades` : null,
                                                        deps.attendance_records ? `${deps.attendance_records} attendance` : null,
                                                        deps.lesson_assignments ? `${deps.lesson_assignments} lessons` : null,
                                                      ]
                                                        .filter(Boolean)
                                                        .join(", ")
                                                      : "";

                                                    const adminParts = deps
                                                      ? [
                                                        deps.substitutions ? `${deps.substitutions} substitutions` : null,
                                                        deps.reassignment_logs ? `${deps.reassignment_logs} reassignment logs` : null,
                                                      ]
                                                        .filter(Boolean)
                                                        .join(", ")
                                                      : "";

                                                    const tooltip = [
                                                      eduTotal > 0 ? `Student/academic records: ${eduParts || `${eduTotal} records`}. Subject cannot be deleted.` : null,
                                                      adminTotal > 0 ? `Historical administrative records: ${adminParts || `${adminTotal} logs`}.` : null,
                                                    ].filter(Boolean).join(" | ");

                                                    return (
                                                      <Badge
                                                        variant="outline"
                                                        size="sm"
                                                        className={
                                                          eduTotal > 0
                                                            ? "bg-blue-50 text-blue-900 border-blue-300 font-bold inline-flex items-center gap-1"
                                                            : "bg-slate-50 text-slate-700 border-slate-300 font-medium inline-flex items-center gap-1"
                                                        }
                                                        title={tooltip}
                                                      >
                                                        <ShieldCheck className={`size-3 ${eduTotal > 0 ? "text-blue-600" : "text-slate-500"}`} />
                                                        {eduTotal > 0 ? `${eduTotal} student records` : `${adminTotal} admin records`}
                                                      </Badge>
                                                    );
                                                  })()} */}
                                                  {(() => {
                                                    const matchingOffering = (studioData?.subject_offerings || []).find(
                                                      (so) => so.subject_id === sub.subject_id && so.academic_level_id === cls.academic_level_id
                                                    );
                                                    const canonPathway = matchingOffering?.pathway ? canonicalizePathway(matchingOffering.pathway) : null;
                                                    const isSharedOffering = canonPathway === "both" || (matchingOffering?.pathway_ids && matchingOffering.pathway_ids.length > 1);
                                                    const isGradeWithPathway = Boolean(
                                                      (studioData?.academic_levels || []).find(
                                                        (l) => l.academic_level_id === cls.academic_level_id && l.grade_level >= 11
                                                      )
                                                    );

                                                    if (!isGradeWithPathway) return null;
                                                    return isSharedOffering ? (
                                                      <Badge variant="outline" size="sm" className="bg-blue-50 text-blue-900 border-blue-300 font-semibold">
                                                        Shared
                                                      </Badge>
                                                    ) : (
                                                      <Badge variant="outline" size="sm" className="bg-emerald-50 text-emerald-900 border-emerald-300 font-semibold">
                                                        Specialized
                                                      </Badge>
                                                    );
                                                  })()}
                                                </div>
                                              </div>
                                            </Table.Cell>

                                            {/* Days & Time Slot Columns */}
                                            <Table.Cell className="py-2.5 px-2 align-middle">
                                              {subjectSlots.length === 0 ? (
                                                <span className="text-xs italic text-muted-foreground font-semibold py-1 inline-block">
                                                  Unscheduled — click &quot;+ Add Slot&quot; to assign schedule
                                                </span>
                                              ) : (
                                                <div className="flex flex-col gap-2">
                                                  {subjectSlots.map((slot, sIdx) => {
                                                    const slotKey = slot._key || `slot_${cls.class_id}_${sub.subject_id}_${sIdx}`;
                                                    const resolvedPeriodSlot = classPeriodSlots(cls.class_id).find(
                                                      (period) => period.slot_id === slot.slot_id || (
                                                        period.start_time === slot.start_time && period.end_time === slot.end_time
                                                      )
                                                    );
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
                                                                disabled={sectionLocked}
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

                                                        {/* JHS uses the shared timetable; SHS retains its existing editor. */}
                                                        {isJhsClass(cls.class_id) ? (
                                                          <Select
                                                            value={resolvedPeriodSlot?.slot_id != null ? String(resolvedPeriodSlot.slot_id) : ""}
                                                            onValueChange={(value) => handlePeriodSlotChange(slotKey, value)}
                                                            disabled={sectionLocked}
                                                          >
                                                            <Select.Trigger className="min-w-52 rounded shadow-none">
                                                              <Select.Value placeholder="Select timetable period" />
                                                            </Select.Trigger>
                                                            <Select.Content className="rounded">
                                                              {classPeriodSlots(cls.class_id).map((period) => (
                                                                <Select.Item key={period.slot_id} value={String(period.slot_id)}>
                                                                  {period.slot_name} — {formatTime12h(period.start_time)}–{formatTime12h(period.end_time)}
                                                                </Select.Item>
                                                              ))}
                                                            </Select.Content>
                                                          </Select>
                                                        ) : <div className="grid gap-1">
                                                          <fieldset id={`schedule-time-${slotKey}`} tabIndex={-1} disabled={sectionLocked} aria-invalid={timeValidationError?.slotKey === slotKey} className={`flex items-center gap-1 ${timeValidationError?.slotKey === slotKey ? "rounded border-2 border-destructive" : ""}`}>
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
                                                          </fieldset>
                                                          {timeValidationError?.slotKey === slotKey && <FormMessage>{timeValidationError.message}</FormMessage>}
                                                        </div>}

                                                        {/* Delete slot button */}
                                                        {subjectSlots.length > 1 && (
                                                          <Tooltip>
                                                            <TooltipTrigger render={<button
                                                              type="button"
                                                              disabled={sectionLocked}
                                                              onClick={() => handleRemoveSlot(slotKey)}
                                                              className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 border border-red-300 rounded ml-1"
                                                              aria-label="Remove time slot"
                                                            >
                                                              <Trash2 className="size-3.5" />
                                                            </button>} />
                                                            <TooltipContent>Remove time slot</TooltipContent>
                                                          </Tooltip>
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
                                                const rowKey = `${cls.class_id}_${sub.subject_id}`;
                                                const isRowMenuOpen = openRowKey === rowKey;

                                                return (
                                                  <div className="flex items-center gap-2">
                                                    <Button
                                                      size="sm"
                                                      variant="outline"
                                                      disabled={sectionLocked}
                                                      onClick={() => {
                                                        setTeacherModalTarget({
                                                          classId: cls.class_id,
                                                          className: cls.section_name,
                                                          subjectId: sub.subject_id,
                                                          subjectName: sub.subject_name,
                                                          currentStaffId: currentStaffId ?? null,
                                                        });
                                                      }}
                                                      className={cn(
                                                        "h-8 min-w-[170px] max-w-[220px] justify-between font-bold text-xs border-2 shadow-none cursor-pointer",
                                                        !currentStaffId
                                                          ? "text-muted-foreground border-gray-400 hover:border-black"
                                                          : currentHasConflict
                                                            ? "bg-destructive text-destructive-foreground border-destructive"
                                                            : "bg-white text-black border-black"
                                                      )}
                                                      title={currentHasConflict ? currentStatusText : teacherObj ? `Assigned: ${teacherObj.name}` : "Click to assign teacher"}
                                                    >
                                                      <div className="flex items-center gap-1.5 truncate">
                                                        <User className="size-3.5 shrink-0" />
                                                        <span className="truncate">
                                                          {teacherObj ? teacherObj.name : "Assign Teacher"}
                                                        </span>
                                                      </div>
                                                      {currentHasConflict && (
                                                        <span className="text-destructive font-bold text-xs shrink-0 ml-1" title={currentStatusText}>
                                                          ⚠️
                                                        </span>
                                                      )}
                                                    </Button>

                                                    {/* Row Action Overflow Menu (⋯) */}
                                                    {!sectionLocked && <div className="flex">
                                                      <Tooltip>
                                                        <TooltipTrigger render={<Button
                                                          onClick={() => setOpenRowKey(isRowMenuOpen ? null : rowKey)}
                                                          size="sm"
                                                          variant="outline"
                                                          className="bg-background w-8"
                                                          aria-label="Row options"
                                                        >
                                                          ⋯
                                                        </Button>} />
                                                        <TooltipContent>Row options</TooltipContent>
                                                      </Tooltip>

                                                      {isRowMenuOpen && (
                                                        <div
                                                          className="absolute right-0 mt-1 w-44 bg-white border-2 border-black shadow-[3px_3px_0_#000] p-1 z-50 flex flex-col gap-1 rounded"
                                                          onMouseLeave={() => setOpenRowKey(null)}
                                                        >
                                                          <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            autoIcon={false}
                                                            onClick={() => {
                                                              setOpenRowKey(null);
                                                              handleAddSlot(cls.class_id, sub.subject_id);
                                                            }}
                                                            className="h-auto justify-start text-[11px] font-bold text-left px-2 py-1 hover:bg-neutral-100 shadow-none hover:translate-y-0"
                                                          >
                                                            <Plus className="size-3 text-primary" />
                                                            <span>+ Add Time Slot</span>
                                                          </Button>
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
                                                    </div>}
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
                              </div>
                            </div>
                          );
                        })}
                      </GradeGroupCarousel>
                    );
                  })()}
                </main>
              </div>
            </div>
          </div>
        </div>
      </div >

      <BreakConfigDrawer
        open={isBreakDrawerOpen}
        onClose={() => setIsBreakDrawerOpen(false)}
        initialSlots={periodTemplateSlots}
        initialGroup={activeGroupKey}
        onSaved={() => void loadStudio(selectedPeriodId || undefined)}
        studioData={studioData}
      />

      {/* Copy Schedule Modal */}
      <Dialog open={isCopyModalOpen} onOpenChange={setIsCopyModalOpen}>
        <Dialog.Content className="w-[calc(100%-2rem)] max-w-xl">
          <Dialog.Header>
            <Dialog.Title className="font-sans text-xl font-bold">Copy Schedule from Term</Dialog.Title>
          </Dialog.Header>
          <section className="space-y-4 p-5">
            <div>
              <label className="block text-sm font-bold mb-1">Source Term</label>
              <Select
                value={copySourcePeriodId}
                onValueChange={(val) => { setCopySourcePeriodId(val); setCopySourceError(""); }}
              >
                <Select.Trigger id="copy-source-term" aria-invalid={!!copySourceError} aria-describedby={copySourceError ? "copy-source-term-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
                  <Select.Value placeholder="Select a source term..." />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {previousPeriods.map(p => (
                      <Select.Item key={p.academic_period_id} value={String(p.academic_period_id)}>
                        {p.period_name}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
              <FormMessage id="copy-source-term-error">{copySourceError}</FormMessage>
            </div>

            <div>
              <label className="block text-sm font-bold mb-1">Scope</label>
              <p className="text-sm text-muted-foreground">
                {activeGradeId
                  ? `Grade ${studioData?.academic_levels?.find(l => String(l.academic_level_id) === activeGradeId)?.grade_level || activeGradeId} (All Sections)`
                  : "Entire Term (All Grades & Sections)"
                }
              </p>
            </div>

            <div className="bg-amber-50 border-2 border-amber-900 p-3 rounded">
              <p className="text-xs font-bold text-amber-900 flex items-start gap-1">
                <AlertTriangle className="size-4 shrink-0" />
                Warning: This will overwrite any existing unsaved drafts or published schedules for the selected scope in the current term. Teacher assignments will be pre-filled and mapped to the current bell schedule.
              </p>
            </div>
          </section>

          <Dialog.Footer>
            <Button variant="outline" onClick={() => setIsCopyModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={() => void handleCopyFromTerm()}
              disabled={isCopying}
            >
              {isCopying ? "Copying..." : "Yes, Overwrite & Copy"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* Discard Draft Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(discardTargetClass)}
        onOpenChange={(open) => {
          if (!open) setDiscardTargetClass(null);
        }}
        title="Discard Draft Changes"
        confirmationTitle={`Are you sure you want to discard all unpublished draft edits for "${discardTargetClass?.sectionName}"?`}
        description="All changes made since unlocking will be permanently discarded, and this section will be restored to its active published baseline schedule."
        options={{
          confirmLabel: "Discard Draft",
          confirmVariant: "default",
          isLoading: isSaving,
          onConfirm: async () => {
            if (!discardTargetClass) return;
            const targetId = discardTargetClass.classId;
            setDiscardTargetClass(null);
            await handleDiscardDraft(targetId);
          },
          onCancel: () => setDiscardTargetClass(null),
        }}
      />

      {/* Publish Section Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(publishTargetClass)}
        onOpenChange={(open) => {
          if (!open) setPublishTargetClass(null);
        }}
        title="Publish Schedule"
        confirmationTitle={`Are you sure you want to publish the timetable for "${publishTargetClass?.sectionName}"?`}
        description={
          publishTargetClass?.isRevisionUpdate
            ? "This will update the live schedule with your draft changes, increment the section revision, and make the updated timetable immediately active for enrolled students and assigned teachers."
            : "This will publish the section's timetable to live status, making it immediately visible and active for students and teachers."
        }
        options={{
          confirmLabel: "Publish Section",
          confirmVariant: "default",
          isLoading: isSaving,
          onConfirm: async () => {
            if (!publishTargetClass) return;
            const targetId = publishTargetClass.classId;
            setPublishTargetClass(null);
            await handleSave("publish", "section", targetId);
          },
          onCancel: () => setPublishTargetClass(null),
        }}
      />
      {/* Teacher Assignment Dialog */}
      <Dialog
        open={Boolean(teacherModalTarget)}
        onOpenChange={(open) => {
          if (!open) setTeacherModalTarget(null);
        }}
      >
        {teacherModalTarget && (
          <AssignTeacherModal
            target={teacherModalTarget}
            teachers={studioData?.teachers || []}
            teacherWorkloads={teacherWorkloads}
            loads={loads}
            getTeacherAvailabilityStatus={getTeacherAvailabilityStatus}
            onAssign={(classId, subjectId, staffId) => {
              if (staffId !== "none") {
                const conflict = getTeacherAvailabilityStatus(staffId, classId, subjectId);
                if (conflict.includes("Conflict")) {
                  toast.error({
                    title: "Teacher unavailable",
                    description: conflict,
                  });
                  return;
                }
              }
              handleTeacherChange(classId, subjectId, staffId);
              setTeacherModalTarget(null);
            }}
            onClose={() => setTeacherModalTarget(null)}
          />
        )}
      </Dialog>
    </AppLayout>
  );
}
