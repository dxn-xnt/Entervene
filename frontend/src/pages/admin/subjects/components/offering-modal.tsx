import { activeFirst } from "@/lib/active-first";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { Button } from "@/components/retroui/Button";
import { Accordion } from "@/components/retroui/Accordion";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Alert } from "@/components/retroui/Alert";
import { Text } from "@/components/retroui/Text";
import { FormMessage, NoChangesMessage } from "@/components/retroui/FormMessage";
import { useEditFormChanges } from "@/hooks/use-edit-form-changes";
import { optionalNumber, unorderedValues } from "@/lib/form-changes";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import { LoadingPanel } from "@/components/loading-panel";
import { formatPeriodLabel } from "@/lib/academic-periods";
import {
  archiveSubjectOffering,
  createSubjectOffering,
  createSubjectOfferingsBatch,
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

const COMMON_DURATIONS = [45, 60, 72, 96] as const;

function DurationSelect({ id, value, onChange, invalid, describedBy }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  const [custom, setCustom] = useState(false);
  const isPreset = COMMON_DURATIONS.some((minutes) => String(minutes) === value);
  const customMode = custom || Boolean(value && !isPreset);
  return (
    <>
      <Select value={customMode ? "custom" : value || undefined} onValueChange={(next) => {
        setCustom(next === "custom");
        onChange(next === "custom" ? "" : next);
      }}>
        <Select.Trigger id={id} className="w-full" aria-invalid={invalid} aria-describedby={describedBy}>
          <Select.Value placeholder="Select duration" />
        </Select.Trigger>
        <Select.Content>
          <Select.Group>
            {COMMON_DURATIONS.map((minutes) => <Select.Item key={minutes} value={String(minutes)}>{minutes} minutes</Select.Item>)}
            <Select.Item value="custom">Custom duration</Select.Item>
          </Select.Group>
        </Select.Content>
      </Select>
      {customMode && <Input type="number" min={1} step={1} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Enter minutes" aria-label="Custom duration in minutes" aria-invalid={invalid} aria-describedby={describedBy} />}
    </>
  );
}
const pathwayScopesOverlap = (existingIds: number[], targetIds: number[]) =>
  !existingIds.length
  || !targetIds.length
  || existingIds.some((pathwayId) => targetIds.includes(pathwayId));

export function OfferingModal({
  open,
  onOpenChange,
  options,
  offering,
  catalogSubjects,
  readOnly = false,
  readOnlyReason,
  defaultAcademicYearId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SubjectOfferingFormOptions | null;
  offering: SubjectOfferingListItem | null;
  catalogSubjects: SubjectListItem[];
  readOnly?: boolean;
  readOnlyReason?: string;
  defaultAcademicYearId?: number | null;
  onSaved: (meta?: {
    message?: string;
    partialFailure?: boolean;
    gradeValue?: string;
    pathway?: SubjectOfferingPathway;
    academicYearId?: number;
  }) => Promise<void>;
}) {
  const [existingSubjectOfferings, setExistingSubjectOfferings] = useState<SubjectOfferingListItem[]>([]);
  const [isLoadingEligibility, setIsLoadingEligibility] = useState(false);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const eligibilityRequestIdRef = useRef(0);
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
    grading_template_id: "",
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

  const effectivePathwayForSubject = useCallback(
    (subject: SubjectListItem): SubjectOfferingPathway =>
      subject.is_core ? "general" : (requiresPathway ? form.pathway : "general"),
    [form.pathway, requiresPathway],
  );
  const pathwayIdsForCode = useCallback((pathway: string) => {
    if (!pathway || pathway === "general") return [];
    if (pathway === "both") return (options?.pathways ?? []).map((item) => item.id);
    const normalized = pathway.toLocaleLowerCase();
    const match = (options?.pathways ?? []).find((item) => {
      const code = item.code.toLocaleLowerCase();
      if (code === normalized) return true;
      if (normalized === "stem_medical") return code.includes("medical");
      if (normalized === "stem_engineering") return code.includes("engineering");
      return false;
    });
    return match ? [match.id] : [];
  }, [options?.pathways]);
  const targetPathwayIdsForSubject = useCallback(
    (subject: SubjectListItem) => pathwayIdsForCode(effectivePathwayForSubject(subject)),
    [effectivePathwayForSubject, pathwayIdsForCode],
  );
  const periodLabelById = useMemo(
    () => new Map(periods.map((period) => [String(period.academic_period_id), formatPeriodLabel(period)])),
    [periods],
  );
  const availabilityBySubjectId = useMemo(() => {
    const availability = new Map<string, { disabled: boolean; status: string }>();
    if (!form.academic_period_ids.length) return availability;
    for (const subject of subjects) {
      const subjectId = String(subject.subject_id);
      const targetPathwayIds = targetPathwayIdsForSubject(subject);
      const occupiedPeriodIds = new Set(
        existingSubjectOfferings
          .filter((item) => item.subject.subject_id === subject.subject_id)
          .filter((item) => pathwayScopesOverlap(
            item.pathway_ids ?? pathwayIdsForCode(item.pathway),
            targetPathwayIds,
          ))
          .map((item) => String(item.academic_period.academic_period_id)),
      );
      const alreadyOffered = form.academic_period_ids.filter((periodId) => occupiedPeriodIds.has(periodId));
      const missing = form.academic_period_ids.filter((periodId) => !occupiedPeriodIds.has(periodId));
      if (!alreadyOffered.length) continue;
      if (!missing.length) {
        availability.set(subjectId, {
          disabled: true,
          status: "Already offered in all selected terms.",
        });
      } else {
        availability.set(subjectId, {
          disabled: false,
          status: `Already offered: ${alreadyOffered.map((id) => periodLabelById.get(id) ?? id).join(", ")} · Will add: ${missing.map((id) => periodLabelById.get(id) ?? id).join(", ")}.`,
        });
      }
    }
    return availability;
  }, [existingSubjectOfferings, form.academic_period_ids, pathwayIdsForCode, periodLabelById, subjects, targetPathwayIdsForSubject]);
  const missingOfferingItems = useMemo(() => {
    const byId = new Map(subjects.map((subject) => [String(subject.subject_id), subject]));
    return form.subject_ids.flatMap((subjectId) => {
      const subject = byId.get(subjectId);
      if (!subject) return [];
      const targetPathway = effectivePathwayForSubject(subject);
      const targetPathwayIds = targetPathwayIdsForSubject(subject);
      return form.academic_period_ids
        .filter((periodId) => !existingSubjectOfferings.some(
          (item) => item.subject.subject_id === subject.subject_id
            && String(item.academic_period.academic_period_id) === periodId
            && pathwayScopesOverlap(
              item.pathway_ids ?? pathwayIdsForCode(item.pathway),
              targetPathwayIds,
            ),
        ))
        .map((periodId) => ({
          subject_id: subject.subject_id,
          academic_period_id: Number(periodId),
          pathway: targetPathway,
        }));
    });
  }, [effectivePathwayForSubject, existingSubjectOfferings, form.academic_period_ids, form.subject_ids, pathwayIdsForCode, subjects, targetPathwayIdsForSubject]);
  const duplicateCatalogLabels = useMemo(() => {
    const keys = new Map<string, string>();
    const duplicates = new Set<string>();
    for (const subject of subjects) {
      const normalizedCode = subject.subject_codename?.replace(/\s+/g, "").toLocaleLowerCase();
      const normalizedName = subject.subject_name.replace(/\s+/g, "").toLocaleLowerCase();
      for (const key of [normalizedCode ? `code:${normalizedCode}` : "", `name:${normalizedName}`].filter(Boolean)) {
        const previous = keys.get(key);
        if (previous) duplicates.add(`${previous} / ${subject.subject_name}`);
        else keys.set(key, subject.subject_name);
      }
    }
    return [...duplicates];
  }, [subjects]);

  useEffect(() => {
    if (!open) {
      setExistingSubjectOfferings([]);
      setEligibilityError(null);
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
            (o) => o.subject.subject_id === offering.subject.subject_id
              && o.status === "active"
              && o.pathway === offering.pathway
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
            grading_template_id: String(offering.subject.grading_template_id),
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
            grading_template_id: String(offering.subject.grading_template_id),
          });
        });

      return () => {
        isMounted = false;
      };
    }

    const activeYear = options?.academic_years.find(
      (year) => year.academic_year_id === defaultAcademicYearId,
    ) ?? options?.academic_years.find((year) => year.is_active) ?? options?.academic_years[0];
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
      grading_template_id: "",
      });
  }, [catalogSubjects, defaultAcademicYearId, gradeLevels, offering, open, options]);

  // In create mode, fetch active offerings for the selected year and grade.
  // Eligibility is then resolved per selected term and overlapping pathway.
  // The isMounted cleanup flag handles both unmount and stale responses from rapid
  // grade/year switches (each effect invocation owns its own isMounted closure).
  useEffect(() => {
    if (!open || offering) return;
    if (!selectedYearId || !selectedLevelId) {
      setExistingSubjectOfferings([]);
      return;
    }
    const requestId = ++eligibilityRequestIdRef.current;
    setIsLoadingEligibility(true);
    setEligibilityError(null);
    getSubjectOfferings({
      academic_year_id: selectedYearId,
      academic_level_id: selectedLevelId,
      status: "active",
    })
      .then((res) => {
        if (requestId !== eligibilityRequestIdRef.current) return;
        setExistingSubjectOfferings(res.subject_offerings);
      })
      .catch((caught) => {
        if (requestId !== eligibilityRequestIdRef.current) return;
        setExistingSubjectOfferings([]);
        setEligibilityError(caught instanceof Error ? caught.message : "Unable to check existing offerings.");
      })
      .finally(() => {
        if (requestId === eligibilityRequestIdRef.current) setIsLoadingEligibility(false);
      });
    return () => {
      eligibilityRequestIdRef.current += 1;
    };
  }, [open, offering, selectedYearId, selectedLevelId]);

  const setField = <TKey extends keyof OfferingFormState>(key: TKey, value: OfferingFormState[TKey]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if ((key === "pathway" && error === "Select a valid pathway for the selected grade level.") || (key === "minutes" && error === "Minutes must be a positive whole number." && Number.isInteger(Number(value)) && Number(value) > 0)) setError(null);
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

  const changes = useEditFormChanges({
    enabled: !!offering,
    resetKey: `${open}:${offering?.subject_offering_id}`,
    initialValues: offering ? [
      String(offering.subject.subject_id), String(offering.academic_year.academic_year_id),
      String(offering.academic_level.academic_level_id),
      unorderedValues(existingSubjectOfferings.length ? existingSubjectOfferings.map(item => String(item.academic_period.academic_period_id)) : [String(offering.academic_period.academic_period_id)]),
      offering.pathway, optionalNumber(offering.minutes), offering.status,
      String(offering.subject.grading_template_id),
    ] : null,
    values: [form.subject_id, form.academic_year_id, form.academic_level_id,
      unorderedValues(form.academic_period_ids), requiresPathway ? form.pathway : "general",
      optionalNumber(form.minutes), form.status, form.grading_template_id],
  });
  const handleSubmit = async () => {
    if (!changes.guardChanges()) return;
    setError(null);
    if (readOnly) {
      failValidation(readOnlyReason ?? "Historical academic years are locked in the UI to protect historical records.");
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
    if (parsedMinutes === null || !Number.isInteger(parsedMinutes) || parsedMinutes <= 0) {
      failValidation("Minutes must be a positive whole number.");
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
              grading_template_id: Number(form.grading_template_id),
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
        const effectivePathway = requiresPathway ? form.pathway : "general";
        if (!missingOfferingItems.length) {
          failValidation("The selected subjects are already offered in all selected terms.");
          return;
        }
        const result = await createSubjectOfferingsBatch({
          academic_year_id: Number(form.academic_year_id),
          academic_level_id: Number(form.academic_level_id),
          items: missingOfferingItems,
          minutes: parsedMinutes,
          status: form.status,
        });

        const savedMeta = {
          gradeValue: String(selectedLevel?.grade_level ?? ""),
          pathway: effectivePathway,
          academicYearId: Number(form.academic_year_id),
        };
        await onSaved({
          message: `${result.created_count} subject offering${result.created_count === 1 ? "" : "s"} created.`,
          ...savedMeta,
        });
        onOpenChange(false);
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
                This offering will be added to the selected academic year. Use the year selector or the advanced option below to change context.
              </p>
            </div>
            <AdminValidationAlert message={error && !["Select setup details, at least one term, and at least one subject.", "No valid academic terms are available for the selected academic year.", "Select a valid pathway for the selected grade level.", "Minutes must be a positive whole number."].includes(error) ? error : null} attempt={validationAttempt} />
            {readOnly ? (
              <div className="rounded! border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[3px_3px_0_#000]">
                <p className="font-bold">Read-only academic year</p>
                <p className="text-muted-foreground">{readOnlyReason}</p>
              </div>
            ) : null}

            <div className="rounded! border-2 border-black p-3 shadow-[3px_3px_0_#000]">
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
                    <label className="text-sm font-semibold" htmlFor="create-offering-minutes">Duration (Minutes) <span className="text-red-500">*</span></label>
                    <DurationSelect
                      id="create-offering-minutes"
                      value={form.minutes}
                      onChange={(value) => setField("minutes", value)}
                      invalid={error === "Minutes must be a positive whole number."}
                      describedBy={error === "Minutes must be a positive whole number." ? "create-offering-minutes-error" : undefined}
                    />
                    {error === "Minutes must be a positive whole number." && <FormMessage id="create-offering-minutes-error">{error}</FormMessage>}
                    <p className="text-xs text-muted-foreground">Minutes per class period for all selected terms. Required for scheduling.</p>
                  </div>
                ) : null}
                <div className="flex flex-col gap-2 md:col-span-2">
                  <label className="flex cursor-pointer items-start gap-3 rounded! border-2 border-black bg-[#fff7d6] p-3 text-sm shadow-[2px_2px_0_#000]">
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
                            {activeFirst(options?.academic_years).map((year) => (
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
                      <Button type="button" size="sm" variant="outline" className="gap-2" onClick={toggleAllTerms}>
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
                          className={`flex items-center gap-3 rounded! border-2 border-black p-3 shadow-[2px_2px_0_#000] ${isFallback ? "cursor-not-allowed bg-black/5 text-black/50" : "cursor-pointer bg-background"
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
                    <Alert status="warning">
                      <Alert.Title className="font-bold">Academic year setup incomplete</Alert.Title>
                      <Alert.Description>
                        No valid terms are configured for {selectedYear?.year_label ?? "the selected academic year"}. Configure its academic periods before adding offerings.
                      </Alert.Description>
                    </Alert>
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
                    <DurationSelect
                      id="offering-minutes"
                      value={form.minutes}
                      onChange={(value) => setField("minutes", value)}
                      invalid={error === "Minutes must be a positive whole number."}
                      describedBy={error === "Minutes must be a positive whole number." ? "offering-minutes-error" : undefined}
                    />
                    {error === "Minutes must be a positive whole number." && <FormMessage id="offering-minutes-error">{error}</FormMessage>}
                    <p className="text-xs text-muted-foreground">Minutes per period. Required for publishing.</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-semibold" htmlFor="offering-grading-template">Grading Template</label>
                    <Select
                      value={form.grading_template_id}
                      onValueChange={(value) => setField("grading_template_id", value)}
                      disabled={offering.subject.grading_template_assignment_locked}
                    >
                      <Select.Trigger id="offering-grading-template" className="w-full">
                        <Select.Value placeholder="Select template" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Group>
                          {(options?.grading_templates ?? []).map((template) => (
                            <Select.Item
                              key={template.grading_template_id}
                              value={String(template.grading_template_id)}
                            >
                              {template.template_name}
                            </Select.Item>
                          ))}
                        </Select.Group>
                      </Select.Content>
                    </Select>
                    <p className="text-xs text-muted-foreground">Applies to every term and pathway in {offering.academic_year.year_label}.</p>
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
                {offering.subject.grading_template_assignment_locked ? (
                  <Alert status="warning" className="md:col-span-3 py-3">
                    <Alert.Title className="font-bold">Grading template locked</Alert.Title>
                    <Alert.Description className="text-sm text-yellow-950">
                      {offering.subject.grading_template_assignment_lock_reason}
                    </Alert.Description>
                  </Alert>
                ) : null}
              </>
            ) : (
              <Accordion>
                <Accordion.Item value="subjects" className="rounded! border-border shadow-none!">
                  <Accordion.Header className="items-center py-3 text-sm font-normal">
                    {form.subject_ids.length ? `${form.subject_ids.length} subjects selected` : "Select Subjects"}
                  </Accordion.Header>
                  <Accordion.Content>
                    <p className="mb-3 text-sm text-muted-foreground">Catalog subjects are filtered by the selected grade level.</p>
                {duplicateCatalogLabels.length ? (
                  <Alert status="warning" className="mb-3 py-3">
                    <Alert.Title className="font-bold">Possible duplicate catalog subjects</Alert.Title>
                    <Alert.Description className="text-sm">
                      Review these separate catalog records before assigning offerings: {duplicateCatalogLabels.join(", ")}.
                    </Alert.Description>
                  </Alert>
                ) : null}
                {eligibilityError ? (
                  <Alert status="error">
                    <Alert.Title className="font-bold">Unable to check offering availability</Alert.Title>
                    <Alert.Description>{eligibilityError}</Alert.Description>
                  </Alert>
                ) : isLoadingEligibility ? (
                  <LoadingPanel label="Checking existing offerings..." className="w-full" />
                ) : (
                  <SubjectPicker
                    showSelectedChips={false}
                    subjects={subjects}
                    selectedSubjectIds={form.subject_ids}
                    onChange={handleSubjectSelectionChange}
                    searchPlaceholder="Search subjects for this grade"
                    availabilityBySubjectId={availabilityBySubjectId}
                  />
                )}
                  </Accordion.Content>
                </Accordion.Item>
                {error === "Select setup details, at least one term, and at least one subject." && !form.subject_ids.length && <FormMessage>Select at least one subject.</FormMessage>}
              </Accordion>
            )}

          </div>
        </section>
        <Dialog.Footer>
          <NoChangesMessage message={changes.noChangesMessage} />
          <Button variant="outline" className="gap-2" onClick={() => onOpenChange(false)} disabled={isSaving}>Cancel</Button>
          <Button
            className="gap-2"
            onClick={handleSubmit}
            disabled={
              isSaving
              || !options
              || readOnly
              || (isCreateMode && (
                isLoadingEligibility
                || Boolean(eligibilityError)
                || !periods.length
                || !missingOfferingItems.length
              ))
              || (!!offering && !changes.hasChanges)
            }
            title={readOnly ? readOnlyReason : undefined}
          >
            {offering ? "Save Offering" : "Add Offerings"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
