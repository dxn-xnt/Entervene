import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  RefreshCw,
  Pencil,
  Lock,
  ExternalLink,
  Save,
} from "lucide-react";
import { Dialog } from "@/components/retroui/Dialog";
import { Badge } from "@/components/retroui/Badge";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/teacher/button";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import type {
  RemediationGeneratedDraft,
  RemediationAssessmentCreateResult,
  RemediationPlan,
  RemediationQuizDraft,
  RemediationClassworkDraft,
  RemediationQuizQuestionDraft,
  RemediationTeacherAnswerKey,
  RemediationTaskDraft,
  RemediationDeliverableDraft,
  RemediationRubricLevelDraft,
  RemediationTeacherClassworkGuide,
} from "@/lib/teacher-interventions-api";
export interface DraftValidationResult {
  isValid: boolean;
  issues: string[];
}

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const componentLabel = (value: string | null | undefined) =>
  value
    ? value
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Teacher review required";

export interface AiRemediationDraftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generatingDraft: boolean;
  generationError: string | null;
  generatedDraft: RemediationGeneratedDraft | null;
  setGeneratedDraft: React.Dispatch<
    React.SetStateAction<RemediationGeneratedDraft | null>
  >;
  draftSaveState: "idle" | "validating" | "saving" | "saved" | "error";
  draftSaveError: string | null;
  savedAssessment: RemediationAssessmentCreateResult | null;
  isEditingDraft: boolean;
  setIsEditingDraft: (editing: boolean) => void;
  quizQuestionMode?: "NEW_TARGETED" | "REUSE_ORIGINAL";
  setQuizQuestionMode?: (mode: "NEW_TARGETED" | "REUSE_ORIGINAL") => void;
  draftValidation: DraftValidationResult;
  capInput?: string;
  plan: RemediationPlan;
  targetAssignmentSummary: string;
  onGenerateWithAI: () => void | Promise<void>;
  onSaveAssessmentDraft: () => void | Promise<void>;
  onUpdateQuizQuestion?: (
    qIndex: number,
    updates: Partial<RemediationQuizQuestionDraft>
  ) => void;
  onUpdateQuizOption?: (
    qIndex: number,
    optIndex: number,
    option_text: string
  ) => void;
  onUpdateQuizAnswerKey?: (
    qIndex: number,
    updates: Partial<RemediationTeacherAnswerKey>
  ) => void;
  onUpdateClassworkTask?: (
    tIndex: number,
    updates: Partial<RemediationTaskDraft>
  ) => void;
  onUpdateClassworkDeliverable?: (
    dIndex: number,
    updates: Partial<RemediationDeliverableDraft>
  ) => void;
  onUpdateClassworkRubricLevel?: (
    rIndex: number,
    updates: Partial<RemediationRubricLevelDraft>
  ) => void;
  onUpdateClassworkTeacherGuide?: (
    updates: Partial<RemediationTeacherClassworkGuide>
  ) => void;
}

