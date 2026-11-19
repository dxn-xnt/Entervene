import { useState, useEffect, useRef } from "react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/teacher/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Input } from "@/components/retroui/Input";
import { Tabs } from "@/components/retroui/Tabs";
import { Label } from "@/components/retroui/Label";
import { Alert } from "@/components/retroui/Alert";
import { FormMessage } from "@/components/retroui/FormMessage";
import { useToast } from "@/components/retroui/Toast";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Sparkles,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Lock,
  FileQuestion,
  Loader2,
  History,
} from "lucide-react";
import {
  type PracticeAssessmentDetail,
  type PracticeAttemptSummary,
  type PracticeGatekeeperPolicy,
  type PracticeQuestionDraft,
  type PracticeQuestionType,
  batchSavePracticeQuestions,
  generatePracticeQuestionsAI,
  getTeacherPracticeAssessment,
  importPracticeQuestionsPreview,
  initializeTeacherPracticeAssessment,
  listTeacherPracticeAttempts,
  publishTeacherPracticeAssessment,
  archiveTeacherPracticeAssessment,
  updateTeacherPracticeAssessment,
} from "@/lib/practice-assessment-api";
import { getRemediationWorkspace } from "@/lib/teacher-interventions-api";

interface PracticeAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  interventionId: number;
  studentName?: string;
  selectedReadingIds?: number[];
  savedReadingIds?: number[];
  onAssessmentUpdated?: (assessment: PracticeAssessmentDetail | null) => void;
}

const POLICY_OPTIONS: Array<{
  value: PracticeGatekeeperPolicy;
  title: string;
  description: string;
}> = [
    {
      value: "REQUIRE_PASS",
      title: "Require Passing Score",
      description:
        "The student must achieve the configured passing percentage before accessing the actual intervention assessment.",
    },
    {
      value: "REQUIRE_ATTEMPT",
      title: "Allow Progress Below Passing",
      description:
        "The student must complete at least one Practice Assessment attempt but may proceed even with a below-passing score.",
    },
    {
      value: "OPTIONAL",
      title: "Optional Practice",
      description:
        "Optional practice checkpoint; remediation remains accessible without attempting.",
    },
  ];

