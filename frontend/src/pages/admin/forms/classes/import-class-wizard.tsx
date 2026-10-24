"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileText, Upload, Users, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { ApiRequestError, getClassFormOptions, validateClassImport } from "@/lib/api";
import type {
  AdviserOption,
  ClassAssignmentStudent,
  ClassFormOptions,
  ClassImportValidationErrorItem,
  ClassImportValidationErrorResponse,
  ClassListItem,
  ManualAssignmentWorkspaceState,
  ManualClassSetup,
  ManualSectionDraft,
  OfficialSectionOption,
  ValidateClassImportResponse,
  ValidatedImportAdviser,
} from "@/types/adminClasses";
import Field from "@/components/admin/classes/fields/Field";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import { Text } from "@/components/retroui/Text";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { FormMessage } from "@/components/retroui/FormMessage";

const MODERN_CLASS_IMPORT_HEADERS = [
  "section_name",
  "grade_level",
  "pathway",
  "adviser",
  "student_lrn",
];
const MODERN_CLASS_IMPORT_HEADER_ROW = MODERN_CLASS_IMPORT_HEADERS.join(",");

const LEGACY_CLASS_IMPORT_HEADERS = [
  "section_name",
  "grade_level",
  "pathway",
  "adviser_staff_id",
  "adviser_first_name",
  "adviser_middle_name",
  "adviser_last_name",
  "student_lrn",
  "student_first_name",
  "student_middle_name",
  "student_last_name",
];