export default function AiRemediationDraftModal({
  open,
  onOpenChange,
  generatingDraft,
  generationError,
  generatedDraft,
  setGeneratedDraft,
  draftSaveState,
  draftSaveError,
  savedAssessment,
  isEditingDraft,
  setIsEditingDraft,
  quizQuestionMode,
  setQuizQuestionMode,
  draftValidation,
  capInput,
  plan,
  targetAssignmentSummary,
  onGenerateWithAI,
  onSaveAssessmentDraft,
  onUpdateQuizQuestion,
  onUpdateQuizOption,
  onUpdateQuizAnswerKey,
  onUpdateClassworkTask,
  onUpdateClassworkDeliverable,
  onUpdateClassworkRubricLevel,
  onUpdateClassworkTeacherGuide,
}: AiRemediationDraftModalProps) {
  const navigate = useNavigate();
  const [internalQuizQuestionMode, setInternalQuizQuestionMode] = useState<
    "NEW_TARGETED" | "REUSE_ORIGINAL"
  >("NEW_TARGETED");

  const currentQuizQuestionMode = quizQuestionMode ?? internalQuizQuestionMode;
  const handleQuizQuestionModeChange =
    setQuizQuestionMode ?? setInternalQuizQuestionMode;

  const updateQuizQuestion =
    onUpdateQuizQuestion ??
    ((qIndex: number, updates: Partial<RemediationQuizQuestionDraft>) => {
      if (generatedDraft?.draft_format !== "QUIZ") return;
      const quizDraft = generatedDraft as RemediationQuizDraft;
      const newQuestions = [...quizDraft.questions];
      newQuestions[qIndex] = { ...newQuestions[qIndex], ...updates };
      const newTotal = newQuestions.reduce(
        (sum, q) => sum + (Number(q.points) || 0),
        0
      );
      setGeneratedDraft({
        ...quizDraft,
        questions: newQuestions,
        total_points: newTotal,
      });
    });

  const updateQuizOption =
    onUpdateQuizOption ??
    ((qIndex: number, optIndex: number, option_text: string) => {
      if (generatedDraft?.draft_format !== "QUIZ") return;
      const quizDraft = generatedDraft as RemediationQuizDraft;
      const newQuestions = [...quizDraft.questions];
      const newOptions = [...newQuestions[qIndex].options];
      newOptions[optIndex] = { ...newOptions[optIndex], option_text };
      newQuestions[qIndex] = { ...newQuestions[qIndex], options: newOptions };
      setGeneratedDraft({
        ...quizDraft,
        questions: newQuestions,
      });
    });

  const updateQuizAnswerKey =
    onUpdateQuizAnswerKey ??
    ((qIndex: number, updates: Partial<RemediationTeacherAnswerKey>) => {
      if (generatedDraft?.draft_format !== "QUIZ") return;
      const quizDraft = generatedDraft as RemediationQuizDraft;
      const newQuestions = [...quizDraft.questions];
      newQuestions[qIndex] = {
        ...newQuestions[qIndex],
        teacher_answer_key: {
          ...newQuestions[qIndex].teacher_answer_key,
          ...updates,
        },
      };
      setGeneratedDraft({
        ...quizDraft,
        questions: newQuestions,
      });
    });

  const updateClassworkTask =
    onUpdateClassworkTask ??
    ((tIndex: number, updates: Partial<RemediationTaskDraft>) => {
      if (generatedDraft?.draft_format !== "CLASSWORK") return;
      const cwDraft = generatedDraft as RemediationClassworkDraft;
      const newTasks = [...cwDraft.tasks];
      newTasks[tIndex] = { ...newTasks[tIndex], ...updates };
      setGeneratedDraft({
        ...cwDraft,
        tasks: newTasks,
      });
    });

  const updateClassworkDeliverable =
    onUpdateClassworkDeliverable ??
    ((dIndex: number, updates: Partial<RemediationDeliverableDraft>) => {
      if (generatedDraft?.draft_format !== "CLASSWORK") return;
      const cwDraft = generatedDraft as RemediationClassworkDraft;
      const newDeliverables = [...cwDraft.deliverables];
      newDeliverables[dIndex] = { ...newDeliverables[dIndex], ...updates };
      setGeneratedDraft({
        ...cwDraft,
        deliverables: newDeliverables,
      });
    });

  const updateClassworkRubricLevel =
    onUpdateClassworkRubricLevel ??
    ((rIndex: number, updates: Partial<RemediationRubricLevelDraft>) => {
      if (generatedDraft?.draft_format !== "CLASSWORK") return;
      const cwDraft = generatedDraft as RemediationClassworkDraft;
      const newLevels = [...cwDraft.rubric_levels];
      newLevels[rIndex] = { ...newLevels[rIndex], ...updates };
      const maxRubric = newLevels.reduce(
        (max, r) => Math.max(max, Number(r.points) || 0),
        0
      );
      setGeneratedDraft({
        ...cwDraft,
        rubric_levels: newLevels,
        total_points: maxRubric > 0 ? maxRubric : cwDraft.total_points,
      });
    });

  const updateClassworkTeacherGuide =
    onUpdateClassworkTeacherGuide ??
    ((updates: Partial<RemediationTeacherClassworkGuide>) => {
      if (generatedDraft?.draft_format !== "CLASSWORK") return;
      const cwDraft = generatedDraft as RemediationClassworkDraft;
      setGeneratedDraft({
        ...cwDraft,
        teacher_guide: {
          ...cwDraft.teacher_guide,
          ...updates,
        },
      });
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (generatingDraft && !nextOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <Dialog.Content size="xl" className="max-h-[90vh] flex flex-col">
        <Dialog.Header>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Dialog.Title className="text-lg font-bold flex items-center gap-2">
                AI Remediation Draft Preview
              </Dialog.Title>
              <Badge variant="surface" size="sm">Teacher Review Only</Badge>
            </div>
            <Badge variant="outline" size="sm">
              {draftSaveState === "saved" ? "Saved Unpublished" : "Unsaved Draft"}
            </Badge>
          </div>

        </Dialog.Header>

        <div className="flex-1 space-y-4 overflow-y-auto p-4 pr-3">
          <Dialog.Description className="text-sm text-muted-foreground">
            Teacher evaluation preview grounded in verified student weaknesses and taught lessons.
          </Dialog.Description>


          {generatingDraft && (
            <div className="flex flex-col items-center justify-center p-8 gap-3 border-2 border-border rounded bg-card text-center">
              <RefreshCw className="size-8 animate-spin text-primary" />
              <h4 className="font-bold text-base">Generating Remediation Draft…</h4>
              <p className="text-sm text-muted-foreground max-w-md">
                Grounded in student weaknesses, eligible taught lessons, and verified learning materials.
              </p>
            </div>
          )}

          {!generatingDraft && generationError && (
            <div className="flex flex-col gap-3">
              <Alert status="error">
                <div className="flex flex-col gap-1">
                  <strong className="font-bold">Remediation Draft Generation Failed</strong>
                  <span>{generationError}</span>
                </div>
              </Alert>
              <p className="text-sm text-muted-foreground px-1">
                All your selected targets, readings, and manual authoring options remain preserved.
                You may retry generation or continue using the manual authoring builder.
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                  Dismiss
                </Button>
                <Button size="sm" onClick={onGenerateWithAI}>
                  Retry Generation
                </Button>
              </div>
            </div>
          )}

          {!generatingDraft && generatedDraft && (
            <div className="flex flex-col gap-4">
              {draftSaveState === "saved" && savedAssessment && (
                <Alert status="success">
                  <div className="flex flex-col gap-1 text-sm">
                    <strong className="font-bold">Assessment draft saved</strong>
                    <span>
                      This assessment is unpublished and unavailable to students. Publication readiness is checked separately when you choose to publish it.
                    </span>
                  </div>
                </Alert>
              )}
              {draftSaveState === "error" && draftSaveError && (
                <Alert status="error">
                  <div className="flex flex-col gap-1 text-sm">
                    <strong className="font-bold">Assessment draft was not saved</strong>
                    <span>{draftSaveError}</span>
                  </div>
                </Alert>
              )}
              {/* Academic Treatment & Score Adjustment Context Banner */}
              <Card className="p-3 border-2 border-border bg-muted/20 flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-foreground">
                      Academic Treatment & Score Adjustment Context
                    </span>
                  </div>

                </div>
                <div className="grid grid-cols-5 gap-2 text-sm">
                  <Card className="border-2! p-2 flex flex-col gap-1 col-span-1">
                    <span className="font-semibold">Grade Treatment</span>
                    <span className="text-sm text-foreground font-normal">
                      {plan.grade_treatment === "PRACTICE_ONLY"
                        ? "Ungraded Practice"
                        : componentLabel(plan.grade_treatment ?? "PRACTICE_ONLY")}
                    </span>
                  </Card>
                  <Card className="border-2! p-2 flex flex-col gap-1 col-span-2">
                    <span className="font-semibold">Original Target Assignment</span>
                    <span className="text-sm text-foreground font-normal">
                      {targetAssignmentSummary}
                    </span>
                  </Card>
                  <Card className="border-2! p-2 flex flex-col gap-1 col-span-2">
                    <span className="font-semibold">Adjustment Cap </span>
                    <span className="text-sm text-foreground font-normal">
                      Capped at {capInput || plan.score_adjustment_cap || 75}% of original max points.
                    </span>
                  </Card>
                </div>
              </Card>

              {/* Draft Title, Metadata & Action Bar */}
              <Card className="flex flex-col gap-2 p-3 bg-primary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {isEditingDraft ? (
                    <div className="flex flex-col gap-1 flex-1 min-w-[240px]">
                      <Label htmlFor="draft-title-input" className="text-xs font-bold">Remediation Title</Label>
                      <Input
                        id="draft-title-input"
                        aria-label="Remediation Title"
                        value={generatedDraft.title}
                        onChange={(e) =>
                          setGeneratedDraft({ ...generatedDraft, title: e.target.value })
                        }
                        className="font-bold text-base h-9"
                      />
                    </div>
                  ) : (
                    <span className="font-black text-lg">{generatedDraft.title}</span>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="solid" size="sm">
                      {generatedDraft.draft_format}
                    </Badge>
                    <Badge variant="outline" size="sm">
                      {componentLabel(generatedDraft.target_component)}
                    </Badge>
                    <Badge variant="surface" size="sm">
                      {generatedDraft.total_points} Total Points
                    </Badge>
                    {draftValidation.isValid ? (
                      <Badge
                        variant="surface"
                        size="sm"
                        className="bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold"
                      >
                        Draft Complete
                      </Badge>
                    ) : (
                      <Badge variant="destructive" size="sm">
                        {draftValidation.issues.length}{" "}
                        {draftValidation.issues.length === 1 ? "Incomplete Field" : "Incomplete Fields"}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>

              {/* Incomplete Issues Alert */}
              {!draftValidation.isValid && isEditingDraft && (
                <Alert status="warning">
                  <div className="flex flex-col gap-1 text-xs">
                    <strong className="font-bold">Please complete the required fields:</strong>
                    <ul className="list-disc list-inside space-y-0.5">
                      {draftValidation.issues.slice(0, 5).map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                      {draftValidation.issues.length > 5 && (
                        <li>...and {draftValidation.issues.length - 5} more issues</li>
                      )}
                    </ul>
                  </div>
                </Alert>
              )}

              {generatedDraft.draft_format === "QUIZ" && (
                <Card className="flex flex-col gap-1.5 p-3 border-2 border-border rounded bg-card">
                  <Label className="font-bold text-sm">Question Selection Mode</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Card
                      className={`p-2.5 border-2 transition-all border-2! cursor-pointer ${currentQuizQuestionMode === "NEW_TARGETED"
                        ? "border-primary bg-primary"
                        : "border-border"
                        }`}
                      onClick={() => handleQuizQuestionModeChange("NEW_TARGETED")}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">Generate New Targeted Questions</span>
                        <Badge variant="solid" size="sm">Supported</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Generates new practice items targeting verified weak competencies and lessons.
                      </p>
                    </Card>

                    <Card
                      className="p-2.5 border-2! border-border opacity-60 cursor-not-allowed bg-muted/20"
                      aria-disabled="true"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">Reuse Original Questions</span>
                        <Badge variant="outline" size="sm">Unsupported</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Backend assessment service does not support verbatim question extraction.
                      </p>
                    </Card>
                  </div>
                </Card>
              )}

              {generatedDraft.draft_format === "QUIZ" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor="quiz-instructions-input" className="font-bold text-sm">Student Instructions</Label>
                    {isEditingDraft ? (
                      <textarea
                        id="quiz-instructions-input"
                        aria-label="Student Instructions"
                        className="w-full rounded-[var(--radius)]! border-2 rounded! border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[70px]"
                        value={generatedDraft.instructions}
                        onChange={(e) =>
                          setGeneratedDraft({ ...generatedDraft, instructions: e.target.value })
                        }
                      />
                    ) : (
                      <div className="p-3 border-2 rounded! bg-background text-sm">
                        {generatedDraft.instructions}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <Label className="font-bold text-sm">
                        Student Questions ({generatedDraft.questions.length} items)
                      </Label>
                      <span className="text-xs text-muted-foreground">Answer keys separated below</span>
                    </div>

                    {generatedDraft.questions.map((q, idx) => (
                      <Card key={q.display_order ?? idx} className="p-3 flex rounded! flex-col gap-2 border-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" size="sm">Item {q.display_order}</Badge>
                            <span className="font-bold text-sm">{label(q.question_type)}</span>
                            {q.difficulty_level && (
                              <Badge variant="surface" size="sm">{q.difficulty_level}</Badge>
                            )}
                          </div>
                          {isEditingDraft ? (
                            <div className="flex items-center gap-1.5">
                              <Label htmlFor={`quiz-points-${idx}`} className="text-xs font-bold">Points:</Label>
                              <Input
                                id={`quiz-points-${idx}`}
                                aria-label="Points:"
                                type="number"
                                min="1"
                                value={q.points}
                                onChange={(e) =>
                                  updateQuizQuestion(idx, {
                                    points: Math.max(1, parseInt(e.target.value, 10) || 1),
                                  })
                                }
                                className="w-16 h-8 px-2 text-center text-xs font-bold"
                              />
                            </div>
                          ) : (
                            <span className="text-xs font-bold">{q.points} {q.points === 1 ? "point" : "points"}</span>
                          )}
                        </div>

                        {isEditingDraft ? (
                          <div className="flex flex-col gap-1">
                            <Label htmlFor={`quiz-prompt-${idx}`} className="text-xs font-bold">Question Prompt</Label>
                            <textarea
                              id={`quiz-prompt-${idx}`}
                              aria-label="Question Prompt"
                              className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[50px]"
                              value={q.question_text}
                              onChange={(e) =>
                                updateQuizQuestion(idx, { question_text: e.target.value })
                              }
                            />
                          </div>
                        ) : (
                          <p className="text-sm font-medium">{q.question_text}</p>
                        )}

                        {q.options && q.options.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1">
                            {q.options.map((opt, optIdx) => (
                              <div
                                key={opt.option_order ?? optIdx}
                                className="p-2 border rounded text-xs bg-muted/30 flex items-center gap-2"
                              >
                                <span className="font-bold text-muted-foreground">
                                  {String.fromCharCode(64 + opt.option_order)}.
                                </span>
                                {isEditingDraft ? (
                                  <Input
                                    aria-label={`Option ${String.fromCharCode(64 + opt.option_order)}`}
                                    value={opt.option_text}
                                    onChange={(e) =>
                                      updateQuizOption(idx, optIdx, e.target.value)
                                    }
                                    className="h-7 text-xs px-2 flex-1"
                                  />
                                ) : (
                                  <span>{opt.option_text}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>

                  <Card className="flex flex-col gap-3 p-4 border-2 mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-base">Teacher-Only Answer Key & Explanations</h4>
                      </div>
                      <Badge variant="solid" size="sm">Teacher Eyes Only</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-1">
                      Never shown to students in student instructions or assignments.
                    </p>

                    <div className="flex flex-col gap-3">
                      {generatedDraft.questions.map((q, idx) => (
                        <div
                          key={`key-${q.display_order ?? idx}`}
                          className="flex flex-col gap-1.5 p-3 rounded! border-2 bg-background text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm">Item {q.display_order} Answer Key</span>
                            <span className="text-muted-foreground">
                              Lesson #{q.targeted_lesson_id} · Competency #{q.targeted_competency_id}
                            </span>
                          </div>
                          {isEditingDraft ? (
                            <div className="flex flex-col gap-2 mt-1">
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`quiz-correct-ans-${idx}`} className="text-xs font-semibold text-muted-foreground">Correct Answer</Label>
                                <Input
                                  id={`quiz-correct-ans-${idx}`}
                                  aria-label="Correct Answer"
                                  value={q.teacher_answer_key.correct_answer}
                                  onChange={(e) =>
                                    updateQuizAnswerKey(idx, { correct_answer: e.target.value })
                                  }
                                  className="h-8 text-xs font-bold text-primary px-2"
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`quiz-explanation-${idx}`} className="text-xs font-semibold text-muted-foreground">Explanation</Label>
                                <textarea
                                  id={`quiz-explanation-${idx}`}
                                  aria-label="Explanation"
                                  className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-xs font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[45px]"
                                  value={q.teacher_answer_key.explanation}
                                  onChange={(e) =>
                                    updateQuizAnswerKey(idx, { explanation: e.target.value })
                                  }
                                />
                              </div>
                              <div className="flex flex-col gap-1">
                                <Label htmlFor={`quiz-scoring-guide-${idx}`} className="text-xs font-semibold text-muted-foreground">Scoring Guide (Optional)</Label>
                                <Input
                                  id={`quiz-scoring-guide-${idx}`}
                                  aria-label="Scoring Guide (Optional)"
                                  value={q.teacher_answer_key.scoring_guide ?? ""}
                                  onChange={(e) =>
                                    updateQuizAnswerKey(idx, { scoring_guide: e.target.value })
                                  }
                                  className="h-8 text-xs px-2"
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <div>
                                <span className="font-semibold text-muted-foreground">Correct Answer: </span>
                                <span className="font-bold text-primary">{q.teacher_answer_key.correct_answer}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-muted-foreground">Explanation: </span>
                                <span>{q.teacher_answer_key.explanation}</span>
                              </div>
                              {q.teacher_answer_key.scoring_guide && (
                                <div>
                                  <span className="font-semibold text-muted-foreground">Scoring Guide: </span>
                                  <span>{q.teacher_answer_key.scoring_guide}</span>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                </div>
              )}

              {generatedDraft.draft_format === "CLASSWORK" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="cw-overview-input" className="font-bold text-sm">Activity Overview</Label>
                    {isEditingDraft ? (
                      <textarea
                        id="cw-overview-input"
                        aria-label="Activity Overview"
                        className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[60px]"
                        value={generatedDraft.description}
                        onChange={(e) =>
                          setGeneratedDraft({ ...generatedDraft, description: e.target.value })
                        }
                      />
                    ) : (
                      <div className="p-3 border-2 rounded bg-background text-sm">
                        {generatedDraft.description}
                      </div>
                    )}
                    <Label htmlFor="cw-instructions-input" className="font-bold text-sm mt-1">Student Instructions</Label>
                    {isEditingDraft ? (
                      <textarea
                        id="cw-instructions-input"
                        aria-label="Student Instructions"
                        className="w-full rounded-[var(--radius)]! border-2 rounded! border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[70px]"
                        value={generatedDraft.student_instructions}
                        onChange={(e) =>
                          setGeneratedDraft({ ...generatedDraft, student_instructions: e.target.value })
                        }
                      />
                    ) : (
                      <div className="p-3 border-2 rounded bg-background text-sm whitespace-pre-wrap">
                        {generatedDraft.student_instructions}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label className="font-bold text-sm">
                      Step-by-Step Tasks ({generatedDraft.tasks.length} tasks)
                    </Label>
                    {generatedDraft.tasks.map((task, idx) => (
                      <Card key={task.task_number ?? idx} className="p-3 flex flex-col gap-1.5 border-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" size="sm">Task {task.task_number}</Badge>
                            {isEditingDraft ? (
                              <Input
                                id={`cw-task-title-${idx}`}
                                aria-label="Task Title"
                                value={task.title}
                                onChange={(e) =>
                                  updateClassworkTask(idx, { title: e.target.value })
                                }
                                className="h-8 text-sm font-bold"
                              />
                            ) : (
                              <span className="font-bold text-sm">{task.title}</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            Lesson #{task.targeted_lesson_id} · Competency #{task.targeted_competency_id}
                          </span>
                        </div>
                        {isEditingDraft ? (
                          <textarea
                            id={`cw-task-instructions-${idx}`}
                            aria-label="Task Instructions"
                            className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[50px]"
                            value={task.instructions}
                            onChange={(e) =>
                              updateClassworkTask(idx, { instructions: e.target.value })
                            }
                          />
                        ) : (
                          <p className="text-sm font-medium whitespace-pre-wrap">{task.instructions}</p>
                        )}
                      </Card>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label className="font-bold text-sm">Required Deliverables</Label>
                      <div className="flex flex-col gap-2">
                        {generatedDraft.deliverables.map((del, idx) => (
                          <Card key={idx} className="p-2.5 flex flex-col gap-1 border-2">
                            <div className="flex items-center justify-between">
                              {isEditingDraft ? (
                                <Input
                                  value={del.deliverable_name}
                                  onChange={(e) =>
                                    updateClassworkDeliverable(idx, { deliverable_name: e.target.value })
                                  }
                                  className="h-7 text-xs font-bold"
                                />
                              ) : (
                                <span className="font-bold text-sm">{del.deliverable_name}</span>
                              )}
                              <Badge variant="surface" size="sm">{del.deliverable_type}</Badge>
                            </div>
                            {isEditingDraft ? (
                              <Input
                                value={del.description}
                                onChange={(e) =>
                                  updateClassworkDeliverable(idx, { description: e.target.value })
                                }
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs text-muted-foreground">{del.description}</p>
                            )}
                          </Card>
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label className="font-bold text-sm">Supported Upload Formats</Label>
                      <div className="p-3 border-2 rounded bg-background flex flex-col gap-2">
                        <div className="flex flex-wrap gap-1.5">
                          {generatedDraft.supported_upload_formats.map((fmt) => (
                            <Badge key={fmt} variant="outline" size="sm">{fmt}</Badge>
                          ))}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          Activity Mode: <strong>{generatedDraft.activity_mode}</strong>
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="font-bold text-sm">Grading Rubric Levels</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {generatedDraft.rubric_levels.map((r, idx) => (
                        <Card key={idx} className="p-3 flex flex-col gap-1 border-2">
                          <div className="flex items-center justify-between">
                            {isEditingDraft ? (
                              <div className="flex items-center gap-1.5 flex-1 mr-2">
                                <Input
                                  value={r.level_name}
                                  onChange={(e) =>
                                    updateClassworkRubricLevel(idx, { level_name: e.target.value })
                                  }
                                  className="h-7 text-xs font-bold flex-1"
                                />
                                <Input
                                  type="number"
                                  min="0"
                                  value={r.points}
                                  onChange={(e) =>
                                    updateClassworkRubricLevel(idx, {
                                      points: Math.max(0, parseInt(e.target.value, 10) || 0),
                                    })
                                  }
                                  className="h-7 w-16 text-xs text-center font-bold"
                                />
                              </div>
                            ) : (
                              <>
                                <span className="font-bold text-sm">{r.level_name}</span>
                                <Badge variant="solid" size="sm">{r.points} pts</Badge>
                              </>
                            )}
                          </div>
                          {isEditingDraft ? (
                            <textarea
                              className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-xs font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[40px] mt-1"
                              value={r.description}
                              onChange={(e) =>
                                updateClassworkRubricLevel(idx, { description: e.target.value })
                              }
                            />
                          ) : (
                            <p className="text-xs text-muted-foreground">{r.description}</p>
                          )}
                        </Card>
                      ))}
                    </div>
                  </div>

                  <Card className="flex flex-col gap-3 p-4 border-2 border-primary bg-primary/5 mt-2">
                    <div className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2">
                        <Lock className="size-4 text-primary" />
                        <h4 className="font-bold text-base">Teacher Evaluation Guide</h4>
                      </div>
                      <Badge variant="solid" size="sm">Teacher Eyes Only</Badge>
                    </div>

                    <div className="flex flex-col gap-2 text-xs">
                      <div>
                        <span className="font-semibold text-muted-foreground block mb-0.5">
                          Exemplar / Expected Response:
                        </span>
                        {isEditingDraft ? (
                          <textarea
                            className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-xs font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[50px]"
                            value={generatedDraft.teacher_guide.exemplar_or_expected_response}
                            onChange={(e) =>
                              updateClassworkTeacherGuide({ exemplar_or_expected_response: e.target.value })
                            }
                          />
                        ) : (
                          <div className="p-2.5 rounded border bg-background whitespace-pre-wrap">
                            {generatedDraft.teacher_guide.exemplar_or_expected_response}
                          </div>
                        )}
                      </div>
                      <div>
                        <span className="font-semibold text-muted-foreground block mb-0.5">
                          Evaluation Notes:
                        </span>
                        {isEditingDraft ? (
                          <textarea
                            className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-xs font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[50px]"
                            value={generatedDraft.teacher_guide.evaluation_notes}
                            onChange={(e) =>
                              updateClassworkTeacherGuide({ evaluation_notes: e.target.value })
                            }
                          />
                        ) : (
                          <div className="p-2.5 rounded border bg-background whitespace-pre-wrap">
                            {generatedDraft.teacher_guide.evaluation_notes}
                          </div>
                        )}
                      </div>
                      {generatedDraft.teacher_guide.common_misconceptions &&
                        generatedDraft.teacher_guide.common_misconceptions.length > 0 && (
                          <div>
                            <span className="font-semibold text-muted-foreground block mb-0.5">
                              Common Misconceptions:
                            </span>
                            {isEditingDraft ? (
                              <textarea
                                className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2 text-xs font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none min-h-[50px]"
                                value={generatedDraft.teacher_guide.common_misconceptions.join("\n")}
                                onChange={(e) =>
                                  updateClassworkTeacherGuide({
                                    common_misconceptions: e.target.value.split("\n").filter(Boolean),
                                  })
                                }
                              />
                            ) : (
                              <ul className="list-disc list-inside p-2.5 rounded border bg-background space-y-0.5">
                                {generatedDraft.teacher_guide.common_misconceptions.map((m, i) => (
                                  <li key={i}>{m}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                    </div>
                  </Card>
                </div>
              )}
            </div>
          )}
          <Alert status="info" className="text-sm rounded!">
            Review and edit this AI draft, then explicitly save it to the classwork repository.
            Saving keeps both the assessment and its targeted assignment unpublished and inaccessible to students.
          </Alert>
        </div>

        <Dialog.Footer className="mt-0 justify-between items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Score Cap: <strong>{capInput || plan.score_adjustment_cap || 75}%</strong> · Draft publishing in PR 2D.2
            </span>
          </div>
          <div className="flex items-center gap-2">
            {generatedDraft && !generatingDraft && (
              <Button
                size="sm"
                variant={isEditingDraft ? "default" : "outline"}
                onClick={() => setIsEditingDraft(!isEditingDraft)}
                disabled={draftSaveState === "saved" || draftSaveState === "validating" || draftSaveState === "saving"}
                className="gap-1.5"
              >
                <Pencil className="size-3.5" />
                {isEditingDraft ? "Done Editing (Preview)" : "Edit Draft"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={generatingDraft}
            >
              Close Preview
            </Button>
            {savedAssessment ? (
              <Button
                size="sm"
                onClick={() => navigate(`/teacher/classworks/${savedAssessment.classwork_id}`)}
                className="gap-1.5"
              >
                <ExternalLink className="size-3.5" />
                Open Saved Assessment
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void onSaveAssessmentDraft()}
                disabled={
                  generatingDraft ||
                  !generatedDraft ||
                  !draftValidation.isValid ||
                  draftSaveState === "validating" ||
                  draftSaveState === "saving"
                }
                className="gap-1.5"
              >
                {draftSaveState === "validating" || draftSaveState === "saving" ? (
                  <RefreshCw className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                {draftSaveState === "validating"
                  ? "Validating Draft..."
                  : draftSaveState === "saving"
                    ? "Saving Draft..."
                    : "Save Assessment Draft"}
              </Button>
            )}
          </div>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
