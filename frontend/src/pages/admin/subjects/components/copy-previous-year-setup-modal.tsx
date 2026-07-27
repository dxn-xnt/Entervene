import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
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
      return;
    }
    if (sourceAcademicYearId === targetAcademicYearId) {
      setError("Source and target academic years must be different.");
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
          <div className="rounded-lg border-2 border-black bg-[#fff1b8] p-3 text-sm shadow-[3px_3px_0_#000]">
            <p className="font-bold">This copies subject offerings only.</p>
            <p className="text-black/70">
              It does not copy teachers, classes, grades, submissions, or predictions.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm" htmlFor="copy-source-year">Source Academic Year</label>
              <Select value={sourceAcademicYearId} onValueChange={setSourceAcademicYearId}>
                <Select.Trigger id="copy-source-year" className="w-full">
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
              <p className="text-xs text-black/70">Previous or inactive years are allowed as the copy source.</p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm" htmlFor="copy-target-year">Target Academic Year</label>
              <Select
                value={targetAcademicYearId}
                onValueChange={setTargetAcademicYearId}
                disabled={targetYears.length <= 1}
              >
                <Select.Trigger id="copy-target-year" className="w-full">
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
              <p className="text-xs text-black/70">Target year must be active. Future terms remain editable.</p>
            </div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-md border-2 border-black bg-background p-3 text-sm shadow-[2px_2px_0_#000]">
            <Checkbox
              checked={overwriteExisting}
              onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
              className="mt-1 shrink-0"
            />
            <span>
              <span className="block font-bold">Overwrite existing offerings</span>
              <span className="text-xs text-black/70">
                Updates exact matching target offerings. Extra target offerings are not deleted.
              </span>
            </span>
          </label>

          {error ? <p className="text-sm font-semibold text-red-700">{error}</p> : null}
        </section>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCopying}>Cancel</Button>
          <Button onClick={handleCopy} disabled={isCopying || !options || !sourceYears.length || !targetYears.length}>
            {isCopying ? "Copying..." : "Copy Previous Year Setup"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
