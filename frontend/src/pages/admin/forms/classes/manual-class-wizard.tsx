"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getClassFormOptions } from "@/lib/api";
import type { AdviserOption, ClassFormOptions, ManualClassSetup, ManualSectionDraft } from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";

type SetupErrors = {
  academicLevel?: string;
  sections?: string;
  sectionRows: Record<string, { sectionName?: string; adviserStaffId?: string }>;
};

function createSectionDraft(sectionName = "", adviserStaffId = ""): ManualSectionDraft {
  return {
    localId: crypto.randomUUID(),
    sectionName,
    adviserStaffId,
  };
}

function adviserName(adviser?: AdviserOption) {
  if (!adviser) return "";
  return [adviser.first_name, adviser.middle_name, adviser.last_name, adviser.suffix].filter(Boolean).join(" ");
}

export default function ManualClassWizard({ initialSetup, onComplete, onBack }: {
  initialSetup: ManualClassSetup | null;
  onComplete: (setup: ManualClassSetup) => void;
  onBack: () => void;
}) {
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [academicLevelId, setAcademicLevelId] = useState(initialSetup?.academicLevelId ? String(initialSetup.academicLevelId) : "");
  const [sections, setSections] = useState<ManualSectionDraft[]>(initialSetup?.sections ?? [createSectionDraft()]);
  const [errors, setErrors] = useState<SetupErrors>({ sectionRows: {} });
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    getClassFormOptions()
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setAcademicLevelId((current) => current || String(data.academic_levels[0]?.academic_level_id ?? ""));
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
  }, [retryKey]);

  function retryLoading() {
    setLoading(true);
    setLoadError("");
    setRetryKey((value) => value + 1);
  }

  function updateSection(localId: string, changes: Partial<ManualSectionDraft>) {
    setSections((current) => current.map((section) => section.localId === localId ? { ...section, ...changes } : section));
  }

  function validate() {
    const nextErrors: SetupErrors = { sectionRows: {} };
    if (!academicLevelId) nextErrors.academicLevel = "Select an academic level.";
    if (!sections.length) nextErrors.sections = "Add at least one section.";

    const names = new Map<string, string>();
    const advisers = new Set<string>();
    sections.forEach((section) => {
      const rowErrors: { sectionName?: string; adviserStaffId?: string } = {};
      const trimmedName = section.sectionName.trim();
      const normalizedName = trimmedName.toLocaleLowerCase();

      if (!trimmedName) rowErrors.sectionName = "Enter a section name.";
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

  function continueToStudents() {
    if (!options || !validate()) return;
    const level = options.academic_levels.find((item) => item.academic_level_id === Number(academicLevelId));
    if (!level) return;
    onComplete({
      academicLevelId: level.academic_level_id,
      academicLevelName: level.level_name,
      academicYear: options.academic_year,
      sections: sections.map((section) => ({
        ...section,
        sectionName: section.sectionName.trim(),
        adviserName: adviserName(options.eligible_advisers.find((adviser) => adviser.staff_id === section.adviserStaffId)),
      })),
    });
  }

  if (loading) {
    return <StatePanel message="Loading class options..." />;
  }

  if (loadError) {
    return (
      <StatePanel message="Unable to load class options." detail={loadError}>
        <Button variant={"default"} onClick={retryLoading}>Retry</Button>
        <Button variant={"outline"} onClick={onBack}>Back</Button>
      </StatePanel>
    );
  }

  if (!options) return null;
  const noLevels = options.academic_levels.length === 0;
  const noAdvisers = options.eligible_advisers.length === 0;

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Field label="Active Academic Year">
          <Input readOnly value={options.academic_year.year_label} className="bg-muted/50 text-muted-foreground" />
        </Field>
        <Field label="Academic Level">
          <Select
            disabled={noLevels}
            value={academicLevelId}
            onChange={(e) => setAcademicLevelId(e.target.value)}
          >
            <Select.Trigger className="w-full">
              <Select.Value placeholder="Select academic level" />
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
          {noLevels && <InlineError message="No academic levels are available." />}
        </Field>
        <Field label="Number of Sections">
          <Input readOnly value={String(sections.length)} className="bg-muted/50 text-muted-foreground" />
        </Field>
      </div>

      <section className="grid gap-2">
        <div>
          <Text as="h6" className="font-bold">Sections</Text>
          {noAdvisers && <InlineError message="No eligible class advisers are available." />}
          {errors.sections && <InlineError message={errors.sections} />}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] gap-2 text-xs font-semibold">
          <span>Section Name</span><span>Adviser</span><span />
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
            <div key={section.localId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] items-start gap-2">
              <div>
                <Input
                  value={section.sectionName}
                  onChange={(event) => updateSection(section.localId, { sectionName: event.target.value })}
                  placeholder="e.g. Sapphire"
                />
                {rowErrors?.sectionName && <InlineError message={rowErrors.sectionName} />}
              </div>
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
                            {adviserName(adviser)}
                          </Select.Item>
                        ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
                {rowErrors?.adviserStaffId && <InlineError message={rowErrors.adviserStaffId} />}
              </div>
              <Button
                aria-label="Remove section"
                variant={"outline"}
                size={"icon"}
                disabled={sections.length === 1}
                onClick={() => setSections((current) => current.filter((item) => item.localId !== section.localId))}
              >
                <Trash2 className="size-4 text-destructive" />
              </Button>
            </div>
          );
        })}
        <Button
          variant={"outline"}
          className="w-fit mt-1"
          onClick={() => setSections((current) => [...current, createSectionDraft()])}
        >
          <Plus className="size-4 mr-2" />Add Another Section
        </Button>
      </section>

      <Dialog.Footer className="px-0 border-t-0 pt-3">
        <Button variant={"outline"} onClick={onBack}>Back</Button>
        <Button
          variant={"default"}
          disabled={noLevels || noAdvisers}
          onClick={continueToStudents}
        >
          Next
        </Button>
      </Dialog.Footer>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return <p className="mt-1 text-xs font-semibold text-destructive">{message}</p>;
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border-2 border-border bg-card p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
