import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmAlertDialog from "@/components/retroui/ConfirmAlertDialog";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { formatPeriodLabel } from "@/lib/academic-periods";
import {
  Archive,
  ArrowUpRight,
  Copy,
  DownloadIcon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import AddSubjectModal from "./forms/add-subject";
import AddGradingComponentModal from "./forms/add-grading-component";
import {
  CurriculumFilters,
  CurriculumPlanTable,
  EmptyStateCard,
  SubjectContextBanner,
  SubjectPicker,
  SubjectModuleTabs,
  type CurriculumGradeValue,
  type CurriculumPathwayValue,
  type CurriculumStatusValue,
  type SubjectModuleTabId,
} from "./subjects/components";
import {
  ApiRequestError,
  archiveGradingTemplate,
  archiveSubject,
  archiveSubjectOffering,
  copySubjectOfferingsFromAcademicYear,
  createSubjectOffering,
  downloadSubjectImportTemplate,
  downloadSubjectOfferingImportTemplate,
  getSubjectOfferingFormOptions,
  getSubjectOfferings,
  getSubjects,
  getGradingTemplateFormOptions,
  getGradingTemplates,
  restoreGradingTemplate,
  restoreSubject,
  restoreSubjectOffering,
  updateSubjectOffering,
  uploadSubjectImportCsv,
  uploadSubjectOfferingImportCsv,
  type SubjectAcademicLevel,
  type GradingTemplateFormOptions,
  type GradingTemplateListItem,
  type SubjectImportResult,
  type SubjectOfferingCopyAcademicYearResult,
  type SubjectOfferingImportResult,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectOfferingListItem,
  type SubjectOfferingPathway,
  type SubjectStatus,
} from "@/lib/api";

const TARGET_GRADES = new Set([7, 8, 9, 10, 11, 12]);
const ALL_VALUE = "all";
const SHS_PATHWAYS: SubjectOfferingPathway[] = ["both", "stem_medical", "stem_engineering"];
const JHS_PATHWAYS: SubjectOfferingPathway[] = ["general"];
const FALLBACK_PERIODS: SubjectOfferingListItem["academic_period"][] = [
  {
    academic_period_id: -1,
    period_name: "Term 1",
    period_type: "TERM",
    period_sequence: 1,
    academic_year_id: -1,
  },
  {
    academic_period_id: -2,
    period_name: "Term 2",
    period_type: "TERM",
    period_sequence: 2,
    academic_year_id: -1,
  },
  {
    academic_period_id: -3,
    period_name: "Term 3",
    period_type: "TERM",
    period_sequence: 3,
    academic_year_id: -1,
  },
];

type AdminSubjectSection = SubjectModuleTabId;

type GradeGroup = {
  academicLevelId: number;
  grade: string;
  gradeLevel: number;
  subjects: SubjectListItem[];
};

type OfferingFilters = {
  academic_year_id: string;
  grade: CurriculumGradeValue;
  pathway: CurriculumPathwayValue;
  status: CurriculumStatusValue;
  search: string;
};

type PendingAction =
  | { kind: "subject"; action: "archive" | "restore"; id: number; label: string }
  | { kind: "offering"; action: "archive" | "restore"; id: number; label: string }
  | { kind: "grading"; action: "archive" | "restore"; id: number; label: string };

type OfferingFormState = {
  subject_id: string;
  subject_ids: string[];
  academic_year_id: string;
  academic_level_id: string;
  academic_period_id: string;
  academic_period_ids: string[];
  pathway: SubjectOfferingPathway;
  status: SubjectStatus;
};

function friendlyErrorMessage(message: string) {
  if (message.trim().toLowerCase() === "not found") {
    return "The subject API endpoint was not found. Restart the backend and make sure the latest migrations/routes are loaded.";
  }
  return message;
}

function subjectCode(subject: SubjectListItem | SubjectOfferingListItem["subject"]) {
  return subject.subject_codename || "No code";
}

function pathwayLabel(pathway: SubjectOfferingPathway) {
  if (pathway === "general") return "General";
  if (pathway === "stem_medical") return "STEM Medical";
  if (pathway === "stem_engineering") return "STEM Engineering";
  return "Shared / Both";
}

function statusBadge(status: SubjectStatus) {
  return (
    <Badge size="sm" variant={status === "active" ? "surface" : "outline"}>
      {status}
    </Badge>
  );
}

function targetLevels(levels: SubjectAcademicLevel[]) {
  const filtered = levels.filter((level) => TARGET_GRADES.has(level.grade_level));
  return filtered.length ? filtered : levels;
}

function gradeValueForLevel(level: SubjectAcademicLevel | null | undefined): CurriculumGradeValue {
  if (!level || !TARGET_GRADES.has(level.grade_level)) return ALL_VALUE;
  return String(level.grade_level) as CurriculumGradeValue;
}

function defaultPathwayForGrade(grade: CurriculumGradeValue): CurriculumPathwayValue {
  if (grade === "7" || grade === "8" || grade === "9" || grade === "10") return "general";
  if (grade === "11" || grade === "12") return "both";
  return ALL_VALUE;
}

function gradeLabel(grade: CurriculumGradeValue) {
  return grade === ALL_VALUE ? "All Grades" : `Grade ${grade}`;
}

function pathwaysForGrade(gradeLevel: number | null | undefined, allowed: SubjectOfferingPathway[] = []) {
  const source = allowed.length ? allowed : [...JHS_PATHWAYS, ...SHS_PATHWAYS];
  if (gradeLevel != null && gradeLevel >= 7 && gradeLevel <= 10) {
    return source.filter((pathway) => JHS_PATHWAYS.includes(pathway));
  }
  if (gradeLevel != null && gradeLevel >= 11 && gradeLevel <= 12) {
    return source.filter((pathway) => SHS_PATHWAYS.includes(pathway));
  }
  return source;
}

function isJuniorHighGrade(gradeLevel: number | null | undefined) {
  return gradeLevel != null && gradeLevel >= 7 && gradeLevel <= 10;
}

function isSeniorHighGrade(gradeLevel: number | null | undefined) {
  return gradeLevel != null && gradeLevel >= 11 && gradeLevel <= 12;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function subjectRouteGrade(level: SubjectAcademicLevel) {
  return level.level_name || `Grade ${level.grade_level}`;
}

function LoadingCard({ label }: { label: string }) {
  return (
    <RetroCard className="flex w-full items-center gap-3 p-4 text-sm">
      <Loader size="sm" />
      <span>{label}</span>
    </RetroCard>
  );
}

function SubjectRow({
  subject,
  onArchive,
  onRestore,
}: {
  subject: SubjectListItem;
  onArchive?: (subject: SubjectListItem) => void;
  onRestore?: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();
  const routeGrade = encodeURIComponent(subjectRouteGrade(subject.academic_level));

  return (
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={() => navigate(`/admin/subjects/${routeGrade}/${subject.subject_id}`)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{subject.subject_name}</p>
            {statusBadge(subject.status)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            <span><strong>Code:</strong> {subjectCode(subject)}</span>
            <span><strong>Grade:</strong> {subject.academic_level.level_name}</span>
            <span><strong>Group:</strong> {subject.subject_group || "Ungrouped"}</span>
            <span><strong>Hours:</strong> {subject.hours ?? 0}</span>
            <span className="col-span-2 md:col-span-2">
              <strong>Default template:</strong> {subject.default_grading_template || "No grading template"}
            </span>
          </div>
          {subject.description ? <p className="text-xs text-muted-foreground">{subject.description}</p> : null}
        </button>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/admin/subjects/${routeGrade}/${subject.subject_id}`)}
          >
            <ArrowUpRight className="size-4 mr-2" /> View
          </Button>
          {subject.status === "active" && onArchive ? (
            <Button size="sm" variant="outline" onClick={() => onArchive(subject)}>
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {subject.status === "archived" && onRestore ? (
            <Button size="sm" variant="outline" onClick={() => onRestore(subject)}>
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}

function SubjectCatalogCard({
  subject,
  onArchive,
}: {
  subject: SubjectListItem;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();
  const routeGrade = encodeURIComponent(subjectRouteGrade(subject.academic_level));

  return (
    <RetroCard className="flex min-h-36 w-56 shrink-0 flex-col justify-between bg-[#fff1b8] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="line-clamp-1 text-lg font-bold">{subject.subject_name}</p>
          <p className="text-xs font-semibold">{subjectCode(subject)}</p>
        </div>
        {statusBadge(subject.status)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="font-semibold">{subject.subject_group || "Ungrouped"}</span>
        <span className="text-right font-semibold">{subject.hours ?? 0} hrs</span>
        <span className="col-span-2 line-clamp-1">{subject.default_grading_template || "No template"}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 flex-1"
          onClick={() => navigate(`/admin/subjects/${routeGrade}/${subject.subject_id}`)}
        >
          <ArrowUpRight className="mr-2 size-4" /> View
        </Button>
        <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onArchive(subject)}>
          <Archive className="mr-2 size-4" /> Archive
        </Button>
      </div>
    </RetroCard>
  );
}

function SubjectGradeSection({
  group,
  onArchive,
}: {
  group: GradeGroup;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();

  return (
    <RetroCard className="w-full p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{group.grade}</h2>
          <p className="text-sm">{group.subjects.length} active subjects</p>
        </div>
        <button
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full border-2 border-black bg-background"
          onClick={() => navigate(`/admin/subjects/${encodeURIComponent(group.grade)}`)}
          type="button"
          title={`View ${group.grade}`}
        >
          <ArrowUpRight className="size-4" />
        </button>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {group.subjects.map((subject) => (
          <SubjectCatalogCard key={subject.subject_id} subject={subject} onArchive={onArchive} />
        ))}
      </div>
    </RetroCard>
  );
}

function OfferingRow({
  offering,
  onEdit,
  onArchive,
  onRestore,
  readOnly = false,
  readOnlyReason,
}: {
  offering: SubjectOfferingListItem;
  onEdit?: (offering: SubjectOfferingListItem) => void;
  onArchive?: (offering: SubjectOfferingListItem) => void;
  onRestore?: (offering: SubjectOfferingListItem) => void;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  return (
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{offering.subject.subject_name}</p>
            {statusBadge(offering.status)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            <span><strong>Code:</strong> {subjectCode(offering.subject)}</span>
            <span><strong>Year:</strong> {offering.academic_year.year_label}</span>
            <span><strong>Grade:</strong> {offering.academic_level.level_name}</span>
            <span><strong>Term:</strong> {offering.academic_period.period_name}</span>
            <span className="col-span-2"><strong>Pathway:</strong> {pathwayLabel(offering.pathway)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(offering)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Edit offering"}
            >
              <Pencil className="size-4 mr-2" /> Edit
            </Button>
          ) : null}
          {offering.status === "active" && onArchive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onArchive(offering)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Archive offering"}
            >
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {offering.status === "archived" && onRestore ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(offering)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Restore offering"}
            >
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}

function scopeLabel(template: GradingTemplateListItem) {
  const level = template.academic_level?.level_name ?? "Any level";
  const subject = template.subject?.subject_name ?? "Any subject";
  return `${level} - ${subject}`;
}

function GradingTemplateRow({
  template,
  onEdit,
  onArchive,
  onRestore,
  readOnly = false,
  readOnlyReason,
}: {
  template: GradingTemplateListItem;
  onEdit?: (template: GradingTemplateListItem) => void;
  onArchive?: (template: GradingTemplateListItem) => void;
  onRestore?: (template: GradingTemplateListItem) => void;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  return (
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{template.template_name}</p>
            {statusBadge(template.status)}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
            <span><strong>Academic scope:</strong> {template.academic_level?.level_name ?? "Any level"}</span>
            <span><strong>Subject scope:</strong> {template.subject?.subject_name ?? "Any subject"}</span>
            <span><strong>Total weight:</strong> {template.total_weight}%</span>
            <span><strong>Components:</strong> {template.component_count}</span>
          </div>
          <p className="sr-only">{scopeLabel(template)}</p>
          {template.description ? <p className="text-xs text-muted-foreground">{template.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {template.components.map((component) => (
              <span
                key={component.component_id}
                className="rounded-full border border-black px-2 py-1 text-xs font-semibold"
              >
                {component.component_name}: {component.weight}%
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(template)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Edit grading template"}
            >
              <Pencil className="size-4 mr-2" /> Edit
            </Button>
          ) : null}
          {template.status === "active" && onArchive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onArchive(template)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Archive grading template"}
            >
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {template.status === "archived" && onRestore ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(template)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Restore grading template"}
            >
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}

function OfferingModal({
  open,
  onOpenChange,
  options,
  offering,
  catalogSubjects,
  readOnly = false,
  readOnlyReason,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SubjectOfferingFormOptions | null;
  offering: SubjectOfferingListItem | null;
  catalogSubjects: SubjectListItem[];
  readOnly?: boolean;
  readOnlyReason?: string;
  onSaved: (message?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<OfferingFormState>({
    subject_id: "",
    subject_ids: [],
    academic_year_id: "",
    academic_level_id: "",
    academic_period_id: "",
    academic_period_ids: [],
    pathway: "general",
    status: "active",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedYear, setShowAdvancedYear] = useState(false);

  const gradeLevels = useMemo(() => targetLevels(options?.academic_levels ?? []), [options]);
  const selectedYearId = Number(form.academic_year_id);
  const selectedLevelId = Number(form.academic_level_id);
  const selectedLevel = gradeLevels.find((level) => level.academic_level_id === selectedLevelId);
  const selectedYear = options?.academic_years.find((year) => year.academic_year_id === selectedYearId);
  const availablePathways = useMemo(
    () => pathwaysForGrade(selectedLevel?.grade_level, options?.pathways),
    [options?.pathways, selectedLevel?.grade_level]
  );
  const periods = useMemo(
    () => (options?.academic_periods ?? []).filter((period) => period.academic_year_id === selectedYearId),
    [options, selectedYearId]
  );
  const visiblePeriods = periods.length ? periods : FALLBACK_PERIODS;
  const subjects = useMemo(
    () => catalogSubjects.filter((subject) => subject.academic_level.academic_level_id === selectedLevelId && subject.status === "active"),
    [catalogSubjects, selectedLevelId]
  );
  const selectedPeriodIds = new Set(form.academic_period_ids);
  const isCreateMode = !offering;
  const allTermsSelected = periods.length > 0 && periods.every((period) => selectedPeriodIds.has(String(period.academic_period_id)));
  const isJhsSelection = isJuniorHighGrade(selectedLevel?.grade_level);
  const isShsSelection = isSeniorHighGrade(selectedLevel?.grade_level);
  const contextPeriod = periods.find((period) => form.academic_period_ids.includes(String(period.academic_period_id)))
    ?? periods.find((period) => String(period.academic_period_id) === form.academic_period_id)
    ?? periods[0];
  const contextLabel = selectedYear?.year_label && contextPeriod
    ? `${selectedYear.year_label} - ${formatPeriodLabel(contextPeriod)}`
    : selectedYear?.year_label ?? "Current setup context unavailable";

  useEffect(() => {
    if (!open) return;
    setError(null);
    setShowAdvancedYear(false);
    if (offering) {
      setForm({
        subject_id: String(offering.subject.subject_id),
        subject_ids: [String(offering.subject.subject_id)],
        academic_year_id: String(offering.academic_year.academic_year_id),
        academic_level_id: String(offering.academic_level.academic_level_id),
        academic_period_id: String(offering.academic_period.academic_period_id),
        academic_period_ids: [String(offering.academic_period.academic_period_id)],
        pathway: offering.pathway,
        status: offering.status,
      });
      return;
    }

    const activeYear = options?.academic_years.find((year) => year.is_active) ?? options?.academic_years[0];
    const level = gradeLevels[0];
    const initialPeriods = (options?.academic_periods ?? []).filter(
      (period) => period.academic_year_id === activeYear?.academic_year_id
    );
    setForm({
      subject_id: "",
      subject_ids: [],
      academic_year_id: activeYear ? String(activeYear.academic_year_id) : "",
      academic_level_id: level ? String(level.academic_level_id) : "",
      academic_period_id: initialPeriods[0] ? String(initialPeriods[0].academic_period_id) : "",
      academic_period_ids: isJuniorHighGrade(level?.grade_level)
        ? initialPeriods.map((period) => String(period.academic_period_id))
        : [],
      pathway: pathwaysForGrade(level?.grade_level, options?.pathways)[0] ?? "general",
      status: options?.default_status ?? "active",
    });
  }, [gradeLevels, offering, open, options]);

  const setField = <TKey extends keyof OfferingFormState>(key: TKey, value: OfferingFormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleYearChange = (value: string) => {
    const nextPeriods = (options?.academic_periods ?? []).filter(
      (period) => period.academic_year_id === Number(value)
    );
    setForm((current) => ({
      ...current,
      academic_year_id: value,
      academic_period_id: nextPeriods[0] ? String(nextPeriods[0].academic_period_id) : "",
      academic_period_ids: isJhsSelection ? nextPeriods.map((period) => String(period.academic_period_id)) : [],
    }));
  };

  const handleLevelChange = (value: string) => {
    const nextLevel = gradeLevels.find((level) => String(level.academic_level_id) === value);
    const nextPathways = pathwaysForGrade(nextLevel?.grade_level, options?.pathways);
    const nextPeriods = (options?.academic_periods ?? []).filter(
      (period) => period.academic_year_id === Number(form.academic_year_id)
    );
    setForm((current) => ({
      ...current,
      academic_level_id: value,
      subject_id: "",
      subject_ids: [],
      academic_period_ids: isJuniorHighGrade(nextLevel?.grade_level)
        ? nextPeriods.map((period) => String(period.academic_period_id))
        : [],
      pathway: nextPathways.includes(current.pathway) ? current.pathway : nextPathways[0] ?? "general",
    }));
  };

  const handleSubjectSelectionChange = (subjectIds: string[]) => {
    setForm((current) => ({
      ...current,
      subject_ids: subjectIds,
      subject_id: subjectIds[0] ?? "",
    }));
  };

  const toggleTerm = (periodId: string) => {
    if (!isCreateMode) {
      setForm((current) => ({
        ...current,
        academic_period_id: periodId,
        academic_period_ids: [periodId],
      }));
      return;
    }

    setForm((current) => {
      const currentIds = new Set(current.academic_period_ids);
      if (currentIds.has(periodId)) {
        currentIds.delete(periodId);
      } else {
        currentIds.add(periodId);
      }
      const nextIds = [...currentIds];
      return {
        ...current,
        academic_period_ids: nextIds,
        academic_period_id: nextIds[0] ?? current.academic_period_id,
      };
    });
  };

  const toggleAllTerms = () => {
    setForm((current) => {
      const nextIds = allTermsSelected ? [] : periods.map((period) => String(period.academic_period_id));
      return {
        ...current,
        academic_period_ids: nextIds,
        academic_period_id: nextIds[0] ?? current.academic_period_id,
      };
    });
  };

  const duplicateOfferingError = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 409) return true;
    if (!(err instanceof Error)) return false;
    const message = err.message.toLowerCase();
    return message.includes("already exists") || message.includes("conflict");
  };

  const summaryMessage = (createdCount: number, skippedCount: number, errorCount = 0) => {
    return `created_count: ${createdCount}, skipped_count: ${skippedCount}, error_count: ${errorCount}`;
  };

  const handleSubmit = async () => {
    setError(null);
    if (readOnly) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      return;
    }
    const selectedIds = isCreateMode ? form.subject_ids : [form.subject_id].filter(Boolean);
    const selectedTermIds = isCreateMode ? form.academic_period_ids : [form.academic_period_id].filter(Boolean);
    if (!selectedIds.length || !selectedTermIds.length || !form.academic_year_id || !form.academic_level_id) {
      setError(isCreateMode ? "Select setup details, at least one term, and at least one subject." : "Select a subject, academic year, grade level, and term.");
      return;
    }
    if (selectedTermIds.some((periodId) => Number(periodId) <= 0)) {
      setError("No valid academic terms are available for the selected academic year.");
      return;
    }
    if (!availablePathways.includes(form.pathway)) {
      setError("Select a valid pathway for the selected grade level.");
      return;
    }

    setIsSaving(true);
    try {
      if (offering) {
        const payload = {
          subject_id: Number(form.subject_id),
          academic_year_id: Number(form.academic_year_id),
          academic_level_id: Number(form.academic_level_id),
          academic_period_id: Number(form.academic_period_id),
          pathway: form.pathway,
          status: form.status,
        };
        await updateSubjectOffering(offering.subject_offering_id, payload);
        await onSaved("Subject offering updated.");
        onOpenChange(false);
      } else {
        let createdCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];

        for (const subjectId of selectedIds) {
          for (const periodId of selectedTermIds) {
            try {
              await createSubjectOffering({
                subject_id: Number(subjectId),
                academic_year_id: Number(form.academic_year_id),
                academic_level_id: Number(form.academic_level_id),
                academic_period_id: Number(periodId),
                pathway: form.pathway,
                status: form.status,
              });
              createdCount += 1;
            } catch (err) {
              if (duplicateOfferingError(err)) {
                skippedCount += 1;
              } else {
                errors.push(err instanceof Error ? err.message : "Unable to create one offering.");
              }
            }
          }
        }

        if (errors.length) {
          await onSaved(summaryMessage(createdCount, skippedCount, errors.length));
          setError(`${summaryMessage(createdCount, skippedCount, errors.length)}. ${errors[0]}`);
        } else {
          await onSaved(summaryMessage(createdCount, skippedCount, 0));
          onOpenChange(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save subject offering.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="3xl" className="max-h-[90vh]">
        <Dialog.Header asChild>
          <div className="flex items-center justify-between w-full">
            <Text as="h5" className="font-sans text-xl font-bold">
              {offering ? "Edit Subject Offering" : "Add Subject Offerings"}
            </Text>
          </div>
        </Dialog.Header>
        <section className="max-h-[calc(90vh-7rem)] overflow-y-auto p-4">
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border-2 border-black bg-[#fff1b8] p-3 shadow-[3px_3px_0_#000]">
              <p className="text-sm font-semibold text-black/70">Current setup context</p>
              <p className="text-lg font-bold">{contextLabel}</p>
              <p className="text-xs text-black/70">
                This offering will be added to the current active academic year. Change active year or active term in System Settings.
              </p>
            </div>
            {readOnly ? (
              <div className="rounded-lg border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000]">
                <p className="font-bold">Read-only academic year</p>
                <p className="text-black/70">{readOnlyReason}</p>
              </div>
            ) : null}

            <div className="rounded-lg border-2 border-black p-3 shadow-[3px_3px_0_#000]">
              <h6 className="mb-3 font-bold">Offering Setup</h6>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-sm" htmlFor="offering-level">Grade Level</label>
                  <Select value={form.academic_level_id} onValueChange={handleLevelChange}>
                    <Select.Trigger id="offering-level" className="w-full">
                      <Select.Value placeholder="Select grade" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        {gradeLevels.map((level) => (
                          <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                            {level.level_name}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm" htmlFor="offering-pathway">Pathway</label>
                  <Select
                    value={form.pathway}
                    onValueChange={(value) => setField("pathway", value as SubjectOfferingPathway)}
                    disabled={isJhsSelection}
                  >
                    <Select.Trigger id="offering-pathway" className="w-full">
                      <Select.Value placeholder="Select pathway" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        {availablePathways.map((pathway) => (
                          <Select.Item key={pathway} value={pathway}>
                            {pathwayLabel(pathway)}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                  {isJhsSelection ? (
                    <p className="text-xs text-black/70">Grade 7 to 10 offerings use General.</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded-md border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[2px_2px_0_#000]">
                    <Checkbox
                      checked={showAdvancedYear}
                      onCheckedChange={(checked) => setShowAdvancedYear(checked === true)}
                      className="mt-1 shrink-0"
                    />
                    <span>
                      <span className="block font-bold">Add to a different academic year</span>
                      <span className="text-xs text-black/70">
                        Keep this off unless you are copying or correcting offerings outside the active setup.
                      </span>
                    </span>
                  </label>
                  {showAdvancedYear ? (
                    <div className="flex flex-col gap-1">
                      <label className="text-sm" htmlFor="offering-year">Academic Year</label>
                      <Select value={form.academic_year_id} onValueChange={handleYearChange}>
                        <Select.Trigger id="offering-year" className="w-full">
                          <Select.Value placeholder="Select year" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Group>
                            {options?.academic_years.map((year) => (
                              <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                                {year.year_label}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        </Select.Content>
                      </Select>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold">{isCreateMode ? "Term(s)" : "Term"}</p>
                      {isJhsSelection ? (
                        <p className="text-xs text-black/70">Junior High subjects usually continue across terms. Adjust if needed.</p>
                      ) : null}
                      {isShsSelection ? (
                        <p className="text-xs text-black/70">Senior High subjects may be offered in selected term(s) depending on hours and curriculum mapping.</p>
                      ) : null}
                    </div>
                    {isCreateMode && periods.length ? (
                      <Button type="button" size="sm" variant="outline" onClick={toggleAllTerms}>
                        {allTermsSelected ? "Clear terms" : "Select all terms"}
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {visiblePeriods.map((period) => {
                      const periodId = String(period.academic_period_id);
                      const isFallback = period.academic_period_id <= 0;
                      return (
                        <label
                          key={period.academic_period_id}
                          className={`flex items-center gap-3 rounded-md border-2 border-black p-3 shadow-[2px_2px_0_#000] ${
                            isFallback ? "cursor-not-allowed bg-black/5 text-black/50" : "cursor-pointer bg-background"
                          }`}
                        >
                          <Checkbox
                            checked={selectedPeriodIds.has(periodId)}
                            onCheckedChange={() => toggleTerm(periodId)}
                            className="shrink-0"
                            disabled={isFallback}
                          />
                          <span className="font-semibold">{formatPeriodLabel(period)}</span>
                        </label>
                      );
                    })}
                  </div>
                  {!periods.length ? (
                    <p className="text-sm font-semibold text-amber-700">No terms found for this academic year.</p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-lg border-2 border-black p-3 shadow-[3px_3px_0_#000]">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h6 className="font-bold">Select Subjects</h6>
                  <p className="text-xs text-black/70">Catalog subjects are filtered by the selected grade level.</p>
                </div>
              </div>

              <SubjectPicker
                subjects={subjects}
                selectedSubjectIds={form.subject_ids}
                onChange={handleSubjectSelectionChange}
                singleSelect={!isCreateMode}
                searchPlaceholder={isCreateMode ? "Search subjects for this grade" : "Search subject"}
              />
            </div>

            {offering ? (
              <div className="flex flex-col gap-1">
                <label className="text-sm" htmlFor="offering-status">Status</label>
                <Select value={form.status} onValueChange={(value) => setField("status", value as SubjectStatus)}>
                  <Select.Trigger id="offering-status" className="w-full">
                    <Select.Value placeholder="Select status" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {(options?.statuses ?? ["active", "archived"]).map((status) => (
                        <Select.Item key={status} value={status}>
                          {status}
                        </Select.Item>
                      ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
              </div>
            ) : null}

            {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
          </div>
        </section>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !options || readOnly} title={readOnly ? readOnlyReason : undefined}>
            {isSaving ? "Saving..." : offering ? "Save Offering" : "Add Offerings"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

function CopyPreviousYearSetupModal({
  open,
  onOpenChange,
  options,
  defaultSourceAcademicYearId,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SubjectOfferingFormOptions | null;
  defaultSourceAcademicYearId?: number;
  onCopied: (result: SubjectOfferingCopyAcademicYearResult) => Promise<void>;
}) {
  const [sourceAcademicYearId, setSourceAcademicYearId] = useState("");
  const [targetAcademicYearId, setTargetAcademicYearId] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeYears = useMemo(
    () => options?.academic_years.filter((year) => year.is_active) ?? [],
    [options?.academic_years]
  );
  const targetYears = activeYears;
  const selectedTargetYearId = Number(targetAcademicYearId);
  const sourceYears = useMemo(() => {
    const years = options?.academic_years ?? [];
    const inactiveYears = years.filter((year) => !year.is_active && year.academic_year_id !== selectedTargetYearId);
    return inactiveYears.length
      ? inactiveYears
      : years.filter((year) => year.academic_year_id !== selectedTargetYearId);
  }, [options?.academic_years, selectedTargetYearId]);

  useEffect(() => {
    if (!open) return;
    const defaultTarget = activeYears[0];
    const sourceCandidates = options?.academic_years.filter((year) =>
      year.academic_year_id !== defaultTarget?.academic_year_id
    ) ?? [];
    const defaultSource = sourceCandidates.find((year) => year.academic_year_id === defaultSourceAcademicYearId)
      ?? sourceCandidates.find((year) => !year.is_active)
      ?? sourceCandidates[0];

    setTargetAcademicYearId(defaultTarget ? String(defaultTarget.academic_year_id) : "");
    setSourceAcademicYearId(defaultSource ? String(defaultSource.academic_year_id) : "");
    setOverwriteExisting(false);
    setError(null);
  }, [activeYears, defaultSourceAcademicYearId, open, options?.academic_years]);

  const handleCopy = async () => {
    setError(null);
    if (!sourceAcademicYearId || !targetAcademicYearId) {
      setError("Select a source academic year and active target academic year.");
      return;
    }
    if (sourceAcademicYearId === targetAcademicYearId) {
      setError("Source and target academic years must be different.");
      return;
    }

    setIsCopying(true);
    try {
      const result = await copySubjectOfferingsFromAcademicYear({
        source_academic_year_id: Number(sourceAcademicYearId),
        target_academic_year_id: Number(targetAcademicYearId),
        overwrite_existing: overwriteExisting,
      });
      await onCopied(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to copy previous year setup.");
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="2xl">
        <Dialog.Header asChild>
          <div className="flex w-full items-center justify-between">
            <Text as="h5" className="font-sans text-xl font-bold">
              Copy Previous Year Setup
            </Text>
          </div>
        </Dialog.Header>
        <section className="flex flex-col gap-4 p-4">
          <div className="rounded-lg border-2 border-black bg-[#fff1b8] p-3 text-sm shadow-[3px_3px_0_#000]">
            <p className="font-bold">This copies subject offerings only.</p>
            <p className="text-black/70">
              It does not copy teachers, classes, grades, submissions, or predictions.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm" htmlFor="copy-source-year">Source Academic Year</label>
              <Select value={sourceAcademicYearId} onValueChange={setSourceAcademicYearId}>
                <Select.Trigger id="copy-source-year" className="w-full">
                  <Select.Value placeholder="Select previous year" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {sourceYears.map((year) => (
                      <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                        {year.year_label}{year.is_active ? " (active)" : ""}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
              <p className="text-xs text-black/70">Previous or inactive years are allowed as the copy source.</p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm" htmlFor="copy-target-year">Target Academic Year</label>
              <Select
                value={targetAcademicYearId}
                onValueChange={setTargetAcademicYearId}
                disabled={targetYears.length <= 1}
              >
                <Select.Trigger id="copy-target-year" className="w-full">
                  <Select.Value placeholder="Select active year" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {targetYears.map((year) => (
                      <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                        {year.year_label}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
              <p className="text-xs text-black/70">Target year must be active. Future terms remain editable.</p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border-2 border-black bg-background p-3 text-sm shadow-[2px_2px_0_#000]">
            <Checkbox
              checked={overwriteExisting}
              onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
              className="mt-1 shrink-0"
            />
            <span>
              <span className="block font-bold">Overwrite existing offerings</span>
              <span className="text-xs text-black/70">
                Updates exact matching target offerings. Extra target offerings are not deleted.
              </span>
            </span>
          </label>

          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
        </section>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>Cancel</Button>
          <Button onClick={handleCopy} disabled={isCopying || !options || !sourceYears.length || !targetYears.length}>
            {isCopying ? "Copying..." : "Copy Previous Year Setup"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}

export default function AdminSubjects() {
  const catalogImportInputRef = useRef<HTMLInputElement | null>(null);
  const offeringImportInputRef = useRef<HTMLInputElement | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSubjectSection>("catalog");
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [archivedSubjects, setArchivedSubjects] = useState<SubjectListItem[]>([]);
  const [offerings, setOfferings] = useState<SubjectOfferingListItem[]>([]);
  const [archivedOfferings, setArchivedOfferings] = useState<SubjectOfferingListItem[]>([]);
  const [gradingTemplates, setGradingTemplates] = useState<GradingTemplateListItem[]>([]);
  const [archivedGradingTemplates, setArchivedGradingTemplates] = useState<GradingTemplateListItem[]>([]);
  const [offeringOptions, setOfferingOptions] = useState<SubjectOfferingFormOptions | null>(null);
  const [gradingOptions, setGradingOptions] = useState<GradingTemplateFormOptions | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [offeringFilters, setOfferingFilters] = useState<OfferingFilters>({
    academic_year_id: ALL_VALUE,
    grade: ALL_VALUE,
    pathway: ALL_VALUE,
    status: "active",
    search: "",
  });
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isLoadingOfferings, setIsLoadingOfferings] = useState(true);
  const [isLoadingGradingTemplates, setIsLoadingGradingTemplates] = useState(true);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isImportingCatalog, setIsImportingCatalog] = useState(false);
  const [isImportingOfferings, setIsImportingOfferings] = useState(false);
  const [isDownloadingCatalogTemplate, setIsDownloadingCatalogTemplate] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [catalogImportResult, setCatalogImportResult] = useState<SubjectImportResult | null>(null);
  const [offeringImportResult, setOfferingImportResult] = useState<SubjectOfferingImportResult | null>(null);
  const [copyResult, setCopyResult] = useState<SubjectOfferingCopyAcademicYearResult | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isOfferingModalOpen, setIsOfferingModalOpen] = useState(false);
  const [isCopySetupModalOpen, setIsCopySetupModalOpen] = useState(false);
  const [editingOffering, setEditingOffering] = useState<SubjectOfferingListItem | null>(null);
  const [isGradingModalOpen, setIsGradingModalOpen] = useState(false);
  const [editingGradingTemplate, setEditingGradingTemplate] = useState<GradingTemplateListItem | null>(null);

  const loadSubjects = async () => {
    setIsLoadingCatalog(true);
    setError(null);
    try {
      const [activeData, archivedData] = await Promise.all([
        getSubjects({ status: "active" }),
        getSubjects({ status: "archived" }),
      ]);
      setSubjects(activeData.subjects);
      setArchivedSubjects(archivedData.subjects);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load subjects.");
    } finally {
      setIsLoadingCatalog(false);
    }
  };

  const loadOfferingOptions = async () => {
    setIsLoadingOptions(true);
    try {
      const data = await getSubjectOfferingFormOptions();
      setOfferingOptions({
        ...data,
        academic_levels: targetLevels(data.academic_levels),
      });
      const gradingData = await getGradingTemplateFormOptions();
      setGradingOptions({
        ...gradingData,
        academic_levels: targetLevels(gradingData.academic_levels),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load subject options.");
    } finally {
      setIsLoadingOptions(false);
    }
  };

  const loadOfferings = useCallback(async () => {
    setIsLoadingOfferings(true);
    setError(null);
    try {
      const selectedLevel = offeringOptions?.academic_levels.find(
        (level) => String(level.grade_level) === offeringFilters.grade
      );
      const params = {
        academic_year_id: offeringFilters.academic_year_id !== ALL_VALUE ? Number(offeringFilters.academic_year_id) : undefined,
        academic_level_id: selectedLevel?.academic_level_id,
        pathway: offeringFilters.pathway !== ALL_VALUE ? offeringFilters.pathway : undefined,
        status: offeringFilters.status !== ALL_VALUE ? offeringFilters.status : undefined,
        search: offeringFilters.search,
      };
      const [listData, archivedData] = await Promise.all([
        getSubjectOfferings(params),
        getSubjectOfferings({ status: "archived" }),
      ]);
      setOfferings(listData.subject_offerings);
      setArchivedOfferings(archivedData.subject_offerings);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load subject offerings.");
    } finally {
      setIsLoadingOfferings(false);
    }
  }, [offeringFilters, offeringOptions?.academic_levels]);

  const loadGradingTemplates = useCallback(async () => {
    setIsLoadingGradingTemplates(true);
    setError(null);
    try {
      const [activeData, archivedData] = await Promise.all([
        getGradingTemplates({ status: "active" }),
        getGradingTemplates({ status: "archived" }),
      ]);
      setGradingTemplates(activeData.grading_templates);
      setArchivedGradingTemplates(archivedData.grading_templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load grading templates.");
    } finally {
      setIsLoadingGradingTemplates(false);
    }
  }, []);

  useEffect(() => {
    void loadSubjects();
    void loadOfferingOptions();
    void loadGradingTemplates();
  }, [loadGradingTemplates]);

  useEffect(() => {
    void loadOfferings();
  }, [loadOfferings]);

  useEffect(() => {
    if (!offeringOptions) return;
    setOfferingFilters((current) => {
      if (current.academic_year_id !== ALL_VALUE && current.grade !== ALL_VALUE) return current;
      const activeYear = offeringOptions.academic_years.find((year) => year.is_active)
        ?? offeringOptions.academic_years[0];
      const defaultLevel = targetLevels(offeringOptions.academic_levels)[0];
      const defaultGrade = gradeValueForLevel(defaultLevel);
      return {
        ...current,
        academic_year_id: current.academic_year_id !== ALL_VALUE
          ? current.academic_year_id
          : String(activeYear?.academic_year_id ?? ALL_VALUE),
        grade: current.grade !== ALL_VALUE ? current.grade : defaultGrade,
        pathway: current.pathway !== ALL_VALUE ? current.pathway : defaultPathwayForGrade(defaultGrade),
      };
    });
  }, [offeringOptions]);

  const filteredCatalogSubjects = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    if (!query) return subjects;
    return subjects.filter((subject) => {
      return [
        subject.subject_name,
        subject.subject_codename,
        subject.subject_group,
        subject.academic_level.level_name,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [catalogSearch, subjects]);

  const gradeGroups = useMemo<GradeGroup[]>(() => {
    const grouped = new Map<number, GradeGroup>();
    for (const subject of filteredCatalogSubjects) {
      const level = subject.academic_level;
      if (!TARGET_GRADES.has(level.grade_level)) continue;
      if (!grouped.has(level.academic_level_id)) {
        grouped.set(level.academic_level_id, {
          academicLevelId: level.academic_level_id,
          grade: level.level_name,
          gradeLevel: level.grade_level,
          subjects: [],
        });
      }
      grouped.get(level.academic_level_id)?.subjects.push(subject);
    }
    return [...grouped.values()]
      .map((group) => ({
        ...group,
        subjects: [...group.subjects].sort((a, b) => a.subject_name.localeCompare(b.subject_name)),
      }))
      .sort((a, b) => a.gradeLevel - b.gradeLevel);
  }, [filteredCatalogSubjects]);

  const selectedAcademicYear = useMemo(() => {
    if (!offeringOptions) return null;
    if (offeringFilters.academic_year_id === ALL_VALUE) {
      return offeringOptions.academic_years.find((year) => year.is_active)
        ?? offeringOptions.academic_years[0]
        ?? null;
    }
    return offeringOptions.academic_years.find(
      (year) => year.academic_year_id === Number(offeringFilters.academic_year_id)
    ) ?? null;
  }, [offeringFilters.academic_year_id, offeringOptions]);
  const activeAcademicYear = useMemo(
    () => offeringOptions?.academic_years.find((year) => year.is_active) ?? null,
    [offeringOptions]
  );
  const isViewingInactiveAcademicYear = selectedAcademicYear?.is_active === false;
  const readOnlyReason = isViewingInactiveAcademicYear
    ? `Viewing previous academic year: ${selectedAcademicYear?.year_label}. Curriculum and grading setup are read-only to protect historical grades and prediction records.`
    : undefined;
  const readOnlyHelper = activeAcademicYear
    ? `Create or copy a setup into the active academic year (${activeAcademicYear.year_label}) before making changes.`
    : "Create or copy a setup into the active academic year before making changes.";

  const selectedAcademicLevel = useMemo(() => {
    if (!offeringOptions || offeringFilters.grade === ALL_VALUE) return null;
    return offeringOptions.academic_levels.find(
      (level) => String(level.grade_level) === offeringFilters.grade
    ) ?? null;
  }, [offeringFilters.grade, offeringOptions]);

  const curriculumPeriods = useMemo(() => {
    if (!offeringOptions || !selectedAcademicYear) return [];
    return offeringOptions.academic_periods
      .filter((period) => period.academic_year_id === selectedAcademicYear.academic_year_id)
      .sort((a, b) => a.period_sequence - b.period_sequence);
  }, [offeringOptions, selectedAcademicYear]);

  const catalogSubjectsForPlan = useMemo(
    () => [...subjects, ...archivedSubjects],
    [archivedSubjects, subjects]
  );

  const activeCatalogCount = subjects.length;
  const activeOfferingCount = offerings.filter((offering) => offering.status === "active").length;
  const activeGradingTemplateCount = gradingTemplates.filter((template) => template.status === "active").length;
  const subjectTabCounts = {
    catalog: activeCatalogCount,
    offerings: activeOfferingCount,
    grading: activeGradingTemplateCount,
    archived: archivedSubjects.length + archivedOfferings.length + archivedGradingTemplates.length,
  };
  const setOfferingSearch = (value: string) => {
    setOfferingFilters((current) => ({ ...current, search: value }));
  };

  const setOfferingGrade = (value: CurriculumGradeValue) => {
    setOfferingFilters((current) => ({
      ...current,
      grade: value,
      pathway: defaultPathwayForGrade(value),
    }));
  };

  const setOfferingPathway = (value: CurriculumPathwayValue) => {
    setOfferingFilters((current) => ({ ...current, pathway: value }));
  };

  const setOfferingStatus = (value: CurriculumStatusValue) => {
    setOfferingFilters((current) => ({ ...current, status: value }));
  };

  const openCreateOffering = () => {
    if (isViewingInactiveAcademicYear) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      return;
    }
    setEditingOffering(null);
    setIsOfferingModalOpen(true);
  };

  const openEditOffering = (offering: SubjectOfferingListItem) => {
    if (isViewingInactiveAcademicYear) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      return;
    }
    setEditingOffering(offering);
    setIsOfferingModalOpen(true);
  };

  const openCreateGradingTemplate = () => {
    if (isViewingInactiveAcademicYear) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      return;
    }
    setEditingGradingTemplate(null);
    setIsGradingModalOpen(true);
  };

  const openEditGradingTemplate = (template: GradingTemplateListItem) => {
    if (isViewingInactiveAcademicYear) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      return;
    }
    setEditingGradingTemplate(template);
    setIsGradingModalOpen(true);
  };

  const handlePendingAction = async () => {
    if (!pendingAction) return;
    if (isViewingInactiveAcademicYear && (pendingAction.kind === "offering" || pendingAction.kind === "grading")) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      setPendingAction(null);
      return;
    }
    try {
      if (pendingAction.kind === "subject") {
        if (pendingAction.action === "archive") {
          await archiveSubject(pendingAction.id);
          setNotice(`${pendingAction.label} was archived.`);
        } else {
          await restoreSubject(pendingAction.id);
          setNotice(`${pendingAction.label} was restored.`);
        }
        await loadSubjects();
      } else if (pendingAction.kind === "offering") {
        if (pendingAction.action === "archive") {
          await archiveSubjectOffering(pendingAction.id);
          setNotice(`${pendingAction.label} offering was archived.`);
        } else {
          await restoreSubjectOffering(pendingAction.id);
          setNotice(`${pendingAction.label} offering was restored.`);
        }
        await loadOfferings();
      } else {
        if (pendingAction.action === "archive") {
          await archiveGradingTemplate(pendingAction.id);
          setNotice(`${pendingAction.label} template was archived.`);
        } else {
          await restoreGradingTemplate(pendingAction.id);
          setNotice(`${pendingAction.label} template was restored.`);
        }
        await loadGradingTemplates();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete action.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleDownloadOfferingTemplate = async () => {
    setError(null);
    setIsDownloadingTemplate(true);
    try {
      const blob = await downloadSubjectOfferingImportTemplate();
      downloadBlob(blob, "subject_offering_import_template.csv");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download offering template.");
    } finally {
      setIsDownloadingTemplate(false);
    }
  };

  const handleOfferingImport = async (file: File | undefined) => {
    if (!file) return;
    if (isViewingInactiveAcademicYear) {
      setError(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      if (offeringImportInputRef.current) offeringImportInputRef.current.value = "";
      return;
    }
    setError(null);
    setOfferingImportResult(null);
    setIsImportingOfferings(true);
    try {
      const result = await uploadSubjectOfferingImportCsv(file);
      setOfferingImportResult(result);
      if (result.created_count > 0) {
        setNotice(`${result.created_count} subject offerings imported.`);
        await loadOfferings();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import subject offerings.");
    } finally {
      setIsImportingOfferings(false);
      if (offeringImportInputRef.current) offeringImportInputRef.current.value = "";
    }
  };

  const handleCopySetupComplete = async (result: SubjectOfferingCopyAcademicYearResult) => {
    setCopyResult(result);
    setNotice(
      `Copy complete: ${result.created_count} created, ${result.updated_count} updated, ${result.skipped_count} skipped.`
    );
    setOfferingFilters((current) => ({
      ...current,
      academic_year_id: String(result.target_academic_year_id),
      status: "active",
    }));
    await loadOfferings();
  };

  const resetOfferingFilters = () => {
    const activeYear = offeringOptions?.academic_years.find((year) => year.is_active)
      ?? offeringOptions?.academic_years[0];
    const defaultLevel = targetLevels(offeringOptions?.academic_levels ?? [])[0];
    const defaultGrade = gradeValueForLevel(defaultLevel);
    setOfferingFilters({
      academic_year_id: String(activeYear?.academic_year_id ?? ALL_VALUE),
      grade: defaultGrade,
      pathway: defaultPathwayForGrade(defaultGrade),
      status: "active",
      search: "",
    });
  };

  const handleDownloadCatalogTemplate = async () => {
    setError(null);
    setIsDownloadingCatalogTemplate(true);
    try {
      const blob = await downloadSubjectImportTemplate();
      downloadBlob(blob, "subject_catalog_import_template.csv");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to download catalog template.");
    } finally {
      setIsDownloadingCatalogTemplate(false);
    }
  };

  const handleCatalogImport = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setCatalogImportResult(null);
    setIsImportingCatalog(true);
    try {
      const result = await uploadSubjectImportCsv(file);
      setCatalogImportResult(result);
      if (result.created_count > 0) {
        setNotice(`${result.created_count} catalog subjects imported.`);
        await loadSubjects();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to import catalog subjects.");
    } finally {
      setIsImportingCatalog(false);
      if (catalogImportInputRef.current) catalogImportInputRef.current.value = "";
    }
  };

  const activeHelperText = {
    catalog: "Add and manage subjects by grade level. Teacher and schedule setup is done later in Classes.",
    offerings: "Set when subjects are available by academic year, grade, pathway, and term.",
    grading: "Create reusable grading templates such as Written Works, Performance Tasks, and Term Assessment.",
    archived: "Restore catalog subjects, offerings, or grading templates that are no longer active.",
  }[activeSection];
  const selectedGradeLabel = selectedAcademicLevel?.level_name ?? gradeLabel(offeringFilters.grade);
  const selectedPathwayLabel = offeringFilters.pathway === ALL_VALUE
    ? "All Pathways"
    : pathwayLabel(offeringFilters.pathway);
  const selectedYearLabel = selectedAcademicYear?.year_label ?? "Active year";

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6">
            <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">Subjects</h1>
              </div>
              <div className="flex flex-wrap gap-2">
                {activeSection === "catalog" ? (
                  <>
                    <input
                      ref={catalogImportInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(event) => void handleCatalogImport(event.target.files?.[0])}
                    />
                    <Dialog>
                      <Dialog.Trigger>
                        <Button>
                          <Plus className="size-4 mr-2" /> New Subject
                        </Button>
                      </Dialog.Trigger>
                      <AddSubjectModal
                        onCreated={async () => {
                          await loadSubjects();
                          await loadOfferings();
                        }}
                      />
                    </Dialog>
                    <Button
                      variant="outline"
                      onClick={() => catalogImportInputRef.current?.click()}
                      disabled={isImportingCatalog}
                    >
                      <Upload className="size-4 mr-2" /> {isImportingCatalog ? "Importing..." : "Import Catalog CSV"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleDownloadCatalogTemplate}
                      disabled={isDownloadingCatalogTemplate}
                    >
                      <DownloadIcon className="size-4 mr-2" />
                      {isDownloadingCatalogTemplate ? "Downloading..." : "Download Catalog Template"}
                    </Button>
                  </>
                ) : null}
                {activeSection === "offerings" ? (
                  <>
                    <input
                      ref={offeringImportInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(event) => void handleOfferingImport(event.target.files?.[0])}
                    />
                    <Button
                      variant="outline"
                      onClick={() => {
                        setError(null);
                        setCopyResult(null);
                        setIsCopySetupModalOpen(true);
                      }}
                      disabled={isLoadingOptions || !activeAcademicYear}
                    >
                      <Copy className="size-4 mr-2" /> Copy Previous Year Setup
                    </Button>
                    <Button
                      onClick={openCreateOffering}
                      disabled={isLoadingOptions || isViewingInactiveAcademicYear}
                      title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                    >
                      <Plus className="size-4 mr-2" /> Add Offerings
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => offeringImportInputRef.current?.click()}
                      disabled={isImportingOfferings || isViewingInactiveAcademicYear}
                      title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                    >
                      <Upload className="size-4 mr-2" /> {isImportingOfferings ? "Importing..." : "Import Offering CSV"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleDownloadOfferingTemplate}
                      disabled={isDownloadingTemplate}
                    >
                      <DownloadIcon className="size-4 mr-2" />
                      {isDownloadingTemplate ? "Downloading..." : "Download Offering Template"}
                    </Button>
                  </>
                ) : null}
                {activeSection === "grading" ? (
                  <Button
                    onClick={openCreateGradingTemplate}
                    disabled={isLoadingOptions || isViewingInactiveAcademicYear}
                    title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                  >
                    <Plus className="size-4 mr-2" /> New Grading Template
                  </Button>
                ) : null}
              </div>
            </header>
            <SubjectContextBanner
              academicYears={offeringOptions?.academic_years}
              academicPeriods={offeringOptions?.academic_periods}
              academicYearId={selectedAcademicYear?.academic_year_id}
              isLoading={isLoadingOptions}
            />
            <RetroCard className="p-3">
              <p className="text-sm font-semibold">
                Start by adding subjects by grade level. Grading templates are optional and can be managed later.
              </p>
            </RetroCard>
            <SubjectModuleTabs activeTab={activeSection} onTabChange={setActiveSection} counts={subjectTabCounts} />
            <p className="text-sm text-black/70">{activeHelperText}</p>
            {isViewingInactiveAcademicYear ? (
              <div className="rounded-lg border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000]">
                <p className="font-bold">{readOnlyReason}</p>
                <p className="text-black/70">
                  {readOnlyHelper} Previous academic years are locked in the UI to protect historical grades and prediction records.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  disabled={isLoadingOptions || !activeAcademicYear}
                  onClick={() => {
                    setError(null);
                    setCopyResult(null);
                    setIsCopySetupModalOpen(true);
                  }}
                >
                  Copy Previous Year Setup
                </Button>
              </div>
            ) : null}

            {notice ? (
              <p className="border-2 border-black bg-[#bbf7d0] p-3 text-sm font-bold shadow-[3px_3px_0_#000]">
                {notice}
              </p>
            ) : null}
            {error ? (
              <div className="flex flex-col gap-2 rounded-lg border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000] md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="font-bold">Unable to load the latest subject data.</p>
                  <p className="text-black/70">{friendlyErrorMessage(error)}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    void loadSubjects();
                    void loadOfferingOptions();
                    void loadOfferings();
                    void loadGradingTemplates();
                  }}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            {activeSection === "catalog" ? (
              <section className="flex flex-col gap-4">
                <RetroCard className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">Subject Catalog</h2>
                      <p className="text-sm">Add and manage subjects by grade level. Teacher and schedule setup is done later in Classes.</p>
                    </div>
                    <div className="relative w-full md:w-80">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2" />
                      <Input
                        className="w-full pl-9"
                        value={catalogSearch}
                        onChange={(event) => setCatalogSearch(event.target.value)}
                        placeholder="Search name, code, group"
                      />
                    </div>
                  </div>
                </RetroCard>

                {catalogImportResult ? (
                  <RetroCard className="p-3 text-sm">
                    <p className="font-bold">Catalog Import Summary</p>
                    <p>
                      {catalogImportResult.created_count} created, {catalogImportResult.skipped_count} skipped, {catalogImportResult.error_count} errors from {catalogImportResult.total_rows} rows.
                    </p>
                    {catalogImportResult.errors.length ? (
                      <div className="mt-2 max-h-32 overflow-y-auto">
                        {catalogImportResult.errors.map((item, index) => (
                          <p key={`${item.row ?? "file"}-${index}`}>
                            Row {item.row ?? "-"}: {item.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </RetroCard>
                ) : null}

                {isLoadingCatalog ? (
                  <LoadingCard label="Loading subjects..." />
                ) : gradeGroups.length === 0 ? (
                  <EmptyStateCard
                    title="No subjects exist yet."
                    description="Create catalog subjects first, then use offerings to place them in a year, grade, pathway, and term."
                  >
                    <Dialog>
                      <Dialog.Trigger>
                        <Button size="sm">Create Subject</Button>
                      </Dialog.Trigger>
                      <AddSubjectModal
                        onCreated={async () => {
                          await loadSubjects();
                          await loadOfferings();
                        }}
                      />
                    </Dialog>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => catalogImportInputRef.current?.click()}
                      disabled={isImportingCatalog}
                    >
                      Import Catalog CSV
                    </Button>
                  </EmptyStateCard>
                ) : (
                  gradeGroups.map((item) => (
                    <SubjectGradeSection
                      key={item.academicLevelId}
                      group={item}
                      onArchive={(itemToArchive) =>
                        setPendingAction({
                          kind: "subject",
                          action: "archive",
                          id: itemToArchive.subject_id,
                          label: itemToArchive.subject_name,
                        })
                      }
                    />
                  ))
                )}
              </section>
            ) : null}

            {activeSection === "offerings" ? (
              <section className="flex flex-col gap-4">
                <RetroCard className="p-4">
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h2 className="text-xl font-semibold">Curriculum Plan</h2>
                        <p className="text-sm">Set when subjects are available by academic year, grade, pathway, and term.</p>
                        <p className="text-xs text-black/70">Offering does not assign teachers or schedules. That happens later in Classes.</p>
                      </div>
                    </div>
                    <CurriculumFilters
                      search={offeringFilters.search}
                      grade={offeringFilters.grade}
                      pathway={offeringFilters.pathway}
                      status={offeringFilters.status}
                      onSearchChange={setOfferingSearch}
                      onGradeChange={setOfferingGrade}
                      onPathwayChange={setOfferingPathway}
                      onStatusChange={setOfferingStatus}
                      onReset={resetOfferingFilters}
                    />
                  </div>
                </RetroCard>

                {offeringImportResult ? (
                  <RetroCard className="p-3 text-sm">
                    <p className="font-bold">Offering Import Summary</p>
                    <p>
                      {offeringImportResult.created_count} created, {offeringImportResult.skipped_count} skipped, {offeringImportResult.error_count} errors from {offeringImportResult.total_rows} rows.
                    </p>
                    {offeringImportResult.errors.length ? (
                      <div className="mt-2 max-h-32 overflow-y-auto">
                        {offeringImportResult.errors.map((item, index) => (
                          <p key={`${item.row ?? "file"}-${index}`}>
                            Row {item.row ?? "-"}: {item.message}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </RetroCard>
                ) : null}

                {copyResult ? (
                  <RetroCard className="p-3 text-sm">
                    <p className="font-bold">Copy Previous Year Setup Summary</p>
                    <p>
                      {copyResult.created_count} created, {copyResult.updated_count} updated, {copyResult.skipped_count} skipped.
                    </p>
                    {copyResult.skipped.length ? (
                      <div className="mt-2 max-h-32 overflow-y-auto">
                        {copyResult.skipped.map((item, index) => (
                          <p key={`${item.source_subject_offering_id ?? "offering"}-${index}`}>
                            Subject {item.subject_id ?? "-"}: {item.reason}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </RetroCard>
                ) : null}

                {isLoadingOfferings ? (
                  <LoadingCard label="Loading subject offerings..." />
                ) : offerings.length === 0 ? (
                  <EmptyStateCard
                    title="No subjects have been offered for this setup yet."
                    description="Click Add Offerings to choose subjects for the selected year, grade, pathway, and term."
                  >
                    <Button
                      size="sm"
                      onClick={openCreateOffering}
                      disabled={isLoadingOptions || isViewingInactiveAcademicYear}
                      title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                    >
                      Add Offerings
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setError(null);
                        setCopyResult(null);
                        setIsCopySetupModalOpen(true);
                      }}
                      disabled={isLoadingOptions || !activeAcademicYear}
                    >
                      Copy Previous Year Setup
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => offeringImportInputRef.current?.click()}
                      disabled={isImportingOfferings || isViewingInactiveAcademicYear}
                      title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                    >
                      Import Offering CSV
                    </Button>
                  </EmptyStateCard>
                ) : (
                  <CurriculumPlanTable
                    offerings={offerings}
                    periods={curriculumPeriods}
                    catalogSubjects={catalogSubjectsForPlan}
                    academicYearLabel={selectedYearLabel}
                    gradeLabel={selectedGradeLabel}
                    pathwayLabel={selectedPathwayLabel}
                    pathway={offeringFilters.pathway}
                    readOnly={isViewingInactiveAcademicYear}
                    readOnlyReason={readOnlyReason}
                    onEdit={openEditOffering}
                    onArchive={(itemToArchive) =>
                      setPendingAction({
                        kind: "offering",
                        action: "archive",
                        id: itemToArchive.subject_offering_id,
                        label: itemToArchive.subject.subject_name,
                      })
                    }
                    onRestore={(itemToRestore) =>
                      setPendingAction({
                        kind: "offering",
                        action: "restore",
                        id: itemToRestore.subject_offering_id,
                        label: itemToRestore.subject.subject_name,
                      })
                    }
                  />
                )}
              </section>
            ) : null}

            {activeSection === "grading" ? (
              <section className="flex flex-col gap-4">
                <RetroCard className="p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold">Grading Setup</h2>
                      <p className="text-sm">Create reusable grading templates such as Written Works, Performance Tasks, and Term Assessment.</p>
                    </div>
                  </div>
                </RetroCard>

                {isLoadingGradingTemplates ? (
                  <LoadingCard label="Loading grading templates..." />
                ) : gradingTemplates.length === 0 ? (
                  <EmptyStateCard
                    title="No grading templates yet."
                    description="Templates define the grading component weights reused by subjects."
                  >
                    <Button
                      size="sm"
                      onClick={openCreateGradingTemplate}
                      disabled={isLoadingOptions || isViewingInactiveAcademicYear}
                      title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                    >
                      Create Grading Template
                    </Button>
                  </EmptyStateCard>
                ) : (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {gradingTemplates.map((template) => (
                      <GradingTemplateRow
                        key={template.grading_template_id}
                        template={template}
                        onEdit={openEditGradingTemplate}
                        readOnly={isViewingInactiveAcademicYear}
                        readOnlyReason={readOnlyReason}
                        onArchive={(itemToArchive) =>
                          setPendingAction({
                            kind: "grading",
                            action: "archive",
                            id: itemToArchive.grading_template_id,
                            label: itemToArchive.template_name,
                          })
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : null}

            {activeSection === "archived" ? (
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <RetroCard className="p-4">
                  <h2 className="text-xl font-semibold">Archived Catalog Subjects</h2>
                  <p className="mb-4 text-sm">Subjects no longer used in the catalog.</p>
                  {isLoadingCatalog ? (
                    <div className="flex items-center gap-2 text-sm"><Loader size="sm" /> Loading archived subjects...</div>
                  ) : archivedSubjects.length === 0 ? (
                    <p className="text-sm">No archived catalog subjects.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {archivedSubjects.map((subject) => (
                        <SubjectRow
                          key={subject.subject_id}
                          subject={subject}
                          onRestore={(itemToRestore) =>
                            setPendingAction({
                              kind: "subject",
                              action: "restore",
                              id: itemToRestore.subject_id,
                              label: itemToRestore.subject_name,
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </RetroCard>

                <RetroCard className="p-4">
                  <h2 className="text-xl font-semibold">Archived Subject Offerings</h2>
                  <p className="mb-4 text-sm">Offerings removed from the active school year/pathway setup.</p>
                  {isLoadingOfferings ? (
                    <div className="flex items-center gap-2 text-sm"><Loader size="sm" /> Loading archived offerings...</div>
                  ) : archivedOfferings.length === 0 ? (
                    <p className="text-sm">No archived subject offerings.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {archivedOfferings.map((offering) => (
                        <OfferingRow
                          key={offering.subject_offering_id}
                          offering={offering}
                          readOnly={isViewingInactiveAcademicYear}
                          readOnlyReason={readOnlyReason}
                          onRestore={(itemToRestore) =>
                            setPendingAction({
                              kind: "offering",
                              action: "restore",
                              id: itemToRestore.subject_offering_id,
                              label: itemToRestore.subject.subject_name,
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </RetroCard>

                <RetroCard className="p-4">
                  <h2 className="text-xl font-semibold">Archived Grading Templates</h2>
                  <p className="mb-4 text-sm">Reusable grading setups hidden from active use.</p>
                  {isLoadingGradingTemplates ? (
                    <div className="flex items-center gap-2 text-sm"><Loader size="sm" /> Loading archived templates...</div>
                  ) : archivedGradingTemplates.length === 0 ? (
                    <p className="text-sm">No archived grading templates.</p>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {archivedGradingTemplates.map((template) => (
                        <GradingTemplateRow
                          key={template.grading_template_id}
                          template={template}
                          readOnly={isViewingInactiveAcademicYear}
                          readOnlyReason={readOnlyReason}
                          onRestore={(itemToRestore) =>
                            setPendingAction({
                              kind: "grading",
                              action: "restore",
                              id: itemToRestore.grading_template_id,
                              label: itemToRestore.template_name,
                            })
                          }
                        />
                      ))}
                    </div>
                  )}
                </RetroCard>
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <OfferingModal
        open={isOfferingModalOpen}
        onOpenChange={setIsOfferingModalOpen}
        options={offeringOptions}
        offering={editingOffering}
        catalogSubjects={subjects}
        readOnly={isViewingInactiveAcademicYear}
        readOnlyReason={readOnlyReason}
        onSaved={async (message) => {
          setNotice(message ?? (editingOffering ? "Subject offering updated." : "Offerings saved."));
          await loadOfferings();
        }}
      />

      <CopyPreviousYearSetupModal
        open={isCopySetupModalOpen}
        onOpenChange={setIsCopySetupModalOpen}
        options={offeringOptions}
        defaultSourceAcademicYearId={isViewingInactiveAcademicYear ? selectedAcademicYear?.academic_year_id : undefined}
        onCopied={handleCopySetupComplete}
      />

      <Dialog open={isGradingModalOpen} onOpenChange={setIsGradingModalOpen}>
        <AddGradingComponentModal
          options={gradingOptions}
          template={editingGradingTemplate}
          readOnly={isViewingInactiveAcademicYear}
          readOnlyReason={readOnlyReason}
          onClose={() => setIsGradingModalOpen(false)}
          onSaved={async () => {
            setNotice(editingGradingTemplate ? "Grading template updated." : "Grading template created.");
            await loadGradingTemplates();
          }}
        />
      </Dialog>

      {pendingAction ? (
        <ConfirmAlertDialog
          title={`${pendingAction.action === "archive" ? "Archive" : "Restore"} ${pendingAction.kind}?`}
          description={`${pendingAction.label} will be ${pendingAction.action === "archive" ? "moved out of active use" : "returned to active use"}.`}
          confirmLabel={pendingAction.action === "archive" ? "Archive" : "Restore"}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void handlePendingAction()}
        />
      ) : null}
    </AppLayout>
  );
}
