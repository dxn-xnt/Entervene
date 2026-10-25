import { useEffect, useMemo, useState } from "react";
import type React from "react";
import { Button } from "@/components/admin/button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { formatPeriodLabel } from "@/lib/academic-periods";
import {
  ApiRequestError,
  archiveSubjectOffering,
  createSubjectOffering,
  getSubjectOfferings,
  updateSubjectOffering,
  type SubjectListItem,
  type SubjectOfferingFormOptions,
  type SubjectOfferingListItem,
  type SubjectOfferingPathway,
  type SubjectStatus,
} from "@/lib/api";
import { SubjectPicker } from "./subject-picker";
import {
  FALLBACK_PERIODS,
  isJuniorHighGrade,
  isSeniorHighGrade,
  pathwayLabel,
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
  onSaved: (meta?: {
    message?: string;
    partialFailure?: boolean;
    gradeValue?: string;
    pathway?: SubjectOfferingPathway;
    academicYearId?: number;
  }) => Promise<void>;
}) {
  const [existingSubjectOfferings, setExistingSubjectOfferings] = useState<SubjectOfferingListItem[]>([]);
  const [alreadyOfferedSubjectIds, setAlreadyOfferedSubjectIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<OfferingFormState>({
    subject_id: "",
    subject_ids: [],
    academic_year_id: "",
    academic_level_id: "",
    academic_period_id: "",
    academic_period_ids: [],
    pathway: "general",
    minutes: "",
    status: "active",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const [showAdvancedYear, setShowAdvancedYear] = useState(false);

  const gradeLevels = useMemo(() => targetLevels(options?.academic_levels ?? []), [options]);
  const selectedYearId = Number(form.academic_year_id);
  const selectedLevelId = Number(form.academic_level_id);
  const selectedLevel = gradeLevels.find((level) => level.academic_level_id === selectedLevelId);
  const selectedYear = options?.academic_years.find((year) => year.academic_year_id === selectedYearId);
  const isJhsSelection = isJuniorHighGrade(selectedLevel?.grade_level);
  const isShsSelection = isSeniorHighGrade(selectedLevel?.grade_level);

  const availablePathways = useMemo<SubjectOfferingPathway[]>(() => {
    if (!isShsSelection) return [];
    const activePathways = options?.pathways ?? [];
    const list: SubjectOfferingPathway[] = [];

    if (activePathways.length > 1) {
      list.push("both");
    }
    for (const p of activePathways) {
      if (!list.includes(p.code as SubjectOfferingPathway)) {
        list.push(p.code as SubjectOfferingPathway);
      }
    }
    if (
      offering?.pathway &&
      offering.pathway !== "general" &&
      !list.includes(offering.pathway as SubjectOfferingPathway)
    ) {
      list.push(offering.pathway as SubjectOfferingPathway);
    }
    return list;
  }, [isShsSelection, options?.pathways, offering?.pathway]);

  const requiresPathway = availablePathways.length > 0;
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
  const contextPeriod = periods.find((period) => form.academic_period_ids.includes(String(period.academic_period_id)))
    ?? periods.find((period) => String(period.academic_period_id) === form.academic_period_id)
    ?? periods[0];
  const contextLabel = selectedYear?.year_label && contextPeriod
    ? `${selectedYear.year_label} - ${formatPeriodLabel(contextPeriod)}`
    : selectedYear?.year_label ?? "Current setup context unavailable";

  useEffect(() => {
    if (!open) {
      setAlreadyOfferedSubjectIds(new Set());
      return;
    }
    setError(null);
    setShowAdvancedYear(false);
    if (offering) {
      let isMounted = true;
      getSubjectOfferings({
        academic_year_id: offering.academic_year.academic_year_id,
        academic_level_id: offering.academic_level.academic_level_id,
      })
        .then((res) => {
          if (!isMounted) return;
          const subjectOfferings = res.subject_offerings.filter(
            (o) => o.subject.subject_id === offering.subject.subject_id && o.status === "active"
          );
          setExistingSubjectOfferings(subjectOfferings);
          const periodIds = subjectOfferings.map((o) => String(o.academic_period.academic_period_id));
          setForm({
            subject_id: String(offering.subject.subject_id),
            subject_ids: [String(offering.subject.subject_id)],
            academic_year_id: String(offering.academic_year.academic_year_id),
            academic_level_id: String(offering.academic_level.academic_level_id),
            academic_period_id: String(offering.academic_period.academic_period_id),
            academic_period_ids: periodIds.length
              ? periodIds
              : [String(offering.academic_period.academic_period_id)],
            pathway: offering.pathway,
            minutes: offering.minutes != null ? String(offering.minutes) : "",
            status: offering.status,
          });
        })
        .catch(() => {
          if (!isMounted) return;
          setExistingSubjectOfferings([offering]);
          setForm({
            subject_id: String(offering.subject.subject_id),
            subject_ids: [String(offering.subject.subject_id)],
            academic_year_id: String(offering.academic_year.academic_year_id),
            academic_level_id: String(offering.academic_level.academic_level_id),
            academic_period_id: String(offering.academic_period.academic_period_id),
            academic_period_ids: [String(offering.academic_period.academic_period_id)],
            pathway: offering.pathway,
            minutes: offering.minutes != null ? String(offering.minutes) : "",
            status: offering.status,
          });
        });

      return () => {
        isMounted = false;
      };
    }

    const activeYear = options?.academic_years.find((year) => year.is_active) ?? options?.academic_years[0];
    const level = gradeLevels[0];
    const initialPeriods = (options?.academic_periods ?? []).filter(
      (period) => period.academic_year_id === activeYear?.academic_year_id
    );
    const isLevelJhs = isJuniorHighGrade(level?.grade_level);
    const activePathwayCount = (options?.pathways ?? []).length;
    const initialPathway: SubjectOfferingPathway = isLevelJhs
      ? "general"
      : activePathwayCount > 1
      ? "both"
      : activePathwayCount === 1
      ? ((options?.pathways[0].code as SubjectOfferingPathway) ?? "general")
      : "general";

    setForm({
      subject_id: "",
      subject_ids: [],
      academic_year_id: activeYear ? String(activeYear.academic_year_id) : "",
      academic_level_id: level ? String(level.academic_level_id) : "",
      academic_period_id: initialPeriods[0] ? String(initialPeriods[0].academic_period_id) : "",
      academic_period_ids: isLevelJhs
        ? initialPeriods.map((period) => String(period.academic_period_id))
        : [],
      pathway: initialPathway,
      minutes: "",
      status: options?.default_status ?? "active",
      });
  }, [catalogSubjects, gradeLevels, offering, open, options]);

  // In create mode, fetch existing active offerings for the selected year+level so
  // the SubjectPicker can gray out already-offered subjects.
  // The isMounted cleanup flag handles both unmount and stale responses from rapid
  // grade/year switches (each effect invocation owns its own isMounted closure).
  useEffect(() => {
    if (!open || offering) return;
    if (!selectedYearId || !selectedLevelId) {
      setAlreadyOfferedSubjectIds(new Set());
      return;
    }
    let isMounted = true;
    getSubjectOfferings({
      academic_year_id: selectedYearId,
      academic_level_id: selectedLevelId,
      status: "active",
    })
      .then((res) => {
        if (!isMounted) return;
        const ids = new Set(res.subject_offerings.map((o) => String(o.subject.subject_id)));
        setAlreadyOfferedSubjectIds(ids);
      })
      .catch(() => {
        // Fail-open: backend still rejects duplicates with HTTP 409 at submit time
        if (!isMounted) return;
        setAlreadyOfferedSubjectIds(new Set());
      });
    return () => {
      isMounted = false;
    };
  }, [open, offering, selectedYearId, selectedLevelId]);

  const setField = <TKey extends keyof OfferingFormState>(key: TKey, value: OfferingFormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if ((key === "pathway" && error === "Select a valid pathway for the selected grade level.") || (key === "minutes" && error === "Minutes must be a positive number." && (!String(value).trim() || Number(value) > 0))) setError(null);
  };

  const failValidation = (message: string) => {
    setError(message);
    setValidationAttempt((attempt) => attempt + 1);
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
    const isNextJhs = isJuniorHighGrade(nextLevel?.grade_level);
    const activePathwayCount = (options?.pathways ?? []).length;
    const nextDefaultPathway: SubjectOfferingPathway = isNextJhs
      ? "general"
      : activePathwayCount > 1
      ? "both"
      : activePathwayCount === 1
      ? ((options?.pathways[0].code as SubjectOfferingPathway) ?? "general")
      : "general";

    const nextPeriods = (options?.academic_periods ?? []).filter(
      (period) => period.academic_year_id === Number(form.academic_year_id)
    );
    setForm((current) => ({
      ...current,
      academic_level_id: value,
      subject_id: "",
      subject_ids: [],
      academic_period_ids: isNextJhs
        ? nextPeriods.map((period) => String(period.academic_period_id))
        : [],
      pathway: nextDefaultPathway,
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
    const parts = [
      `${createdCount} subject offering${createdCount === 1 ? "" : "s"} created`,
      ...(skippedCount ? [`${skippedCount} already existed`] : []),
      ...(errorCount ? [`${errorCount} could not be created`] : []),
    ];
    return `${parts.join("; ")}.`;
  };

  const handleSubmit = async () => {
    setError(null);
    if (readOnly) {
      failValidation(readOnlyReason ?? "Previous academic years are locked in the UI to protect historical records.");
      return;
    }
    const selectedIds = isCreateMode ? form.subject_ids : [form.subject_id].filter(Boolean);
    const selectedTermIds = form.academic_period_ids;
    if (!selectedIds.length || !selectedTermIds.length || !form.academic_year_id || !form.academic_level_id) {
      failValidation("Select setup details, at least one term, and at least one subject.");
      return;
    }
    if (selectedTermIds.some((periodId) => Number(periodId) <= 0)) {
      failValidation("No valid academic terms are available for the selected academic year.");
      return;
    }
    if (requiresPathway && !availablePathways.includes(form.pathway)) {
      failValidation("Select a valid pathway for the selected grade level.");
      return;
    }

    const parsedMinutes = form.minutes.trim() ? Number(form.minutes) : null;
    if (parsedMinutes !== null && (isNaN(parsedMinutes) || parsedMinutes <= 0)) {
      failValidation("Minutes must be a positive number.");
      return;
    }

    setIsSaving(true);
    try {
      if (offering) {
        const targetPeriodIds = new Set(form.academic_period_ids);
        const existingMap = new Map<string, SubjectOfferingListItem>();
        for (const item of existingSubjectOfferings) {
          existingMap.set(String(item.academic_period.academic_period_id), item);
        }
        if (!existingMap.has(String(offering.academic_period.academic_period_id))) {
          existingMap.set(String(offering.academic_period.academic_period_id), offering);
        }

        for (const periodId of form.academic_period_ids) {
          if (!existingMap.has(periodId)) {
            try {
              await createSubjectOffering({
                subject_id: Number(form.subject_id),
                academic_year_id: Number(form.academic_year_id),
                academic_level_id: Number(form.academic_level_id),
                academic_period_id: Number(periodId),
                pathway: requiresPathway ? form.pathway : "general",
                minutes: parsedMinutes,
                status: form.status,
              });
            } catch {
              // Ignore duplicates if already existing
            }
          }
        }

        for (const [periodId, existingItem] of existingMap.entries()) {
          if (targetPeriodIds.has(periodId)) {
            await updateSubjectOffering(existingItem.subject_offering_id, {
              subject_id: Number(form.subject_id),
              academic_year_id: Number(form.academic_year_id),
              academic_level_id: Number(form.academic_level_id),
              academic_period_id: Number(periodId),
              pathway: requiresPathway ? form.pathway : "general",
              minutes: parsedMinutes,
              status: form.status,
            });
          } else {
            await archiveSubjectOffering(existingItem.subject_offering_id);
          }
        }

        const effectivePathway = requiresPathway ? form.pathway : "general";
        const savedMeta = {
          gradeValue: String(selectedLevel?.grade_level ?? ""),
          pathway: effectivePathway,
          academicYearId: Number(form.academic_year_id),
        };
        await onSaved({ message: `Updated offerings for ${offering.subject.subject_name}.`, ...savedMeta });
        onOpenChange(false);
      } else {
        let createdCount = 0;
        let skippedCount = 0;
        const errors: string[] = [];
        const effectivePathway = requiresPathway ? form.pathway : "general";

        for (const subjectId of selectedIds) {
          for (const periodId of selectedTermIds) {
            try {
              await createSubjectOffering({
                subject_id: Number(subjectId),
                academic_year_id: Number(form.academic_year_id),
                academic_level_id: Number(form.academic_level_id),
                academic_period_id: Number(periodId),
                pathway: effectivePathway,
                minutes: parsedMinutes,
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

        const savedMeta = {
          gradeValue: String(selectedLevel?.grade_level ?? ""),
          pathway: effectivePathway,
          academicYearId: Number(form.academic_year_id),
        };

        if (errors.length) {
          await onSaved({ message: summaryMessage(createdCount, skippedCount, errors.length), partialFailure: true, ...savedMeta });
          setError(`${summaryMessage(createdCount, skippedCount, errors.length)}. ${errors[0]}`);
        } else {
          await onSaved({ message: summaryMessage(createdCount, skippedCount, 0), ...savedMeta });
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
        <section className="p-4">
          <div className="flex flex-col gap-4">
            <div className="space-y-1 text-muted-foreground">
              <p className="text-sm">Current setup context</p>
              <p className="text-sm">{contextLabel}</p>
              <p className="text-xs">
                This offering will be added to the current active academic year. Change active year or active term in System Settings.
              </p>
            </div>
            <AdminValidationAlert message={error && !["Select setup details, at least one term, and at least one subject.", "No valid academic terms are available for the selected academic year.", "Select a valid pathway for the selected grade level.", "Minutes must be a positive number."].includes(error) ? error : null} attempt={validationAttempt} />
            {readOnly ? (
              <div className="rounded border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000]">
                <p className="font-bold">Read-only academic year</p>
                <p className="text-muted-foreground">{readOnlyReason}</p>
              </div>
            ) : null}

            <div className="rounded border-2 border-black p-3 shadow-[3px_3px_0_#000]">
              <h6 className="mb-3 font-bold">Offering Setup</h6>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-semibold" htmlFor="offering-level">Grade Level</label>
                  <Select
                    value={form.academic_level_id}
                    onValueChange={handleLevelChange}
                    disabled={!isCreateMode}
                  >
                    <Select.Trigger id="offering-level" aria-invalid={error === "Select setup details, at least one term, and at least one subject." && !form.academic_level_id} aria-describedby={error === "Select setup details, at least one term, and at least one subject." && !form.academic_level_id ? "offering-level-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
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
                  {error === "Select setup details, at least one term, and at least one subject." && !form.academic_level_id && <FormMessage id="offering-level-error">Select a grade level.</FormMessage>}
                  {!isCreateMode ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      Grade level is tied to the catalog subject and cannot be changed here.
                    </p>
                  ) : null}
                </div>
                {requiresPathway ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold" htmlFor="offering-pathway">Pathway</label>
                    <Select
                      value={form.pathway}
                      onValueChange={(value) => setField("pathway", value as SubjectOfferingPathway)}
                    >
                    <Select.Trigger id="offering-pathway" aria-invalid={error === "Select a valid pathway for the selected grade level."} aria-describedby={error === "Select a valid pathway for the selected grade level." ? "offering-pathway-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
                        <Select.Value placeholder="Select pathway" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {availablePathways.map((pathway) => {
                            const pathwayObj = options?.pathways.find((p) => p.code === pathway);
                            const label = pathwayObj?.name || pathwayLabel(pathway);
                            return (
                              <Select.Item key={pathway} value={pathway}>
                                {label}
                              </Select.Item>
                            );
                          })}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                    {error === "Select a valid pathway for the selected grade level." && <FormMessage id="offering-pathway-error">{error}</FormMessage>}
                  </div>
                ) : null}
                {isCreateMode ? (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold" htmlFor="create-offering-minutes">Duration (Minutes)</label>
                    <Input
                      id="create-offering-minutes"
                      aria-invalid={error === "Minutes must be a positive number."}
                      aria-describedby={error === "Minutes must be a positive number." ? "create-offering-minutes-error" : undefined}
                      type="number"
                      min={1}
                      value={form.minutes}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField("minutes", e.target.value)}
                      placeholder="e.g. 45, 60, 72, 96 (optional)"
                    />
                    {error === "Minutes must be a positive number." && <FormMessage id="create-offering-minutes-error">{error}</FormMessage>}
                    <p className="text-xs text-muted-foreground">Minutes per class period (optional now, required for publishing).</p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 md:col-span-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[2px_2px_0_#000]">
                    <Checkbox
                      checked={showAdvancedYear}
                      onCheckedChange={(checked) => setShowAdvancedYear(checked === true)}
                      className="mt-1 shrink-0"
                    />
                    <span>
                      <span className="block font-bold">Add to a different academic year</span>
                      <span className="text-xs text-muted-foreground">
                        Keep this off unless you are copying or correcting offerings outside the active setup.
                      </span>
                    </span>
                  </label>
                  {showAdvancedYear ? (
                    <div className="flex flex-col gap-1">
                      <label className="text-sm" htmlFor="offering-year">Academic Year</label>
                      <Select value={form.academic_year_id} onValueChange={handleYearChange}>
                        <Select.Trigger id="offering-year" aria-invalid={error === "Select setup details, at least one term, and at least one subject." && !form.academic_year_id} aria-describedby={error === "Select setup details, at least one term, and at least one subject." && !form.academic_year_id ? "offering-year-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
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
                      {error === "Select setup details, at least one term, and at least one subject." && !form.academic_year_id && <FormMessage id="offering-year-error">Select an academic year.</FormMessage>}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-col gap-2 md:col-span-2">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Term(s)</p>
                      {isJhsSelection ? (
                        <p className="text-xs text-muted-foreground">Junior High subjects usually continue across terms. Adjust if needed.</p>
                      ) : null}
                      {isShsSelection ? (
                        <p className="text-xs text-muted-foreground">Senior High subjects may be offered in selected term(s) depending on hours and curriculum mapping.</p>
                      ) : null}
                    </div>
                    {periods.length ? (
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
                          className={`flex items-center gap-3 rounded border-2 border-black p-3 shadow-[2px_2px_0_#000] ${isFallback ? "cursor-not-allowed bg-black/5 text-black/50" : "cursor-pointer bg-background"
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
                  {error === "No valid academic terms are available for the selected academic year." && <FormMessage>{error}</FormMessage>}
                  {error === "Select setup details, at least one term, and at least one subject." && !form.academic_period_ids.length && <FormMessage>Select at least one term.</FormMessage>}
                </div>
              </div>
            </div>

            {offering ? (
              <>
                <div className="space-y-1 text-muted-foreground">
                  <p className="text-xs">Subject Being Edited</p>
                  <p className="text-sm">{offering.subject.subject_name}</p>
                  <p className="text-xs">
                    Code: {offering.subject.subject_codename || "N/A"} • Grade: {offering.academic_level.level_name}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold" htmlFor="offering-minutes">Duration (Minutes)</label>
                    <Input
                      id="offering-minutes"
                      aria-invalid={error === "Minutes must be a positive number."}
                      aria-describedby={error === "Minutes must be a positive number." ? "offering-minutes-error" : undefined}
                      type="number"
                      min={1}
                      value={form.minutes}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setField("minutes", e.target.value)}
                      placeholder="e.g. 45, 60, 72, 96"
                    />
                    {error === "Minutes must be a positive number." && <FormMessage id="offering-minutes-error">{error}</FormMessage>}
                    <p className="text-xs text-muted-foreground">Minutes per period. Required for publishing.</p>
                  </div>
                  <div className="text-sm">
                    <strong>Grading Template:</strong> {offering?.subject.grading_template ?? "Set in Subject Catalog"}
                    <p className="text-xs text-muted-foreground">Change this in Add/Edit Subject.</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold" htmlFor="offering-status">Status</label>
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
                </div>
              </>
            ) : (
              <div className="rounded border-2 border-black p-3 shadow-[3px_3px_0_#000]">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h6 className="font-bold">Select Subjects</h6>
                    <p className="text-xs text-muted-foreground">Catalog subjects are filtered by the selected grade level.</p>
                  </div>
                </div>

                <SubjectPicker
                  subjects={subjects}
                  selectedSubjectIds={form.subject_ids}
                  onChange={handleSubjectSelectionChange}
                  searchPlaceholder="Search subjects for this grade"
                  alreadyOfferedSubjectIds={alreadyOfferedSubjectIds}
                />
                {error === "Select setup details, at least one term, and at least one subject." && !form.subject_ids.length && <FormMessage>Select at least one subject.</FormMessage>}
              </div>
            )}

          </div>
        </section>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isSaving || !options || readOnly} title={readOnly ? readOnlyReason : undefined}>
            {offering ? "Save Offering" : "Add Offerings"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