export default function PracticeAssessmentModal({
  isOpen,
  onClose,
  interventionId,
  studentName,
  selectedReadingIds,
  savedReadingIds,
  onAssessmentUpdated,
}: PracticeAssessmentModalProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedInterventionRef = useRef<number | null>(null);
  const hasLocalDraftRef = useRef(false);

  const [loadedReadingIds, setLoadedReadingIds] = useState<number[]>([]);
  const effectiveApprovedReadings = selectedReadingIds ?? savedReadingIds ?? loadedReadingIds;
  const currentReadingSignature = [...effectiveApprovedReadings]
    .sort((a, b) => a - b)
    .join(",");

  // Assessment Config State
  const [assessment, setAssessment] = useState<PracticeAssessmentDetail | null>(null);
  const [title, setTitle] = useState("Practice Assessment");
  const [passingPercentage, setPassingPercentage] = useState<number>(75);
  const [gatekeeperPolicy, setGatekeeperPolicy] = useState<PracticeGatekeeperPolicy>("REQUIRE_PASS");
  const [questions, setQuestions] = useState<PracticeQuestionDraft[]>([]);
  const [attempts, setAttempts] = useState<PracticeAttemptSummary[]>([]);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [activeTab, setActiveTab] = useState<"questions" | "attempts">("questions");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // AI Generation Drawer State
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [aiTargetCount, setAiTargetCount] = useState<number>(5);
  const [aiGuidance, setAiGuidance] = useState("");
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [generatedSourceSignature, setGeneratedSourceSignature] = useState<string | null>(null);

  // Import State
  const [isImporting, setIsImporting] = useState(false);

  // Questions are locked if student attempts exist
  const isLocked = attempts.length > 0;
  const generatedSourcesAreStale =
    generatedSourceSignature !== null && generatedSourceSignature !== currentReadingSignature;

  // Load existing assessment and attempts
  useEffect(() => {
    if (!isOpen) return;

    // Keep an unsaved generated/imported draft when the teacher briefly closes
    // this modal or moves between intervention wizard steps.
    if (
      loadedInterventionRef.current === interventionId &&
      hasLocalDraftRef.current
    ) {
      return;
    }

    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      setShowAiDrawer(false);
      try {
        const existing = await getTeacherPracticeAssessment(interventionId);
        if (!mounted) return;
        loadedInterventionRef.current = interventionId;
        hasLocalDraftRef.current = false;
        setGeneratedSourceSignature(null);

        if (existing) {
          setAssessment(existing);
          setTitle(existing.title);
          setPassingPercentage(Number(existing.passing_percentage));
          setGatekeeperPolicy(existing.gatekeeper_policy);
          setQuestions(existing.questions || []);

          // Load student attempts
          const attemptList = await listTeacherPracticeAttempts(interventionId);
          if (mounted) setAttempts(attemptList);
        } else {
          // Defaults for new practice assessment
          setAssessment(null);
          setTitle("Practice Assessment");
          setPassingPercentage(75);
          setGatekeeperPolicy("REQUIRE_PASS");
          setQuestions([]);
          setAttempts([]);
        }

        if (selectedReadingIds == null && savedReadingIds == null) {
          try {
            const workspace = await getRemediationWorkspace(interventionId);
            if (mounted && workspace?.plan?.selected_resources) {
              const readingIds = workspace.plan.selected_resources
                .filter((r) => r.kind === "CLASSWORK")
                .map((r) => r.id);
              setLoadedReadingIds(readingIds);
            }
          } catch {
            // non-fatal if workspace cannot be fetched
          }
        }
      } catch (err) {
        if (mounted) {
          const msg = err instanceof Error ? err.message : "Failed to load practice assessment.";
          setErrorMessage(msg);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void load();
    return () => {
      mounted = false;
    };
  }, [isOpen, interventionId]);

  // Question CRUD handlers
  const handleAddQuestion = (type: PracticeQuestionType) => {
    if (isLocked) return;

    let defaultOptions = [
      { option_text: "", is_correct: true, option_order: 1 },
      { option_text: "", is_correct: false, option_order: 2 },
      { option_text: "", is_correct: false, option_order: 3 },
      { option_text: "", is_correct: false, option_order: 4 },
    ];

    if (type === "TRUE_FALSE") {
      defaultOptions = [
        { option_text: "True", is_correct: true, option_order: 1 },
        { option_text: "False", is_correct: false, option_order: 2 },
      ];
    } else if (type === "IDENTIFICATION") {
      defaultOptions = [{ option_text: "", is_correct: true, option_order: 1 }];
    }

    const newQ: PracticeQuestionDraft = {
      question_text: "",
      question_type: type,
      points: 1.0,
      explanation: "",
      display_order: questions.length + 1,
      is_ai_generated: false,
      options: defaultOptions,
    };

    setQuestions([...questions, newQ]);
  };

  const handleUpdateQuestion = (index: number, patch: Partial<PracticeQuestionDraft>) => {
    if (isLocked) return;
    const next = [...questions];
    next[index] = { ...next[index], ...patch };
    setQuestions(next);
  };

  const handleDeleteQuestion = (index: number) => {
    if (isLocked) return;
    const next = questions.filter((_, i) => i !== index);
    setQuestions(next);
  };

  const handleMoveQuestion = (index: number, direction: "up" | "down") => {
    if (isLocked) return;
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= questions.length) return;
    const next = [...questions];
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    setQuestions(next);
  };

  // Option handlers for MCQ
  const handleAddOption = (qIdx: number) => {
    if (isLocked) return;
    const q = questions[qIdx];
    if (q.options.length >= 6) return;
    const newOptions = [
      ...q.options,
      { option_text: "", is_correct: false, option_order: q.options.length + 1 },
    ];
    handleUpdateQuestion(qIdx, { options: newOptions });
  };

  const handleRemoveOption = (qIdx: number, optIdx: number) => {
    if (isLocked) return;
    const q = questions[qIdx];
    if (q.options.length <= 2) return;
    const newOptions = q.options.filter((_, i) => i !== optIdx);
    // If the removed option was the correct one, make first option correct
    if (q.options[optIdx]?.is_correct && newOptions.length > 0) {
      newOptions[0].is_correct = true;
    }
    handleUpdateQuestion(qIdx, { options: newOptions });
  };

  const handleSetCorrectOption = (qIdx: number, optIdx: number) => {
    if (isLocked) return;
    const q = questions[qIdx];
    const newOptions = q.options.map((opt, i) => ({
      ...opt,
      is_correct: i === optIdx,
    }));
    handleUpdateQuestion(qIdx, { options: newOptions });
  };

  const handleUpdateOptionText = (qIdx: number, optIdx: number, text: string) => {
    if (isLocked) return;
    const q = questions[qIdx];
    const newOptions = [...q.options];
    newOptions[optIdx] = { ...newOptions[optIdx], option_text: text };
    handleUpdateQuestion(qIdx, { options: newOptions });
  };

  // Import handler
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["docx", "pdf", "txt"].includes(ext)) {
      setErrorMessage("Unsupported file format. Please upload a .docx, .pdf, or .txt quiz document.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setIsImporting(true);
    setErrorMessage(null);
    try {
      const preview = await importPracticeQuestionsPreview(interventionId, file);
      if (preview.questions.length > 0) {
        setQuestions((prev) => [...prev, ...preview.questions]);
        hasLocalDraftRef.current = true;
        if (preview.warnings && preview.warnings.length > 0) {
          toast.warning({
            title: "Import Warnings",
            description: `Imported ${preview.questions.length} questions with ${preview.warnings.length} warning(s).`,
          });
        } else {
          toast.success({
            title: "Questions Imported",
            description: `Imported ${preview.questions.length} questions from ${file.name}.`,
          });
        }
      } else if (preview.warnings && preview.warnings.length > 0) {
        toast.warning({
          title: "Import Warnings",
          description: `${preview.warnings.length} warning(s) found during import.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import questions from file.";
      setErrorMessage(msg);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // AI Generation handler
  const handleGenerateAI = async () => {
    setIsAiGenerating(true);
    setAiError(null);
    setErrorMessage(null);

    // Validate approved reading selection
    if (!effectiveApprovedReadings || effectiveApprovedReadings.length === 0) {
      setAiError(
        "Select supporting reading materials before generating practice questions with AI."
      );
      setIsAiGenerating(false);
      return;
    }

    try {
      const generated = await generatePracticeQuestionsAI(interventionId, {
        target_count: aiTargetCount,
        reading_classwork_ids: effectiveApprovedReadings,
        additional_guidance: aiGuidance.trim() || undefined,
      });

      if (generated.length !== aiTargetCount) {
        setAiError(
          `The AI service returned ${generated.length} of ${aiTargetCount} requested questions. ` +
          "Your current draft was not changed; try again."
        );
      } else {
        // Generation is a replacement operation. Appending caused repeated
        // clicks (or regenerating an existing five-question draft) to become ten.
        setQuestions(generated);
        setGeneratedSourceSignature(currentReadingSignature);
        hasLocalDraftRef.current = true;
        setShowAiDrawer(false);
        setAiGuidance("");
        toast.success({
          title: "AI Questions Generated",
          description: `Generated ${generated.length} multiple-choice questions grounded in selected readings.`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate AI questions.";
      setAiError(msg);
    } finally {
      setIsAiGenerating(false);
    }
  };

  // Validate form questions before saving/publishing
  const validateQuestions = (): string | null => {
    if (isNaN(passingPercentage) || passingPercentage < 0 || passingPercentage > 100) {
      return "Passing percentage must be between 0% and 100%.";
    }
    if (questions.length === 0) {
      return "The Practice Assessment must have at least one question.";
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question_text.trim()) {
        return `Question #${i + 1} has empty question text.`;
      }
      if (q.question_type === "IDENTIFICATION") {
        if (!q.options[0]?.option_text.trim()) {
          return `Question #${i + 1} (Identification) must have an accepted answer.`;
        }
      } else {
        if (q.options.length < 2) {
          return `Question #${i + 1} must have at least 2 options.`;
        }
        if (q.options.some((opt) => !opt.option_text.trim())) {
          return `Question #${i + 1} has empty option text.`;
        }
        if (!q.options.some((opt) => opt.is_correct)) {
          return `Question #${i + 1} must have a designated correct answer.`;
        }
      }
    }
    return null;
  };

  // Save Draft
  const handleSaveDraft = async () => {
    if (generatedSourcesAreStale) {
      setErrorMessage(
        "Selected reading materials changed after AI generation. Regenerate the questions before saving this draft."
      );
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    try {
      // 1. Ensure or update assessment record
      let currentAssessment = assessment;
      if (!currentAssessment) {
        currentAssessment = await initializeTeacherPracticeAssessment(interventionId, {
          title: title.trim() || "Practice Assessment",
          passing_percentage: passingPercentage,
          gatekeeper_policy: gatekeeperPolicy,
        });
      } else {
        currentAssessment = await updateTeacherPracticeAssessment(interventionId, {
          title: title.trim() || "Practice Assessment",
          passing_percentage: passingPercentage,
          gatekeeper_policy: gatekeeperPolicy,
        });
      }

      // 2. Batch save questions if not locked
      if (!isLocked) {
        const savedQuestions = await batchSavePracticeQuestions(interventionId, questions);
        currentAssessment = { ...currentAssessment, questions: savedQuestions };
      }

      setAssessment(currentAssessment);
      hasLocalDraftRef.current = false;
      if (onAssessmentUpdated) onAssessmentUpdated(currentAssessment);

      toast.success({
        title: "Draft Saved",
        description: "Practice Assessment configuration and questions saved.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save practice assessment draft.";
      setErrorMessage(msg);
    } finally {
      setIsSaving(false);
    }
  };

  // Publish Assessment
  const handlePublish = async () => {
    if (generatedSourcesAreStale) {
      setErrorMessage(
        "Selected reading materials changed after AI generation. Regenerate the questions before publishing."
      );
      return;
    }
    const valError = validateQuestions();
    if (valError) {
      setErrorMessage(valError);
      return;
    }

    setIsPublishing(true);
    setErrorMessage(null);
    try {
      // 1. Ensure or update assessment record
      if (!assessment) {
        await initializeTeacherPracticeAssessment(interventionId, {
          title: title.trim() || "Practice Assessment",
          passing_percentage: passingPercentage,
          gatekeeper_policy: gatekeeperPolicy,
        });
      } else {
        await updateTeacherPracticeAssessment(interventionId, {
          title: title.trim() || "Practice Assessment",
          passing_percentage: passingPercentage,
          gatekeeper_policy: gatekeeperPolicy,
        });
      }

      // 2. Batch save questions only if not locked
      if (!isLocked) {
        await batchSavePracticeQuestions(interventionId, questions);
      }

      // 3. Publish
      const published = await publishTeacherPracticeAssessment(interventionId);
      setAssessment(published);
      hasLocalDraftRef.current = false;
      if (onAssessmentUpdated) onAssessmentUpdated(published);

      toast.success({
        title: "Practice Assessment Published",
        description: "Practice assessment is now published and active for this intervention.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to publish practice assessment.";
      setErrorMessage(msg);
    } finally {
      setIsPublishing(false);
    }
  };

  // Archive Assessment
  const handleArchive = async () => {
    setIsArchiving(true);
    setErrorMessage(null);
    try {
      const archived = await archiveTeacherPracticeAssessment(interventionId);
      setAssessment(archived);
      if (onAssessmentUpdated) onAssessmentUpdated(archived);

      toast.success({
        title: "Practice Assessment Archived",
        description: "Practice assessment has been archived.",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to archive practice assessment.";
      setErrorMessage(msg);
    } finally {
      setIsArchiving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="3xl" className="max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <Dialog.Header asChild className="px-5 py-4 border-b-2 border-border">
          <Dialog.Title className="text-xl font-black">
            Practice Assessment
          </Dialog.Title>
        </Dialog.Header>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Dialog.Description className="min-w-0 flex-1 text-sm text-muted-foreground">
              Ungraded assessment completed before remediation
              {studentName ? ` ? Student: ${studentName}` : ""}
            </Dialog.Description>
            {assessment && (
              <Badge variant="solid" size="sm" className="shrink-0">
                {assessment.status}
              </Badge>
            )}
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center p-12">
              <Loader2 className="size-8 animate-spin text-primary" />
              <span className="ml-3 text-sm text-muted-foreground">Loading Practice Assessment...</span>
            </div>
          ) : (
            <>
              {errorMessage && (
                <Alert status="error" className="border-2">
                  <AlertTriangle className="size-4" />
                  <Alert.Title>Error</Alert.Title>
                  <Alert.Description>{errorMessage}</Alert.Description>
                </Alert>
              )}

              {isLocked && (
                <div className="rounded border-2 border-amber-600 bg-amber-100 p-4 text-amber-950 shadow-xs">
                  <div className="flex items-start gap-3">
                    <Lock className="size-5 text-amber-800 shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-1.5">
                      <h5 className="text-amber-950 font-black text-sm">Questions Locked</h5>
                      <p className="text-amber-900 text-sm sm:text-sm font-medium leading-relaxed">
                        Student attempts already exist for this Practice Assessment. Question content is permanently locked
                        to preserve attempt and feedback snapshot integrity. You can still adjust the title, passing percentage,
                        and progression policy.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* General Settings Card */}
              <Card className="w-full shadow-none! flex flex-col gap-4 border-2 border-border p-4">
                <h4 className="font-bold text-base">Configuration & Policies</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Title */}
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <Label htmlFor="practice-title" className="text-sm font-semibold">
                      Assessment Title
                    </Label>
                    <Input
                      id="practice-title"
                      className="w-full"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Practice Assessment"
                    />
                  </div>

                  {/* Passing Percentage */}
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="practice-passing-percent" className="text-sm font-semibold">
                        Passing Percentage (0–100%)
                      </Label>
                      <span className="text-sm font-mono font-bold text-muted-foreground">{passingPercentage}%</span>
                    </div>
                    <Input
                      id="practice-passing-percent"
                      className="w-full"
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={passingPercentage}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (!isNaN(val)) {
                          setPassingPercentage(Math.max(0, Math.min(100, Math.round(val))));
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Progression Policy Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Remediation Progression Policy</Label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {POLICY_OPTIONS.map((policy) => {
                      const isSelected = gatekeeperPolicy === policy.value;
                      return (
                        <div
                          key={policy.value}
                          onClick={() => setGatekeeperPolicy(policy.value)}
                          className={`cursor-pointer rounded! border-2 p-3 transition-colors ${isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/40"
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm">{policy.title}</span>
                            {isSelected && <CheckCircle2 className="size-4 text-primary" />}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{policy.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              {/* Navigation Tabs (Questions vs Attempts) */}
              <Tabs
                tabs={[{ id: "questions", label: "Questions" }, { id: "attempts", label: "Student Attempts" }]}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                counts={{ questions: questions.length, attempts: attempts.length }}
                className="-mx-5!"
                listClassName="px-5!"
                tabClassName="rounded-t-lg!"
              />

              {/* TAB 1: Questions Management */}
              {activeTab === "questions" && (
                <div className="space-y-4">
                  {/* Authoring Actions Bar */}
                  {!isLocked && (
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 p-3 rounded! border-2 border-border">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddQuestion("MULTIPLE_CHOICE")}
                        >
                          <Plus className="size-3.5 " /> Add Multiple Choice
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddQuestion("TRUE_FALSE")}
                        >
                          <Plus className="size-3.5 " /> Add True / False
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddQuestion("IDENTIFICATION")}
                        >
                          <Plus className="size-3.5 " /> Add Identification
                        </Button>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".docx,.pdf,.txt"
                          className="hidden"
                          onChange={handleImportFile}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isImporting}
                          onClick={() => fileInputRef.current?.click()}
                        >
                          {isImporting ? (
                            <Loader2 className="size-3.5  animate-spin" />
                          ) : (
                            <Upload className="size-3.5 " />
                          )}
                          Import (.docx, .pdf, .txt)
                        </Button>

                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => setShowAiDrawer(!showAiDrawer)}
                        >
                          <Sparkles className="size-3.5 " /> Generate with AI
                        </Button>
                      </div>
                    </div>
                  )}



                  {generatedSourcesAreStale && (
                    <Alert status="warning" className="border-2 border-amber-400 bg-amber-50">
                      <AlertTriangle className="size-4 text-amber-600" />
                      <Alert.Title className="text-amber-900 font-bold">
                        Reading materials changed
                      </Alert.Title>
                      <Alert.Description className="text-amber-800">
                        These AI questions were generated from a different reading selection. The questions remain
                        visible for review, but regenerate them before saving or publishing.
                      </Alert.Description>
                    </Alert>
                  )}

                  {/* AI Generation Drawer */}
                  {showAiDrawer && (
                    <Card className="w-full shadow-none! w-full rounded! border-2 border-border bg-card p-4 space-y-4 shadow-none!">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm">AI Practice Question Generation</h4>
                        </div>
                        <Badge variant="surface" size="sm">
                          Multiple Choice Only
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Generates multiple-choice practice questions grounded strictly in the selected reading materials
                        for this intervention.
                      </p>

                      {questions.length > 0 && (
                        <Alert status="warning" className="border-2 border-amber-400 bg-amber-50">
                          <AlertTriangle className="size-4 text-amber-600" />
                          <Alert.Title className="text-amber-900 font-bold">
                            Regeneration replaces the current question draft
                          </Alert.Title>
                          <Alert.Description className="text-amber-800">
                            Review or save the current questions first if you want to keep them. Generated questions are
                            never appended automatically.
                          </Alert.Description>
                        </Alert>
                      )}

                      <div className="flex items-center gap-2 text-sm">
                        <span>
                          Source Readings:{" "}
                          <strong>{effectiveApprovedReadings.length} material(s) selected</strong>
                        </span>
                      </div>

                      {effectiveApprovedReadings.length === 0 && (
                        <p className="text-sm text-muted-foreground">Select supporting reading materials to generate practice questions.</p>
                      )}

                      {aiError && (
                        <FormMessage aria-live="assertive">{aiError}</FormMessage>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor="practice-ai-count" className="text-sm font-semibold">Target Questions Count</Label>
                          <Input
                            type="number"
                            min={1}
                            max={15}
                            id="practice-ai-count"
                            value={aiTargetCount}
                            onChange={(e) =>
                              setAiTargetCount(Math.max(1, Math.min(15, Number(e.target.value) || 1)))
                            }
                          />
                        </div>
                        <div className="sm:col-span-2 flex flex-col gap-1.5">
                          <Label htmlFor="practice-ai-guidance" className="text-sm font-semibold">Focus / Teacher Guidance (Optional)</Label>
                          <Input
                            id="practice-ai-guidance"
                            value={aiGuidance}
                            onChange={(e) => setAiGuidance(e.target.value)}
                            placeholder="e.g. Focus on definitions and key formulas"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setShowAiDrawer(false)}
                          disabled={isAiGenerating}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="default"
                          disabled={
                            isAiGenerating ||
                            effectiveApprovedReadings.length === 0
                          }
                          onClick={handleGenerateAI}
                        >
                          {isAiGenerating ? (
                            <>
                              <Loader2 className="size-3.5  animate-spin" /> Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="size-3.5 " /> {questions.length > 0 ? "Regenerate Questions" : "Generate Questions"}
                            </>
                          )}
                        </Button>
                      </div>
                    </Card>
                  )}

                  {/* Empty State */}
                  {questions.length === 0 ? (
                    <TeacherEmptyState
                      icon={<FileQuestion className="size-5" />}
                      title="No Practice Questions"
                      description="Create questions manually, import from an existing quiz file, or generate questions with AI using selected reading materials."
                    />
                  ) : (
                    /* Question List */
                    <div className="space-y-4">
                      {questions.map((q, qIdx) => (
                        <Card
                          key={qIdx}
                          className="w-full shadow-none! border-2 border-border p-4 space-y-3 relative group"
                        >
                          {/* Question Card Header */}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-black text-sm">#{qIdx + 1}</span>
                              <Badge variant="outline" size="sm">
                                {q.question_type === "MULTIPLE_CHOICE"
                                  ? "Multiple Choice"
                                  : q.question_type === "TRUE_FALSE"
                                    ? "True / False"
                                    : "Identification"}
                              </Badge>
                              {q.is_ai_generated && (
                                <Badge variant="surface" size="sm">
                                  <Sparkles className="size-3 " /> AI Generated
                                </Badge>
                              )}
                            </div>

                            {!isLocked && (
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={qIdx === 0}
                                  onClick={() => handleMoveQuestion(qIdx, "up")}
                                  title="Move Up"
                                >
                                  <ArrowUp className="size-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={qIdx === questions.length - 1}
                                  onClick={() => handleMoveQuestion(qIdx, "down")}
                                  title="Move Down"
                                >
                                  <ArrowDown className="size-3.5" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="text-destructive hover:bg-destructive/10"
                                  onClick={() => handleDeleteQuestion(qIdx)}
                                  title="Delete Question"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Question Text & Points */}
                          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                            <div className="sm:col-span-3 space-y-1">
                              <Label className="text-sm font-semibold">Question Text</Label>
                              <textarea
                                disabled={isLocked}
                                value={q.question_text}
                                onChange={(e) =>
                                  handleUpdateQuestion(qIdx, { question_text: e.target.value })
                                }
                                placeholder="Enter the question prompt..."
                                rows={3}
                                className="w-full rounded! border-2 border-border bg-background p-2.5 text-sm transition focus:outline-hidden focus:border-black min-h-20 disabled:opacity-100 disabled:bg-muted/30 disabled:text-foreground disabled:cursor-default"
                              />
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <Label className="text-sm font-semibold">Points</Label>
                              <Input
                                type="number"
                                min={0.5}
                                step={0.5}
                                disabled={isLocked}
                                value={q.points}
                                onChange={(e) =>
                                  handleUpdateQuestion(qIdx, {
                                    points: Math.max(0.1, Number(e.target.value) || 1.0),
                                  })
                                }
                                className="disabled:opacity-100 disabled:bg-muted/30 disabled:text-foreground disabled:cursor-default"
                              />
                            </div>
                          </div>

                          {/* Options / Answer Keys */}
                          <div className="space-y-2 pt-1">
                            <Label className="text-sm font-semibold">
                              {q.question_type === "IDENTIFICATION"
                                ? "Accepted Answer Key (Exact Match)"
                                : "Answer Options (Select the correct answer)"}
                            </Label>

                            {q.question_type === "IDENTIFICATION" ? (
                              <div className="flex flex-col gap-1.5">
                                <Input
                                  disabled={isLocked}
                                  value={q.options[0]?.option_text || ""}
                                  onChange={(e) => handleUpdateOptionText(qIdx, 0, e.target.value)}
                                  placeholder="Enter accepted answer (case-insensitive)..."
                                  className="disabled:opacity-100 disabled:bg-muted/30 disabled:text-foreground disabled:cursor-default font-mono text-sm"
                                />
                                {isLocked && (
                                  <p className="text-sm text-emerald-700 font-semibold flex items-center gap-1">
                                    <CheckCircle2 className="size-3.5" /> Accepted student answer key
                                  </p>
                                )}
                              </div>
                            ) : q.question_type === "TRUE_FALSE" ? (
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {q.options.map((opt, optIdx) => (
                                  <div
                                    key={optIdx}
                                    onClick={() => !isLocked && handleSetCorrectOption(qIdx, optIdx)}
                                    className={`flex items-center gap-3 p-3 rounded! border-2 border-border transition-colors ${
                                      opt.is_correct
                                        ? "bg-primary/10 text-foreground font-semibold"
                                        : "border-border bg-background text-foreground"
                                    } ${isLocked ? "cursor-default" : "cursor-pointer hover:bg-muted/40"}`}
                                  >
                                    <Checkbox variant="solid" checked={opt.is_correct} disabled={isLocked} onCheckedChange={() => handleSetCorrectOption(qIdx, optIdx)} aria-label={"Mark option " + (optIdx + 1) + " as correct answer"} className="shrink-0 border-border disabled:opacity-100" />
                                    <span className="flex-1 text-sm">{opt.option_text}</span>
                                    {opt.is_correct && (
                                      <Badge variant="success" size="sm" className="shrink-0">Correct</Badge>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              /* MULTIPLE CHOICE */
                              <div className="space-y-2">
                                {q.options.map((opt, optIdx) => (
                                  <div
                                    key={optIdx}
                                    className={`flex flex-wrap items-center gap-3 rounded! border-2 border-border p-3 transition-colors ${
                                      opt.is_correct
                                        ? "bg-primary/10"
                                        : "bg-card"
                                    }`}
                                  >
                                    <Checkbox variant="solid" checked={opt.is_correct} disabled={isLocked} onCheckedChange={() => handleSetCorrectOption(qIdx, optIdx)} aria-label={"Mark option " + (optIdx + 1) + " as correct answer"} className="shrink-0 border-border disabled:opacity-100" />
                                    <Input
                                      disabled={isLocked}
                                      value={opt.option_text}
                                      onChange={(e) =>
                                        handleUpdateOptionText(qIdx, optIdx, e.target.value)
                                      }
                                      placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                                      className="min-w-0 flex-1 disabled:opacity-100 disabled:bg-muted/30 disabled:text-foreground disabled:cursor-default"
                                    />
                                    {opt.is_correct && (
                                      <Badge variant="success" size="sm" className="shrink-0">
                                        Correct
                                      </Badge>
                                    )}
                                    {!isLocked && q.options.length > 2 && (
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="size-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => handleRemoveOption(qIdx, optIdx)}
                                        title="Remove option"
                                      >
                                        <Trash2 className="size-3.5" />
                                      </Button>
                                    )}
                                  </div>
                                ))}

                                {!isLocked && q.options.length < 6 && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleAddOption(qIdx)}
                                    className="text-sm"
                                  >
                                    <Plus className="size-3 " /> Add Option
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Explanation */}
                          <div className="space-y-1 pt-1">
                            <Label className="text-sm font-semibold text-muted-foreground">
                              Explanation / Rationale (Shown after submission)
                            </Label>
                            <textarea
                              disabled={isLocked}
                              value={q.explanation || ""}
                              onChange={(e) =>
                                handleUpdateQuestion(qIdx, { explanation: e.target.value })
                              }
                              placeholder="Explanation for the correct answer..."
                              rows={2}
                              className="w-full rounded! border-2 border-border bg-background p-2.5 text-sm transition focus:outline-hidden focus:border-black min-h-16 disabled:opacity-100 disabled:bg-muted/30 disabled:text-foreground disabled:cursor-default"
                            />
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: Student Attempts */}
              {activeTab === "attempts" && (
                <div className="space-y-4">
                  {attempts.length === 0 ? (
                    <TeacherEmptyState
                      icon={<History className="size-5" />}
                      title="No Student Attempts Yet"
                      description="Once the student starts and submits practice attempts, their scores and timestamps will appear here."
                    />
                  ) : (
                    <div className="space-y-3">
                      {attempts.map((att) => {
                        const isSubmitted = att.status === "SUBMITTED";
                        const isStarted = att.status === "STARTED";

                        return (
                          <Card
                            key={att.attempt_id}
                            className="border-2 border-border p-3 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">Attempt #{att.attempt_number}</span>
                                {isSubmitted ? (
                                  <Badge
                                    variant={att.is_passed ? "solid" : "destructive"}
                                    size="sm"
                                  >
                                    {att.is_passed ? "PASSED" : "BELOW PASSING"}
                                  </Badge>
                                ) : isStarted ? (
                                  <Badge variant="surface" size="sm" className="bg-amber-100 text-amber-900 border-amber-300 font-bold">
                                    IN PROGRESS
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" size="sm">
                                    {att.status}
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                Started: {new Date(att.started_at).toLocaleString("en-PH")}
                                {isSubmitted && att.completed_at
                                  ? ` · Submitted: ${new Date(att.completed_at).toLocaleString("en-PH")}`
                                  : ""}
                              </p>
                            </div>

                            <div className="text-right">
                              {isSubmitted ? (
                                <>
                                  <div className="text-lg font-black">{Number(att.score_percentage).toFixed(1)}%</div>
                                  <div className="text-sm text-muted-foreground">
                                    {Number(att.total_score).toFixed(1)} / {Number(att.max_score).toFixed(1)} pts
                                  </div>
                                </>
                              ) : isStarted ? (
                                <div className="text-sm font-semibold text-muted-foreground italic">
                                  Draft In Progress
                                </div>
                              ) : (
                                <div className="text-sm font-semibold text-muted-foreground">
                                  {att.status}
                                </div>
                              )}
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <Dialog.Footer className="px-5 py-3 border-t-2 border-border flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="mr-auto"
            disabled={isSaving || isPublishing || isArchiving}
            onClick={onClose}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            {assessment && assessment.status === "PUBLISHED" && (
              <Button
                variant="outline"
                size="sm"
                disabled={isArchiving || isSaving || isPublishing}
                onClick={handleArchive}
                className="text-muted-foreground hover:text-foreground"
              >
                {isArchiving ? <Loader2 className="size-3.5  animate-spin" /> : null}
                Archive
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={isSaving || isPublishing || isArchiving}
              onClick={handleSaveDraft}
            >
              {isSaving ? <Loader2 className="size-3.5  animate-spin" /> : null}
              Save Draft
            </Button>

            <Button
              variant="default"
              size="sm"
              disabled={isPublishing || isSaving || isArchiving || questions.length === 0}
              onClick={handlePublish}
            >
              {isPublishing ? <Loader2 className="size-3.5  animate-spin" /> : null}
              {assessment?.status === "PUBLISHED" ? "Re-publish" : "Publish Assessment"}
            </Button>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
