import { useState, useEffect } from "react";
import LessonModal from "@/components/lesson-modal";
import { Alert } from "@/components/retroui/Alert";
import ConfirmAlertDialog from "@/components/retroui/ConfirmAlertDialog";
import AppLayout from "@/layouts/app-layout";

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
      const response = await fetch(
        "http://localhost:8000/api/v1/lessons/drafts",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch draft lessons");
      }

      const data = await response.json();
      setDraftLessons(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch draft lessons"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDeleteLesson = async () => {
    if (!lessonPendingDelete) return;
    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/lessons/${lessonPendingDelete.lesson_id}`,
        {
          method: "DELETE",
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to delete lesson");
      }

      setDraftLessons(draftLessons.filter((l) => l.lesson_id !== lessonPendingDelete.lesson_id));
      setLessonPendingDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lesson");
    }
  };

  const handlePublishLesson = async (lessonId: number) => {
    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/lessons/${lessonId}/publish`,
        {
          method: "PUT",
          credentials: "include",
        }
      );

      if (!response.ok) {
        throw new Error("Failed to publish lesson");
      }

      // Remove from drafts and refresh
      setDraftLessons(draftLessons.filter((l) => l.lesson_id !== lessonId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish lesson");
    }
  };

  const openNewLessonModal = (subjectId: number) => {
    setSelectedSubjectId(subjectId);
    setIsModalOpen(true);
  };

  return (
    // <AppLayout className="min-h-screen bg-gray-50">
    <AppLayout>
      <header className="bg-white border-b px-6 py-5">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Draft Lessons</h1>
            <p className="text-gray-600 mt-1">
              Manage and publish your draft lessons
            </p>
          </div>
          <button
            onClick={() => openNewLessonModal(0)}
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            + New Lesson
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4">
          <Alert status="error">
            <Alert.Title>Draft lesson error</Alert.Title>
            <Alert.Description>{error}</Alert.Description>
          </Alert>
        </div>
      )}

      <main className="px-6 py-6">
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
                    onClick={() => handlePublishLesson(lesson.lesson_id)}
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
      </main>

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
