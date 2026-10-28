import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/admin/button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { useToast } from "@/components/retroui/Toast";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AppLayout from "@/layouts/app-layout";
import {
  Archive,
  BookOpen,
  Calendar,
  Copy,
  DownloadIcon,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import AddSubjectModal from "./forms/add-subject";
import {
  ALL_VALUE,
  CopyPreviousYearSetupModal,
  CurriculumFilters,
  CurriculumPlanTable,
  GradingTemplateManager,
  EmptyStateCard,
  LoadingCard,
  OfferingModal,
  OfferingRow,
  SubjectGradeSection,
  SubjectCatalogCard,
  defaultPathwayForGrade,
  defaultOfferingFilters,
  offeringQueryFromFilters,
  downloadBlob,
  friendlyErrorMessage,
  gradeLabel,
  pathwayLabel,
  targetLevels,
  TARGET_GRADES,
  type AdminSubjectSection,
  type CurriculumGradeValue,
  type CurriculumPathwayValue,
  type CurriculumStatusValue,
  type GradeGroup,
  type OfferingFilters,
  type PendingAction,
} from "./subjects/components";
import {
  archiveSubject,
  archiveSubjectOffering,
  downloadSubjectImportTemplate,
  downloadSubjectOfferingImportTemplate,
  getSubjectOfferingFormOptions,
  getSubjectOfferings,
  getSubjects,
  getGradingTemplates,
  restoreSubject,
  restoreSubjectOffering,
  uploadSubjectImportCsv,
  uploadSubjectOfferingImportCsv,
  type GradingTemplateListItem,
  type SubjectImportResult,
  type SubjectOfferingCopyAcademicYearResult,
  type SubjectOfferingImportResult,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectOfferingListItem,
} from "@/lib/api";

const MODULE_TABS: Array<TabItem<AdminSubjectSection>> = [
  { id: "catalog", label: "Subject Catalog", icon: BookOpen },
  { id: "offerings", label: "Curriculum Plan", icon: Calendar },
  { id: "grading", label: "Grading Templates", icon: SlidersHorizontal },
  { id: "archived", label: "Archived", icon: Archive },
];

export default function AdminSubjects() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as AdminSubjectSection | null;
  const initialSection = tabParam && ["catalog", "offerings", "grading", "archived"].includes(tabParam)
    ? tabParam
    : "catalog";
  const [activeSection, setActiveSection] = useState<AdminSubjectSection>(initialSection);
  const catalogImportInputRef = useRef<HTMLInputElement | null>(null);
  const offeringImportInputRef = useRef<HTMLInputElement | null>(null);
  const offeringRequestIdRef = useRef(0);
  const [subjects, setSubjects] = useState<SubjectListItem[]>([]);
  const [archivedSubjects, setArchivedSubjects] = useState<SubjectListItem[]>([]);
  const [offerings, setOfferings] = useState<SubjectOfferingListItem[]>([]);
  const [archivedOfferings, setArchivedOfferings] = useState<SubjectOfferingListItem[]>([]);
  const [gradingTemplates, setGradingTemplates] = useState<GradingTemplateListItem[]>([]);
  const [gradingCreateRequest, setGradingCreateRequest] = useState(0);
  const [offeringOptions, setOfferingOptions] = useState<SubjectOfferingFormOptions | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogTemplateFilter, setCatalogTemplateFilter] = useState<string>("all");
  const [offeringFilters, setOfferingFilters] = useState<OfferingFilters>({
    academic_year_id: ALL_VALUE,
    grade: ALL_VALUE,
    pathway: ALL_VALUE,
    status: "active",
    search: "",
  });
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(true);
  const [isLoadingOfferings, setIsLoadingOfferings] = useState(true);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);
  const [isImportingCatalog, setIsImportingCatalog] = useState(false);
  const [isImportingOfferings, setIsImportingOfferings] = useState(false);
  const [isDownloadingCatalogTemplate, setIsDownloadingCatalogTemplate] = useState(false);
  const [isDownloadingTemplate, setIsDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setNotice = (message: string) => {
    toast.success({ title: message });
  };
  const [catalogImportResult, setCatalogImportResult] = useState<SubjectImportResult | null>(null);
  const [offeringImportResult, setOfferingImportResult] = useState<SubjectOfferingImportResult | null>(null);
  const [copyResult, setCopyResult] = useState<SubjectOfferingCopyAcademicYearResult | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isOfferingModalOpen, setIsOfferingModalOpen] = useState(false);
  const [isCopySetupModalOpen, setIsCopySetupModalOpen] = useState(false);
  const [editingOffering, setEditingOffering] = useState<SubjectOfferingListItem | null>(null);
  const [isSubjectModalOpen, setIsSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<SubjectListItem | null>(null);

  const openCreateSubject = () => {
    setEditingSubject(null);
    setIsSubjectModalOpen(true);
  };

  const openEditSubject = (subject: SubjectListItem) => {
    setEditingSubject(subject);
    setIsSubjectModalOpen(true);
  };

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load subject options.");
    } finally {
      setIsLoadingOptions(false);
    }
  };

  const loadOfferings = useCallback(async (overrideFilters?: Partial<OfferingFilters>) => {
    const activeFilters = overrideFilters ? { ...offeringFilters, ...overrideFilters } : offeringFilters;
    const params = offeringQueryFromFilters(activeFilters, offeringOptions);
    if (!params) return;
    const requestId = ++offeringRequestIdRef.current;
    setIsLoadingOfferings(true);
    setError(null);
    try {
      const [listData, archivedData] = await Promise.all([
        getSubjectOfferings(params),
        getSubjectOfferings({ status: "archived" }),
      ]);
      if (requestId !== offeringRequestIdRef.current) return;
      setOfferings(listData.subject_offerings);
      setArchivedOfferings(archivedData.subject_offerings);
    } catch (err) {
      if (requestId !== offeringRequestIdRef.current) return;
      setError(err instanceof Error ? err.message : "Unable to load subject offerings.");
    } finally {
      if (requestId === offeringRequestIdRef.current) setIsLoadingOfferings(false);
    }
  }, [offeringFilters, offeringOptions]);

  const loadGradingTemplates = useCallback(async () => {
    try {
      const data = await getGradingTemplates();
      setGradingTemplates(data.grading_templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load grading templates.");
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
    const tab = searchParams.get("tab") as AdminSubjectSection | null;
    if (tab && ["catalog", "offerings", "grading", "archived"].includes(tab) && tab !== activeSection) {
      setActiveSection(tab);
    }
  }, [searchParams, activeSection]);

  useEffect(() => {
    if (!offeringOptions) return;
    setOfferingFilters((current) => {
      if (current.academic_year_id !== ALL_VALUE && current.grade !== ALL_VALUE) return current;
      const defaults = defaultOfferingFilters(offeringOptions);
      return {
        ...defaults, ...current,
        academic_year_id: current.academic_year_id !== ALL_VALUE ? current.academic_year_id : defaults.academic_year_id,
        grade: current.grade !== ALL_VALUE ? current.grade : defaults.grade,
        pathway: current.pathway !== ALL_VALUE ? current.pathway : defaults.pathway
      };
    });
  }, [offeringOptions]);

  const availableGradingTemplates = useMemo(() => {
    const names = new Set<string>();
    for (const t of gradingTemplates) {
      if (t.template_name?.trim()) {
        names.add(t.template_name.trim());
      }
    }
    for (const s of subjects) {
      names.add(s.grading_template.template_name);
    }
    for (const s of archivedSubjects) {
      names.add(s.grading_template.template_name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [gradingTemplates, subjects, archivedSubjects]);

  const filteredCatalogSubjects = useMemo(() => {
    let list = subjects;

    if (catalogTemplateFilter !== "all") {
      const filterLower = catalogTemplateFilter.trim().toLowerCase();
      list = list.filter((subject) => subject.grading_template.template_name.toLowerCase() === filterLower);
    }

    const query = catalogSearch.trim().toLowerCase();
    if (!query) return list;

    return list.filter((subject) => {
      return [
        subject.subject_name,
        subject.subject_codename,
        subject.grading_template.template_name,
        subject.academic_level.level_name,
        subject.grading_template.template_name,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [subjects, catalogTemplateFilter, catalogSearch]);

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
    ? `Viewing previous academic year: ${selectedAcademicYear?.year_label}. Curriculum setup is read-only to protect historical grades and prediction records.`
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

  const handlePendingAction = async () => {
    if (!pendingAction) return;
    if (isViewingInactiveAcademicYear && pendingAction.kind === "offering") {
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
        await Promise.all([loadSubjects(), loadOfferings(), loadGradingTemplates()]);
      } else if (pendingAction.kind === "offering") {
        if (pendingAction.action === "archive") {
          await archiveSubjectOffering(pendingAction.id);
          setNotice(`${pendingAction.label} offering was archived.`);
        } else {
          await restoreSubjectOffering(pendingAction.id);
          setNotice(`${pendingAction.label} offering was restored.`);
        }
        await Promise.all([loadSubjects(), loadOfferings(), loadGradingTemplates()]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to complete action.");
      toast.error({ title: "Unable to complete action", description: err instanceof Error ? err.message : undefined });
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
      toast.error({ title: "Unable to import subject offerings", description: err instanceof Error ? err.message : undefined });
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
    setOfferingFilters(defaultOfferingFilters(offeringOptions));
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
      toast.error({ title: "Unable to import catalog subjects", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsImportingCatalog(false);
      if (catalogImportInputRef.current) catalogImportInputRef.current.value = "";
    }
  };

  const selectedGradeLabel = selectedAcademicLevel?.level_name ?? gradeLabel(offeringFilters.grade);
  const selectedPathwayLabel = offeringFilters.pathway === ALL_VALUE
    ? "All Pathways"
    : pathwayLabel(offeringFilters.pathway);
  const selectedYearLabel = selectedAcademicYear?.year_label ?? "Active year";

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <div data-page-tabs-sticky-region>
              <header className="flex flex-col gap-2 bg-background px-3 py-3 sm:px-4 sm:py-4 md:flex-row md:items-center md:justify-between md:gap-3 md:px-6">
                <div className="flex items-center gap-3">
                  <SidebarTrigger className="shrink-0 md:hidden" />
                  <h1 className="text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">Subjects</h1>
                </div>
                <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:flex-wrap [&_button]:min-w-0 [&_button]:w-full md:[&_button]:w-auto">
                  {activeSection === "catalog" ? (
                    <>
                      <input
                        ref={catalogImportInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={(event) => void handleCatalogImport(event.target.files?.[0])}
                      />
                      <Button size="header" className="col-span-2 md:col-auto" onClick={openCreateSubject}>
                        <Plus className="size-4" /> New Subject
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="header" className="col-span-2 md:hidden" variant="outline">
                            <MoreHorizontal className="size-4" /> Catalog Actions
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[calc(100vw-1.5rem)] border-2 sm:w-72">
                          <DropdownMenuItem disabled={isImportingCatalog} onClick={() => catalogImportInputRef.current?.click()}>
                            <Upload className="mr-2 size-4" /> Import Catalog CSV
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={isDownloadingCatalogTemplate} onClick={handleDownloadCatalogTemplate}>
                            <DownloadIcon className="mr-2 size-4" /> Download Catalog Template
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        size="header"
                        className="hidden md:inline-flex"
                        variant="outline"
                        onClick={() => catalogImportInputRef.current?.click()}
                        disabled={isImportingCatalog}
                      >
                        <Upload className="size-4" /> Import Catalog CSV
                      </Button>
                      <Button
                        size="header"
                        className="hidden md:inline-flex"
                        variant="outline"
                        onClick={handleDownloadCatalogTemplate}
                        disabled={isDownloadingCatalogTemplate}
                      >
                        <DownloadIcon className="size-4" />
                        Download Catalog Template
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
                        size="header"
                        variant="outline"
                        className="hidden md:inline-flex"
                        onClick={() => {
                          setError(null);
                          setCopyResult(null);
                          setIsCopySetupModalOpen(true);
                        }}
                        disabled={isLoadingOptions || !activeAcademicYear}
                      >
                        <Copy className="size-4" /> Copy Previous Year Setup
                      </Button>
                      <Button
                        size="header"
                        className="col-span-2 md:col-auto"
                        onClick={openCreateOffering}
                        disabled={isLoadingOptions || isViewingInactiveAcademicYear}
                        title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                      >
                        <Plus className="size-4" /> Add Offerings
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="header" className="col-span-2 md:hidden" variant="outline">
                            <MoreHorizontal className="mr-2 size-4" /> Offering Actions
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-[calc(100vw-1.5rem)] border-2 sm:w-72">
                          <DropdownMenuItem
                            disabled={isLoadingOptions || !activeAcademicYear}
                            onClick={() => {
                              setError(null);
                              setCopyResult(null);
                              setIsCopySetupModalOpen(true);
                            }}
                          >
                            <Copy className="mr-2 size-4" /> Copy Previous Year Setup
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isImportingOfferings || isViewingInactiveAcademicYear}
                            onClick={() => offeringImportInputRef.current?.click()}
                          >
                            <Upload className="mr-2 size-4" /> Import Offering CSV
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={isDownloadingTemplate} onClick={handleDownloadOfferingTemplate}>
                            <DownloadIcon className="mr-2 size-4" /> Download Offering Template
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        size="header"
                        className="hidden md:inline-flex"
                        variant="outline"
                        onClick={() => offeringImportInputRef.current?.click()}
                        disabled={isImportingOfferings || isViewingInactiveAcademicYear}
                        title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                      >
                        <Upload className="size-4 mr-2" /> Import Offering CSV
                      </Button>
                      <Button
                        size="header"
                        className="hidden md:inline-flex"
                        variant="outline"
                        onClick={handleDownloadOfferingTemplate}
                        disabled={isDownloadingTemplate}
                      >
                        <DownloadIcon className="size-4 mr-2" />
                        Download Offering Template
                      </Button>
                    </>
                  ) : null}
                  {activeSection === "grading" ? (
                    <Button
                      size="header"
                      className="col-span-2 md:col-auto"
                      onClick={() => setGradingCreateRequest((request) => request + 1)}
                    >
                      <Plus className="size-4" /> New Grading Template
                    </Button>
                  ) : null}
                </div>
              </header>
              <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                <Tabs
                  tabs={MODULE_TABS}
                  activeTab={activeSection}
                  onTabChange={(tab) => {
                    setActiveSection(tab);
                    const next = new URLSearchParams(searchParams);
                    next.set("tab", tab);
                    setSearchParams(next, { replace: true });
                  }}
                />
              </div>

            </div>

            <div className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-4 border-border px-3 py-3 [&_table]:min-w-[720px] sm:px-4 sm:py-4 md:px-6">
              {isViewingInactiveAcademicYear && activeSection === "offerings" ? (
                <div className="rounded border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000]">
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

              {error ? (
                <div className="flex flex-col gap-2 rounded border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000] md:flex-row md:items-center md:justify-between">
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
                  <div className="grid gap-3 md:grid-cols-[1fr_160px]">
                    <label className="relative">
                      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                      <Input
                        variant="search"
                        value={catalogSearch}
                        onChange={(event) => setCatalogSearch(event.target.value)}
                        placeholder="Search name, code, template"
                        className="w-full"
                      />
                    </label>
                    <Select
                      value={catalogTemplateFilter}
                      onValueChange={(val) => setCatalogTemplateFilter(val)}
                    >
                      <Select.Trigger className="w-full">
                        <Select.Value placeholder="Grading Template" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          <Select.Item value="all">All Templates</Select.Item>
                          {availableGradingTemplates.map((templateName) => (
                            <Select.Item key={templateName} value={templateName}>
                              {templateName}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                  </div>

                  {catalogImportResult ? (
                    <RetroCard className="p-3 text-sm">
                      <p className="font-bold">Catalog Import Summary</p>
                      <p>
                        {catalogImportResult.created_count} created, {catalogImportResult.skipped_count} skipped, {catalogImportResult.error_count} errors from {catalogImportResult.total_rows} rows.
                      </p>
                      {catalogImportResult.warnings?.length ? (
                        <div className="mt-2 max-h-32 overflow-y-auto rounded border border-amber-300 bg-amber-50 p-2 text-amber-900">
                          <p className="font-semibold">Needs Review / Notes ({catalogImportResult.warnings.length}):</p>
                          {catalogImportResult.warnings.map((warn, index) => (
                            <p key={`warn-${index}`}>{warn}</p>
                          ))}
                        </div>
                      ) : null}
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
                      <Button size="sm" onClick={openCreateSubject}>Create Subject</Button>
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
                        onEdit={openEditSubject}
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
                  {/* <RetroCard className="p-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div>
                          <h2 className="text-xl font-semibold">Curriculum Plan</h2>
                          <p className="text-sm">Set when subjects are available by academic year, grade, pathway, and term.</p>
                          <p className="text-xs text-black/70">Offering does not assign teachers or schedules. That happens later in Classes.</p>
                        </div>
                      </div>

                    </div>
                  </RetroCard> */}
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
                <GradingTemplateManager
                  templates={gradingTemplates}
                  subjects={[...subjects, ...archivedSubjects]}
                  academicYears={offeringOptions?.academic_years ?? []}
                  createRequest={gradingCreateRequest}
                  showCreateButton={false}
                  onReload={async () => {
                    await Promise.all([loadGradingTemplates(), loadSubjects()]);
                  }}
                />
              ) : null}

              {activeSection === "archived" ? (
                <section className="flex flex-col gap-4">
                  <RetroCard className="flex flex-col bg-primary">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold">Archived Catalog Subjects</h2>
                        <p className="text-sm">Subjects no longer used in the catalog.</p>
                      </div>
                      <Badge variant="outline" className="border-border">
                        {archivedSubjects.length} subject
                        {archivedSubjects.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <div >
                      {archivedSubjects.length === 0 ? (
                        <EmptyStateCard
                          compact
                          icon={<Archive />}
                          title="No archived catalog subjects"
                          description="Catalog subjects you archive will appear here."
                        />
                      ) : (
                        <div className="flex gap-3 overflow-auto pb-2 pt-1">
                          {archivedSubjects.map((subject) => (
                            <SubjectCatalogCard
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
                    </div>
                  </RetroCard>

                  <RetroCard className="flex flex-col bg-primary">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold">Archived Subject Offerings</h2>
                        <p className="text-sm">Offerings removed from the active school year/pathway setup.</p>
                      </div>
                      <Badge variant="outline" className="border-border">
                        {archivedOfferings.length} offering
                        {archivedOfferings.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <div>
                      {archivedOfferings.length === 0 ? (
                        <EmptyStateCard
                          compact
                          icon={<Archive />}
                          title="No archived subject offerings"
                          description="Subject offerings you archive will appear here."
                        />
                      ) : (
                        <div className="flex gap-3 overflow-auto pb-2 pt-1">
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
                    </div>
                  </RetroCard>

                </section>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={isSubjectModalOpen} onOpenChange={setIsSubjectModalOpen}>
        <AddSubjectModal
          open={isSubjectModalOpen}
          subjectToEdit={editingSubject}
          onCreated={async () => {
            await Promise.all([loadSubjects(), loadOfferings(), loadGradingTemplates()]);
          }}
        />
      </Dialog>

      <OfferingModal
        open={isOfferingModalOpen}
        onOpenChange={setIsOfferingModalOpen}
        options={offeringOptions}
        offering={editingOffering}
        catalogSubjects={subjects}
        readOnly={isViewingInactiveAcademicYear}
        readOnlyReason={readOnlyReason}
        onSaved={async (savedMeta) => {
          const message = savedMeta?.message ?? (editingOffering ? "Subject offering updated." : "Offerings saved.");
          if (savedMeta?.partialFailure) {
            toast.warning({ title: "Some offerings need attention", description: message });
          } else {
            setNotice(message);
          }
          let nextFilters = offeringFilters;
          if (savedMeta?.gradeValue) {
            const nextGrade = savedMeta.gradeValue as CurriculumGradeValue;
            const isShsGrade = nextGrade === "11" || nextGrade === "12";
            nextFilters = {
              ...offeringFilters,
              academic_year_id: savedMeta.academicYearId ? String(savedMeta.academicYearId) : offeringFilters.academic_year_id,
              grade: nextGrade,
              pathway: isShsGrade ? "all" : (savedMeta.pathway ?? offeringFilters.pathway),
            };
            setOfferingFilters(nextFilters);
          }
          await Promise.all([loadSubjects(), loadOfferings(nextFilters), loadGradingTemplates()]);
        }}
      />

      <CopyPreviousYearSetupModal
        open={isCopySetupModalOpen}
        onOpenChange={setIsCopySetupModalOpen}
        options={offeringOptions}
        defaultSourceAcademicYearId={isViewingInactiveAcademicYear ? selectedAcademicYear?.academic_year_id : undefined}
        onCopied={handleCopySetupComplete}
      />

      <ConfirmDialog
        open={Boolean(pendingAction)}
        onOpenChange={(open) => { if (!open) setPendingAction(null); }}
        title={`${pendingAction?.action === "archive" ? "Archive" : "Restore"} ${pendingAction?.kind ?? "subject"}`}
        description={pendingAction
          ? `${pendingAction.label} will be ${pendingAction.action === "archive" ? "moved out of active use" : "returned to active use"}.`
          : undefined}
        confirmLabel={pendingAction?.action === "archive" ? "Archive" : "Restore"}
        confirmVariant={pendingAction?.action === "archive" ? "destructive" : "default"}
        onCancel={() => setPendingAction(null)}
        onConfirm={handlePendingAction}
      />
    </AppLayout>
  );
}
