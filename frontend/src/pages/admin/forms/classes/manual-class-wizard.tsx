"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getClassFormOptions } from "@/lib/api";
import type { AdviserOption, ClassFormOptions, ManualClassSetup, ManualSectionDraft } from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Select } from "@/components/retroui/Select";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import { RoleBadge } from "@/components/role-badge";

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
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [academicLevelId, setAcademicLevelId] = useState(initialSetup?.academicLevelId ? String(initialSetup.academicLevelId) : "");
  const [selectedYearId, setSelectedYearId] = useState(initialSetup?.academicYear.academic_year_id ? String(initialSetup.academicYear.academic_year_id) : "");
  const [sections, setSections] = useState<ManualSectionDraft[]>(initialSetup?.sections ?? [createSectionDraft()]);
  const [errors, setErrors] = useState<SetupErrors>({ sectionRows: {} });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getClassFormOptions(selectedYearId ? Number(selectedYearId) : undefined)
      .then((classData) => {
        if (cancelled) return;
        setOptions(classData);
        if (!selectedYearId) setSelectedYearId(String(classData.academic_year.academic_year_id));
        const defaultLevelId = initialSetup?.academicLevelId ? String(initialSetup.academicLevelId) : String(classData.academic_levels[0]?.academic_level_id ?? "");
        setAcademicLevelId((current) => current || defaultLevelId);

        if (!initialSetup?.sections) {
          setSections((current) => current.length ? current : [createSectionDraft()]);
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

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setRetryKey((value) => value + 1);
  }

  const selectedLevel = options?.academic_levels.find((item) => String(item.academic_level_id) === academicLevelId);
  const isSeniorHigh = selectedLevel ? selectedLevel.grade_level >= 11 : false;
  const needsPathway = isSeniorHigh && (selectedLevel?.requires_pathway ?? false);
  const showPathwayColumn = needsPathway;
  const configuredSections = (options?.official_sections ?? []).filter((section) => section.academic_level_id === Number(academicLevelId) && section.is_active);
  const availableSections = configuredSections.filter((section) => !section.has_class);
  const selectedSectionNames = new Set(sections.map((section) => section.sectionName).filter(Boolean));
  const nextUnusedSection = availableSections.find((section) => !selectedSectionNames.has(section.section_name));
  const canAddSection = sections.every((section) => Boolean(section.sectionName)) && Boolean(nextUnusedSection);

  function addSection() {
    setSections((current) => {
      if (current.some((section) => !section.sectionName)) return current;
      const next = availableSections.find((option) => !current.some((section) => section.sectionName === option.section_name));
      return next ? [...current, createSectionDraft(next.section_name, "", next.pathway_code || "general")] : current;
    });
  }

  function updateSection(localId: string, changes: Partial<ManualSectionDraft>) {
    setSections((current) => current.map((section) => section.localId === localId ? { ...section, ...changes } : section));
  }

  function validate() {
    const nextErrors: SetupErrors = { sectionRows: {} };
    if (!academicLevelId) nextErrors.academicLevel = "Select an academic level.";
    if (!configuredSections.length) {
      nextErrors.academicLevel = "No official sections are configured for this grade and academic year. Configure them in System Settings or use another year.";
    } else if (!availableSections.length) {
      nextErrors.academicLevel = `All configured ${selectedLevel?.level_name || "Grade"} sections for this academic year already have classes. You can manage the existing classes or configure another authorized section.`;
    }
    if (!sections.length) nextErrors.sections = "Add at least one section.";

    const names = new Map<string, string>();
    const advisers = new Set<string>();
    sections.forEach((section) => {
      const rowErrors: { sectionName?: string; adviserStaffId?: string } = {};
      const trimmedName = section.sectionName.trim();
      const normalizedName = trimmedName.toLocaleLowerCase();

      if (!trimmedName) rowErrors.sectionName = "Enter a section name.";
      else if (!availableSections.some((option) => option.section_name === trimmedName && option.pathway_code === (section.pathway === "general" ? null : section.pathway))) rowErrors.sectionName = "Select an available official section.";
      else if (names.has(normalizedName)) rowErrors.sectionName = `Section name duplicates "${names.get(normalizedName)}".`;
      else names.set(normalizedName, trimmedName);
      if (!section.adviserStaffId) rowErrors.adviserStaffId = "Select an adviser.";
      else if (advisers.has(section.adviserStaffId)) rowErrors.adviserStaffId = "Each adviser can only be assigned to one section per academic year.";
      else advisers.add(section.adviserStaffId);
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
        pathway: availableSections.find((option) => option.section_name === section.sectionName)?.pathway_code || "general",
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
      <Field label="Academic Year">
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
        <div className="rounded border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 font-semibold">
          All advisers are currently assigned for the active academic year. You can create sections after freeing an adviser slot.
        </div>
      )}

      <Field label="Academic Level">
        <Select
          disabled={noLevels}
          value={academicLevelId}
          onChange={(e) => {
            const newLevelId = e.target.value;
            setAcademicLevelId(newLevelId);
            setSections((current) => current.map((s) => ({ ...s, sectionName: "", pathway: "general" })));
          }}
        >
          <Select.Trigger className="w-full">
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
        {errors.academicLevel && <InlineError message={errors.academicLevel} />}
        {!configuredSections.length && (
          <InlineError message="No official sections are configured for this grade and academic year. Configure them in System Settings or use another year." />
        )}
        {configuredSections.length > 0 && !availableSections.length && (
          <InlineError message={`All configured ${selectedLevel?.level_name || "Grade"} sections for this academic year already have classes. You can manage the existing classes or configure another authorized section.`} />
        )}
      </Field>

      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <Text className="text-sm font-semibold">Sections & Advisers</Text>
          {errors.sections && <InlineError message={errors.sections} />}
        </div>

        <div className={`grid ${showPathwayColumn ? "grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_36px]" : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]"} gap-2 text-xs font-semibold text-muted-foreground px-1`}>
          <span>Section Name</span>
          {showPathwayColumn && <span>Strand / Pathway</span>}
          <span>Adviser</span>
          <span />
        </div>

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
                <Select value={section.sectionName} onValueChange={(name) => {
                  const chosen = availableSections.find((option) => option.section_name === name);
                  updateSection(section.localId, { sectionName: name, pathway: chosen?.pathway_code || "general" });
                }}>
                  <Select.Trigger className="w-full"><Select.Value placeholder="Select official section" /></Select.Trigger>
                  <Select.Content><Select.Group>
                    {availableSections
                      .filter((option) => option.section_name === section.sectionName || !sections.some((other) => other.localId !== section.localId && other.sectionName === option.section_name))
                      .map((option) => <Select.Item key={option.id} value={option.section_name}>{option.section_name}{option.pathway_name ? ` — ${option.pathway_name}` : ""}</Select.Item>)}
                  </Select.Group></Select.Content>
                </Select>
                {rowErrors?.sectionName && <InlineError message={rowErrors.sectionName} />}
              </div>
              {showPathwayColumn && (
                <div>
                  <div className="flex min-h-10 items-center border-2 border-black px-2 text-xs">{availableSections.find((option) => option.section_name === section.sectionName)?.pathway_name ?? "Choose a section"}</div>
                </div>
              )}
              <div>
                <Select
                  disabled={noAdvisers}
                  value={section.adviserStaffId}
                  onChange={(e) => updateSection(section.localId, { adviserStaffId: e.target.value })}
                >
                  <Select.Trigger className="w-full">
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
                {rowErrors?.adviserStaffId && <InlineError message={rowErrors.adviserStaffId} />}
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
          <Plus className="size-4 mr-2" />{nextUnusedSection ? "Add Another Section" : "All Available Sections Added"}
        </Button>
      </section>

      <Dialog.Footer className="-mx-4 -mb-4 w-[calc(100%+2rem)] justify-between border-t-2 px-4 py-4">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>Back</Button>
          <Button
            variant="outline"
            disabled={noLevels || noAdvisers || !availableSections.length}
            onClick={() => completeDetails(onSkipStudents)}
          >
            Review without Students
          </Button>
          <Button
            variant="default"
            disabled={noLevels || noAdvisers || !availableSections.length}
            onClick={() => completeDetails(onComplete)}
          >
            Assign Students
          </Button>
        </div>
      </Dialog.Footer>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return <p className="mt-1 text-xs font-semibold text-destructive">{message}</p>;
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
