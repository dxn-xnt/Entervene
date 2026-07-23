import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmAlertDialog from "@/components/retroui/ConfirmAlertDialog";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Loader } from "@/components/retroui/Loader";
import { Select } from "@/components/retroui/Select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import {
  Copy,
  DownloadIcon,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import AddSubjectModal from "./forms/add-subject";
import AddGradingComponentModal from "./forms/add-grading-component";
import {
  ALL_VALUE,
  CopyPreviousYearSetupModal,
  CurriculumFilters,
  CurriculumPlanTable,
  EmptyStateCard,
  GradingTemplateRow,
  LoadingCard,
  OfferingModal,
  OfferingRow,
  SubjectGradeSection,
  SubjectModuleTabs,
  SubjectRow,
  defaultPathwayForGrade,
  downloadBlob,
  friendlyErrorMessage,
  gradeLabel,
  gradeValueForLevel,
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
  type SubjectModuleTabId,
} from "./subjects/components";
import {
  archiveGradingTemplate,
  archiveSubject,
  archiveSubjectOffering,
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
  uploadSubjectImportCsv,
  uploadSubjectOfferingImportCsv,
  type GradingTemplateFormOptions,
  type GradingTemplateListItem,
  type SubjectImportResult,
  type SubjectOfferingCopyAcademicYearResult,
  type SubjectOfferingImportResult,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectOfferingListItem,
} from "@/lib/api";

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
                      <Upload className="size-4 mr-2" /> Import Catalog CSV
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleDownloadCatalogTemplate}
                      disabled={isDownloadingCatalogTemplate}
                    >
                      <DownloadIcon className="size-4 mr-2" />
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
                      <Upload className="size-4 mr-2" /> Import Offering CSV
                    </Button>
                    <Button
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
                    onClick={openCreateGradingTemplate}
                    disabled={isLoadingOptions || isViewingInactiveAcademicYear}
                    title={isViewingInactiveAcademicYear ? readOnlyReason : undefined}
                  >
                    <Plus className="size-4 mr-2" /> New Grading Template
                  </Button>
                ) : null}
              </div>
            </header>
            {/* <SubjectContextBanner
              academicYears={offeringOptions?.academic_years}
              academicPeriods={offeringOptions?.academic_periods}
              academicYearId={selectedAcademicYear?.academic_year_id}
              isLoading={isLoadingOptions}
            /> */}
            <SubjectModuleTabs activeTab={activeSection} onTabChange={setActiveSection} counts={subjectTabCounts} />
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
                <div className="grid gap-3 md:grid-cols-[1fr_160px_160px] py-2">

                  <label className="relative shadow-md hover:shadow-none transition-shadow">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                    <Input
                      value={catalogSearch}
                      onChange={(event) => setCatalogSearch(event.target.value)}
                      placeholder="Search name, code, group"
                      className="h-10 w-full shadow-none border-black pl-9 pr-3"
                    />
                  </label>
                  <Select value={""}>
                    <Select.Trigger className="w-full">
                      <Select.Value placeholder="Status" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value={"All"}>All Statuses</Select.Item>
                        <Select.Item value={"Active"}>Active</Select.Item>
                        <Select.Item value={"Archived"}>Archived</Select.Item>
                      </Select.Group>
                    </Select.Content>
                  </Select>

                  <Select value={""} >
                    <Select.Trigger className="w-full">
                      <Select.Value placeholder="Status" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        <Select.Item value={"All"}>All Statuses</Select.Item>
                        <Select.Item value={"Active"}>Active</Select.Item>
                        <Select.Item value={"Archived"}>Archived</Select.Item>
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
