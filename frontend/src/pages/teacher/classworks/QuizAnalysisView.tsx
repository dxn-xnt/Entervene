import { useState } from "react";
import { Check, X, Pencil } from "lucide-react";
import type { QuizAnalysis } from "./quiz-builder-types";
import type { TeacherClasswork } from "@/types/classwork";
import { Select } from "@/components/retroui/Select";

interface QuizAnalysisViewProps {
  quizAnalysis: QuizAnalysis | null;
  isQuizAnalysisLoading: boolean;
  quizAnalysisError: string;
  selected: TeacherClasswork;
  setSelectedGradingSubmissionId: (id: number) => void;
}

export default function QuizAnalysisView({
  quizAnalysis,
  isQuizAnalysisLoading,
  quizAnalysisError,
  selected,
  setSelectedGradingSubmissionId,
}: QuizAnalysisViewProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "questions" | "students">("overview");
  const [studentSort, setStudentSort] = useState<"accuracy" | "name">("accuracy");
  const [questionSort, setQuestionSort] = useState<"order" | "accuracy">("order");

  if (isQuizAnalysisLoading) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
        Loading quiz analysis...
      </p>
    );
  }

  if (quizAnalysisError) {
    return (
      <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        {quizAnalysisError}
      </p>
    );
  }

  if (!quizAnalysis) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm font-semibold text-gray-500">
        Quiz analysis is not available yet.
      </p>
    );
  }

  const sortedStudents = [...quizAnalysis.students].sort((a, b) => {
    if (studentSort === "accuracy") {
      const aScore = a.score_percent ?? 0;
      const bScore = b.score_percent ?? 0;
      return bScore - aScore;
    }
    return a.student_name.localeCompare(b.student_name);
  });

  const sortedQuestions = [...quizAnalysis.questions].sort((a, b) => {
    if (questionSort === "accuracy") {
      const aAcc = a.accuracy_percent ?? 0;
      const bAcc = b.accuracy_percent ?? 0;
      return bAcc - aAcc;
    }
    return 0; // maintain original display_order which is already sorted
  });

  const totalPoints = quizAnalysis.total_points ?? selected.total_points ?? 0;

  return (
    <div className="space-y-4">
      {/* Top 3 Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border-2 border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold">Class Accuracy</p>
          </div>
          <p className="mt-2 text-4xl font-bold">
            {quizAnalysis.class_accuracy_percent ?? 0}
            <span className="text-2xl">%</span>
          </p>
        </div>
        <div className="rounded-lg border-2 border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <p className="text-sm font-bold">Participation</p>
          <p className="mt-2 text-4xl font-bold">
            {quizAnalysis.submitted_count}{" "}
            <span className="text-xl font-medium">of {quizAnalysis.total_students} students</span>
          </p>
        </div>
        <div className="rounded-lg border-2 border-black bg-[#F6E9B2] p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <p className="text-sm font-bold">Questions</p>
          <p className="mt-2 text-4xl font-bold">{quizAnalysis.questions.length}</p>
        </div>
      </div>

      {/* Tabs Section */}
      <div className="rounded-lg border-2 border-black bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] flex flex-col">
        <div className="flex border-b-2 border-black overflow-x-auto">
          {["overview", "questions", "students"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={`px-6 py-3 text-sm font-bold capitalize transition-colors ${
                activeTab === tab
                  ? "bg-[#F6E9B2] border-r-2 border-black last:border-r-0"
                  : "bg-white hover:bg-gray-50 border-r-2 border-black last:border-r-0"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === "overview" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="pb-3 font-medium text-gray-500 whitespace-nowrap pr-4">Learner's Name</th>
                    <th className="pb-3 font-medium text-gray-500 text-center px-4">Points</th>
                    {quizAnalysis.questions.map((q, i) => (
                      <th key={q.quiz_question_id} className="pb-3 font-medium text-center px-2">
                        <div className="text-xs text-gray-500">Q{i + 1}</div>
                        <div className="text-xs font-bold whitespace-nowrap text-green-600">{q.accuracy_percent ?? 0}%</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedStudents.map((student) => (
                    <tr key={student.student_id} className="border-b border-gray-100 last:border-0">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="grid h-8 w-8 place-items-center rounded-full border border-black bg-[#FFD08A] text-xs font-bold shrink-0">
                            {student.student_name.slice(0, 1)}
                          </div>
                          <span className="font-bold whitespace-nowrap">{student.student_name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-bold">
                        {student.grade ?? 0} <span className="text-gray-500 font-normal">({student.score_percent ?? 0}%)</span>
                      </td>
                      {quizAnalysis.questions.map((q) => {
                        const ans = student.answers?.find((a) => a.quiz_question_id === q.quiz_question_id);
                        const isCorrect = ans?.is_correct;
                        return (
                          <td key={q.quiz_question_id} className="py-3 px-2 text-center">
                            <div className="flex justify-center">
                              {isCorrect === true ? (
                                <div className="h-6 w-8 bg-[#8BCB88] border border-black rounded flex items-center justify-center">
                                  <Check size={14} className="text-black" />
                                </div>
                              ) : isCorrect === false ? (
                                <div className="h-6 w-8 bg-[#FF6B6B] border border-black rounded flex items-center justify-center">
                                  <X size={14} className="text-black" />
                                </div>
                              ) : (
                                <div className="h-6 w-8 bg-gray-100 border border-black rounded" />
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeTab === "questions" && (
            <div>
              <div className="mb-4 flex justify-end">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-600">Sort By:</span>
                  <Select value={questionSort} onValueChange={(v) => setQuestionSort(v as any)}>
                    <Select.Trigger className="h-8 bg-white border-2 border-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] w-40">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <Select.Item value="order">Question Order</Select.Item>
                      <Select.Item value="accuracy">Accuracy</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
              <div className="space-y-4">
                {sortedQuestions.map((q, i) => (
                  <div key={q.quiz_question_id} className="rounded-lg border-2 border-black p-4 bg-white">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                      <div className="flex gap-4">
                        <div className="border border-black rounded px-2 py-1 flex flex-col text-xs bg-white">
                          <span className="text-gray-500">Question Type</span>
                          <span className="font-bold text-base">{q.question_type === "MULTIPLE_CHOICE" ? "Multiple Choice" : "Short Answer"}</span>
                        </div>
                        <div className="border border-black rounded px-2 py-1 flex flex-col text-xs bg-white">
                          <span className="text-gray-500">points</span>
                          <span className="font-bold text-center text-base">{q.points}</span>
                        </div>
                      </div>
                      <div className="flex gap-4">
                        <div className="border border-black rounded px-3 py-1 flex flex-col text-xs bg-white items-center">
                          <span className="text-gray-500">Correct answer</span>
                          <span className="font-bold text-base">{q.correct_count}/{q.answered_count}</span>
                        </div>
                        <div className="border border-black rounded px-3 py-1 flex flex-col text-xs bg-white items-center">
                          <span className="text-gray-500">Accuracy</span>
                          <span className="font-bold text-base">{q.accuracy_percent ?? 0}%</span>
                        </div>
                      </div>
                    </div>
                    <p className="text-lg font-bold mb-4">
                      {i + 1}. {q.question_text}
                    </p>
                    {q.question_type === "MULTIPLE_CHOICE" ? (
                      <div className="space-y-2 max-w-2xl">
                        {q.option_distribution.map((opt, idx) => {
                          const percent = q.answered_count > 0 ? (opt.selected_count / q.answered_count) * 100 : 0;
                          return (
                            <div key={opt.option_id} className="flex items-center gap-4">
                              <span className="w-4 font-bold">{String.fromCharCode(65 + idx)}.</span>
                              <div className="flex-1 text-sm">{opt.option_text}</div>
                              <div className="w-24 text-right text-xs font-bold text-gray-500 flex items-center justify-end gap-1">
                                {opt.is_correct ? <span className="text-[#3A6D38]">correct <Check size={12} className="inline"/></span> : <span>incorrect <X size={12} className="inline"/></span>}
                              </div>
                              <div className="w-80 h-7 border border-black rounded bg-white relative overflow-hidden flex items-center">
                                <div 
                                  className={`absolute top-0 left-0 h-full ${opt.is_correct ? 'bg-[#3A6D38]' : 'bg-gray-100'}`} 
                                  style={{ width: `${percent}%` }}
                                />
                                <span className={`relative z-10 text-xs px-2 font-bold ${opt.is_correct && percent > 15 ? 'text-white' : 'text-black'}`}>
                                  {opt.selected_count} answered
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-gray-600">
                        {q.needs_grading_count} responses need manual grading.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "students" && (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex gap-4 text-xs font-bold">
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-[#8BCB88] border border-black rounded-sm"/> Correct</div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-[#FF6B6B] border border-black rounded-sm"/> Incorrect</div>
                  <div className="flex items-center gap-1"><div className="w-4 h-4 bg-white border border-black rounded-sm"/> Unattempted</div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-gray-600">Sort By:</span>
                  <Select value={studentSort} onValueChange={(v) => setStudentSort(v as any)}>
                    <Select.Trigger className="h-8 bg-white border-2 border-black font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] w-32">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                      <Select.Item value="accuracy">Accuracy</Select.Item>
                      <Select.Item value="name">Name</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b-2 border-black">
                      <th className="pb-3 font-medium text-gray-500 whitespace-nowrap pl-4">Learner's Name</th>
                      <th className="pb-3 font-medium text-gray-500"></th>
                      <th className="pb-3 font-medium text-gray-500 text-center px-4">Accuracy</th>
                      <th className="pb-3 font-medium text-gray-500 text-center px-4">Points</th>
                      <th className="pb-3 font-medium text-gray-500 text-center px-4">Score</th>
                      <th className="pb-3 font-medium text-gray-500 text-right pr-4">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStudents.map((student) => {
                      const corrects = student.answers?.filter(a => a.is_correct === true).length || 0;
                      return (
                        <tr key={student.student_id} className="border-b border-gray-200 last:border-0">
                          <td className="py-4 pl-4 pr-2">
                            <div className="flex items-center gap-2">
                              <div className="grid h-8 w-8 place-items-center rounded-full border border-black bg-[#FFD08A] text-xs font-bold shrink-0">
                                {student.student_name.slice(0, 1)}
                              </div>
                              <span className="font-bold whitespace-nowrap">{student.student_name}</span>
                            </div>
                          </td>
                          <td className="py-4 px-2">
                            <div className="flex items-center gap-2">
                              <div className="flex gap-[2px]">
                                {quizAnalysis.questions.map((q) => {
                                  const ans = student.answers?.find(a => a.quiz_question_id === q.quiz_question_id);
                                  return (
                                    <div 
                                      key={q.quiz_question_id} 
                                      className={`w-[14px] h-[18px] border border-black rounded-sm ${
                                        ans?.is_correct === true ? 'bg-[#8BCB88]' : ans?.is_correct === false ? 'bg-[#FF6B6B]' : 'bg-gray-100'
                                      }`}
                                    />
                                  );
                                })}
                              </div>
                              <span className="text-xs font-bold text-[#3A6D38] ml-2">{corrects} corrects <Check size={12} className="inline"/></span>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center font-bold text-lg">
                            {student.score_percent ?? 0}<span className="text-xs font-normal text-gray-500">%</span>
                          </td>
                          <td className="py-4 px-4 text-center font-bold text-lg">
                            {student.grade ?? 0}<span className="text-xs font-normal text-gray-500">/{totalPoints}</span>
                          </td>
                          <td className="py-4 px-4 text-center font-bold text-lg">
                            {student.grade ?? 0}
                          </td>
                          <td className="py-4 pr-4 text-right">
                            {student.submission_id ? (
                              <button
                                type="button"
                                onClick={() => setSelectedGradingSubmissionId(student.submission_id!)}
                                className={`inline-flex items-center gap-1 rounded border border-black px-3 py-1.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-colors ${
                                  student.needs_grading
                                    ? "bg-[#FFD08A] hover:bg-[#FFC06A] text-black"
                                    : "bg-white hover:bg-gray-50 text-black"
                                }`}
                              >
                                <Pencil size={12} />
                                {student.needs_grading ? "Grade" : "Score"}
                              </button>
                            ) : (
                              <span className="text-xs italic text-gray-400">No attempt</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
