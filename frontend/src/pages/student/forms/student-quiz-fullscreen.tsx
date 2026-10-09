import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { QuizTextAnswerInput, QuizTextAnswerSummary } from "@/components/quiz/student-quiz-answer";
import type {
  ClassworkDetail,
  QuizAttempt,
  QuizAttemptQuestion,
} from "../subjects-view/types";

interface StudentQuizFullscreenProps {
  selectedQuizAttempt: QuizAttempt;
  selectedClasswork: ClassworkDetail;
  quizAnswers: Record<
    number,
    { selected_option_id?: number; answer_text?: string }
  >;
  setQuizAnswers: React.Dispatch<
    React.SetStateAction<
      Record<number, { selected_option_id?: number; answer_text?: string }>
    >
  >;
  quizCurrentIndex: number;
  setQuizCurrentIndex: React.Dispatch<React.SetStateAction<number>>;
  quizReviewMode: boolean;
  setQuizReviewMode: (val: boolean) => void;
  quizRemainingSeconds: number | null;
  flaggedQuizQuestionIds: Set<number>;
  toggleQuizFlag: (questionId: number) => void;
  quizError: string;
  isQuizSubmitting: boolean;
  onExit: () => void;
  onSubmit: (autoSubmit?: boolean) => void;
}

function formatExamTimer(seconds: number | null) {
  if (seconds === null) return "No timer";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function StudentQuizFullscreen({
  selectedQuizAttempt,
  selectedClasswork,
  quizAnswers,
  setQuizAnswers,
  quizCurrentIndex,
  setQuizCurrentIndex,
  quizReviewMode,
  setQuizReviewMode,
  quizRemainingSeconds,
  flaggedQuizQuestionIds,
  toggleQuizFlag,
  quizError,
  isQuizSubmitting,
  onExit,
  onSubmit,
}: StudentQuizFullscreenProps) {
  const questions = selectedQuizAttempt.questions;
  const currentQuestion = questions[quizCurrentIndex] ?? questions[0];
  const hasQuizAnswer = (question: QuizAttemptQuestion) => {
    const answer = quizAnswers[question.quiz_question_id];
    return Boolean(answer?.selected_option_id || answer?.answer_text?.trim());
  };
  const answeredCount = questions.filter(hasQuizAnswer).length;
  const isSummaryMode =
    selectedQuizAttempt.status !== "pending" &&
    selectedQuizAttempt.summary_available;
  const totalPoints =
    selectedQuizAttempt.total_points ?? selectedClasswork.total_points ?? 0;

  return (
    <div className="fixed inset-0 z-[99999] flex flex-col bg-white">
      <header className="border-b-2 border-black bg-white px-4 py-3">
        <div className="grid grid-cols-[auto_1fr_auto] items-start gap-3">
          {isSummaryMode ? (
            <span className="size-10" aria-hidden="true" />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      type="button"
                      onClick={onExit}
                      variant="outline"
                      size="icon"
                      className="rounded border-black bg-white shadow-md hover:bg-white hover:shadow-none"
                      aria-label="Exit fullscreen quiz"
                    >
                      <ChevronLeft size={22} />
                    </Button>
                  </span>
                }
              />
              <TooltipContent>Exit quiz</TooltipContent>
            </Tooltip>
          )}
          <div className="text-center">
            <p className="text-xl font-black leading-none">
              {isSummaryMode
                ? selectedClasswork.show_scores
                  ? `${selectedQuizAttempt.grade ?? 0}/${totalPoints}`
                  : "Hidden"
                : formatExamTimer(quizRemainingSeconds)}
            </p>
            <p className="text-xs font-semibold text-gray-700">
              {isSummaryMode ? "score" : "time left"}
            </p>
          </div>
          {isSummaryMode ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex">
                    <Button
                      type="button"
                      onClick={onExit}
                      variant="outline"
                      size="icon"
                      className="rounded border-black bg-white shadow-md hover:bg-white hover:shadow-none"
                      aria-label="Close quiz summary"
                    >
                      <X size={22} />
                    </Button>
                  </span>
                }
              />
              <TooltipContent>Close summary</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              type="button"
              onClick={() => setQuizReviewMode(true)}
              size="sm"
              className="rounded border-black bg-primary text-sm font-bold text-black"
            >
              Finish Quiz
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-6xl space-y-4">
          <Card className="block w-full border-black bg-white p-4 text-center shadow-md hover:shadow-none">
            <h1 className="text-2xl font-bold">{selectedQuizAttempt.title}</h1>
            <p className="mt-1 text-sm font-semibold italic text-gray-700">
              {selectedClasswork.description
                ? `Lessons: ${selectedClasswork.description}`
                : "Review each question carefully before submitting."}
            </p>
            {isSummaryMode ? (
              <div className="mt-4">
                <p className="text-sm font-semibold">Quiz Summary</p>
                <p className="text-xs text-gray-600">
                  Review your recorded answers and item scores.
                </p>
              </div>
            ) : !quizReviewMode ? (
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {questions.map((question, index) => (
                  <Button
                    key={question.quiz_question_id}
                    type="button"
                    onClick={() => {
                      setQuizCurrentIndex(index);
                      setQuizReviewMode(false);
                    }}
                    className={`relative h-8 min-w-8 rounded border-black px-2 text-xs font-bold shadow-md hover:shadow-none ${
                      index === quizCurrentIndex
                        ? "bg-white"
                        : hasQuizAnswer(question)
                          ? "bg-[#F6E9B2]"
                          : "bg-white"
                    }`}
                  >
                    {flaggedQuizQuestionIds.has(question.quiz_question_id) ? (
                      <span className="absolute -top-2 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-red-500" />
                    ) : null}
                    {index + 1}
                  </Button>
                ))}
              </div>
            ) : null}
          </Card>

          {quizError ? (
            <p className="border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {quizError}
            </p>
          ) : null}

          {isSummaryMode ? (
            <section className="mx-auto max-w-4xl space-y-3">
              {questions.map((question, index) => {
                const selectedOption = question.options.find(
                  (option) => option.option_id === question.selected_option_id,
                );
                return (
                  <Card
                    key={question.quiz_question_id}
                    className="block w-full border-black bg-white p-4 shadow-md hover:shadow-none"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2 className="min-w-0 flex-1 break-words text-base font-bold">
                        {index + 1}. {question.question_text}
                      </h2>
                      <Badge
                        variant={
                          selectedClasswork.show_scores &&
                          question.points_awarded != null
                            ? question.points_awarded >= question.points
                              ? "success"
                              : question.points_awarded <= 0
                                ? "destructive"
                                : "outline"
                            : "outline"
                        }
                        size="sm"
                        className="shrink-0 text-xs font-bold"
                      >
                        {selectedClasswork.show_scores
                          ? `${question.points_awarded ?? 0}/${question.points} pts`
                          : `${question.points} pts`}
                      </Badge>
                    </div>
                    {question.question_type === "MULTIPLE_CHOICE" ||
                    question.question_type === "TRUE_FALSE" ? (
                      <div className="mt-3 grid gap-2">
                        {question.options.map((option) => {
                          const isSelected =
                            option.option_id === question.selected_option_id;
                          const isCorrect = option.is_correct === true;
                          return (
                            <div
                              key={option.option_id}
                              className={`border border-foreground px-3 py-2 text-sm ${
                                isSelected
                                  ? "bg-primary text-primary-foreground"
                                  : isCorrect
                                    ? "bg-success/10"
                                    : "bg-background"
                              }`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="min-w-0 break-words">
                                  {option.option_text}
                                </span>
                                <span className="text-xs font-bold">
                                  {isCorrect && isSelected
                                    ? "Your answer / Correct answer"
                                    : isCorrect
                                      ? "Correct answer"
                                      : isSelected
                                        ? "Your answer"
                                        : ""}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {!selectedOption && (
                          <p className="text-xs font-semibold text-red-700">
                            No answer recorded.
                          </p>
                        )}
                      </div>
                    ) : (
                      <QuizTextAnswerSummary question={question} />
                    )}
                  </Card>
                );
              })}
            </section>
          ) : quizReviewMode ? (
            <section className="mx-auto max-w-3xl">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-lg font-bold">Review answers</h2>
                <p className="text-sm font-semibold text-gray-600">
                  {answeredCount}/{questions.length} answered
                </p>
              </div>
              <Card className="block w-full overflow-hidden border-black bg-white p-0 shadow-md hover:shadow-none">
                {questions.map((question, index) => (
                  <Button
                    key={question.quiz_question_id}
                    type="button"
                    onClick={() => {
                      setQuizCurrentIndex(index);
                      setQuizReviewMode(false);
                    }}
                    variant="ghost"
                    className="flex w-full rounded items-center justify-between border-b border-gray-300 px-4 py-2 text-left shadow-none last:border-b-0 hover:bg-primary hover:shadow-none"
                  >
                    <span className="font-semibold">Question {index + 1}</span>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="rounded border border-gray-300 text-[11px] font-semibold"
                    >
                      {hasQuizAnswer(question)
                        ? "Answer Recorded"
                        : "No Answer"}
                    </Badge>
                  </Button>
                ))}
              </Card>
              <Button
                type="button"
                onClick={() => onSubmit(false)}
                disabled={!selectedQuizAttempt.can_submit || isQuizSubmitting}
                className="mt-4 float-right rounded border-black bg-success text-sm font-bold text-black shadow-none hover:bg-success/80 hover:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isQuizSubmitting ? "Submitting..." : "Submit"}
              </Button>
            </section>
          ) : currentQuestion ? (
            <section className="mx-auto max-w-3xl space-y-4">
              <div className="flex items-center justify-between">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex">
                        <Button
                          type="button"
                          onClick={() =>
                            setQuizCurrentIndex((index) =>
                              Math.max(0, index - 1),
                            )
                          }
                          disabled={quizCurrentIndex === 0}
                          variant="outline"
                          size="icon"
                          className="rounded border-black bg-white shadow-md hover:shadow-none disabled:opacity-40"
                          aria-label="Previous question"
                        >
                          <ChevronLeft size={18} />
                        </Button>
                      </span>
                    }
                  />
                  <TooltipContent>Previous</TooltipContent>
                </Tooltip>
                <Button
                  type="button"
                  onClick={() =>
                    toggleQuizFlag(currentQuestion.quiz_question_id)
                  }
                  className={`rounded border-black px-4 py-2 text-xs font-bold shadow-md hover:shadow-none ${
                    flaggedQuizQuestionIds.has(currentQuestion.quiz_question_id)
                      ? "bg-[#F6E9B2]"
                      : "bg-white"
                  }`}
                >
                  Flag Question
                </Button>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <span className="inline-flex">
                        <Button
                          type="button"
                          onClick={() =>
                            setQuizCurrentIndex((index) =>
                              Math.min(questions.length - 1, index + 1),
                            )
                          }
                          disabled={quizCurrentIndex === questions.length - 1}
                          variant="outline"
                          size="icon"
                          className="rounded border-black bg-white shadow-md hover:shadow-none disabled:opacity-40"
                          aria-label="Next question"
                        >
                          <ChevronRight size={18} />
                        </Button>
                      </span>
                    }
                  />
                  <TooltipContent>Next</TooltipContent>
                </Tooltip>
              </div>

              <Card className="block w-full border-black bg-white px-6 py-8 text-center shadow-md hover:shadow-none">
                <p className="text-lg font-bold whitespace-normal break-words [overflow-wrap:anywhere]">
                  {currentQuestion.question_text}
                </p>
              </Card>

              {currentQuestion.question_type === "MULTIPLE_CHOICE" ||
              currentQuestion.question_type === "TRUE_FALSE" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {currentQuestion.options.map((option) => (
                    <Button
                      key={option.option_id}
                      type="button"
                      autoIcon={false}
                      onClick={() =>
                        setQuizAnswers((current) => ({
                          ...current,
                          [currentQuestion.quiz_question_id]: {
                            ...current[currentQuestion.quiz_question_id],
                            selected_option_id: option.option_id,
                          },
                        }))
                      }
                      disabled={isQuizSubmitting}
                      style={{ borderWidth: 1 }}
                      className={`w-full min-w-0 h-full min-h-24 rounded border-black p-4 text-base sm:text-lg font-bold shadow-md hover:shadow-none whitespace-normal break-words [overflow-wrap:anywhere] ${
                        quizAnswers[currentQuestion.quiz_question_id]
                          ?.selected_option_id === option.option_id
                          ? "bg-success hover:bg-success"
                          : "bg-white hover:bg-white"
                      }`}
                    >
                      <span className="w-full max-w-full min-w-0 whitespace-normal break-words [overflow-wrap:anywhere] text-center leading-snug">
                        {option.option_text}
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <QuizTextAnswerInput
                  question={currentQuestion}
                  value={
                    quizAnswers[currentQuestion.quiz_question_id]
                      ?.answer_text ?? ""
                  }
                  onChange={(text) =>
                    setQuizAnswers((current) => ({
                      ...current,
                      [currentQuestion.quiz_question_id]: {
                        ...current[currentQuestion.quiz_question_id],
                        answer_text: text,
                      },
                    }))
                  }
                  disabled={isQuizSubmitting}
                />
              )}
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
