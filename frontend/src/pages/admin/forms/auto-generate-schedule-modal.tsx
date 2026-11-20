"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "@/components/retroui/Alert";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { SegmentedControl } from "@/components/retroui/SegmentedControl";
import { Table } from "@/components/retroui/Table";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/pages/admin/subjects/components/empty-state-card";
import {
  autoScheduleSubjectLoads,
  type AutoScheduleDecisionItem,
  type AutoScheduleResponse,
  type SubjectLoadItem,
  type SubjectLoadStudioData,
} from "@/lib/api";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Save,
  SkipForward,
  Sparkles,
} from "lucide-react";

export type AutoGenerateScope = "section" | "grade" | "all";

interface AutoGenerateScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  periodId: number | null;
  initialScope: AutoGenerateScope;
  initialSectionId?: number | null;
  activeGradeId: string;
  studioData: SubjectLoadStudioData | null;
  loads: SubjectLoadItem[];
  lockedSectionIds: Set<number>;
  isSaving: boolean;
  onApplyDraft: (
    preview: AutoScheduleResponse,
    targetClassIds: number[],
    persistAsDraft: boolean,
  ) => Promise<void>;
}

function formatTime12h(str?: string | null): string {
  if (!str) return "";
  const parts = str.split(":");
  if (parts.length < 2) return str;
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) || 0;
  if (Number.isNaN(h)) return str;
  let period = "AM";
  if (h >= 12) {
    period = "PM";
    if (h > 12) h -= 12;
  } else if (h === 0) {
    h = 12;
  }
  return `${h}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDaysLabel(days?: string[]): string {
  if (!days || days.length === 0) return "";
  const order = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const labels: Record<string, string> = {
    MON: "Mon",
    TUE: "Tue",
    WED: "Wed",
    THU: "Thu",
    FRI: "Fri",
    SAT: "Sat",
    SUN: "Sun",
  };
  const unique = Array.from(new Set(days)).sort(
    (a, b) => order.indexOf(a) - order.indexOf(b),
  );
  if (
    unique.length === 5 &&
    unique[0] === "MON" &&
    unique[1] === "TUE" &&
    unique[2] === "WED" &&
    unique[3] === "THU" &&
    unique[4] === "FRI"
  ) {
    return "Mon–Fri";
  }
  return unique.map((d) => labels[d] ?? d).join(", ");
}

export default function AutoGenerateScheduleModal({
  open,
  onOpenChange,
  periodId,
  initialScope,
  initialSectionId,
  activeGradeId,
  studioData,
  loads,
  lockedSectionIds,
  isSaving,
  onApplyDraft,
}: AutoGenerateScheduleModalProps) {
  const [scope, setScope] = useState<AutoGenerateScope>(initialScope);
  const [overwriteDrafts, setOverwriteDrafts] = useState(false);
  const [filterTab, setFilterTab] = useState<"all" | "generated" | "unscheduled" | "skipped">("all");
  const [preview, setPreview] = useState<AutoScheduleResponse | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const requestSeqRef = useRef(0);

  // Sync defaults whenever the modal opens
  useEffect(() => {
    if (open) {
      setScope(initialScope);
      setOverwriteDrafts(false);
      setFilterTab("all");
      setPreviewError(null);
      setApplyError(null);
    }
  }, [open, initialScope, initialSectionId]);

  const activeSection = useMemo(() => {
    if (!studioData?.classes) return null;
    if (initialSectionId != null) {
      return studioData.classes.find((c) => c.class_id === initialSectionId) ?? null;
    }
    return null;
  }, [studioData?.classes, initialSectionId]);

  const activeGrade = useMemo(() => {
    if (!studioData?.academic_levels || !activeGradeId) return null;
    return (
      studioData.academic_levels.find((l) => String(l.academic_level_id) === activeGradeId) ?? null
    );
  }, [studioData?.academic_levels, activeGradeId]);

  const targetClassIds = useMemo(() => {
    const classes = studioData?.classes || [];
    if (scope === "section" && activeSection) {
      return [activeSection.class_id];
    }
    if (scope === "grade" && activeGrade) {
      return classes
        .filter((c) => c.academic_level_id === activeGrade.academic_level_id)
        .map((c) => c.class_id);
    }
    return classes.map((c) => c.class_id);
  }, [scope, activeSection, activeGrade, studioData?.classes]);

  const hasUnlockedManualDrafts = useMemo(() => {
    const targetSet = new Set(targetClassIds);
    return loads.some(
      (l) =>
        targetSet.has(l.class_id) &&
        !lockedSectionIds.has(l.class_id) &&
        Boolean(l.start_time && l.end_time && l.days_of_week && l.days_of_week.length > 0),
    );
  }, [loads, targetClassIds, lockedSectionIds]);

  const fetchPreview = useCallback(
    async (nextTargetIds: number[], nextOverwrite: boolean) => {
      if (!periodId) return;
      if (nextTargetIds.length === 0) {
        setPreview(null);
        setPreviewError(null);
        return;
      }
      const seq = ++requestSeqRef.current;
      setIsLoadingPreview(true);
      setPreviewError(null);
      setApplyError(null);
      try {
        const res = await autoScheduleSubjectLoads(periodId, loads, {
          targetClassIds: nextTargetIds,
          overwriteExistingDrafts: nextOverwrite,
        });
        if (seq !== requestSeqRef.current) return;
        setPreview(res);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        setPreview(null);
        setPreviewError(
          err instanceof Error ? err.message : "Unable to preview generated schedule.",
        );
      } finally {
        if (seq === requestSeqRef.current) {
          setIsLoadingPreview(false);
        }
      }
    },
    [periodId, loads],
  );

  useEffect(() => {
    if (!open || !periodId) return;
    void fetchPreview(targetClassIds, overwriteDrafts);
  }, [open, periodId, targetClassIds, overwriteDrafts, fetchPreview]);

  const filteredItems = useMemo<AutoScheduleDecisionItem[]>(() => {
    if (!preview) return [];
    if (filterTab === "all") return preview.items;
    return preview.items.filter((item) => item.outcome === filterTab);
  }, [preview, filterTab]);

  const existingErrorConflicts = useMemo(
    () => (preview?.existing_conflicts || []).filter((c) => c.severity === "error"),
    [preview?.existing_conflicts],
  );

  const resultingNonUnscheduledErrors = useMemo(
    () =>
      (preview?.conflicts || []).filter(
        (c) => c.severity === "error" && c.rule !== "UNSCHEDULED_LOAD",
      ),
    [preview?.conflicts],
  );

  const canApply = Boolean(
    preview &&
      !isLoadingPreview &&
      !isApplying &&
      !isSaving &&
      preview.summary.generated_count > 0,
  );

  const handleApply = async (persistAsDraft: boolean) => {
    if (!preview || !canApply) return;
    setIsApplying(true);
    setApplyError(null);
    try {
      await onApplyDraft(preview, targetClassIds, persistAsDraft);
      onOpenChange(false);
    } catch (err) {
      setApplyError(
        err instanceof Error ? err.message : "Failed to apply generated draft schedule.",
      );
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="xl" className="w-[calc(100%-2rem)] max-w-4xl">
        <Dialog.Header position="static">
          <div className="flex flex-col text-left">
            <Dialog.Title className="font-sans text-xl font-bold text-primary-foreground">
              Auto-Generate Draft Schedule
            </Dialog.Title>
            <Dialog.Description className="text-xs font-medium text-primary-foreground/85">
              Preview conflict-free draft placements before applying or saving. Published schedules are never modified until unlocked.
            </Dialog.Description>
          </div>
        </Dialog.Header>

        <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 text-sm">
          {/* Controls: Scope + Overwrite Opt-In */}
          <div className="flex flex-col gap-3 rounded border-2 border-black bg-card p-3.5 shadow-[2px_2px_0_#000]">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="auto-generate-scope" className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Target Scope
                </label>
                <Select
                  value={scope}
                  onValueChange={(val) => {
                    setScope(val as AutoGenerateScope);
                    setOverwriteDrafts(false);
                  }}
                >
                  <Select.Trigger id="auto-generate-scope" className="w-full">
                    <Select.Value placeholder="Select scope" />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {activeSection && (
                        <Select.Item value="section">
                          Current Section — {activeSection.section_name}
                        </Select.Item>
                      )}
                      {activeGrade && (
                        <Select.Item value="grade">
                          Current Grade — {activeGrade.level_name}
                        </Select.Item>
                      )}
                      <Select.Item value="all">
                        All Unlocked Sections ({studioData?.classes.length ?? 0} total)
                      </Select.Item>
                    </Select.Group>
                  </Select.Content>
                </Select>
              </div>

              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isLoadingPreview || isApplying || targetClassIds.length === 0}
                onClick={() => void fetchPreview(targetClassIds, overwriteDrafts)}
                className="gap-2 shrink-0"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                Refresh Preview
              </Button>
            </div>

            {hasUnlockedManualDrafts && (
              <label className="flex cursor-pointer items-start gap-2.5 border-t border-black/15 pt-2.5 text-xs">
                <Checkbox
                  id="auto-generate-overwrite-drafts"
                  size="sm"
                  checked={overwriteDrafts}
                  disabled={isLoadingPreview || isApplying}
                  onCheckedChange={(checked) => setOverwriteDrafts(Boolean(checked))}
                />
                <span className="leading-snug">
                  <strong className="block text-foreground">
                    Regenerate existing draft schedules
                  </strong>
                  <span className="text-muted-foreground">
                    Leave unchecked to keep manually placed draft slots and only fill unscheduled subjects. Locked published sections are always preserved.
                  </span>
                </span>
              </label>
            )}
          </div>

          {overwriteDrafts && preview && preview.summary.replaced_count > 0 && (
            <Alert status="warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              <div>
                <Alert.Title className="font-bold">
                  Explicit overwrite confirmation required
                </Alert.Title>
                <Alert.Description className="mt-0.5 text-xs">
                  Applying this preview will replace{" "}
                  <strong>{preview.summary.replaced_count}</strong> existing manual draft{" "}
                  {preview.summary.replaced_count === 1 ? "schedule" : "schedules"} in unlocked sections. Existing teacher assignments are kept, and locked published sections remain untouched.
                </Alert.Description>
              </div>
            </Alert>
          )}

          {previewError && (
            <Alert status="error">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <div>
                <Alert.Title className="font-bold">Preview failed</Alert.Title>
                <Alert.Description className="mt-0.5 text-xs">
                  {previewError}
                </Alert.Description>
              </div>
            </Alert>
          )}

          {applyError && (
            <Alert status="error">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <div>
                <Alert.Title className="font-bold">Unable to save draft</Alert.Title>
                <Alert.Description className="mt-0.5 text-xs">
                  {applyError}
                </Alert.Description>
              </div>
            </Alert>
          )}

          {/* Never silently ignore existing conflicts */}
          {!isLoadingPreview && preview && existingErrorConflicts.length > 0 && (
            <Alert status="error">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <Alert.Title className="font-bold">
                  {existingErrorConflicts.length} existing schedule{" "}
                  {existingErrorConflicts.length === 1 ? "conflict" : "conflicts"} detected
                </Alert.Title>
                <Alert.Description className="mt-1 flex flex-col gap-1 text-xs">
                  <p>
                    {resultingNonUnscheduledErrors.length > 0
                      ? "Preserved schedules still contain unresolved conflicts that must be fixed before publishing:"
                      : "Existing draft conflicts will be resolved if you apply this regenerated draft:"}
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {existingErrorConflicts.slice(0, 4).map((c, idx) => (
                      <li key={`${c.rule}-${idx}`}>{c.message}</li>
                    ))}
                    {existingErrorConflicts.length > 4 && (
                      <li>and {existingErrorConflicts.length - 4} more conflict(s).</li>
                    )}
                  </ul>
                </Alert.Description>
              </div>
            </Alert>
          )}

          {/* Loading vs Preview Content */}
          {isLoadingPreview ? (
            <LoadingPanel label="Calculating conflict-free draft schedule..." />
          ) : !preview ? (
            !previewError ? (
              <EmptyStateCard
                compact
                icon={<Clock />}
                title="No sections available in this scope"
                description="Create an active class section or switch to another grade scope to generate a draft schedule."
              />
            ) : null
          ) : (
            <>
              {/* Summary Badges & Filter Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    size="sm"
                    variant="surface"
                    className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-900 border-emerald-400 font-bold"
                  >
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    {preview.summary.generated_count} generated
                  </Badge>
                  <Badge
                    size="sm"
                    variant="surface"
                    className={
                      preview.summary.unscheduled_count > 0
                        ? "inline-flex items-center gap-1 bg-amber-100 text-amber-950 border-amber-500 font-bold"
                        : "inline-flex items-center gap-1 font-bold"
                    }
                  >
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    {preview.summary.unscheduled_count} unscheduled
                  </Badge>
                  <Badge
                    size="sm"
                    variant="outline"
                    className="inline-flex items-center gap-1 font-bold"
                  >
                    <SkipForward className="size-3.5" aria-hidden="true" />
                    {preview.summary.skipped_count} skipped
                  </Badge>
                  {preview.summary.locked_sections_count > 0 && (
                    <Badge size="sm" variant="outline" className="font-semibold">
                      {preview.summary.locked_sections_count} locked{" "}
                      {preview.summary.locked_sections_count === 1 ? "section" : "sections"} preserved
                    </Badge>
                  )}
                </div>

                <SegmentedControl
                  size="sm"
                  value={filterTab}
                  onValueChange={(val) =>
                    setFilterTab(val as "all" | "generated" | "unscheduled" | "skipped")
                  }
                >
                  <SegmentedControl.Item value="all">
                    All ({preview.items.length})
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="generated">
                    Generated ({preview.summary.generated_count})
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="unscheduled">
                    Unscheduled ({preview.summary.unscheduled_count})
                  </SegmentedControl.Item>
                  <SegmentedControl.Item value="skipped">
                    Skipped ({preview.summary.skipped_count})
                  </SegmentedControl.Item>
                </SegmentedControl>
              </div>

              {filteredItems.length === 0 ? (
                <EmptyStateCard
                  compact
                  icon={<Sparkles />}
                  title={
                    preview.items.length === 0
                      ? "No eligible subjects to schedule"
                      : `No ${filterTab} subjects in this preview`
                  }
                  description={
                    preview.items.length === 0
                      ? "Configure active Subject Offerings for this academic year, term, grade level, and pathway in Curriculum Plan first."
                      : "Switch tabs above to inspect the other subjects in this preview."
                  }
                />
              ) : (
                <div className="max-h-[42vh] overflow-auto rounded border-2 border-black bg-background">
                  <Table className="w-full min-w-[680px] text-xs shadow-none">
                    <Table.Header>
                      <Table.Row className="border-b-2 border-black bg-primary/20">
                        <Table.Head className="font-bold text-black py-2">Section</Table.Head>
                        <Table.Head className="font-bold text-black py-2">Subject</Table.Head>
                        <Table.Head className="font-bold text-black py-2">Status</Table.Head>
                        <Table.Head className="font-bold text-black py-2">Proposed Slot</Table.Head>
                        <Table.Head className="font-bold text-black py-2">Teacher</Table.Head>
                        <Table.Head className="font-bold text-black py-2">Details</Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {filteredItems.map((item) => {
                        const timeText =
                          item.start_time && item.end_time
                            ? `${formatTime12h(item.start_time)} – ${formatTime12h(item.end_time)}`
                            : null;
                        const daysText = formatDaysLabel(item.days_of_week);
                        return (
                          <Table.Row
                            key={`${item.class_id}_${item.subject_id}_${item.outcome}`}
                            className="border-b border-black/15"
                          >
                            <Table.Cell className="py-2 font-bold text-black whitespace-nowrap">
                              {item.section_name}
                            </Table.Cell>
                            <Table.Cell className="py-2 font-semibold text-foreground">
                              {item.subject_name}
                            </Table.Cell>
                            <Table.Cell className="py-2 whitespace-nowrap">
                              {item.outcome === "generated" ? (
                                <Badge
                                  size="sm"
                                  variant="surface"
                                  className="bg-emerald-100 text-emerald-900 border-emerald-400 font-bold"
                                >
                                  {item.replaced_existing ? "Replaced" : "Generated"}
                                </Badge>
                              ) : item.outcome === "unscheduled" ? (
                                <Badge
                                  size="sm"
                                  variant="surface"
                                  className="bg-amber-100 text-amber-950 border-amber-500 font-bold"
                                >
                                  Unscheduled
                                </Badge>
                              ) : (
                                <Badge size="sm" variant="outline" className="font-semibold">
                                  Skipped
                                </Badge>
                              )}
                            </Table.Cell>
                            <Table.Cell className="py-2 whitespace-nowrap">
                              {timeText ? (
                                <div className="flex flex-col">
                                  <span className="font-semibold text-black">
                                    {item.slot_name ? `${item.slot_name} · ` : ""}
                                    {timeText}
                                  </span>
                                  {daysText && (
                                    <span className="text-[11px] text-muted-foreground">
                                      {daysText}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="italic text-muted-foreground">Unscheduled</span>
                              )}
                            </Table.Cell>
                            <Table.Cell className="py-2 whitespace-nowrap">
                              {item.staff_name ? (
                                <span className="font-medium text-foreground">{item.staff_name}</span>
                              ) : (
                                <span className="italic text-amber-800">Unassigned</span>
                              )}
                            </Table.Cell>
                            <Table.Cell className="py-2 text-muted-foreground max-w-[280px] whitespace-normal break-words">
                              {item.reason}
                            </Table.Cell>
                          </Table.Row>
                        );
                      })}
                    </Table.Body>
                  </Table>
                </div>
              )}

              {(preview.summary.empty_curriculum_sections?.length ?? 0) > 0 &&
                preview.items.length > 0 && (
                  <Alert status="info">
                    <Alert.Title className="font-bold">
                      Sections without active subject offerings
                    </Alert.Title>
                    <Alert.Description className="mt-0.5 text-xs">
                      No active Subject Offerings are configured for:{" "}
                      <strong>
                        {preview.summary.empty_curriculum_sections!.join(", ")}
                      </strong>
                      . Configure their offerings in Curriculum Plan before generating schedules for them.
                    </Alert.Description>
                  </Alert>
                )}

              {preview.summary.generated_count === 0 && preview.items.length > 0 && (
                <Alert status="info">
                  <Alert.Title className="font-bold">No new placements to apply</Alert.Title>
                  <Alert.Description className="mt-0.5 text-xs">
                    {preview.summary.unscheduled_count > 0
                      ? "Remaining subjects could not be placed safely. Review the unscheduled reasons above before retrying."
                      : preview.summary.locked_sections_count === preview.summary.target_sections_count
                        ? "All sections in this scope are published and locked. Unlock a section first to regenerate."
                        : "All eligible subjects in this scope already have schedules. Check \"Regenerate existing draft schedules\" above if you want to replace them."}
                  </Alert.Description>
                </Alert>
              )}
            </>
          )}
        </section>

        <Dialog.Footer position="static" className="border-t-2 border-border py-3 flex-wrap gap-2 justify-end">
          <Button
            type="button"
            variant="outline"
            disabled={isApplying}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!canApply}
            onClick={() => void handleApply(false)}
            className="gap-2"
          >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {overwriteDrafts && (preview?.summary.replaced_count ?? 0) > 0
              ? "Replace in Editor"
              : "Apply to Editor"}
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={!canApply}
            onClick={() => void handleApply(true)}
            className="gap-2"
          >
            <Save className="size-3.5" aria-hidden="true" />
            {isApplying
              ? "Saving Draft..."
              : overwriteDrafts && (preview?.summary.replaced_count ?? 0) > 0
                ? "Replace & Save Draft"
                : "Save as Draft"}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
