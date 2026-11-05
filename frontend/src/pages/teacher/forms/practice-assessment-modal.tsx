import { useState, useEffect, useRef } from "react";
import { Dialog } from "@/components/retroui/Dialog";
import { Button } from "@/components/teacher/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Alert } from "@/components/retroui/Alert";
import { useToast } from "@/components/retroui/Toast";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Sparkles,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Lock,
  FileQuestion,
  Loader2,
  BookOpen,
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

interface PracticeAssessmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  interventionId: number;
  studentName?: string;
  selectedReadingIds?: number[];
  savedReadingIds?: number[];
  hasUnsavedReadingChanges?: boolean;
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
  selectedReadingIds = [],
  savedReadingIds,
  hasUnsavedReadingChanges = false,
  onAssessmentUpdated,
}: PracticeAssessmentModalProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const effectiveApprovedReadings = savedReadingIds !== undefined ? savedReadingIds : selectedReadingIds;

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

  // Import State
  const [isImporting, setIsImporting] = useState(false);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);

  // Questions are locked if student attempts exist
  const isLocked = attempts.length > 0;

  // Load existing assessment and attempts
  useEffect(() => {
    if (!isOpen) return;

    let mounted = true;
    const load = async () => {
      setIsLoading(true);
      setErrorMessage(null);
      setImportWarnings([]);
      setShowAiDrawer(false);
      try {
        const existing = await getTeacherPracticeAssessment(interventionId);
        if (!mounted) return;

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
    setImportWarnings([]);
    try {
      // If assessment does not exist on backend yet, create draft assessment first
      if (!assessment) {
        const created = await initializeTeacherPracticeAssessment(interventionId, {
          title,
          passing_percentage: passingPercentage,
          gatekeeper_policy: gatekeeperPolicy,
        });
        setAssessment(created);
      }

      const preview = await importPracticeQuestionsPreview(interventionId, file);
      if (preview.questions.length > 0) {
        setQuestions((prev) => [...prev, ...preview.questions]);
        toast({
          title: "Questions Imported",
          description: `Imported ${preview.questions.length} questions from ${file.name}. Review and save draft.`,
          variant: "success",
        });
      }
      if (preview.warnings && preview.warnings.length > 0) {
        setImportWarnings(preview.warnings);
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

    // Guard against unsaved reading selection in intervention workspace
    if (hasUnsavedReadingChanges) {
      setAiError(
        "You have unsaved changes to your supporting reading materials in the intervention plan. Save the intervention plan first so questions are grounded in approved materials."
      );
      setIsAiGenerating(false);
      return;
    }

    // Validate approved reading selection
    if (!effectiveApprovedReadings || effectiveApprovedReadings.length === 0) {
      setAiError(
        "No approved supporting reading materials are currently saved for this intervention. Please select and save reading materials under Supporting Resources before generating practice questions with AI."
      );
      setIsAiGenerating(false);
      return;
    }

    try {
      // Ensure assessment exists on backend
      if (!assessment) {
        const created = await initializeTeacherPracticeAssessment(interventionId, {
          title,
          passing_percentage: passingPercentage,
          gatekeeper_policy: gatekeeperPolicy,
        });
        setAssessment(created);
      }

      const generated = await generatePracticeQuestionsAI(interventionId, {
        target_count: aiTargetCount,
        reading_classwork_ids: effectiveApprovedReadings,
        additional_guidance: aiGuidance.trim() || undefined,
      });

      if (generated.length === 0) {
        setAiError("The AI service did not generate any questions from the reading materials.");
      } else {
        setQuestions((prev) => [...prev, ...generated]);
        setShowAiDrawer(false);
        setAiGuidance("");
        toast({
          title: "AI Questions Generated",
          description: `Generated ${generated.length} multiple-choice questions grounded in selected readings.`,
          variant: "success",
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
      if (onAssessmentUpdated) onAssessmentUpdated(currentAssessment);

      toast({
        title: "Draft Saved",
        description: "Practice Assessment configuration and questions saved.",
        variant: "success",
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
      if (onAssessmentUpdated) onAssessmentUpdated(published);

      toast({
        title: "Practice Assessment Published",
        description: "Practice assessment is now published and active for this intervention.",
        variant: "success",
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
      <Dialog.Content size="2xl" className="max-h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <Dialog.Header className="px-5 py-4 border-b-2 border-border">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Dialog.Title className="text-xl font-black">
                Practice Assessment
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                Ungraded assessment completed before remediation
                {studentName ? ` · Student: ${studentName}` : ""}
              </Dialog.Description>
            </div>
            <div className="flex items-center gap-2">
              {assessment && (
                <Badge
                  variant={
                    assessment.status === "PUBLISHED"
                      ? "solid"
                      : assessment.status === "ARCHIVED"
                        ? "outline"
                        : "surface"
                  }
                  size="md"
                >
                  {assessment.status}
                </Badge>
              )}
            </div>
          </div>
        </Dialog.Header>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
                <Alert status="warning" className="border-2 border-amber-500/50 bg-amber-50 dark:bg-amber-950/20">
                  <Lock className="size-4 text-amber-600 dark:text-amber-400" />
                  <Alert.Title className="text-amber-900 dark:text-amber-200">
                    Questions Locked
                  </Alert.Title>
                  <Alert.Description className="text-amber-800 dark:text-amber-300">
                    Student attempts already exist for this Practice Assessment. Question content is permanently locked
                    to preserve attempt and feedback snapshot integrity. You can still adjust the title, passing percentage,
                    and progression policy.
                  </Alert.Description>
                </Alert>
              )}

              {/* General Settings Card */}
              <Card className="flex flex-col gap-4 border-2 border-border p-4">
                <h4 className="font-bold text-base">Configuration & Policies</h4>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Title */}
                  <div className="space-y-1.5">
                    <Label htmlFor="practice-title" className="text-sm font-semibold">
                      Assessment Title
                    </Label>
                    <Input
                      id="practice-title"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Practice Assessment"
                    />
                  </div>

                  {/* Passing Percentage */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="practice-passing-percent" className="text-sm font-semibold">
                        Passing Percentage (0–100%)
                      </Label>
                      <span className="text-xs font-mono font-bold text-muted-foreground">{passingPercentage}%</span>
                    </div>
                    <Input
                      id="practice-passing-percent"
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
                          className={`cursor-pointer rounded border-2 p-3 transition-colors ${isSelected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/40"
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm">{policy.title}</span>
                            {isSelected && <CheckCircle2 className="size-4 text-primary" />}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{policy.description}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </Card>

              {/* Navigation Tabs (Questions vs Attempts) */}
              <div className="flex border-b-2 border-border gap-2">
                <button
                  type="button"
                  onClick={() => setActiveTab("questions")}
                  className={`pb-2 px-3 font-bold text-sm border-b-2 transition-colors ${activeTab === "questions"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Questions ({questions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("attempts")}
                  className={`pb-2 px-3 font-bold text-sm border-b-2 transition-colors ${activeTab === "attempts"
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                >
                  Student Attempts ({attempts.length})
                </button>
              </div>

              {/* TAB 1: Questions Management */}
              {activeTab === "questions" && (
                <div className="space-y-4">
                  {/* Authoring Actions Bar */}
                  {!isLocked && (
                    <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/40 p-3 rounded border-2 border-border">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddQuestion("MULTIPLE_CHOICE")}
                        >
                          <Plus className="size-3.5 mr-1" /> Add Multiple Choice
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddQuestion("TRUE_FALSE")}
                        >
                          <Plus className="size-3.5 mr-1" /> Add True / False
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleAddQuestion("IDENTIFICATION")}
                        >
                          <Plus className="size-3.5 mr-1" /> Add Identification
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
                            <Loader2 className="size-3.5 mr-1 animate-spin" />
                          ) : (
                            <Upload className="size-3.5 mr-1" />
                          )}
                          Import (.docx, .pdf, .txt)
                        </Button>

                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => setShowAiDrawer(!showAiDrawer)}
                        >
                          <Sparkles className="size-3.5 mr-1" /> Generate with AI
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Import Warnings */}
                  {importWarnings.length > 0 && (
                    <Alert status="warning" className="border-2 border-amber-400 bg-amber-50">
                      <AlertTriangle className="size-4 text-amber-600" />
                      <Alert.Title className="text-amber-900 font-bold">Import Warnings</Alert.Title>
                      <Alert.Description>
                        <ul className="list-disc pl-4 text-xs space-y-1 text-amber-800">
                          {importWarnings.map((w, idx) => (
                            <li key={idx}>{w}</li>
                          ))}
                        </ul>
                      </Alert.Description>
                    </Alert>
                  )}

                  {/* AI Generation Drawer */}
                  {showAiDrawer && (
                    <Card className="border-2 border-primary bg-primary/5 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="size-4 text-primary" />
                          <h4 className="font-bold text-sm">AI Practice Question Generation</h4>
                        </div>
                        <Badge variant="surface" size="sm">
                          Multiple Choice Only
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Generates multiple-choice practice questions grounded strictly in the selected reading materials
                        for this intervention.
                      </p>

                      <div className="flex items-center gap-2 text-xs">
                        <BookOpen className="size-4 text-primary" />
                        <span>
                          Source Readings:{" "}
                          <strong>{effectiveApprovedReadings.length} approved material(s) saved</strong>
                        </span>
                      </div>

                      {hasUnsavedReadingChanges && (
                        <Alert status="warning" className="border-2 border-amber-400 bg-amber-50">
                          <AlertTriangle className="size-4 text-amber-600" />
                          <Alert.Title className="text-amber-900 font-bold text-xs">Unsaved Reading Selections</Alert.Title>
                          <Alert.Description className="text-xs text-amber-800">
                            You have unsaved changes to your supporting reading materials in the intervention plan.
                            Please save the intervention plan first before generating practice questions with AI.
                          </Alert.Description>
                        </Alert>
                      )}

                      {!hasUnsavedReadingChanges && effectiveApprovedReadings.length === 0 && (
                        <Alert status="info" className="border">
                          <AlertTriangle className="size-4" />
                          <Alert.Title className="font-bold text-xs">No Saved Reading Materials</Alert.Title>
                          <Alert.Description className="text-xs">
                            No approved supporting reading materials are currently saved for this intervention.
                            Please select and save reading materials under Supporting Resources before generating practice questions.
                          </Alert.Description>
                        </Alert>
                      )}

                      {aiError && (
                        <Alert status="error" className="border">
                          <AlertTriangle className="size-3.5" />
                          <Alert.Description className="text-xs">{aiError}</Alert.Description>
                        </Alert>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-semibold">Target Questions Count</Label>
                          <Input
                            type="number"
                            min={1}
                            max={20}
                            value={aiTargetCount}
                            onChange={(e) =>
                              setAiTargetCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                            }
                          />
                        </div>
                        <div className="sm:col-span-2 space-y-1">
                          <Label className="text-xs font-semibold">Focus / Teacher Guidance (Optional)</Label>
                          <Input
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
                            hasUnsavedReadingChanges ||
                            effectiveApprovedReadings.length === 0
                          }
                          onClick={handleGenerateAI}
                        >
                          {isAiGenerating ? (
                            <>
                              <Loader2 className="size-3.5 mr-1.5 animate-spin" /> Generating...
                            </>
                          ) : (
                            <>
                              <Sparkles className="size-3.5 mr-1.5" /> Generate Questions
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
                          className="border-2 border-border p-4 space-y-3 relative group"
                        >
                          {/* Question Card Header */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
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
                                  <Sparkles className="size-3 mr-1" /> AI Generated
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
                              <Label className="text-xs font-semibold">Question Text</Label>
                              <Input
                                disabled={isLocked}
                                value={q.question_text}
                                onChange={(e) =>
                                  handleUpdateQuestion(qIdx, { question_text: e.target.value })
                                }
                                placeholder="Enter the question prompt..."
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs font-semibold">Points</Label>
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
                              />
                            </div>
                          </div>

                          {/* Options / Answer Keys */}
                          <div className="space-y-2 pt-1">
                            <Label className="text-xs font-semibold">
                              {q.question_type === "IDENTIFICATION"
                                ? "Accepted Answer Key (Exact Match)"
                                : "Answer Options (Select the correct answer)"}
                            </Label>

                            {q.question_type === "IDENTIFICATION" ? (
                              <Input
                                disabled={isLocked}
                                value={q.options[0]?.option_text || ""}
                                onChange={(e) => handleUpdateOptionText(qIdx, 0, e.target.value)}
                                placeholder="Enter accepted answer (case-insensitive)..."
                              />
                            ) : q.question_type === "TRUE_FALSE" ? (
                              <div className="grid grid-cols-2 gap-2">
                                {q.options.map((opt, optIdx) => (
                                  <div
                                    key={optIdx}
                                    onClick={() => !isLocked && handleSetCorrectOption(qIdx, optIdx)}
                                    className={`flex items-center justify-between p-2.5 rounded border-2 cursor-pointer transition-colors ${opt.is_correct
                                      ? "border-primary bg-primary/10 font-bold"
                                      : "border-border hover:bg-muted/40"
                                      }`}
                                  >
                                    <span className="text-sm">{opt.option_text}</span>
                                    {opt.is_correct && <CheckCircle2 className="size-4 text-primary" />}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              /* MULTIPLE CHOICE */
                              <div className="space-y-2">
                                {q.options.map((opt, optIdx) => (
                                  <div key={optIdx} className="flex items-center gap-2">
                                    <input
                                      type="radio"
                                      name={`correct-opt-${qIdx}`}
                                      checked={opt.is_correct}
                                      disabled={isLocked}
                                      onChange={() => handleSetCorrectOption(qIdx, optIdx)}
                                      className="size-4 text-primary cursor-pointer"
                                      title="Mark as correct answer"
                                    />
                                    <Input
                                      disabled={isLocked}
                                      value={opt.option_text}
                                      onChange={(e) =>
                                        handleUpdateOptionText(qIdx, optIdx, e.target.value)
                                      }
                                      placeholder={`Option ${String.fromCharCode(65 + optIdx)}`}
                                      className="flex-1"
                                    />
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
                                    className="text-xs"
                                  >
                                    <Plus className="size-3 mr-1" /> Add Option
                                  </Button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Explanation */}
                          <div className="space-y-1 pt-1">
                            <Label className="text-xs font-semibold text-muted-foreground">
                              Explanation / Rationale (Shown after submission)
                            </Label>
                            <Input
                              disabled={isLocked}
                              value={q.explanation || ""}
                              onChange={(e) =>
                                handleUpdateQuestion(qIdx, { explanation: e.target.value })
                              }
                              placeholder="Explanation for the correct answer..."
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
                      {attempts.map((att) => (
                        <Card
                          key={att.attempt_id}
                          className="border-2 border-border p-3 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm">Attempt #{att.attempt_number}</span>
                              <Badge
                                variant={att.is_passed ? "solid" : "destructive"}
                                size="sm"
                              >
                                {att.is_passed ? "PASSED" : "BELOW PASSING"}
                              </Badge>
                              <Badge variant="outline" size="sm">
                                {att.status}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Started: {new Date(att.started_at).toLocaleString("en-PH")}
                              {att.completed_at
                                ? ` · Submitted: ${new Date(att.completed_at).toLocaleString("en-PH")}`
                                : ""}
                            </p>
                          </div>

                          <div className="text-right">
                            <div className="text-lg font-black">{Number(att.score_percentage).toFixed(1)}%</div>
                            <div className="text-xs text-muted-foreground">
                              {Number(att.total_score).toFixed(1)} / {Number(att.max_score).toFixed(1)} pts
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Actions */}
        <Dialog.Footer className="px-5 py-3 border-t-2 border-border flex flex-wrap items-center justify-between gap-2 bg-muted/20">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
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
                {isArchiving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
                Archive
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={isSaving || isPublishing || isArchiving}
              onClick={handleSaveDraft}
            >
              {isSaving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
              Save Draft
            </Button>

            <Button
              variant="default"
              size="sm"
              disabled={isPublishing || isSaving || isArchiving || questions.length === 0}
              onClick={handlePublish}
            >
              {isPublishing ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : null}
              {assessment?.status === "PUBLISHED" ? "Re-publish" : "Publish Assessment"}
            </Button>
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
