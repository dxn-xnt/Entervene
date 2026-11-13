"use client";

import { Plus, Settings, Trash2, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchPathways, getClassFormOptions, type AcademicPathwayRead } from "@/lib/api";
import type { AdviserOption, ClassFormOptions, ManualClassSetup, ManualSectionDraft, OfficialSectionOption } from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { RoleBadge } from "@/components/role-badge";
import { Dialog } from "@/components/retroui/Dialog";
import { Alert } from "@/components/retroui/Alert";
import OfficialSectionsSettings from "@/pages/admin/official-sections-settings";

type SetupErrors = {
  academicLevel?: string;
  sections?: string;
  sectionRows: Record<string, { sectionName?: string; adviserStaffId?: string }>;
  configuredRows: Record<number, { adviserStaffId?: string }>;
};

function createSectionDraft(sectionName = "", adviserStaffId = "", pathway = "general"): ManualSectionDraft {
  return {
    localId: crypto.randomUUID(),
    sectionName,
    adviserStaffId,
    pathway,
  };
}

function adviserName(adviser?: AdviserOption) {
  if (!adviser) return "";
  return [adviser.first_name, adviser.middle_name, adviser.last_name, adviser.suffix].filter(Boolean).join(" ");
}

export default function ManualClassWizard({ initialSetup, onComplete, onSkipStudents, onBack, onClose, onScreenChange }: {
  initialSetup: ManualClassSetup | null;
  onComplete: (setup: ManualClassSetup) => void;
  onSkipStudents: (setup: ManualClassSetup) => void;
  onBack: () => void;
  onClose: () => void;
  onScreenChange?: (screen: "details" | "official-sections") => void;
}) {
  const navigate = useNavigate();
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [academicLevelId, setAcademicLevelId] = useState(initialSetup?.academicLevelId ? String(initialSetup.academicLevelId) : "");
  const [selectedYearId, setSelectedYearId] = useState(initialSetup?.academicYear.academic_year_id ? String(initialSetup.academicYear.academic_year_id) : "");
  const [sections, setSections] = useState<ManualSectionDraft[]>(initialSetup?.sections ?? [createSectionDraft()]);
  const [errors, setErrors] = useState<SetupErrors>({ sectionRows: {}, configuredRows: {} });
  const [configuredAdvisers, setConfiguredAdvisers] = useState<Record<number, string>>({});
  const [screen, setScreen] = useState<"details" | "official-sections">("details");
  const [managerError, setManagerError] = useState("");
  const [returningToDetails, setReturningToDetails] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [availablePathways, setAvailablePathways] = useState<AcademicPathwayRead[]>([]);
  const loadedYearIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (loadedYearIdRef.current && loadedYearIdRef.current === selectedYearId && options) {
      return;
    }

    getClassFormOptions(selectedYearId ? Number(selectedYearId) : undefined)
      .then((classData) => {
        if (cancelled) return;
        setOptions(classData);
        const resolvedYearId = String(classData.academic_year.academic_year_id);
        loadedYearIdRef.current = resolvedYearId;
        if (!selectedYearId) setSelectedYearId(resolvedYearId);
        const defaultLevelId = initialSetup?.academicLevelId ? String(initialSetup.academicLevelId) : String(classData.academic_levels[0]?.academic_level_id ?? "");
        setAcademicLevelId((current) => current || defaultLevelId);

        if (!initialSetup?.sections) {
          setSections([createSectionDraft()]);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Unable to load class options.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [initialSetup?.academicLevelId, initialSetup?.sections, options, retryKey, selectedYearId]);

  useEffect(() => {
    fetchPathways(true)
      .then((res) => {
        if (res?.pathways) setAvailablePathways(res.pathways);
      })
      .catch(() => {});
  }, []);

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setRetryKey((value) => value + 1);
  }

  function handleAcademicLevelChange(newLevelId: string) {
    setAcademicLevelId(newLevelId);
    setSections([createSectionDraft()]);
    setConfiguredAdvisers({});
    setErrors({ sectionRows: {}, configuredRows: {} });
  }

  const selectedLevel = options?.academic_levels.find((item) => String(item.academic_level_id) === academicLevelId);
  const isSeniorHigh = selectedLevel ? selectedLevel.grade_level >= 11 : false;
  const needsPathway = isSeniorHigh && (selectedLevel?.requires_pathway ?? false);
  const showPathwayColumn = needsPathway;

  // Existing sections for this grade level in the active academic year
  const existingGradeSections = (options?.official_sections ?? []).filter(
    (sec) => sec.academic_level_id === Number(academicLevelId) && sec.is_active
  );
  const existingClassSections = existingGradeSections.filter((section) => section.has_class);
  const selectedSectionNames = new Set(sections.map((section) => section.sectionName.trim().toLocaleLowerCase()).filter(Boolean));
  const availableConfiguredSections = existingGradeSections.filter(
    (section) => !section.has_class && !selectedSectionNames.has(section.section_name.trim().toLocaleLowerCase())
  );

  // Pathway options for senior high
  const pathwayOptions = availablePathways.length > 0
    ? availablePathways
    : (options?.official_sections ?? [])
        .filter((sec) => sec.pathway_code && sec.pathway_name)
        .map((sec) => ({
          id: sec.pathway_id || 0,
          code: sec.pathway_code || "",
          name: sec.pathway_name || "",
          is_enabled: true,
          sort_order: 0,
        }));

  const canAddSection = sections.every((section) => Boolean(section.sectionName.trim()));

  function addSection() {
    setSections((current) => {
      if (current.some((section) => !section.sectionName.trim())) return current;
      const defaultPathway = showPathwayColumn && pathwayOptions[0] ? pathwayOptions[0].code : "general";
      return [...current, createSectionDraft("", "", defaultPathway)];
    });
  }

  function updateSection(localId: string, changes: Partial<ManualSectionDraft>) {
    setSections((current) => current.map((section) => section.localId === localId ? { ...section, ...changes } : section));
    setErrors((current) => {
      const row = { ...current.sectionRows[localId] };
      if (changes.sectionName && changes.sectionName.trim()) delete row.sectionName;
      if (changes.adviserStaffId) delete row.adviserStaffId;
      const sectionRows = { ...current.sectionRows };
      if (Object.keys(row).length) sectionRows[localId] = row;
      else delete sectionRows[localId];
      return { ...current, sections: sections.length ? undefined : current.sections, sectionRows };
    });
  }

  function addConfiguredSection(section: OfficialSectionOption) {
    const adviserStaffId = configuredAdvisers[section.id] ?? "";
    if (!adviserStaffId) {
      setErrors((current) => ({
        ...current,
        configuredRows: { ...current.configuredRows, [section.id]: { adviserStaffId: "Select an adviser before adding this section." } },
      }));
      return;
    }
    if (sections.some((draft) => draft.adviserStaffId === adviserStaffId)) {
      setErrors((current) => ({
        ...current,
        configuredRows: { ...current.configuredRows, [section.id]: { adviserStaffId: "This adviser is already assigned to another section." } },
      }));
      return;
    }

    const draft: ManualSectionDraft = {
      localId: crypto.randomUUID(),
      officialSectionId: section.id,
      sectionName: section.section_name,
      adviserStaffId,
      pathway: section.pathway_code || "general",
    };
    setSections((current) => current.length === 1 && !current[0].sectionName.trim() && !current[0].adviserStaffId
      ? [draft]
      : [...current, draft]);
    setConfiguredAdvisers((current) => {
      const next = { ...current };
      delete next[section.id];
      return next;
    });
    setErrors((current) => {
      const configuredRows = { ...current.configuredRows };
      delete configuredRows[section.id];
      return { ...current, configuredRows };
    });
  }

  function removeSection(localId: string) {
    setSections((current) => {
      const remaining = current.filter((section) => section.localId !== localId);
      return remaining.length ? remaining : [createSectionDraft()];
    });
  }

  function manageClass(section: OfficialSectionOption) {
    if (section.class_id == null) return;
    onClose();
    const isArchived = (section.class_status ?? "active").toLocaleLowerCase() === "archived";
    navigate(isArchived
      ? `/admin/classes/${section.class_id}?tab=students`
      : `/admin/classes/${section.class_id}?tab=students&action=manage-students`);
  }

  function manageOfficialSections() {
    setManagerError("");
    setScreen("official-sections");
    onScreenChange?.("official-sections");
  }

  async function returnToDetails() {
    if (returningToDetails) return;
    setReturningToDetails(true);
    setManagerError("");
    try {
      const classData = await getClassFormOptions(selectedYearId ? Number(selectedYearId) : undefined);
      setOptions(classData);
      loadedYearIdRef.current = String(classData.academic_year.academic_year_id);
      setScreen("details");
      onScreenChange?.("details");
    } catch (error: unknown) {
      setManagerError(error instanceof Error ? error.message : "Unable to refresh configured sections.");
    } finally {
      setReturningToDetails(false);
    }
  }

  function validate() {
    const nextErrors: SetupErrors = { sectionRows: {}, configuredRows: {} };
    if (!academicLevelId) nextErrors.academicLevel = "Select an academic level.";
    if (!sections.length) nextErrors.sections = "Add at least one section.";

    const existingClassNames = new Set(
      existingGradeSections
        .filter((sec) => sec.has_class)
        .map((sec) => sec.section_name.trim().toLowerCase())
    );

    const names = new Map<string, string>();
    const advisers = new Set<string>();
    sections.forEach((section) => {
      const rowErrors: { sectionName?: string; adviserStaffId?: string } = {};
      const trimmedName = section.sectionName.trim();
      const normalizedName = trimmedName.toLocaleLowerCase();

      if (!trimmedName) {
        rowErrors.sectionName = "Enter a section name.";
      } else if (existingClassNames.has(normalizedName)) {
        rowErrors.sectionName = `A class with section name "${trimmedName}" already exists for this grade.`;
      } else if (names.has(normalizedName)) {
        rowErrors.sectionName = `Section name duplicates "${names.get(normalizedName)}".`;
      } else {
        names.set(normalizedName, trimmedName);
      }

      if (!section.adviserStaffId) {
        rowErrors.adviserStaffId = "Select an adviser.";
      } else if (advisers.has(section.adviserStaffId)) {
        rowErrors.adviserStaffId = "Each adviser can only be assigned to one section per academic year.";
      } else {
        advisers.add(section.adviserStaffId);
      }

      if (Object.keys(rowErrors).length) nextErrors.sectionRows[section.localId] = rowErrors;
    });

    setErrors(nextErrors);
    return !nextErrors.academicLevel && !nextErrors.sections && Object.keys(nextErrors.sectionRows).length === 0;
  }

  function completeDetails(next: (setup: ManualClassSetup) => void) {
    if (!options || !validate()) return;
    const level = options.academic_levels.find((item) => item.academic_level_id === Number(academicLevelId));
    if (!level) return;
    next({
      academicLevelId: level.academic_level_id,
      academicLevelName: level.level_name,
      academicYear: options.academic_year,
      sections: sections.map((section) => {
        const officialSection = existingGradeSections.find((official) => !official.has_class && (
          official.id === section.officialSectionId
          || official.section_name.trim().toLocaleLowerCase() === section.sectionName.trim().toLocaleLowerCase()
        ));
        return {
          ...section,
          officialSectionId: officialSection?.id ?? section.officialSectionId,
          sectionName: officialSection?.section_name ?? section.sectionName.trim(),
          pathway: officialSection?.pathway_code || section.pathway || "general",
          adviserName: adviserName(options.eligible_advisers.find((adviser) => adviser.staff_id === section.adviserStaffId)),
        };
      }),
    });
  }

  if (loading) {
    return <StatePanel message="Loading class options..." />;
  }

  if (loadError || !options) {
    return (
      <StatePanel message={loadError || "Unable to load class options."}>
        <Button variant={"outline"} onClick={retryLoading}>Retry</Button>
      </StatePanel>
    );
  }

  const noLevels = options.academic_levels.length === 0;
  const noAdvisers = options.eligible_advisers.length === 0;

  if (screen === "official-sections") {
    return (
      <div className="grid gap-4">
        {managerError && (
          <Alert status="error">
            <Alert.Title>Unable to return to class setup</Alert.Title>
            <Alert.Description>{managerError}</Alert.Description>
          </Alert>
        )}
        <OfficialSectionsSettings
          academicYearId={options.academic_year.academic_year_id}
          initialLevelId={Number(academicLevelId)}
          levels={options.academic_levels}
          pathways={availablePathways}
          pathwayScopes={[]}
        />
        <Dialog.Footer className="-mx-4 -mb-4 w-[calc(100%+2rem)] justify-between border-t-2 px-4 py-4">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="default" disabled={returningToDetails} onClick={() => void returnToDetails()}>
            {returningToDetails ? "Refreshing..." : "Back to New Class"}
          </Button>
        </Dialog.Footer>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-4 -mb-3">
        <div className="flex flex-col gap-1">
          <Field label="Academic Year" isRequired>
            <Select value={selectedYearId} onValueChange={(value) => {
              setSelectedYearId(value);
              setOptions(null);
              setLoading(true);
              setSections([createSectionDraft()]);
              setConfiguredAdvisers({});
              setErrors({ sectionRows: {}, configuredRows: {} });
            }}>
              <Select.Trigger className="w-full"><Select.Value placeholder="Select academic year" /></Select.Trigger>
              <Select.Content><Select.Group>
                {(options.academic_years ?? [options.academic_year]).map((year) => <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>{year.year_label}</Select.Item>)}
              </Select.Group></Select.Content>
            </Select>
          </Field>
          {noAdvisers && (
            <Text as="p" className="text-xs text-muted-foreground">
              All advisers are currently assigned for the active academic year.
            </Text>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Field label="Academic Level" isRequired>
            <Select
              disabled={noLevels}
              value={academicLevelId}
              onValueChange={handleAcademicLevelChange}
              onChange={(e) => handleAcademicLevelChange(e.target.value)}
            >
              <Select.Trigger
                id="new-class-academic-level"
                className="w-full aria-[invalid=true]:border-destructive"
                aria-invalid={!!errors.academicLevel}
                aria-describedby={errors.academicLevel ? "new-class-academic-level-error" : undefined}
              >
                <Select.Value placeholder="Select level" />
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  {options.academic_levels.map((level) => (
                    <Select.Item key={level.academic_level_id} value={String(level.academic_level_id)}>
                      {level.level_name}
                    </Select.Item>
                  ))}
                </Select.Group>
              </Select.Content>
            </Select>
            {errors.academicLevel && <InlineError id="new-class-academic-level-error" message={errors.academicLevel} />}
          </Field>
        </div>
      </div>

      {availableConfiguredSections.length > 0 && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <Text className="text-sm font-semibold">Available configured sections</Text>
              <Text as="p" className="text-xs text-muted-foreground">Assign an adviser to include an official section in this class setup.</Text>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={manageOfficialSections}>
              <Settings className="mr-2 size-4" />Manage official sections
            </Button>
          </div>
          <div className="grid gap-2">
            {availableConfiguredSections.map((section) => {
              const adviserError = errors.configuredRows[section.id]?.adviserStaffId;
              const selectedAdviser = configuredAdvisers[section.id] ?? "";
              const assignedAdvisers = new Set(sections.map((draft) => draft.adviserStaffId).filter(Boolean));
              return (
                <div key={section.id} className="grid gap-2 rounded border-2 border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Text className="font-semibold">{section.section_name}</Text>
                      <Badge variant="outline" size="sm">Configured</Badge>
                    </div>
                    {section.pathway_name && <Text as="p" className="text-xs text-muted-foreground">{section.pathway_name}</Text>}
                  </div>
                  <div>
                    <Select
                      value={selectedAdviser}
                      onValueChange={(value) => {
                        setConfiguredAdvisers((current) => ({ ...current, [section.id]: value }));
                        setErrors((current) => {
                          const configuredRows = { ...current.configuredRows };
                          delete configuredRows[section.id];
                          return { ...current, configuredRows };
                        });
                      }}
                      onChange={(event) => setConfiguredAdvisers((current) => ({ ...current, [section.id]: event.target.value }))}
                      disabled={noAdvisers}
                    >
                      <Select.Trigger aria-label={`Adviser for ${section.section_name}`} aria-invalid={!!adviserError} aria-describedby={adviserError ? `configured-section-error-${section.id}` : undefined} className="w-full aria-[invalid=true]:border-destructive">
                        <Select.Value placeholder="Select adviser" />
                      </Select.Trigger>
                      <Select.Content><Select.Group>
                        {options.eligible_advisers
                          .filter((adviser) => adviser.staff_id === selectedAdviser || !assignedAdvisers.has(adviser.staff_id))
                          .map((adviser) => <Select.Item key={adviser.staff_id} value={adviser.staff_id}>{adviserName(adviser)}</Select.Item>)}
                      </Select.Group></Select.Content>
                    </Select>
                    {adviserError && <InlineError id={`configured-section-error-${section.id}`} message={adviserError} />}
                  </div>
                  <Button type="button" variant="outline" onClick={() => addConfiguredSection(section)}>
                    <Plus className="mr-2 size-4" />Add section
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {existingClassSections.length > 0 && (
        <section className="grid gap-3">
          <div>
            <Text className="text-sm font-semibold">Existing classes</Text>
            <Text as="p" className="text-xs text-muted-foreground">These official sections already have classes and cannot be added again.</Text>
          </div>
          <div className="grid gap-2">
            {existingClassSections.map((section) => (
              <div key={section.id} className="flex flex-wrap items-center justify-between gap-3 rounded border-2 border-border bg-muted/20 p-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text className="font-semibold">{section.section_name}</Text>
                    <Badge variant="secondary" size="sm">In use</Badge>
                  </div>
                  <Text as="p" className="text-xs text-muted-foreground">
                    {section.adviser_name || "No adviser assigned"}{section.pathway_name ? ` · ${section.pathway_name}` : ""}
                  </Text>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={section.class_id == null} onClick={() => manageClass(section)}>
                  <Users className="mr-2 size-4" />Manage Class
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Sections & Advisers table */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <div>
            <Text className="text-sm font-semibold">Class sections</Text>
            <Text as="p" className="text-xs text-muted-foreground">Review configured sections or create a new section below.</Text>
          </div>
          {errors.sections && <InlineError message={errors.sections} />}
        </div>

        <div className={`grid ${showPathwayColumn ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_36px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]"} gap-2 px-1 text-sm font-medium text-foreground -mb-2`}>
          <span>Section Name <span className="text-red-500">*</span></span>
          {showPathwayColumn && <span>Strand / Pathway</span>}
          <span>Adviser <span className="text-red-500">*</span></span>
          <span />
        </div>

        {sections.map((section) => {
          const rowErrors = errors.sectionRows[section.localId];
          const configuredSection = existingGradeSections.find((official) => !official.has_class && (
            official.id === section.officialSectionId
            || official.section_name.trim().toLocaleLowerCase() === section.sectionName.trim().toLocaleLowerCase()
          ));
          const selectedByOtherRows = new Set(
            sections
              .filter((item) => item.localId !== section.localId)
              .map((item) => item.adviserStaffId)
              .filter(Boolean)
          );
          return (
            <div key={section.localId} className={`grid ${showPathwayColumn ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_36px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]"} items-start gap-2`}>
              <div className="relative">
                <Input
                  id={`new-class-section-${section.localId}`}
                  value={section.sectionName}
                  placeholder="e.g. Diamond, Archimedes"
                  disabled={!!configuredSection}
                  readOnly={!!configuredSection}
                  className={`w-full h-10 aria-[invalid=true]:border-destructive ${configuredSection ? "bg-muted/30 pr-24 font-semibold" : ""}`}
                  aria-invalid={!!rowErrors?.sectionName}
                  aria-describedby={rowErrors?.sectionName ? `new-class-section-error-${section.localId}` : undefined}
                  onChange={(e) => updateSection(section.localId, { sectionName: e.target.value })}
                />
                {configuredSection && <Badge variant="outline" size="sm" className="pointer-events-none absolute right-2 top-2 select-none">Configured</Badge>}
                {rowErrors?.sectionName && (
                  <InlineError id={`new-class-section-error-${section.localId}`} message={rowErrors.sectionName} />
                )}
              </div>
              {showPathwayColumn && (
                <div>
                  {configuredSection ? (
                    <Input disabled readOnly value={configuredSection.pathway_name || "General"} className="h-10 bg-muted/30 text-muted-foreground" />
                  ) : <Select
                    value={section.pathway || ""}
                    onValueChange={(val) => updateSection(section.localId, { pathway: val })}
                  >
                    <Select.Trigger className="w-full">
                      <Select.Value placeholder="Select pathway" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Group>
                        {pathwayOptions.map((pw) => (
                          <Select.Item key={pw.code} value={pw.code}>
                            {pw.name}
                          </Select.Item>
                        ))}
                      </Select.Group>
                    </Select.Content>
                  </Select>}
                </div>
              )}
              <div>
                <Select
                  disabled={noAdvisers}
                  value={section.adviserStaffId}
                  onChange={(e) => updateSection(section.localId, { adviserStaffId: e.target.value })}
                >
                  <Select.Trigger className="w-full aria-[invalid=true]:border-destructive" aria-invalid={!!rowErrors?.adviserStaffId} aria-describedby={rowErrors?.adviserStaffId ? `new-class-adviser-error-${section.localId}` : undefined}>
                    <Select.Value placeholder="Select adviser" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {options.eligible_advisers
                        .filter((adviser) => adviser.staff_id === section.adviserStaffId || !selectedByOtherRows.has(adviser.staff_id))
                        .map((adviser) => (
                          <Select.Item key={adviser.staff_id} value={adviser.staff_id}>
                            <span className="flex items-center gap-2">
                              <span className="truncate">{adviserName(adviser)}</span>
                              <RoleBadge role="teacher" />
                            </span>
                          </Select.Item>
                        ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
                {rowErrors?.adviserStaffId && <InlineError id={`new-class-adviser-error-${section.localId}`} message={rowErrors.adviserStaffId} />}
              </div>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex"><Button
                  aria-label="Remove section"
                  variant={"outline"}
                  size={"icon"}
                  onClick={() => removeSection(section.localId)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button></span>} />
                <TooltipContent>Remove section</TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        <Button
          variant={"outline"}
          className="w-fit mt-1"
          disabled={!canAddSection}
          onClick={addSection}
        >
          <Plus className="size-4 mr-2" />Add Another Section
        </Button>
      </section>

      <Dialog.Footer className="-mx-4 -mb-4 w-[calc(100%+2rem)] justify-between border-t-2 px-4 py-4">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button
            variant="outline"
            disabled={noLevels || noAdvisers || !sections.length}
            onClick={() => completeDetails(onSkipStudents)}
          >
            Review without Students
          </Button>
          <Button
            variant="default"
            disabled={noLevels || noAdvisers || !sections.length}
            onClick={() => completeDetails(onComplete)}
          >
            Assign Students
          </Button>
        </div>
      </Dialog.Footer>
    </div>
  );
}

function InlineError({ message, id }: { message: string; id?: string }) {
  return <FormMessage id={id} className="mt-1 text-xs">{message}</FormMessage>;
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded border-2 border-border bg-card p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
