import { useState, useEffect } from "react";
import LessonModal from "@/components/lesson-modal";
import { Alert } from "@/components/retroui/Alert";
import ConfirmAlertDialog from "@/components/retroui/ConfirmAlertDialog";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface DraftLesson {
  lesson_id: number;
  title: string;
  description?: string;
  subject_name?: string;
  is_published: boolean;
  is_draft: boolean;
  created_at?: string;
  updated_at?: string;
  subject_id: number;
}

export default function DraftLessons() {
  const [draftLessons, setDraftLessons] = useState<DraftLesson[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSubjectId, setSelectedSubjectId] = useState(0);
  const [lessonPendingDelete, setLessonPendingDelete] = useState<DraftLesson | null>(null);

  useEffect(() => {
    fetchDraftLessons();
  }, []);

  const fetchDraftLessons = async () => {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/v1/lessons/drafts");
      if (!response.ok) {
        throw new Error("Failed to load draft lessons");
      }
      const data = await response.json();
      setDraftLessons(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft lessons");
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDeleteLesson = async () => {
    if (!lessonPendingDelete) return;
    try {
      const response = await fetch(`/api/v1/lessons/${lessonPendingDelete.lesson_id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete lesson");
      }
      setLessonPendingDelete(null);
      fetchDraftLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lesson");
    }
  };

  const publishLesson = async (lessonId: number) => {
    try {
      const response = await fetch(`/api/v1/lessons/${lessonId}/publish`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to publish lesson");
      }
      fetchDraftLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish lesson");
    }
  };

  const openNewLessonModal = (subjectId: number) => {
    setSelectedSubjectId(subjectId);
    setIsModalOpen(true);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 bg-background py-4 px-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">Draft Lessons</h1>
              </div>
              <button
                onClick={() => openNewLessonModal(0)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
              >
                + New Lesson
              </button>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-4">
              {error && (
                <Alert status="error">
                  <Alert.Title>Draft lesson error</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert>
              )}

              {isLoading ? (
                <div className="text-center py-12">
                  <p className="text-gray-500">Loading draft lessons...</p>
                </div>
              ) : draftLessons.length > 0 ? (
                <div className="grid gap-4">
                  {draftLessons.map((lesson) => (
                    <div
                      key={lesson.lesson_id}
                      className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
                    >
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex-1">
                          <h3 className="text-lg font-semibold text-gray-900">
                            {lesson.title}
                          </h3>
                          {lesson.description && (
                            <p className="text-sm text-gray-600 mt-1">
                              {lesson.description}
                            </p>
                          )}
                          {lesson.subject_name && (
                            <p className="text-sm text-gray-500 mt-2">
                              <span className="font-medium">Subject:</span>{" "}
                              {lesson.subject_name}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 ml-4">
                          <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full font-medium">
                            Draft
                          </span>
                        </div>
                      </div>

                      <div className="text-sm text-gray-500 mb-4">
                        {lesson.updated_at
                          ? `Last updated ${new Date(lesson.updated_at).toLocaleDateString()}`
                          : `Created ${
                              lesson.created_at
                                ? new Date(lesson.created_at).toLocaleDateString()
                                : ""
                            }`}
                      </div>

                      <div className="flex gap-3 flex-wrap">
                        <button className="px-4 py-2 text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 text-sm font-medium transition-colors">
                          Edit
                        </button>
                        <button
                          onClick={() => publishLesson(lesson.lesson_id)}
                          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium transition-colors"
                        >
                          Publish Now
                        </button>
                        <button
                          onClick={() => setLessonPendingDelete(lesson)}
                          className="px-4 py-2 text-red-600 border border-red-600 rounded-lg hover:bg-red-50 text-sm font-medium transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 bg-white rounded-lg">
                  <p className="text-gray-500 mb-2">No draft lessons yet</p>
                  <p className="text-sm text-gray-400 mb-6">
                    Create a new lesson and save it as a draft to continue working on
                    it later
                  </p>
                  <button
                    onClick={() => openNewLessonModal(0)}
                    className="text-green-600 hover:text-green-700 font-medium"
                  >
                    Create your first draft
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <LessonModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        classId={0}
        subjectId={selectedSubjectId}
        onLessonCreated={fetchDraftLessons}
      />

      {lessonPendingDelete ? (
        <ConfirmAlertDialog
          title="Delete draft lesson?"
          description={`This will delete "${lessonPendingDelete.title}". This action cannot be undone.`}
          confirmLabel="Delete Draft"
          onCancel={() => setLessonPendingDelete(null)}
          onConfirm={confirmDeleteLesson}
        />
      ) : null}
    </AppLayout>
  );
}
