import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { formatPeriodLabel } from "@/lib/academic-periods";
import {
  ApiRequestError,
  createSubjectOffering,
  updateSubjectOffering,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectOfferingListItem,
  type SubjectOfferingPathway,
  type SubjectStatus,
} from "@/lib/api";
import { SubjectPicker } from "./SubjectPicker";
import {
  FALLBACK_PERIODS,
  isJuniorHighGrade,
  isSeniorHighGrade,
  pathwayLabel,
  pathwaysForGrade,
  targetLevels,
  type OfferingFormState,
} from "./subject-utils";

export function OfferingModal({
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
                          className={`flex items-center gap-3 rounded-md border-2 border-black p-3 shadow-[2px_2px_0_#000] ${isFallback ? "cursor-not-allowed bg-black/5 text-black/50" : "cursor-pointer bg-background"
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
