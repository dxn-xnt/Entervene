import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getClassFormOptions } from "@/lib/api";
import type { AdviserOption, ClassFormOptions, ManualClassSetup, ManualSectionDraft } from "@/types/adminClasses";
import Field from "../fields/Field";
import SelectField from "../fields/SelectField";
import { retroButton } from "../utils";

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
        <button className={retroButton("bg-[#79bd80]")} onClick={retryLoading}>Retry</button>
        <button className={retroButton()} onClick={onBack}>Back</button>
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
          <input readOnly value={options.academic_year.year_label} className="h-10 rounded-md border border-black bg-black/5 px-3 text-sm text-black/70" />
        </Field>
        <Field label="Academic Level">
          <SelectField disabled={noLevels} value={academicLevelId} onChange={setAcademicLevelId}>
            {!academicLevelId && <option value="">Select academic level</option>}
            {options.academic_levels.map((level) => <option key={level.academic_level_id} value={level.academic_level_id}>{level.level_name}</option>)}
          </SelectField>
          {errors.academicLevel && <InlineError message={errors.academicLevel} />}
          {noLevels && <InlineError message="No academic levels are available." />}
        </Field>
        <Field label="Number of Sections">
          <input readOnly value={sections.length} className="h-10 rounded-md border border-black bg-black/5 px-3 text-sm text-black/70" />
        </Field>
      </div>

      <section className="grid gap-2">
        <div>
          <h3 className="font-bold">Sections</h3>
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
                <input value={section.sectionName} onChange={(event) => updateSection(section.localId, { sectionName: event.target.value })} placeholder="Sapphire" className="h-10 w-full rounded-md border border-black bg-[#fffdf5] px-3 text-sm" />
                {rowErrors?.sectionName && <InlineError message={rowErrors.sectionName} />}
              </div>
              <div>
                <SelectField disabled={noAdvisers} value={section.adviserStaffId} onChange={(value) => updateSection(section.localId, { adviserStaffId: value })}>
                  <option value="">Select adviser</option>
                  {options.eligible_advisers
                    .filter((adviser) => adviser.staff_id === section.adviserStaffId || !selectedByOtherRows.has(adviser.staff_id))
                    .map((adviser) => <option key={adviser.staff_id} value={adviser.staff_id}>{adviserName(adviser)}</option>)}
                </SelectField>
                {rowErrors?.adviserStaffId && <InlineError message={rowErrors.adviserStaffId} />}
              </div>
              <button aria-label="Remove section" disabled={sections.length === 1} className="grid size-9 place-items-center rounded-md border border-black bg-white disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setSections((current) => current.filter((item) => item.localId !== section.localId))}>
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
        <button className={retroButton("w-fit")} onClick={() => setSections((current) => [...current, createSectionDraft()])}><Plus className="size-4" />Add Another Section</button>
      </section>

      <div className="flex justify-between">
        <button className={retroButton()} onClick={onBack}>Back</button>
        <button disabled={noLevels || noAdvisers} className={retroButton("bg-[#79bd80] disabled:cursor-not-allowed disabled:opacity-50")} onClick={continueToStudents}>Continue to Add Students</button>
      </div>
    </div>
  );
}

function InlineError({ message }: { message: string }) {
  return <p className="mt-1 text-[11px] font-semibold text-red-700">{message}</p>;
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-3 rounded-md border border-black bg-[#fff8d7] p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-black/70">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
