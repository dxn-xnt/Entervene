"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, CheckCircle2, ShieldCheck } from "lucide-react";
import { useAcademicPeriod, type AcademicYearItem } from "@/context/AcademicPeriodContext";
import { isChronologicallyEarlierYear, invalidateReusableSetupCache } from "@/lib/academic-year-chronology";
import {
  type AcademicYearSetupMode,
  type AcademicYearSetupResponse,
  setupAcademicYearClasses,
} from "@/lib/api";
import { Button } from "@/components/admin/button";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { Alert } from "@/components/retroui/Alert";
import { useToast } from "@/components/retroui/Toast";

export type SetupYearStep = "configure" | "confirm" | "success";

interface SetupYearWizardProps {
  step?: SetupYearStep;
  onStepChange?: (step: SetupYearStep) => void;
  onBack: () => void;
  onClose: () => void;
  onClassesCreated?: () => void;
  sourceYears?: AcademicYearItem[];
}

export default function SetupYearWizard({
  step: externalStep,
  onStepChange,
  onBack,
  onClose,
  onClassesCreated,
  sourceYears,
}: SetupYearWizardProps) {
  const { selectedYearId, selectedYear, academicYears } = useAcademicPeriod();
  const toast = useToast();

  const targetYearId = selectedYearId;
  const targetYearLabel = selectedYear?.year_label ?? `Academic Year ${targetYearId ?? ""}`;

  const availableSourceYears = useMemo(() => {
    if (sourceYears) return sourceYears;
    if (!selectedYear) return [];
    return (academicYears ?? []).filter((y) => isChronologicallyEarlierYear(y, selectedYear));
  }, [sourceYears, academicYears, selectedYear]);

  const defaultSourceYearId = useMemo(() => {
    const active = availableSourceYears.find((y) => y.is_active);
    if (active) return String(active.academic_year_id);
    return availableSourceYears.length > 0 ? String(availableSourceYears[0].academic_year_id) : "";
  }, [availableSourceYears]);

  const [sourceYearId, setSourceYearId] = useState<string>(defaultSourceYearId);

  useEffect(() => {
    if (!availableSourceYears.some((y) => String(y.academic_year_id) === sourceYearId)) {
      setSourceYearId(defaultSourceYearId);
    }
  }, [availableSourceYears, defaultSourceYearId, sourceYearId]);

  const [mode, setMode] = useState<AcademicYearSetupMode>("retain_classes_and_advisers");
  const [internalStep, setInternalStep] = useState<SetupYearStep>("configure");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupResult, setSetupResult] = useState<AcademicYearSetupResponse | null>(null);

  const currentStep = externalStep ?? internalStep;
  const changeStep = (nextStep: SetupYearStep) => {
    setInternalStep(nextStep);
    onStepChange?.(nextStep);
  };

  const selectedSourceYear = availableSourceYears.find((y) => String(y.academic_year_id) === sourceYearId);
  const sourceYearLabel = selectedSourceYear?.year_label ?? (sourceYearId ? `Academic Year ${sourceYearId}` : "Not selected");

  const modeDescriptions: Record<AcademicYearSetupMode, { title: string; subtitle: string }> = {
    sections_only: {
      title: "Sections Only",
      subtitle: "Copy official section names for each grade. Classes and advisers will be created manually.",
    },
    retain_classes_and_advisers: {
      title: "Retain Classes and Advisers",
      subtitle: "Copy sections and create independent new classes with eligible advisers carried over from previous year.",
    },
    retain_classes_without_advisers: {
      title: "Retain Classes Without Advisers",
      subtitle: "Copy sections and create independent new classes with unassigned advisers for you to assign later.",
    },
  };

  async function handleConfirmSetup() {
    if (!targetYearId) {
      setError("No target academic year selected. Please select a viewing year in the sidebar.");
      return;
    }
    if (!sourceYearId) {
      setError("Please select a source academic year.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await setupAcademicYearClasses({
        source_academic_year_id: Number(sourceYearId),
        target_academic_year_id: targetYearId,
        mode,
      });

      invalidateReusableSetupCache(targetYearId);
      setSetupResult(result);
      changeStep("success");
      toast.success({
        title: "Academic year setup completed",
        description: `${result.sections_created} section(s) and ${result.classes_created} class(es) created.`,
      });
      onClassesCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to set up academic year classes.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (currentStep === "success" && setupResult) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center justify-center gap-3 py-4 text-center">
          <div className="flex size-12 items-center justify-center rounded-full border-2 border-black bg-primary text-black">
            <CheckCircle2 className="size-6" />
          </div>
          <div>
            <Text as="h4" className="font-sans text-xl font-bold">
              Setup Completed Successfully
            </Text>
            <p className="mt-1 text-sm text-muted-foreground">
              Sections and classes have been established for {targetYearLabel}.
            </p>
          </div>
        </div>

        <div className="rounded border-2 border-border bg-card p-4 text-sm shadow-sm space-y-2">
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Sections created:</span>
            <span className="font-bold">{setupResult.sections_created}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Sections reused:</span>
            <span className="font-bold">{setupResult.sections_reused}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Classes created:</span>
            <span className="font-bold">{setupResult.classes_created}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Classes reused:</span>
            <span className="font-bold">{setupResult.classes_reused}</span>
          </div>
        </div>

        <div className="flex justify-end pt-4 border-t">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  if (currentStep === "confirm") {
    return (
      <div className="flex flex-col gap-4">
        {error && (
          <Alert status="error">
            {error}
          </Alert>
        )}

        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Review the setup configuration before applying changes to <span className="font-semibold text-foreground">{targetYearLabel}</span>.
          </p>
        </div>

        <div className="rounded border-2 border-border bg-card p-4 text-sm shadow-sm space-y-3">
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Source Academic Year:</span>
            <span className="font-bold">{sourceYearLabel}</span>
          </div>
          <div className="flex justify-between border-b pb-2">
            <span className="text-muted-foreground">Target Academic Year:</span>
            <span className="font-bold text-primary">{targetYearLabel}</span>
          </div>
          <div className="flex flex-col gap-1 border-b pb-2">
            <span className="text-muted-foreground">Setup Mode:</span>
            <span className="font-bold">{modeDescriptions[mode].title}</span>
            <span className="text-xs text-muted-foreground">{modeDescriptions[mode].subtitle}</span>
          </div>

          <div className="rounded border border-black/10 bg-muted/40 p-3 space-y-1 text-xs">
            <p className="font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck className="size-4 text-primary" /> Data Safety Guarantees
            </p>
            <p className="text-muted-foreground">• Student enrollments and grades are never copied.</p>
            <p className="text-muted-foreground">• Subject Loads are not carried over; assign loads cleanly in Studio.</p>
            <p className="text-muted-foreground">• Source-year records ({sourceYearLabel}) remain completely unmodified.</p>
            <p className="text-muted-foreground">• Repeated setup is idempotent and will not create duplicates.</p>
          </div>
        </div>

        <div className="flex justify-between pt-4 border-t">
          <Button
            variant="outline"
            onClick={() => changeStep("configure")}
            disabled={isSubmitting}
            className="gap-2"
          >
            <ArrowLeft className="size-4" /> Back to Configuration
          </Button>
          <Button
            onClick={handleConfirmSetup}
            disabled={isSubmitting}
            className="gap-2"
          >
            {isSubmitting ? "Setting up..." : "Confirm & Set Up"}
          </Button>
        </div>
      </div>
    );
  }

  // Configuration step (currentStep === "configure")
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert status="error">
          {error}
        </Alert>
      )}

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Carry forward section names and optionally classes into <span className="font-semibold text-foreground">{targetYearLabel}</span>.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="source-year-select" className="text-sm font-semibold">
          Source Academic Year <span className="text-red-500">*</span>
        </label>
        {availableSourceYears.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No chronologically earlier academic years exist with reusable sections or classes.
          </p>
        ) : (
          <Select
            value={sourceYearId}
            onValueChange={(val) => {
              setSourceYearId(val);
              setError(null);
            }}
          >
            <Select.Trigger id="source-year-select" className="w-full">
              <Select.Value placeholder="Select source academic year" />
            </Select.Trigger>
            <Select.Content>
              <Select.Group>
                {availableSourceYears.map((year) => (
                  <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                    {year.year_label} {year.is_active ? "(Active)" : ""}
                  </Select.Item>
                ))}
              </Select.Group>
            </Select.Content>
          </Select>
        )}
        <p className="text-xs text-muted-foreground">
          Select which academic year’s configuration to use as a baseline.
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-2">
        <label className="text-sm font-semibold">
          Setup Mode <span className="text-red-500">*</span>
        </label>
        <div className="grid gap-3">
          {(["retain_classes_and_advisers", "retain_classes_without_advisers", "sections_only"] as const).map((m) => {
            const isSelected = mode === m;
            const item = modeDescriptions[m];
            return (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex flex-col items-start gap-1 rounded border-2 p-3 text-left transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10 shadow-sm"
                    : "border-border bg-background hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <span className="font-bold text-sm text-foreground">{item.title}</span>
                  {isSelected && <Check className="size-4 text-primary" />}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{item.subtitle}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack} className="gap-2">
          <ArrowLeft className="size-4" /> Back
        </Button>
        <Button
          onClick={() => {
            if (!sourceYearId) {
              setError("Please select a source academic year.");
              return;
            }
            setError(null);
            changeStep("confirm");
          }}
          disabled={!sourceYearId || availableSourceYears.length === 0}
        >
          Continue to Summary
        </Button>
      </div>
    </div>
  );
}
