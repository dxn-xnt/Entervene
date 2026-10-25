import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/admin/button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { FormMessage } from "@/components/retroui/FormMessage";
import { AdminValidationAlert } from "@/components/admin/AdminValidationAlert";
import {
  copySubjectOfferingsFromAcademicYear,
  type SubjectOfferingCopyAcademicYearResult,
  type SubjectOfferingFormOptions,
} from "@/lib/api";

export function CopyPreviousYearSetupModal({
  open,
  onOpenChange,
  options,
  defaultSourceAcademicYearId,
  onCopied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: SubjectOfferingFormOptions | null;
  defaultSourceAcademicYearId?: number;
  onCopied: (result: SubjectOfferingCopyAcademicYearResult) => Promise<void>;
}) {
  const [sourceAcademicYearId, setSourceAcademicYearId] = useState("");
  const [targetAcademicYearId, setTargetAcademicYearId] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);

  const activeYears = useMemo(
    () => options?.academic_years.filter((year) => year.is_active) ?? [],
    [options?.academic_years]
  );
  const targetYears = activeYears;
  const selectedTargetYearId = Number(targetAcademicYearId);
  const sourceYears = useMemo(() => {
    const years = options?.academic_years ?? [];
    const inactiveYears = years.filter((year) => !year.is_active && year.academic_year_id !== selectedTargetYearId);
    return inactiveYears.length
      ? inactiveYears
      : years.filter((year) => year.academic_year_id !== selectedTargetYearId);
  }, [options?.academic_years, selectedTargetYearId]);

  useEffect(() => {
    if (!open) return;
    const defaultTarget = activeYears[0];
    const sourceCandidates = options?.academic_years.filter((year) =>
      year.academic_year_id !== defaultTarget?.academic_year_id
    ) ?? [];
    const defaultSource = sourceCandidates.find((year) => year.academic_year_id === defaultSourceAcademicYearId)
      ?? sourceCandidates.find((year) => !year.is_active)
      ?? sourceCandidates[0];

    setTargetAcademicYearId(defaultTarget ? String(defaultTarget.academic_year_id) : "");
    setSourceAcademicYearId(defaultSource ? String(defaultSource.academic_year_id) : "");
    setOverwriteExisting(false);
    setError(null);
  }, [activeYears, defaultSourceAcademicYearId, open, options?.academic_years]);

  const handleCopy = async () => {
    setError(null);
    if (!sourceAcademicYearId || !targetAcademicYearId) {
      setError("Select a source academic year and active target academic year.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }
    if (sourceAcademicYearId === targetAcademicYearId) {
      setError("Source and target academic years must be different.");
      setValidationAttempt((attempt) => attempt + 1);
      return;
    }

    setIsCopying(true);
    try {
      const result = await copySubjectOfferingsFromAcademicYear({
        source_academic_year_id: Number(sourceAcademicYearId),
        target_academic_year_id: Number(targetAcademicYearId),
        overwrite_existing: overwriteExisting,
      });
      await onCopied(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to copy previous year setup.");
    } finally {
      setIsCopying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="2xl">
        <Dialog.Header asChild>
          <div className="flex w-full items-center justify-between">
            <Text as="h5" className="font-sans text-xl font-bold">
              Copy Previous Year Setup
            </Text>
          </div>
        </Dialog.Header>
        <section className="flex flex-col gap-4 p-4">
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>This copies subject offerings only.</p>
            <p>
              It does not copy teachers, classes, grades, submissions, or predictions.
            </p>
          </div>
          <AdminValidationAlert message={error} attempt={validationAttempt} firstInvalidFieldId={!sourceAcademicYearId ? "copy-source-year" : !targetAcademicYearId || sourceAcademicYearId === targetAcademicYearId ? "copy-target-year" : undefined} />

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm" htmlFor="copy-source-year">Source Academic Year</label>
              <Select value={sourceAcademicYearId} onValueChange={(value) => { setSourceAcademicYearId(value); setError(null); }}>
                <Select.Trigger id="copy-source-year" aria-invalid={!!error && !sourceAcademicYearId} aria-describedby={error && !sourceAcademicYearId ? "copy-source-year-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
                  <Select.Value placeholder="Select previous year" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {sourceYears.map((year) => (
                      <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                        {year.year_label}{year.is_active ? " (active)" : ""}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
              {error && !sourceAcademicYearId && <FormMessage id="copy-source-year-error">Select a source academic year.</FormMessage>}
              <p className="text-xs text-muted-foreground">Previous or inactive years are allowed as the copy source.</p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm" htmlFor="copy-target-year">Target Academic Year</label>
              <Select
                value={targetAcademicYearId}
                onValueChange={(value) => { setTargetAcademicYearId(value); setError(null); }}
                disabled={targetYears.length <= 1}
              >
                <Select.Trigger id="copy-target-year" aria-invalid={!!error && (!targetAcademicYearId || sourceAcademicYearId === targetAcademicYearId)} aria-describedby={error && (!targetAcademicYearId || sourceAcademicYearId === targetAcademicYearId) ? "copy-target-year-error" : undefined} className="w-full aria-[invalid=true]:border-destructive">
                  <Select.Value placeholder="Select active year" />
                </Select.Trigger>
                <Select.Content>
                  <Select.Group>
                    {targetYears.map((year) => (
                      <Select.Item key={year.academic_year_id} value={String(year.academic_year_id)}>
                        {year.year_label}
                      </Select.Item>
                    ))}
                  </Select.Group>
                </Select.Content>
              </Select>
              {error && (!targetAcademicYearId || sourceAcademicYearId === targetAcademicYearId) && <FormMessage id="copy-target-year-error">{sourceAcademicYearId === targetAcademicYearId ? "Choose a different target year." : "Select an active target year."}</FormMessage>}
              <p className="text-xs text-muted-foreground">Target year must be active. Future terms remain editable.</p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded border-2 border-black bg-background p-3 text-sm shadow-[2px_2px_0_#000]">
            <Checkbox
              checked={overwriteExisting}
              onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
              className="mt-1 shrink-0"
            />
            <span>
              <span className="block font-bold">Overwrite existing offerings</span>
              <span className="text-xs text-muted-foreground">
                Updates exact matching target offerings. Extra target offerings are not deleted.
              </span>
            </span>
          </label>

        </section>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>Cancel</Button>
          <Button onClick={handleCopy} disabled={isCopying || !options || !sourceYears.length || !targetYears.length}>
            Copy Previous Year Setup
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