export default function ImportClassWizard({
  existingClasses,
  onContinue,
  onValidationStale,
  onBack,
  onClose,
}: {
  existingClasses?: ClassListItem[];
  onContinue: (setup: ManualClassSetup, assignmentState: ManualAssignmentWorkspaceState, skipToReview?: boolean) => void;
  onValidationStale?: () => void;
  onBack?: () => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [options, setOptions] = useState<ClassFormOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [selectedAcademicLevelId, setSelectedAcademicLevelId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidateClassImportResponse | null>(null);
  const [validationError, setValidationError] = useState<ImportValidationErrorState | null>(null);
  const [selectedAdvisers, setSelectedAdvisers] = useState<Record<string, string>>({});
  const [showExistingClasses, setShowExistingClasses] = useState(false);

  useEffect(() => {
    let cancelled = false;

    getClassFormOptions()
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setSelectedAcademicLevelId((current) => current || String(data.academic_levels[0]?.academic_level_id ?? ""));
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

  function openFilePicker() {
    if (isValidating) return;
    fileInputRef.current?.click();
  }

  function clearFileInput() {
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeFile() {
    if (isValidating) return;
    setSelectedFile(null);
    setFileError("");
    clearValidationState();
    clearFileInput();
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    clearValidationState();

    if (!file) return;
    if (!file.name.toLocaleLowerCase().endsWith(".csv")) {
      setSelectedFile(null);
      setFileError("Only .csv files are supported.");
      clearFileInput();
      return;
    }

    setFileError("");
    setSelectedFile(file);
  }

  function downloadTemplate() {
    const selectedLevel = options?.academic_levels.find((level) => String(level.academic_level_id) === selectedAcademicLevelId);
    const gradeLevel = selectedLevel?.grade_level ?? 7;

    const configuredSections = options?.official_sections?.filter(
      (sec) => sec.academic_level_id === Number(selectedAcademicLevelId) && sec.is_active
    ) ?? [];
    const availableSections = configuredSections.filter((sec) => !sec.has_class);

    let csvContent = `${MODERN_CLASS_IMPORT_HEADER_ROW}\n`;
    // Only pre-fill official sections that do NOT already have classes in this academic year
    if (availableSections.length > 0) {
      const rows = availableSections.map((sec) => {
        const pathway = sec.pathway_code || "general";
        return `${sec.section_name},${gradeLevel},${pathway},,`;
      });
      csvContent += rows.join("\n") + "\n";
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `class_import_template_grade_${gradeLevel}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function validateCsv() {
    if (isValidating || !selectedAcademicLevelId || !selectedFile) return;

    setIsValidating(true);
    clearValidationState();
    try {
      const preflightError = await preflightClassImportCsv(selectedFile);
      if (preflightError) {
        setValidationError(preflightError);
        return;
      }
      const result = await validateClassImport(selectedFile, Number(selectedAcademicLevelId));
      const initialAdvisers: Record<string, string> = {};
      for (const section of result.sections) {
        initialAdvisers[section.section_name] = section.adviser?.staff_id ?? "";
      }
      setSelectedAdvisers(initialAdvisers);
      setValidationResult(result);
    } catch (error: unknown) {
      setValidationError(toImportValidationError(error));
    } finally {
      setIsValidating(false);
    }
  }

  function clearValidationState() {
    setValidationResult(null);
    setSelectedAdvisers({});
    setValidationError(null);
    setShowExistingClasses(false);
    onValidationStale?.();
  }

  function handleAdviserChange(sectionName: string, staffId: string) {
    setSelectedAdvisers((prev) => ({
      ...prev,
      [sectionName]: staffId,
    }));
  }

  const eligibleAdvisers = validationResult?.eligible_advisers && validationResult.eligible_advisers.length > 0
    ? validationResult.eligible_advisers
    : (options?.eligible_advisers ?? []);

  const adviserCounts: Record<string, number> = {};
  for (const staffId of Object.values(selectedAdvisers)) {
    if (staffId) adviserCounts[staffId] = (adviserCounts[staffId] || 0) + 1;
  }
  const hasDuplicateAdviser = Object.values(adviserCounts).some((count) => count > 1);
  const allAdvisersSelected = validationResult
    ? validationResult.sections.length > 0 && validationResult.sections.every((sec) => Boolean(selectedAdvisers[sec.section_name]))
    : false;

  const canContinue = allAdvisersSelected && !hasDuplicateAdviser && !isValidating && !validationError;

  function continueToAssignments(skipToReview = false) {
    if (!validationResult || !canContinue || isValidating || validationError) return;
    const { setup, assignmentState } = hydratedImportState(validationResult, selectedAdvisers, eligibleAdvisers);
    onContinue(setup, assignmentState, skipToReview);
  }

  if (loading) {
    return <StatePanel message="Loading class options..." />;
  }

  if (loadError) {
    return (
      <StatePanel message="Unable to load class options." detail={loadError}>
        <Button variant={"default"} onClick={retryLoading}>Retry</Button>
      </StatePanel>
    );
  }

  if (!options) return null;
  const noLevels = options.academic_levels.length === 0;
  const selectedLevel = options.academic_levels.find((level) => String(level.academic_level_id) === selectedAcademicLevelId);

  const configuredSections = (options?.official_sections ?? []).filter(
    (sec) => sec.academic_level_id === Number(selectedAcademicLevelId) && sec.is_active
  );
  const availableSections = configuredSections.filter((sec) => !sec.has_class);
  const existingClassSections = configuredSections.filter((sec) => sec.has_class);
  const allSectionsHaveClasses = configuredSections.length > 0 && availableSections.length === 0;
  const isImportBlocked = allSectionsHaveClasses || configuredSections.length === 0;
  const canValidate = Boolean(selectedAcademicLevelId && selectedFile && !isValidating && !isImportBlocked);

  const resolveExistingClass = (sec: OfficialSectionOption) => {
    if (sec.class_id != null) {
      return {
        class_id: sec.class_id,
        class_status: sec.class_status ?? "active",
        section_name: sec.section_name,
        pathway_name: sec.pathway_name,
      };
    }
    if (existingClasses) {
      const match = existingClasses.find(
        (c) =>
          c.academic_level.academic_level_id === sec.academic_level_id &&
          c.academic_year.academic_year_id === sec.academic_year_id &&
          c.section_name.trim().toLowerCase() === sec.section_name.trim().toLowerCase()
      );
      if (match) {
        return {
          class_id: match.class_id,
          class_status: match.class_status,
          section_name: match.section_name,
          pathway_name: match.pathway?.name ?? null,
        };
      }
    }
    return null;
  };

  const handleManageClass = (classId: number | string, isArchived: boolean) => {
    if (selectedFile || validationResult) {
      const confirmLeave = window.confirm(
        "You have an import in progress. Navigating to an existing class will close the wizard. Do you want to continue?"
      );
      if (!confirmLeave) return;
    }
    onClose();
    if (isArchived) {
      navigate(`/admin/classes/${classId}?tab=students`);
    } else {
      navigate(`/admin/classes/${classId}?tab=students&action=manage-students`);
    }
  };


  const handleConfigureSections = () => {
    if (selectedFile || validationResult) {
      const confirmLeave = window.confirm(
        "You have an import in progress. Navigating away will close the wizard. Do you want to continue?"
      );
      if (!confirmLeave) return;
    }
    onClose();
    navigate("/admin/settings");
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        <Field label="Academic Year">
          <Input readOnly value={options.academic_year.year_label} className="bg-muted/50 text-muted-foreground" />
        </Field>
        <Field label="Academic Level">
          <Select
            disabled={noLevels || isValidating}
            value={selectedAcademicLevelId}
            onChange={(e) => {
              setSelectedAcademicLevelId(e.target.value);
              clearValidationState();
            }}
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
          {noLevels && <InlineError message="No academic levels are available." />}
          {selectedLevel && (
            <div className="mt-2 space-y-1.5">
              {allSectionsHaveClasses ? (
                <Card className="grid gap-3.5 border-2 border-black bg-[#fffbeb] p-4 sm:p-5 shadow-[3px_3px_0_#000]">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2.5 text-base sm:text-lg font-bold text-black">
                      <CheckCircle2 className="size-5 shrink-0 text-emerald-600" />
                      <span>All {selectedLevel.level_name} classes are created</span>
                    </div>
                    <Badge variant="outline" className="w-fit border-black/30 bg-white/90 text-xs sm:text-sm font-semibold text-black">
                      AY {options.academic_year.year_label}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <p className="text-sm font-bold text-black">
                      All sections for this grade already have classes.
                    </p>
                    <p className="text-sm text-black/85 leading-relaxed">
                      {existingClassSections.map((s) => s.section_name).join(" and ")} already exist for AY {options.academic_year.year_label}. There are no additional official sections available to import.
                    </p>
                  </div>

                  <div className="pt-1">
                    <div className="text-xs sm:text-sm font-bold text-black mb-2">
                      Choose a class to manage its students:
                    </div>

                    <div className="grid gap-2.5">
                      {existingClassSections.map((sec) => {
                        const existing = resolveExistingClass(sec);
                        const classId = existing?.class_id;
                        const isArchived = (existing?.class_status ?? "active").toLowerCase() === "archived";

                        return (
                          <div
                            key={sec.id}
                            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded border-2 border-black/40 bg-white p-3.5 sm:p-4 shadow-[2px_2px_0_#000] transition-all hover:border-black"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-base sm:text-lg font-bold text-black tracking-tight">{sec.section_name}</span>
                                {sec.pathway_name && (
                                  <Badge variant="default" className="text-xs font-medium bg-muted/60 text-muted-foreground">
                                    {sec.pathway_name}
                                  </Badge>
                                )}
                                {isArchived ? (
                                  <Badge variant="outline" className="border-amber-600 text-amber-700 bg-amber-50 text-xs font-semibold">
                                    Archived
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="border-emerald-600 text-emerald-700 bg-emerald-50 text-xs font-semibold">
                                    Existing class
                                  </Badge>
                                )}
                              </div>
                              <div className="mt-1 flex items-center gap-2 text-xs sm:text-sm font-medium text-muted-foreground">
                                <span>{classId ? `Class ID #${classId}` : "Existing class"}</span>
                                <span>•</span>
                                <span>{selectedLevel.level_name}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 pt-1 sm:pt-0">
                              {classId != null ? (
                                <Button
                                  type="button"
                                  variant={isArchived ? "outline" : "default"}
                                  className="font-bold min-h-[40px] px-4 text-sm sm:text-base shrink-0"
                                  aria-label={isArchived ? "View Class" : `Manage ${sec.section_name}`}
                                  onClick={() => handleManageClass(classId, isArchived)}
                                >
                                  <Users className="size-4 mr-1.5" />
                                  {isArchived ? "View Class" : "Manage Students"}
                                </Button>
                              ) : (
                                <span className="text-xs text-muted-foreground italic">Navigation unavailable</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-2.5 border-t border-black/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 shrink-0 text-amber-600" />
                      <span>Need another class? Configure a new official section.</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-fit text-xs h-7 px-2.5 font-semibold text-black border-2 border-black"
                      onClick={handleConfigureSections}
                    >
                      Configure Sections
                    </Button>
                  </div>
                </Card>
              ) : configuredSections.length === 0 ? (
                <div className="grid gap-2 text-destructive">
                  <FormMessage>No official sections configured</FormMessage>
                  <p className="text-sm text-destructive/90 leading-relaxed">
                    No official sections are currently configured for {selectedLevel.level_name} in academic year {options.academic_year.year_label}. Configure official sections in System Settings before importing classes.
                  </p>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="font-bold text-xs sm:text-sm h-8 px-3 text-black border-2 border-black"
                      onClick={handleConfigureSections}
                    >
                      Configure Sections
                    </Button>
                  </div>
                </div>
              ) : availableSections.length > 0 ? (
                <Card className="grid gap-2.5 border-2 border-black bg-card p-3.5 sm:p-4 shadow-[2px_2px_0_#000]">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        Available section{availableSections.length > 1 ? "s" : ""} for import:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {availableSections.map((sec) => (
                          <div
                            key={sec.id}
                            className="inline-flex items-center gap-1.5 rounded border-2 border-emerald-600/50 bg-emerald-50 px-2.5 py-1 text-xs sm:text-sm font-bold text-emerald-950 shadow-[1px_1px_0_#000]"
                          >
                            <span className="size-2 rounded-full bg-emerald-600" />
                            <span>{sec.section_name}</span>
                            {sec.pathway_name && (
                              <span className="text-xs font-normal text-emerald-800">({sec.pathway_name})</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {existingClassSections.length > 0 && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="font-bold text-xs sm:text-sm h-8 px-2.5 shrink-0 self-start sm:self-auto border-2 border-black"
                        aria-expanded={showExistingClasses}
                        aria-controls="existing-classes-disclosure"
                        onClick={() => setShowExistingClasses((prev) => !prev)}
                      >
                        <Users className="size-3.5 mr-1" />
                        <span>
                          {existingClassSections.length} existing class{existingClassSections.length > 1 ? "es" : ""}
                        </span>
                        <span className="mx-1 text-muted-foreground">•</span>
                        <span className="text-primary underline">
                          {showExistingClasses ? "Hide" : "Manage classes"}
                        </span>
                        <ChevronDown
                          className={cn(
                            "size-3.5 ml-1 transition-transform duration-200",
                            showExistingClasses && "rotate-180"
                          )}
                        />
                      </Button>
                    )}
                  </div>

                  {existingClassSections.length > 0 && showExistingClasses && (
                    <div
                      id="existing-classes-disclosure"
                      className="mt-2.5 pt-3 border-t-2 border-border/80 grid gap-2.5"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground font-semibold gap-1">
                        <div className="flex items-center gap-1.5 font-bold text-black text-sm">
                          <Users className="size-4 text-primary shrink-0" />
                          <span>Existing Classes</span>
                        </div>
                        <span>Already created ({existingClassSections.length}) · Choose a class to manage its students:</span>
                      </div>

                      <div className="grid gap-2">
                        {existingClassSections.map((sec) => {
                          const existing = resolveExistingClass(sec);
                          const classId = existing?.class_id;
                          const isArchived = (existing?.class_status ?? "active").toLowerCase() === "archived";

                          return (
                            <div
                              key={sec.id}
                              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 rounded border-2 border-black/30 bg-muted/20 p-3 shadow-[1px_1px_0_#000] hover:border-black transition-all"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-base font-bold text-black tracking-tight">{sec.section_name}</span>
                                  {sec.pathway_name && (
                                    <Badge variant="default" className="text-xs font-medium bg-muted/60 text-muted-foreground">
                                      {sec.pathway_name}
                                    </Badge>
                                  )}
                                  {isArchived ? (
                                    <Badge size="sm" variant="outline" className="border-amber-600 text-amber-700 bg-amber-50 text-xs font-semibold">
                                      Archived
                                    </Badge>
                                  ) : (
                                    <Badge size="sm" variant="outline" className="border-border text-xs font-medium bg-background">
                                      Existing class
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-0.5 text-xs font-medium text-muted-foreground">
                                  {classId ? `Class ID #${classId}` : "Existing class"}
                                </div>
                              </div>

                              <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 pt-1 sm:pt-0">
                                {classId != null ? (
                                  <Button
                                    type="button"
                                    variant={isArchived ? "outline" : "default"}
                                    className="font-bold min-h-[38px] px-3.5 text-sm shrink-0"
                                    aria-label={isArchived ? "View Class" : `Manage ${sec.section_name}`}
                                    onClick={() => handleManageClass(classId, isArchived)}
                                  >
                                    <Users className="size-4 mr-1.5" />
                                    {isArchived ? "View Class" : "Manage Students"}
                                  </Button>
                                ) : (
                                  <span className="text-xs text-muted-foreground italic">Navigation unavailable</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </Card>
              ) : null}
            </div>
          )}
        </Field>
      </div>

      {!isImportBlocked && (
        <>
          <Card className="grid gap-3 p-4">
            <div>
              <Text as="h6" className="font-bold">Upload CSV file</Text>
              <Text as="p" className="text-xs text-muted-foreground">
                Import multiple class sections and optional student assignments for {selectedLevel?.level_name ?? "the selected grade level"}.
              </Text>
              <Text as="p" className="mt-1 text-xs font-semibold text-muted-foreground">
                Template columns: section_name, grade_level, pathway, adviser, student_lrn. LRNs must be complete 12-digit numbers.
              </Text>
            </div>
            <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />
            {!selectedFile ? (
              <Button disabled={isValidating || noLevels || configuredSections.length === 0} className="w-fit" onClick={openFilePicker}>
                <Upload className="size-4 mr-2" /> Choose CSV File
              </Button>
            ) : (
              <Card className="grid gap-3 p-3 bg-muted/20">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0">
                    <Text as="p" className="text-xs font-bold uppercase text-muted-foreground">Selected CSV file</Text>
                    <Text as="p" className="break-words text-sm font-bold">{selectedFile.name}</Text>
                    <Text as="p" className="text-xs text-muted-foreground">{readableFileSize(selectedFile.size)}</Text>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={"outline"} disabled={isValidating} onClick={openFilePicker}>Replace file</Button>
                  <Button size="sm" variant={"outline"} disabled={isValidating} onClick={removeFile}><X className="size-3 mr-1" />Remove</Button>
                </div>
              </Card>
            )}
            {fileError && <InlineError message={fileError} />}
          </Card>

          <Card className="grid gap-2 p-3 text-sm bg-muted/20">
            <div className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-4 text-primary" /> CSV validation</div>
            {isValidating ? (
              <p className="text-xs font-semibold text-muted-foreground">Uploading and validating CSV...</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Validate sections, check grade consistency, match registered students, and resolve eligible class advisers.
              </p>
            )}
          </Card>

          {validationError && <ValidationErrorPanel error={validationError} onDownloadTemplate={downloadTemplate} />}
          {validationResult && (
            <ValidationSuccessPanel
              result={validationResult}
              selectedAdvisers={selectedAdvisers}
              eligibleAdvisers={eligibleAdvisers}
              onAdviserChange={handleAdviserChange}
              canContinue={canContinue}
              onContinue={continueToAssignments}
            />
          )}
        </>
      )}

      <Dialog.Footer className="-mx-4 -mb-4 w-[calc(100%+2rem)] justify-between border-t-2 px-4 py-4">
        <Button variant="outline" onClick={onClose}>Close</Button>
        <div className="flex flex-wrap gap-2">
          {onBack && <Button variant={"outline"} onClick={onBack}>Back</Button>}
          {!isImportBlocked && (
            <>
              <Button variant={"outline"} onClick={downloadTemplate}><Download className="size-4 mr-2" /> Download Template</Button>
              <Button disabled={!canValidate} onClick={validateCsv}>
                {isValidating ? "Validating CSV..." : "Validate CSV"}
              </Button>
            </>
          )}
        </div>
      </Dialog.Footer>
    </div>
  );
}

function readableFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function InlineError({ message }: { message: string }) {
  return <FormMessage className="text-xs">{message}</FormMessage>;
}

type ImportValidationErrorState = {
  message: string;
  details: ClassImportValidationErrorItem[];
};

type ParsedCsvRow = {
  rowNumber: number;
  values: string[];
};

type CsvParseResult = {
  rows: ParsedCsvRow[];
  malformed: boolean;
};

function formatAdviserName(adv: AdviserOption | ValidatedImportAdviser) {
  return [adv.first_name, adv.middle_name, adv.last_name, adv.suffix].filter(Boolean).join(" ");
}

function formatAdviserOptionLabel(adv: AdviserOption) {
  const name = formatAdviserName(adv);
  const secondary: string[] = [];
  if (adv.email) secondary.push(adv.email);
  else if (adv.staff_id) secondary.push(adv.staff_id);
  if (adv.employment_status) secondary.push(adv.employment_status);
  return secondary.length > 0 ? `${name} (${secondary.join(" • ")})` : name;
}

function ValidationSuccessPanel({
  result,
  selectedAdvisers,
  eligibleAdvisers,
  onAdviserChange,
  canContinue,
  onContinue,
}: {
  result: ValidateClassImportResponse;
  selectedAdvisers: Record<string, string>;
  eligibleAdvisers: AdviserOption[];
  onAdviserChange: (sectionName: string, staffId: string) => void;
  canContinue: boolean;
  onContinue: (skipToReview: boolean) => void;
}) {
  const adviserCounts: Record<string, number> = {};
  for (const staffId of Object.values(selectedAdvisers)) {
    if (staffId) adviserCounts[staffId] = (adviserCounts[staffId] || 0) + 1;
  }

  const formatLabel = result.format === "legacy" ? "Legacy 12-column template" : "Modern 5-column template";

  return (
    <Card className="grid gap-3 border-primary bg-primary/10 p-4 text-sm">
      <div>
        <Text as="h6" className="font-bold text-primary">CSV validated successfully</Text>
        <div className="mt-1 grid grid-cols-2 gap-1 text-xs">
          <p><span className="font-semibold">Academic Year:</span> {result.academic_year.year_label}</p>
          <p><span className="font-semibold">Academic Level:</span> {result.academic_level.level_name}</p>
          <p><span className="font-semibold">Sections detected:</span> {result.summary.section_count}</p>
          <p><span className="font-semibold">Students resolved:</span> {result.summary.student_count}</p>
          <p className="col-span-2 text-muted-foreground"><span className="font-semibold">Format:</span> {formatLabel}</p>
        </div>
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <Card className="grid gap-2 border-amber-500 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-bold">
            <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Import Notice / Warnings</span>
          </div>
          <ul className="grid gap-1 pl-4 list-disc">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-3">
        <Text as="h6" className="font-bold text-xs uppercase text-muted-foreground">Sections & Adviser Selection</Text>
        {result.sections.map((section) => {
          const currentStaffId = selectedAdvisers[section.section_name] || "";
          const isDuplicate = currentStaffId ? (adviserCounts[currentStaffId] || 0) > 1 : false;
          const studentCount = section.students.length;

          return (
            <Card key={section.section_name} className="p-3 grid gap-2.5 bg-background">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm">{section.section_name}</span>
                <div className="flex items-center gap-2">
                  {section.pathway && section.pathway !== "general" && (
                    <span className="text-[11px] px-2 py-0.5 rounded bg-muted font-medium">
                      {section.pathway}
                    </span>
                  )}
                  <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${studentCount > 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {studentCount > 0 ? `${studentCount} student${studentCount > 1 ? "s" : ""}` : "Empty class (0 students)"}
                  </span>
                </div>
              </div>

              {section.adviser_hint && !currentStaffId && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  CSV adviser hint: "{section.adviser_hint}". Please select an adviser from the dropdown below.
                </p>
              )}

              <div>
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                  Class Adviser <span className="text-destructive">*</span>
                </label>
                <Select
                  value={currentStaffId}
                  onChange={(e) => onAdviserChange(section.section_name, e.target.value)}
                >
                  <Select.Trigger className="w-full">
                    <Select.Value placeholder="Select eligible adviser..." />
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Group>
                      {eligibleAdvisers.map((adv) => (
                        <Select.Item key={adv.staff_id} value={adv.staff_id}>
                          {formatAdviserOptionLabel(adv)}
                        </Select.Item>
                      ))}
                    </Select.Group>
                  </Select.Content>
                </Select>
                {isDuplicate && (
                  <p className="text-xs text-destructive font-semibold mt-1">
                    This adviser is selected for multiple imported sections. Please choose a unique adviser for each class.
                  </p>
                )}
                {!currentStaffId && (
                  <p className="text-xs text-destructive font-semibold mt-1">
                    Please select an eligible adviser for this class before continuing.
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        {result.summary.student_count === 0 ? (
          <Button disabled={!canContinue} onClick={() => onContinue(true)}>
            Review Empty Classes
          </Button>
        ) : (
          <>
            <Button disabled={!canContinue} onClick={() => onContinue(false)}>
              Next: Assign Students
            </Button>
            <Button variant="outline" disabled={!canContinue} onClick={() => onContinue(true)}>
              Skip to Review
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

function hydratedImportState(
  result: ValidateClassImportResponse,
  adviserMap: Record<string, string>,
  adviserOptions: AdviserOption[],
): {
  setup: ManualClassSetup;
  assignmentState: ManualAssignmentWorkspaceState;
} {
  const sections: ManualSectionDraft[] = result.sections.map((section) => {
    const staffId = adviserMap[section.section_name] || section.adviser?.staff_id || "";
    const matched = adviserOptions.find((a) => a.staff_id === staffId);
    const name = matched
      ? formatAdviserName(matched)
      : (section.adviser ? formatAdviserName(section.adviser) : "");

    return {
      localId: crypto.randomUUID(),
      sectionName: section.section_name,
      adviserStaffId: staffId,
      adviserName: name,
      pathway: section.pathway || "general",
    };
  });

  const assignmentsBySection = Object.fromEntries(sections.map((section, index) => [
    section.localId,
    result.sections[index].students.map((student): ClassAssignmentStudent => ({
      student_id: student.student_id,
      student_lrn: student.student_lrn,
      first_name: student.first_name,
      middle_name: student.middle_name,
      last_name: student.last_name,
      gender: student.gender,
      academic_level_id: student.academic_level_id,
    })),
  ]));

  return {
    setup: {
      academicLevelId: result.academic_level.academic_level_id,
      academicLevelName: result.academic_level.level_name,
      academicYear: result.academic_year,
      sections,
    },
    assignmentState: {
      academicLevelId: result.academic_level.academic_level_id,
      unassignedStudents: [],
      assignmentsBySection,
      selectedStudentIds: new Set(),
    },
  };
}

function ValidationErrorPanel({ error, onDownloadTemplate }: { error: ImportValidationErrorState; onDownloadTemplate: () => void }) {
  const hasHeaderError = error.details.some((detail) => isHeaderValidationCode(detail.code));
  const showGeneralMessage = error.message.trim().toLocaleLowerCase() !== "csv validation failed.";

  return (
    <div className="grid gap-2 text-sm text-destructive">
      <FormMessage>CSV validation failed.</FormMessage>
      {showGeneralMessage && <FormMessage>{error.message}</FormMessage>}
      {hasHeaderError && (
        <div className="grid gap-2">
          <p className="font-bold text-xs">Required Modern Header Template:</p>
          <code className="break-all rounded bg-muted p-2 text-[11px] font-mono">{MODERN_CLASS_IMPORT_HEADER_ROW}</code>
          <Button size="sm" variant={"outline"} className="w-fit" onClick={onDownloadTemplate}>
            <Download className="size-3 mr-1" /> Download Header Template
          </Button>
        </div>
      )}
      {!!error.details.length && (
        <ul className="grid gap-1 text-xs">
          {error.details.map((item, index) => (
            <li key={`${item.code}-${index}`}>- {item.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function preflightClassImportCsv(file: File): Promise<ImportValidationErrorState | null> {
  const text = await file.text();
  const parseResult = parseCsvRows(text);
  if (parseResult.malformed) {
    return { message: "The CSV file is malformed. Ensure fields with commas or quotes are properly escaped.", details: [] };
  }
  if (!parseResult.rows.length) {
    return { message: "The selected CSV file is empty.", details: [] };
  }

  const headerValues = parseResult.rows[0].values.map((item) => item.trim());
  const isModern = MODERN_CLASS_IMPORT_HEADERS.length === headerValues.length
    && MODERN_CLASS_IMPORT_HEADERS.every((header, index) => header === headerValues[index]);
  const isLegacy = LEGACY_CLASS_IMPORT_HEADERS.length === headerValues.length
    && LEGACY_CLASS_IMPORT_HEADERS.every((header, index) => header === headerValues[index]);

  if (!isModern && !isLegacy) {
    return {
      message: "CSV headers do not match the required template.",
      details: [{ code: "invalid_headers", message: "Header row must match the modern 5-column format or legacy 12-column format." }],
    };
  }

  const lrnIndex = isModern ? 4 : 7;
  const details: ClassImportValidationErrorItem[] = [];
  const lrnOccurrences = new Map<string, number[]>();

  parseResult.rows.slice(1).forEach(({ rowNumber, values }) => {
    const rawLrn = (values[lrnIndex] ?? "").trim();
    if (!rawLrn) return;
    if (isScientificNotation(rawLrn)) {
      details.push({
        code: "student_lrn_scientific_notation",
        message: `Row ${rowNumber}: Student LRN "${rawLrn}" appears to be in scientific notation.`,
      });
      return;
    }
    const rows = lrnOccurrences.get(rawLrn) ?? [];
    rows.push(rowNumber);
    lrnOccurrences.set(rawLrn, rows);
  });

  lrnOccurrences.forEach((rows, lrn) => {
    if (rows.length > 1) {
      details.push({
        code: "duplicate_student_lrn",
        message: `Student LRN "${lrn}" is duplicated on rows ${rows.join(", ")}.`,
      });
    }
  });

  return details.length ? { message: "CSV preflight check failed.", details: details.slice(0, 10) } : null;
}

function parseCsvRows(text: string): CsvParseResult {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: ParsedCsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let rowNumber = 1;
  let malformed = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push({ rowNumber, values: row });
      row = [];
      cell = "";
      rowNumber += 1;
      continue;
    }

    cell += char;
  }

  if (inQuotes) malformed = true;
  if (cell || row.length) {
    row.push(cell);
    rows.push({ rowNumber, values: row });
  }

  return {
    malformed,
    rows: rows.filter((item, index) => index === 0 || item.values.some((value) => value.trim() !== "")),
  };
}

function isScientificNotation(value: string) {
  return /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/.test(value);
}

function isHeaderValidationCode(code: string) {
  return code === "invalid_header" || code === "invalid_headers";
}

function toImportValidationError(error: unknown): ImportValidationErrorState {
  if (!(error instanceof ApiRequestError)) {
    return { message: "Unable to connect to the server. Please try again.", details: [] };
  }
  if (error.status === 401) return { message: "Your session has expired. Please sign in again.", details: [] };
  if (error.status === 403) return { message: "You do not have permission to validate class imports.", details: [] };

  const data = safeImportErrorResponse(error.data);
  if (!data) return { message: error.message || "Unable to validate CSV. Please try again.", details: [] };
  return {
    message: importCodeMessage(data.code, data.message),
    details: data.errors.filter((item) => isSafeMessage(item.message)),
  };
}

function safeImportErrorResponse(data: unknown): ClassImportValidationErrorResponse | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (typeof value.message !== "string" || typeof value.code !== "string" || !Array.isArray(value.errors)) return null;
  return {
    message: value.message,
    code: value.code,
    errors: value.errors.filter(isImportErrorItem),
  };
}

function isImportErrorItem(value: unknown): value is ClassImportValidationErrorItem {
  return Boolean(value && typeof value === "object"
    && "code" in value && typeof value.code === "string"
    && "message" in value && typeof value.message === "string");
}

function isSafeMessage(message: string) {
  return !/stack|traceback|sql|constraint|\/app\/|\\app\\/i.test(message);
}

function importCodeMessage(code: string, fallback?: string) {
  const messages: Record<string, string> = {
    csv_validation_failed: "CSV validation failed.",
    invalid_csv_file: "Please upload a valid CSV file.",
    invalid_file_type: "Only CSV files are supported.",
    empty_csv: "The selected CSV file is empty.",
    file_empty: "The selected CSV file is empty.",
    invalid_headers: "CSV headers do not match the required template.",
    missing_required_field: "A required CSV field is missing.",
    invalid_grade_level: "Grade level must be a whole number.",
    academic_level_mismatch: "CSV grade level does not match the selected academic level.",
    duplicate_student_lrn: "A student LRN appears more than once in the CSV.",
    student_lrn_scientific_notation: "One or more Student LRNs were converted to scientific notation.",
    student_not_found: "One or more student accounts could not be found.",
    student_already_assigned: "One or more students are already assigned to a class.",
    adviser_not_found: "One or more advisers could not be found.",
    adviser_already_assigned: "An adviser is already assigned to another class section.",
    duplicate_adviser_assignment: "An adviser is assigned to multiple imported sections.",
    conflicting_section_adviser: "A section uses conflicting adviser information.",
    section_already_exists: "A section already exists for the selected academic level and active academic year.",
    invalid_pathway: "One or more rows contain an invalid or missing pathway for the selected grade level.",
    conflicting_section_pathway: "A section uses conflicting pathway values in CSV.",
    active_academic_year_missing: "No active academic year is configured.",
    active_academic_year_multiple: "Multiple active academic years were detected.",
  };
  return messages[code] ?? fallback ?? "Unable to validate CSV. Please try again.";
}

function StatePanel({ message, detail, children }: { message: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-3 rounded border-2 border-border bg-card p-5 text-sm">
      <p className="font-bold">{message}</p>
      {detail && detail !== message && <p className="text-xs text-muted-foreground">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
