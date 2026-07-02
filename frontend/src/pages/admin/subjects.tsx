import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import {
  Archive,
  ArrowUpRight,
  DownloadIcon,
  Filter,
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
  ApiRequestError,
  archiveGradingTemplate,
  archiveSubject,
  archiveSubjectOffering,
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

type AdminSubjectSection = "catalog" | "offerings" | "grading" | "archived";

type GradeGroup = {
  academicLevelId: number;
  grade: string;
  gradeLevel: number;
  subjects: SubjectListItem[];
};

type OfferingFilters = {
  academic_year_id: string;
  academic_level_id: string;
  academic_period_id: string;
  pathway: SubjectOfferingPathway | typeof ALL_VALUE;
  status: SubjectStatus | typeof ALL_VALUE;
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

type OfferingGroup = {
  key: string;
  academicYear: SubjectOfferingListItem["academic_year"];
  academicLevel: SubjectOfferingListItem["academic_level"];
  pathway: SubjectOfferingPathway;
  offerings: SubjectOfferingListItem[];
};

type OfferingTermGroup = {
  academicPeriod: SubjectOfferingListItem["academic_period"];
  offerings: SubjectOfferingListItem[];
};

type SubjectTab = {
  id: AdminSubjectSection;
  label: string;
};

function SubjectTabs({
  tabs,
  activeTab,
  onChange,
}: {
  tabs: SubjectTab[];
  activeTab: AdminSubjectSection;
  onChange: (tab: AdminSubjectSection) => void;
}) {
  return (
    <div className="-mx-4 md:-mx-6 border-b border-black/40 px-4 md:px-6">
      <div className="flex flex-wrap gap-2 pt-2">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`min-h-10 border-2 border-b-0 px-4 py-2 text-sm font-semibold shadow-[3px_0_0_#000] transition-colors ${isActive
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted"
                }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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

function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <RetroCard className="w-full p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-bold">{title}</p>
          <p className="text-sm text-black/70">{description}</p>
        </div>
        {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
      </div>
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
}: {
  offering: SubjectOfferingListItem;
  onEdit?: (offering: SubjectOfferingListItem) => void;
  onArchive?: (offering: SubjectOfferingListItem) => void;
  onRestore?: (offering: SubjectOfferingListItem) => void;
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
            <Button size="sm" variant="outline" onClick={() => onEdit(offering)}>
              <Pencil className="size-4 mr-2" /> Edit
            </Button>
          ) : null}
          {offering.status === "active" && onArchive ? (
            <Button size="sm" variant="outline" onClick={() => onArchive(offering)}>
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {offering.status === "archived" && onRestore ? (
            <Button size="sm" variant="outline" onClick={() => onRestore(offering)}>
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}

function OfferingGroupCard({
  group,
  subjectHours,
  onEdit,
  onArchive,
  onRestore,
}: {
  group: OfferingGroup;
  subjectHours: Map<number, number | null>;
  onEdit: (offering: SubjectOfferingListItem) => void;
  onArchive: (offering: SubjectOfferingListItem) => void;
  onRestore: (offering: SubjectOfferingListItem) => void;
}) {
  const termGroups = useMemo<OfferingTermGroup[]>(() => {
    const grouped = new Map<number, OfferingTermGroup>();
    for (const offering of group.offerings) {
      const termId = offering.academic_period.academic_period_id;
      if (!grouped.has(termId)) {
        grouped.set(termId, {
          academicPeriod: offering.academic_period,
          offerings: [],
        });
      }
      grouped.get(termId)?.offerings.push(offering);
    }

    return [...grouped.values()]
      .map((item) => ({
        ...item,
        offerings: [...item.offerings].sort((a, b) => a.subject.subject_name.localeCompare(b.subject.subject_name)),
      }))
      .sort((a, b) => a.academicPeriod.period_sequence - b.academicPeriod.period_sequence);
  }, [group.offerings]);

  return (
    <RetroCard className="overflow-hidden p-0">
      <div className="border-b-2 border-black bg-[#fff1b8] p-3">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-lg font-bold">
              {group.academicLevel.level_name} &bull; {pathwayLabel(group.pathway)} &bull; {group.academicYear.year_label}
            </h3>
            <p className="text-sm font-semibold">
              {group.offerings.length} subject-term offerings across {termGroups.length} term{termGroups.length === 1 ? "" : "s"}
            </p>
          </div>
          <Badge size="sm" variant="outline">
            {group.academicYear.is_active ? "Active year" : "School year"}
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-3">
        {termGroups.map((termGroup) => (
          <div key={termGroup.academicPeriod.academic_period_id} className="rounded-md border-2 border-black bg-background">
            <div className="border-b-2 border-black px-3 py-2">
              <p className="font-bold">{termGroup.academicPeriod.period_name}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-black/30 bg-[#fff7d6]">
                  <tr>
                    <th className="px-3 py-2 font-bold">Subject</th>
                    <th className="px-3 py-2 font-bold">Code</th>
                    <th className="px-3 py-2 font-bold">Group</th>
                    <th className="px-3 py-2 font-bold">Hours</th>
                    <th className="px-3 py-2 font-bold">Status</th>
                    <th className="px-3 py-2 text-right font-bold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {termGroup.offerings.map((offering) => (
                    <tr key={offering.subject_offering_id} className="border-b border-black/20 last:border-b-0">
                      <td className="px-3 py-2 font-semibold">{offering.subject.subject_name}</td>
                      <td className="px-3 py-2">{subjectCode(offering.subject)}</td>
                      <td className="px-3 py-2">{offering.subject.subject_group || "Ungrouped"}</td>
                      <td className="px-3 py-2">{subjectHours.get(offering.subject.subject_id) ?? "-"}</td>
                      <td className="px-3 py-2">{statusBadge(offering.status)}</td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" className="h-8" onClick={() => onEdit(offering)}>
                            <Pencil className="mr-1 size-4" /> Edit
                          </Button>
                          {offering.status === "active" ? (
                            <Button size="sm" variant="outline" className="h-8" onClick={() => onArchive(offering)}>
                              <Archive className="mr-1 size-4" /> Archive
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" className="h-8" onClick={() => onRestore(offering)}>
                              <RotateCcw className="mr-1 size-4" /> Restore
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
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
}: {
  template: GradingTemplateListItem;
  onEdit?: (template: GradingTemplateListItem) => void;
  onArchive?: (template: GradingTemplateListItem) => void;
  onRestore?: (template: GradingTemplateListItem) => void;
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
            <Button size="sm" variant="outline" onClick={() => onEdit(template)}>
              <Pencil className="size-4 mr-2" /> Edit
            </Button>
          ) : null}
          {template.status === "active" && onArchive ? (
            <Button size="sm" variant="outline" onClick={() => onArchive(template)}>
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {template.status === "archived" && onRestore ? (
            <Button size="sm" variant="outline" onClick={() => onRestore(template)}>
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
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SubjectOfferingFormOptions | null;
  offering: SubjectOfferingListItem | null;
  catalogSubjects: SubjectListItem[];
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

  const gradeLevels = useMemo(() => targetLevels(options?.academic_levels ?? []), [options]);
  const selectedYearId = Number(form.academic_year_id);
  const selectedLevelId = Number(form.academic_level_id);
  const selectedLevel = gradeLevels.find((level) => level.academic_level_id === selectedLevelId);
  const availablePathways = useMemo(
    () => pathwaysForGrade(selectedLevel?.grade_level, options?.pathways),
    [options?.pathways, selectedLevel?.grade_level]
  );
  const periods = useMemo(
    () => (options?.academic_periods ?? []).filter((period) => period.academic_year_id === selectedYearId),
    [options, selectedYearId]
  );
  const subjects = useMemo(
    () => catalogSubjects.filter((subject) => subject.academic_level.academic_level_id === selectedLevelId && subject.status === "active"),
    [catalogSubjects, selectedLevelId]
  );
  const selectedSubjectIds = new Set(form.subject_ids);
  const selectedPeriodIds = new Set(form.academic_period_ids);
  const isCreateMode = !offering;
  const allSubjectsSelected = subjects.length > 0 && subjects.every((subject) => selectedSubjectIds.has(String(subject.subject_id)));
  const allTermsSelected = periods.length > 0 && periods.every((period) => selectedPeriodIds.has(String(period.academic_period_id)));
  const isJhsSelection = isJuniorHighGrade(selectedLevel?.grade_level);
  const isShsSelection = isSeniorHighGrade(selectedLevel?.grade_level);

  useEffect(() => {
    if (!open) return;
    setError(null);
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
    const initialSubject = (options?.active_subjects ?? []).find(
      (subject) => subject.academic_level_id === level?.academic_level_id
    );

    setForm({
      subject_id: initialSubject ? String(initialSubject.subject_id) : "",
      subject_ids: initialSubject ? [String(initialSubject.subject_id)] : [],
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
    const nextSubject = (options?.active_subjects ?? []).find(
      (subject) => subject.academic_level_id === Number(value)
    );
    const nextPeriods = (options?.academic_periods ?? []).filter(
      (period) => period.academic_year_id === Number(form.academic_year_id)
    );
    setForm((current) => ({
      ...current,
      academic_level_id: value,
      subject_id: nextSubject ? String(nextSubject.subject_id) : "",
      subject_ids: nextSubject ? [String(nextSubject.subject_id)] : [],
      academic_period_ids: isJuniorHighGrade(nextLevel?.grade_level)
        ? nextPeriods.map((period) => String(period.academic_period_id))
        : [],
      pathway: nextPathways.includes(current.pathway) ? current.pathway : nextPathways[0] ?? "general",
    }));
  };

  const toggleSubject = (subjectId: string) => {
    setForm((current) => {
      const currentIds = new Set(current.subject_ids);
      if (currentIds.has(subjectId)) {
        currentIds.delete(subjectId);
      } else {
        currentIds.add(subjectId);
      }
      const nextIds = [...currentIds];
      return {
        ...current,
        subject_ids: nextIds,
        subject_id: nextIds[0] ?? "",
      };
    });
  };

  const toggleAllSubjects = () => {
    setForm((current) => {
      const nextIds = allSubjectsSelected ? [] : subjects.map((subject) => String(subject.subject_id));
      return {
        ...current,
        subject_ids: nextIds,
        subject_id: nextIds[0] ?? "",
      };
    });
  };

  const toggleTerm = (periodId: string) => {
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
    const selectedIds = isCreateMode ? form.subject_ids : [form.subject_id].filter(Boolean);
    const selectedTermIds = isCreateMode ? form.academic_period_ids : [form.academic_period_id].filter(Boolean);
    if (!selectedIds.length || !selectedTermIds.length || !form.academic_year_id || !form.academic_level_id) {
      setError(isCreateMode ? "Select setup details, at least one term, and at least one subject." : "Select a subject, academic year, grade level, and term.");
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
            <div className="rounded-lg border-2 border-black p-3 shadow-[3px_3px_0_#000]">
              <h6 className="mb-3 font-bold">Offering Setup</h6>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                  <Select value={form.pathway} onValueChange={(value) => setField("pathway", value as SubjectOfferingPathway)}>
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
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Multiple Terms</p>
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
                  {isCreateMode ? (
                    periods.length === 0 ? (
                      <p className="text-sm">No terms found for this academic year.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                        {periods.map((period) => {
                          const periodId = String(period.academic_period_id);
                          return (
                            <label
                              key={period.academic_period_id}
                              className="flex cursor-pointer items-center gap-3 rounded-md border-2 border-black bg-background p-3 shadow-[2px_2px_0_#000]"
                            >
                              <Checkbox
                                checked={selectedPeriodIds.has(periodId)}
                                onCheckedChange={() => toggleTerm(periodId)}
                                className="shrink-0"
                              />
                              <span className="font-semibold">{period.period_name}</span>
                            </label>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <Select value={form.academic_period_id} onValueChange={(value) => setField("academic_period_id", value)}>
                      <Select.Trigger id="offering-period" className="w-full">
                        <Select.Value placeholder="Select term" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {periods.map((period) => (
                            <Select.Item key={period.academic_period_id} value={String(period.academic_period_id)}>
                              {period.period_name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border-2 border-black p-3 shadow-[3px_3px_0_#000]">
              <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h6 className="font-bold">Select Subjects</h6>
                  <p className="text-xs text-black/70">Catalog subjects are filtered by the selected grade level.</p>
                </div>
                {isCreateMode && subjects.length ? (
                  <Button type="button" size="sm" variant="outline" onClick={toggleAllSubjects}>
                    {allSubjectsSelected ? "Clear all" : "Select all available subjects"}
                  </Button>
                ) : null}
              </div>

              {isCreateMode ? (
                subjects.length === 0 ? (
                  <p className="text-sm">No active catalog subjects found for this grade level.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {subjects.map((subject) => {
                      const subjectId = String(subject.subject_id);
                      return (
                        <label
                          key={subject.subject_id}
                          className="flex cursor-pointer items-start gap-3 rounded-md border-2 border-black bg-background p-3 shadow-[2px_2px_0_#000]"
                        >
                          <Checkbox
                            checked={selectedSubjectIds.has(subjectId)}
                            onCheckedChange={() => toggleSubject(subjectId)}
                            className="mt-1 shrink-0"
                          />
                          <span className="grid min-w-0 flex-1 grid-cols-1 gap-1 text-sm md:grid-cols-[1.5fr_120px_140px_80px]">
                            <strong className="truncate">{subject.subject_name}</strong>
                            <span>{subjectCode(subject)}</span>
                            <span>{subject.subject_group || "Ungrouped"}</span>
                            <span>{subject.hours ?? "-"} hrs</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="flex flex-col gap-1">
                  <label className="text-sm" htmlFor="offering-subject">Subject</label>
                  <Select value={form.subject_id} onValueChange={(value) => setField("subject_id", value)}>
                    <Select.Trigger id="offering-subject" className="w-full">
                      <Select.Value placeholder="Select subject" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        {subjects.map((subject) => (
                          <Select.Item key={subject.subject_id} value={String(subject.subject_id)}>
                            {subject.subject_name} ({subject.subject_codename || "No code"})
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>
                </div>
              )}
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
          <Button onClick={handleSubmit} disabled={isSaving || !options}>
            {isSaving ? "Saving..." : offering ? "Save Offering" : "Add Offerings"}
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
    academic_level_id: ALL_VALUE,
    academic_period_id: ALL_VALUE,
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
  const [showAcademicFilters, setShowAcademicFilters] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [catalogImportResult, setCatalogImportResult] = useState<SubjectImportResult | null>(null);
  const [offeringImportResult, setOfferingImportResult] = useState<SubjectOfferingImportResult | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isOfferingModalOpen, setIsOfferingModalOpen] = useState(false);
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
      const params = {
        academic_year_id: offeringFilters.academic_year_id !== ALL_VALUE ? Number(offeringFilters.academic_year_id) : undefined,
        academic_level_id: offeringFilters.academic_level_id !== ALL_VALUE ? Number(offeringFilters.academic_level_id) : undefined,
        academic_period_id: offeringFilters.academic_period_id !== ALL_VALUE ? Number(offeringFilters.academic_period_id) : undefined,
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
  }, [offeringFilters]);

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

  const subjectHoursById = useMemo(() => {
    const hours = new Map<number, number | null>();
    for (const subject of [...subjects, ...archivedSubjects]) {
      hours.set(subject.subject_id, subject.hours);
    }
    return hours;
  }, [archivedSubjects, subjects]);

  const offeringGroups = useMemo<OfferingGroup[]>(() => {
    const grouped = new Map<string, OfferingGroup>();
    for (const offering of offerings) {
      const key = [
        offering.academic_year.academic_year_id,
        offering.academic_level.academic_level_id,
        offering.pathway,
      ].join(":");

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          academicYear: offering.academic_year,
          academicLevel: offering.academic_level,
          pathway: offering.pathway,
          offerings: [],
        });
      }
      grouped.get(key)?.offerings.push(offering);
    }

    return [...grouped.values()].sort((a, b) => {
      const yearOrder = b.academicYear.year_label.localeCompare(a.academicYear.year_label);
      if (yearOrder) return yearOrder;
      const gradeOrder = a.academicLevel.grade_level - b.academicLevel.grade_level;
      if (gradeOrder) return gradeOrder;
      return pathwayLabel(a.pathway).localeCompare(pathwayLabel(b.pathway));
    });
  }, [offerings]);

  const activeCatalogCount = subjects.length;
  const activeOfferingCount = offerings.filter((offering) => offering.status === "active").length;
  const activeGradingTemplateCount = gradingTemplates.filter((template) => template.status === "active").length;
  const subjectTabs: SubjectTab[] = [
    { id: "catalog", label: `Subject Catalog (${activeCatalogCount})` },
    { id: "offerings", label: `Subject Offerings (${activeOfferingCount})` },
    { id: "grading", label: `Grading Setup (${activeGradingTemplateCount})` },
    { id: "archived", label: `Archived (${archivedSubjects.length + archivedOfferings.length + archivedGradingTemplates.length})` },
  ];
  const activeAcademicFilterCount = [
    offeringFilters.academic_year_id,
    offeringFilters.academic_level_id,
    offeringFilters.academic_period_id,
  ].filter((value) => value !== ALL_VALUE).length;

  const setFilter = <TKey extends keyof OfferingFilters>(key: TKey, value: OfferingFilters[TKey]) => {
    setOfferingFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === "academic_year_id") {
        next.academic_period_id = ALL_VALUE;
      }
      return next;
    });
  };

  const filterPeriods = useMemo(() => {
    if (!offeringOptions) return [];
    if (offeringFilters.academic_year_id === ALL_VALUE) return offeringOptions.academic_periods;
    return offeringOptions.academic_periods.filter(
      (period) => period.academic_year_id === Number(offeringFilters.academic_year_id)
    );
  }, [offeringFilters.academic_year_id, offeringOptions]);

  const openCreateOffering = () => {
    setEditingOffering(null);
    setIsOfferingModalOpen(true);
  };

  const openEditOffering = (offering: SubjectOfferingListItem) => {
    setEditingOffering(offering);
    setIsOfferingModalOpen(true);
  };

  const openCreateGradingTemplate = () => {
    setEditingGradingTemplate(null);
    setIsGradingModalOpen(true);
  };

  const openEditGradingTemplate = (template: GradingTemplateListItem) => {
    setEditingGradingTemplate(template);
    setIsGradingModalOpen(true);
  };

  const handlePendingAction = async () => {
    if (!pendingAction) return;
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

  const resetOfferingFilters = () => {
    setOfferingFilters({
      academic_year_id: ALL_VALUE,
      academic_level_id: ALL_VALUE,
      academic_period_id: ALL_VALUE,
      pathway: ALL_VALUE,
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
                    <Button onClick={openCreateOffering} disabled={isLoadingOptions}>
                      <Plus className="size-4 mr-2" /> Add Offerings
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => offeringImportInputRef.current?.click()}
                      disabled={isImportingOfferings}
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
                  <Button onClick={openCreateGradingTemplate} disabled={isLoadingOptions}>
                    <Plus className="size-4 mr-2" /> New Grading Template
                  </Button>
                ) : null}
              </div>
            </header>
            {/* <RetroCard className="p-3">
              <p className="text-sm font-semibold">
                Start by adding subjects by grade level. Grading templates are optional and can be managed later.
              </p>
            </RetroCard> */}
            <SubjectTabs tabs={subjectTabs} activeTab={activeSection} onChange={setActiveSection} />
            <p className="text-sm text-black/70">{activeHelperText}</p>

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
                  <EmptyState
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
                  </EmptyState>
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
                        <h2 className="text-xl font-semibold">Subject Offerings</h2>
                        <p className="text-sm">Set when subjects are available by academic year, grade, pathway, and term.</p>
                        <p className="text-xs text-black/70">Offering does not assign teachers or schedules. That happens later in Classes.</p>
                      </div>
                    </div>

                    <div className="rounded-lg border-2 border-black p-3 shadow-[3px_3px_0_#000]">
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_220px_180px_auto_auto]">
                        <label className="relative min-w-0">
                          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                          <Input
                            className="h-10 w-full pl-9"
                            value={offeringFilters.search}
                            onChange={(event) => setFilter("search", event.target.value)}
                            placeholder="Search subject or code"
                          />
                        </label>
                        <Select value={offeringFilters.pathway} onValueChange={(value) => setFilter("pathway", value as OfferingFilters["pathway"])}>
                          <Select.Trigger className="h-10 w-full">
                            <Select.Value placeholder="Pathway" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Group>
                              <Select.Item value={ALL_VALUE}>All pathways</Select.Item>
                              {(offeringOptions?.pathways ?? [...JHS_PATHWAYS, ...SHS_PATHWAYS]).map((pathway) => (
                                <Select.Item key={pathway} value={pathway}>
                                  {pathwayLabel(pathway)}
                                </Select.Item>
                              ))}
                            </Select.Group>
                          </Select.Content>
                        </Select>
                        <Select value={offeringFilters.status} onValueChange={(value) => setFilter("status", value as OfferingFilters["status"])}>
                          <Select.Trigger className="h-10 w-full">
                            <Select.Value placeholder="Status" />
                          </Select.Trigger>
                          <Select.Content>
                            <Select.Group>
                              <Select.Item value={ALL_VALUE}>All statuses</Select.Item>
                              <Select.Item value="active">Active</Select.Item>
                              <Select.Item value="archived">Archived</Select.Item>
                            </Select.Group>
                          </Select.Content>
                        </Select>
                        <Button
                          type="button"
                          variant={showAcademicFilters ? "default" : "outline"}
                          onClick={() => setShowAcademicFilters((current) => !current)}
                          className="h-10 whitespace-nowrap"
                        >
                          <Filter className="size-4 mr-2" />
                          Academic filters{activeAcademicFilterCount ? ` (${activeAcademicFilterCount})` : ""}
                        </Button>
                        <Button type="button" className="h-10" variant="outline" onClick={resetOfferingFilters}>
                          Reset
                        </Button>
                      </div>

                      {showAcademicFilters ? (
                        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-black/10 pt-3 md:grid-cols-3">
                          <Select value={offeringFilters.academic_year_id} onValueChange={(value) => setFilter("academic_year_id", value)}>
                            <Select.Trigger className="h-10 w-full">
                              <Select.Value placeholder="Academic year" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Group>
                                <Select.Item value={ALL_VALUE}>All years</Select.Item>
                                {offeringOptions?.academic_years.map((year) => (
                                  <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                                    {year.year_label}
                                  </Select.Item>
                                ))}
                              </Select.Group>
                            </Select.Content>
                          </Select>
                          <Select value={offeringFilters.academic_level_id} onValueChange={(value) => setFilter("academic_level_id", value)}>
                            <Select.Trigger className="h-10 w-full">
                              <Select.Value placeholder="Grade level" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Group>
                                <Select.Item value={ALL_VALUE}>All grades</Select.Item>
                                {offeringOptions?.academic_levels.map((level) => (
                                  <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                                    {level.level_name}
                                  </Select.Item>
                                ))}
                              </Select.Group>
                            </Select.Content>
                          </Select>
                          <Select value={offeringFilters.academic_period_id} onValueChange={(value) => setFilter("academic_period_id", value)}>
                            <Select.Trigger className="h-10 w-full">
                              <Select.Value placeholder="Term" />
                            </Select.Trigger>
                            <Select.Content>
                              <Select.Group>
                                <Select.Item value={ALL_VALUE}>All terms</Select.Item>
                                {filterPeriods.map((period) => (
                                  <Select.Item key={period.academic_period_id} value={String(period.academic_period_id)}>
                                    {period.period_name}
                                  </Select.Item>
                                ))}
                              </Select.Group>
                            </Select.Content>
                          </Select>
                        </div>
                      ) : null}
                    </div>
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

                {isLoadingOfferings ? (
                  <LoadingCard label="Loading subject offerings..." />
                ) : offeringGroups.length === 0 ? (
                  <EmptyState
                    title="No subjects have been offered for this setup yet."
                    description="Click Add Offerings to choose subjects for a school year, term, grade, and pathway."
                  >
                    <Button size="sm" onClick={openCreateOffering} disabled={isLoadingOptions}>
                      Add Offerings
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => offeringImportInputRef.current?.click()}
                      disabled={isImportingOfferings}
                    >
                      Import Offering CSV
                    </Button>
                  </EmptyState>
                ) : (
                  <div className="flex flex-col gap-3">
                    {offeringGroups.map((group) => (
                      <OfferingGroupCard
                        key={group.key}
                        group={group}
                        subjectHours={subjectHoursById}
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
                    ))}
                  </div>
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
                  <EmptyState
                    title="No grading templates yet."
                    description="Templates define the grading component weights reused by subjects."
                  >
                    <Button size="sm" onClick={openCreateGradingTemplate} disabled={isLoadingOptions}>
                      Create Grading Template
                    </Button>
                  </EmptyState>
                ) : (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {gradingTemplates.map((template) => (
                      <GradingTemplateRow
                        key={template.grading_template_id}
                        template={template}
                        onEdit={openEditGradingTemplate}
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
        onSaved={async (message) => {
          setNotice(message ?? (editingOffering ? "Subject offering updated." : "Offerings saved."));
          await loadOfferings();
        }}
      />

      <Dialog open={isGradingModalOpen} onOpenChange={setIsGradingModalOpen}>
        <AddGradingComponentModal
          options={gradingOptions}
          template={editingGradingTemplate}
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
