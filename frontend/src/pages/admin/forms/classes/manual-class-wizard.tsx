"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteOfficialSection, fetchPathways, getClassFormOptions, type AcademicPathwayRead } from "@/lib/api";
import type { AdviserOption, ClassFormOptions, ManualClassSetup, ManualSectionDraft, OfficialSectionOption } from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { RoleBadge } from "@/components/role-badge";
import { useToast } from "@/components/retroui/Toast";

type SetupErrors = {
  academicLevel?: string;
  sections?: string;
  sectionRows: Record<string, { sectionName?: string; adviserStaffId?: string }>;
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

export default function ManualClassWizard({ initialSetup, onComplete, onSkipStudents, onBack, onClose }: {
  initialSetup: ManualClassSetup | null;
  onComplete: (setup: ManualClassSetup) => void;
  onSkipStudents: (setup: ManualClassSetup) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [academicLevelId, setAcademicLevelId] = useState(initialSetup?.academicLevelId ? String(initialSetup.academicLevelId) : "");
  const [selectedYearId, setSelectedYearId] = useState(initialSetup?.academicYear.academic_year_id ? String(initialSetup.academicYear.academic_year_id) : "");
  const [sections, setSections] = useState<ManualSectionDraft[]>(initialSetup?.sections ?? [createSectionDraft()]);
  const [errors, setErrors] = useState<SetupErrors>({ sectionRows: {} });
  const [retryKey, setRetryKey] = useState(0);
  const [availablePathways, setAvailablePathways] = useState<AcademicPathwayRead[]>([]);
  const [sectionToDelete, setSectionToDelete] = useState<OfficialSectionOption | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
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
  }, [retryKey, selectedYearId]);

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
    setErrors((current) => ({ ...current, academicLevel: undefined, sectionRows: {} }));
  }

  const selectedLevel = options?.academic_levels.find((item) => String(item.academic_level_id) === academicLevelId);
  const isSeniorHigh = selectedLevel ? selectedLevel.grade_level >= 11 : false;
  const needsPathway = isSeniorHigh && (selectedLevel?.requires_pathway ?? false);
  const showPathwayColumn = needsPathway;

  // Existing sections for this grade level in the active academic year
  const existingGradeSections = (options?.official_sections ?? []).filter(
    (sec) => sec.academic_level_id === Number(academicLevelId) && sec.is_active
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

  async function handleConfirmDelete() {
    if (!sectionToDelete) return;
    setIsDeleting(true);
    try {
      const res = await deleteOfficialSection(sectionToDelete.id);
      toast.success({ title: res.message || "Section deleted" });
      setSectionToDelete(null);
      const classData = await getClassFormOptions(selectedYearId ? Number(selectedYearId) : undefined);
      setOptions(classData);
    } catch (err: unknown) {
      toast.error({
        title: "Unable to delete section",
        description: err instanceof Error ? err.message : "Error deleting section",
      });
    } finally {
      setIsDeleting(false);
    }
  }

  function validate() {
    const nextErrors: SetupErrors = { sectionRows: {} };
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
      sections: sections.map((section) => ({
        ...section,
        sectionName: section.sectionName.trim(),
        pathway: section.pathway || "general",
        adviserName: adviserName(options.eligible_advisers.find((adviser) => adviser.staff_id === section.adviserStaffId)),
      })),
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
              setErrors({ sectionRows: {} });
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

      {/* Sections & Advisers table */}
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <Text className="text-sm font-semibold">Sections & Advisers</Text>
          {errors.sections && <InlineError message={errors.sections} />}
        </div>

        <div className={`grid ${showPathwayColumn ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_36px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]"} gap-2 px-1 text-sm font-medium text-foreground -mb-2`}>
          <span>Section Name <span className="text-red-500">*</span></span>
          {showPathwayColumn && <span>Strand / Pathway</span>}
          <span>Adviser <span className="text-red-500">*</span></span>
          <span />
        </div>

        {/* Existing sections of this grade level (read-only with delete action) */}
        {existingGradeSections.map((sec) => (
          <div
            key={`existing-${sec.id}`}
            className={`grid ${showPathwayColumn ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_36px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]"} items-center gap-2`}
          >
            <div className="relative flex items-center">
              <Input
                value={sec.section_name}
                disabled
                readOnly
                aria-label={`Existing section ${sec.section_name}`}
                className="w-full h-10 bg-muted/30 text-foreground font-semibold cursor-not-allowed pr-20"
              />
              <Badge
                variant={sec.has_class ? "secondary" : "outline"}
                size="sm"
                className="absolute right-2 text-xs select-none pointer-events-none"
              >
                {sec.has_class ? "In use" : "Configured"}
              </Badge>
            </div>

            {showPathwayColumn && (
              <div>
                <Input
                  value={sec.pathway_name || "General"}
                  disabled
                  readOnly
                  aria-label={`Pathway for ${sec.section_name}`}
                  className="w-full h-10 bg-muted/30 text-muted-foreground cursor-not-allowed text-xs"
                />
              </div>
            )}

            <div>
              <Input
                value={sec.adviser_name || (sec.has_class ? "Assigned" : "Unassigned")}
                disabled
                readOnly
                aria-label={`Adviser for ${sec.section_name}`}
                className="w-full h-10 bg-muted/30 text-muted-foreground cursor-not-allowed text-sm"
              />
            </div>

            <Button
              type="button"
              aria-label={`Delete ${sec.section_name}`}
              variant="outline"
              size="sm"
              className="h-10 w-9 p-0 text-destructive border-border hover:border-destructive hover:bg-destructive/10 shrink-0"
              onClick={() => setSectionToDelete(sec)}
              title={`Delete ${sec.section_name}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}

        {sections.map((section) => {
          const rowErrors = errors.sectionRows[section.localId];
          const selectedByOtherRows = new Set(
            sections
              .filter((item) => item.localId !== section.localId)
              .map((item) => item.adviserStaffId)
              .filter(Boolean)
          );
          return (
            <div key={section.localId} className={`grid ${showPathwayColumn ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_36px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]"} items-start gap-2`}>
              <div>
                <Input
                  id={`new-class-section-${section.localId}`}
                  value={section.sectionName}
                  placeholder="e.g. Diamond, Archimedes"
                  className="w-full h-10 aria-[invalid=true]:border-destructive"
                  aria-invalid={!!rowErrors?.sectionName}
                  aria-describedby={rowErrors?.sectionName ? `new-class-section-error-${section.localId}` : undefined}
                  onChange={(e) => updateSection(section.localId, { sectionName: e.target.value })}
                />
                {rowErrors?.sectionName && (
                  <InlineError id={`new-class-section-error-${section.localId}`} message={rowErrors.sectionName} />
                )}
              </div>
              {showPathwayColumn && (
                <div>
                  <Select
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
                  </Select>
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
                  disabled={sections.length === 1}
                  onClick={() => setSections((current) => current.filter((item) => item.localId !== section.localId))}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button></span>} />
                <TooltipContent>{sections.length === 1 ? "Keep one section" : "Remove section"}</TooltipContent>
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

      {/* Delete confirmation dialog */}
      <Dialog open={!!sectionToDelete} onOpenChange={(open) => !open && setSectionToDelete(null)}>
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Delete Section</Dialog.Title>
            <Dialog.Description>
              Are you sure you want to delete section <strong>{sectionToDelete?.section_name}</strong>?
              {sectionToDelete?.has_class ? " This section has an active class. Safe deletion will remove it if no active student records or grades exist, or archive it if records are present." : ""}
            </Dialog.Description>
          </Dialog.Header>
          <Dialog.Footer className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setSectionToDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isDeleting}
              onClick={handleConfirmDelete}
            >
              {isDeleting ? "Deleting..." : "Delete Section"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

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
