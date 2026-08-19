import type { Dispatch, SetStateAction } from "react";
import { ArrowRight, FileText, Trash2, Upload, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ClassworkDraft, Lesson } from "./types";
import { Button } from "@/components/retroui/Button";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";

type ClassworkFormModalProps = {
  classworkLesson: Lesson;
  classworkDraft: ClassworkDraft;
  setClassworkDraft: Dispatch<SetStateAction<ClassworkDraft>>;
  classworkMaterials: File[];
  isCreatingClasswork: boolean;
  error: string;
  closeClassworkForm: () => void;
  addClassworkMaterials: (files: FileList | null) => void;
  removeClassworkMaterial: (index: number) => void;
  createClassworkForLesson: () => void;
};

export default function ClassworkFormModal({
  classworkLesson,
  classworkDraft,
  setClassworkDraft,
  classworkMaterials,
  isCreatingClasswork,
  error,
  closeClassworkForm,
  addClassworkMaterials,
  removeClassworkMaterial,
  createClassworkForLesson,
}: ClassworkFormModalProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isReadingDraft = classworkDraft.classwork_type === "READING";
  const isQuizDraft = classworkDraft.classwork_type === "QUIZ";
  const isQuarterlyAssessment =
    classworkDraft.classwork_category === "QUARTERLY_ASSESSMENT" &&
    classworkLesson.lesson_id === 0;
  const allowsClassworkMaterials = classworkDraft.classwork_type !== "QUIZ";
  const classworkModalTitle = isQuarterlyAssessment
    ? "Add Quarterly Assessment"
    : isReadingDraft
      ? "Add Reading"
      : isQuizDraft
        ? "Add Quiz"
        : "Add Classwork";
  const headerBg = isQuarterlyAssessment ? "bg-[#F6E9B2]" : "bg-[#7ABA78]";
  const modalSubtitle = isQuarterlyAssessment
    ? "Subject-level — spans all lessons"
    : `Lesson: ${classworkLesson.title}`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeClassworkForm();
      }}
    >
      <Dialog.Content className="block w-full max-w-2xl border-black bg-white p-0 transition-none max-h-[90vh] overflow-y-auto">
        <Dialog.Header
          className={`sticky top-0 z-10 flex items-center justify-between border-b-2 border-black px-5 py-4`}
        >
          <div>
            <h2 className="text-lg font-bold">{classworkModalTitle}</h2>
            <p className="text-xs font-medium">{modalSubtitle}</p>
          </div>
        </Dialog.Header>

        <div className="space-y-4 p-5">
          {error && (
            <div className="border-2 border-red-600 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="classwork-title"
              className="mb-1 block text-sm font-semibold"
            >
              Title
            </label>
            <Input
              id="classwork-title"
              value={classworkDraft.title}
              onChange={(event) =>
                setClassworkDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              disabled={isCreatingClasswork}
              className="rounded-none border-black !shadow-none h-10 w-full"
              placeholder="Activity 1"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="classwork-type"
                className="mb-1 block text-sm font-semibold"
              >
                Type
              </label>
              <select
                id="classwork-type"
                value={classworkDraft.classwork_type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setClassworkDraft((current) => ({
                    ...current,
                    classwork_type: nextType,
                    total_points:
                      nextType === "READING"
                        ? ""
                        : current.total_points || "100",
                  }));
                }}
                disabled={isCreatingClasswork}
                className="h-10 w-full rounded-none border-2 border-black px-3 text-sm font-semibold"
              >
                <option value="READING">Reading</option>
                <option value="ACTIVITY">Activity</option>
                <option value="ASSIGNMENT">Assignment</option>
                <option value="QUIZ">Quiz</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="classwork-category"
                className="mb-1 block text-sm font-semibold"
              >
                Category
              </label>
              <select
                id="classwork-category"
                value={classworkDraft.classwork_category}
                onChange={(event) =>
                  setClassworkDraft((current) => ({
                    ...current,
                    classwork_category: event.target.value,
                  }))
                }
                disabled={isCreatingClasswork}
                className="h-10 w-full rounded-none border-2 border-black px-3 text-sm font-semibold"
              >
                <option value="WRITTEN_WORK">Written Work</option>
                <option value="PERFORMANCE_TASK">Performance Task</option>
                <option value="PERIODICAL_EXAM">Quarterly Assessment</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {!isReadingDraft && (
              <div>
                <label
                  htmlFor="classwork-points"
                  className="mb-1 block text-sm font-semibold"
                >
                  Total points
                </label>
                <Input
                  id="classwork-points"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={classworkDraft.total_points}
                  onChange={(event) =>
                    setClassworkDraft((current) => ({
                      ...current,
                      total_points: event.target.value,
                    }))
                  }
                  disabled={isCreatingClasswork}
                  className="rounded-none border-black !shadow-none h-10 w-full"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="classwork-due"
                className="mb-1 block text-sm font-semibold"
              >
                Due date
              </label>
              <Input
                id="classwork-due"
                type="datetime-local"
                value={classworkDraft.due_date}
                onChange={(event) =>
                  setClassworkDraft((current) => ({
                    ...current,
                    due_date: event.target.value,
                  }))
                }
                disabled={isCreatingClasswork}
                className="rounded-none border-black !shadow-none h-10 w-full"
              />
            </div>
          </div>

          {!isReadingDraft && classworkDraft.due_date && (
            <label className="flex items-start gap-3 border-2 border-black bg-primary px-4 py-3 text-sm font-semibold">
              <input
                type="checkbox"
                checked={classworkDraft.allow_late_submissions}
                onChange={(event) =>
                  setClassworkDraft((current) => ({
                    ...current,
                    allow_late_submissions: event.target.checked,
                  }))
                }
                disabled={isCreatingClasswork}
                className="mt-1"
              />
              <span>
                Allow submissions/resubmissions after the due date
                <span className="block text-xs font-medium text-gray-700">
                  Late work will be accepted but marked as late.
                </span>
              </span>
            </label>
          )}

          <div>
            <label
              htmlFor="classwork-description"
              className="mb-1 block text-sm font-semibold"
            >
              Description
            </label>
            <textarea
              id="classwork-description"
              value={classworkDraft.description}
              onChange={(event) =>
                setClassworkDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              disabled={isCreatingClasswork}
              className="min-h-20 w-full rounded-none border-2 border-black px-3 py-2 text-sm"
              placeholder="Optional summary"
            />
          </div>

          <div>
            <label
              htmlFor="classwork-instructions"
              className="mb-1 block text-sm font-semibold"
            >
              Instructions
            </label>
            <textarea
              id="classwork-instructions"
              value={classworkDraft.instructions}
              onChange={(event) =>
                setClassworkDraft((current) => ({
                  ...current,
                  instructions: event.target.value,
                }))
              }
              disabled={isCreatingClasswork}
              className="min-h-24 w-full rounded-none border-2 border-black px-3 py-2 text-sm"
              placeholder="What students need to do"
            />
          </div>

          <div className="flex flex-col gap-2 border-2 border-black bg-primary p-4 text-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-bold text-gray-900">
                  Need full builder features?
                </p>
                <p className="text-xs text-gray-700">
                  Build advanced quizzes, import question files, and configure
                  multi-file assignments directly in the Classworks Builder.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigate("/teacher/classworks", {
                    state: {
                      returnUrl: location.pathname,
                      prefill: {
                        title: classworkDraft.title,
                        classwork_type: classworkDraft.classwork_type,
                        classwork_category: classworkDraft.classwork_category,
                        total_points: classworkDraft.total_points,
                        due_date: classworkDraft.due_date,
                        allow_late_submissions:
                          classworkDraft.allow_late_submissions,
                        description: classworkDraft.description,
                        instructions: classworkDraft.instructions,
                        lesson_id: classworkLesson.lesson_id,
                      },
                    },
                  });
                }}
                className="shrink-0 gap-1.5 bg-white text-xs"
              >
                Continue in Classworks Builder
                <ArrowRight size={14} />
              </Button>
            </div>
          </div>

          {allowsClassworkMaterials && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label
                  htmlFor="classwork-materials"
                  className="block text-sm font-semibold"
                >
                  Upload Material
                </label>
                <span className="text-xs font-medium text-gray-500">
                  PDF, DOCX, PPTX, JPG, PNG | 4 MB each
                </span>
              </div>

              <label
                htmlFor="classwork-materials"
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-none border-2 border-dashed px-4 py-5 text-sm font-semibold transition-colors ${
                  isCreatingClasswork
                    ? "cursor-not-allowed border-gray-300 bg-gray-100 text-gray-400"
                    : "border-black bg-gray-50 hover:bg-primary"
                }`}
              >
                <Upload size={18} />
                Select material files
              </label>
              <input
                id="classwork-materials"
                type="file"
                multiple
                accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                onChange={(event) => {
                  addClassworkMaterials(event.target.files);
                  event.target.value = "";
                }}
                disabled={isCreatingClasswork}
                className="hidden"
              />

              {classworkMaterials.length > 0 && (
                <div className="mt-3 space-y-2">
                  {classworkMaterials.map((material, index) => (
                    <div
                      key={`${material.name}-${material.size}`}
                      className="flex items-center gap-3 border-2 border-black bg-white px-3 py-2"
                    >
                      <FileText size={17} className="shrink-0 text-gray-700" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          {material.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {(material.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeClassworkMaterial(index)}
                        disabled={isCreatingClasswork}
                        className="p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
                        aria-label={`Remove ${material.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <label className="flex items-center gap-2 border-2 border-black px-3 py-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={classworkDraft.is_published}
              onChange={(event) =>
                setClassworkDraft((current) => ({
                  ...current,
                  is_published: event.target.checked,
                }))
              }
              disabled={isCreatingClasswork}
            />
            Publish for this class
          </label>
          <label className="flex items-center gap-2 border-2 border-black px-3 py-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={classworkDraft.show_scores}
              onChange={(event) =>
                setClassworkDraft((current) => ({
                  ...current,
                  show_scores: event.target.checked,
                }))
              }
              disabled={isCreatingClasswork}
            />
            Show scores to students
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t-2 border-black px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={closeClassworkForm}
            disabled={isCreatingClasswork}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={createClassworkForLesson}
            disabled={isCreatingClasswork}
            className="bg-[#7ABA78] text-black hover:bg-[#6aa868]"
          >
            {isCreatingClasswork ? "Adding..." : classworkModalTitle}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
