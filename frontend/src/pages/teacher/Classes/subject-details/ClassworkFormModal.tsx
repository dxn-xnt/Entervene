import type { Dispatch, SetStateAction } from "react";
import { FileText, Trash2, Upload, X } from "lucide-react";
import type { ClassworkDraft, Lesson } from "./types";

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
  const isReadingDraft = classworkDraft.classwork_type === "READING";
  const isQuizDraft = classworkDraft.classwork_type === "QUIZ";
  const allowsClassworkMaterials = classworkDraft.classwork_type !== "QUIZ";
  const classworkModalTitle = isReadingDraft ? "Add Reading" : isQuizDraft ? "Add Quiz" : "Add Classwork";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <div className="sticky top-0 flex items-center justify-between border-b border-black bg-[#7ABA78] px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">{classworkModalTitle}</h2>
            <p className="text-xs font-medium">Lesson: {classworkLesson.title}</p>
          </div>
          <button type="button" onClick={closeClassworkForm} className="rounded p-1 hover:bg-white/30">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="classwork-title" className="mb-1 block text-sm font-semibold">Title</label>
            <input
              id="classwork-title"
              value={classworkDraft.title}
              onChange={(event) =>
                setClassworkDraft((current) => ({ ...current, title: event.target.value }))
              }
              disabled={isCreatingClasswork}
              className="w-full rounded-lg border border-gray-700 px-3 py-2"
              placeholder="Activity 1"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="classwork-type" className="mb-1 block text-sm font-semibold">Type</label>
              <select
                id="classwork-type"
                value={classworkDraft.classwork_type}
                onChange={(event) => {
                  const nextType = event.target.value;
                  setClassworkDraft((current) => ({
                    ...current,
                    classwork_type: nextType,
                    total_points: nextType === "READING" ? "" : current.total_points || "100",
                  }));
                }}
                disabled={isCreatingClasswork}
                className="w-full rounded-lg border border-gray-700 px-3 py-2"
              >
                <option value="READING">Reading</option>
                <option value="ACTIVITY">Activity</option>
                <option value="ASSIGNMENT">Assignment</option>
                <option value="QUIZ">Quiz</option>
              </select>
            </div>

            <div>
              <label htmlFor="classwork-category" className="mb-1 block text-sm font-semibold">Category</label>
              <select
                id="classwork-category"
                value={classworkDraft.classwork_category}
                onChange={(event) =>
                  setClassworkDraft((current) => ({ ...current, classwork_category: event.target.value }))
                }
                disabled={isCreatingClasswork}
                className="w-full rounded-lg border border-gray-700 px-3 py-2"
              >
                <option value="WRITTEN_WORK">Written Work</option>
                <option value="PERFORMANCE_TASK">Performance Task</option>
                <option value="PERIODICAL_EXAM">Periodical Exam</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {!isReadingDraft && (
              <div>
                <label htmlFor="classwork-points" className="mb-1 block text-sm font-semibold">Total points</label>
                <input
                  id="classwork-points"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="decimal"
                  value={classworkDraft.total_points}
                  onChange={(event) =>
                    setClassworkDraft((current) => ({ ...current, total_points: event.target.value }))
                  }
                  disabled={isCreatingClasswork}
                  className="w-full rounded-lg border border-gray-700 px-3 py-2"
                />
              </div>
            )}

            <div>
              <label htmlFor="classwork-due" className="mb-1 block text-sm font-semibold">Due date</label>
              <input
                id="classwork-due"
                type="datetime-local"
                value={classworkDraft.due_date}
                onChange={(event) =>
                  setClassworkDraft((current) => ({ ...current, due_date: event.target.value }))
                }
                disabled={isCreatingClasswork}
                className="w-full rounded-lg border border-gray-700 px-3 py-2"
              />
            </div>
          </div>

          {!isReadingDraft && classworkDraft.due_date && (
            <label className="flex items-start gap-3 rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 text-sm font-semibold">
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
            <label htmlFor="classwork-description" className="mb-1 block text-sm font-semibold">Description</label>
            <textarea
              id="classwork-description"
              value={classworkDraft.description}
              onChange={(event) =>
                setClassworkDraft((current) => ({ ...current, description: event.target.value }))
              }
              disabled={isCreatingClasswork}
              className="min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2"
              placeholder="Optional summary"
            />
          </div>

          <div>
            <label htmlFor="classwork-instructions" className="mb-1 block text-sm font-semibold">Instructions</label>
            <textarea
              id="classwork-instructions"
              value={classworkDraft.instructions}
              onChange={(event) =>
                setClassworkDraft((current) => ({ ...current, instructions: event.target.value }))
              }
              disabled={isCreatingClasswork}
              className="min-h-24 w-full rounded-lg border border-gray-700 px-3 py-2"
              placeholder="What students need to do"
            />
          </div>

          {isQuizDraft && (
            <div className="rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              Save this quiz first, then open its details to manually build questions or import quiz questions from a file.
            </div>
          )}

          {isReadingDraft && (
            <div className="rounded-lg border border-black bg-[#F6E9B2] px-4 py-3 text-sm font-medium shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
              Add the reading file or notes here so students can see the lesson material inside the classwork timeline.
            </div>
          )}

          {allowsClassworkMaterials && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <label htmlFor="classwork-materials" className="block text-sm font-semibold">
                  Upload Material
                </label>
                <span className="text-xs font-medium text-gray-500">
                  PDF, DOCX, PPTX, JPG, PNG | 4 MB each
                </span>
              </div>

              <label
                htmlFor="classwork-materials"
                className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-sm font-semibold transition-colors ${
                  isCreatingClasswork
                    ? "cursor-not-allowed border-gray-300 bg-gray-100 text-gray-400"
                    : "border-gray-700 bg-gray-50 hover:bg-[#F6E9B2]"
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
                      className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2"
                    >
                      <FileText size={17} className="shrink-0 text-gray-700" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{material.name}</p>
                        <p className="text-xs text-gray-500">
                          {(material.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeClassworkMaterial(index)}
                        disabled={isCreatingClasswork}
                        className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
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

          <label className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={classworkDraft.is_published}
              onChange={(event) =>
                setClassworkDraft((current) => ({ ...current, is_published: event.target.checked }))
              }
              disabled={isCreatingClasswork}
            />
            Publish for this class
          </label>
        </div>

        <div className="flex justify-end gap-3 border-t border-black px-5 py-4">
          <button
            type="button"
            onClick={closeClassworkForm}
            disabled={isCreatingClasswork}
            className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={createClassworkForLesson}
            disabled={isCreatingClasswork}
            className="rounded-lg border border-gray-700 bg-[#7ABA78] px-4 py-2 text-sm font-semibold hover:brightness-95 disabled:opacity-60"
          >
            {isCreatingClasswork ? "Adding..." : classworkModalTitle}
          </button>
        </div>
      </section>
    </div>
  );
}
