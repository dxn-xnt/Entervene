import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import LessonModal from "@/components/LessonModal";
import Tabs from "@/components/Tabs";
import AppLayout from "@/layouts/app-layout";
import { apiFetch } from "@/lib/api";

interface Lesson {
  lesson_id: number;
  title: string;
  description?: string;
  subject_name?: string;
  is_published: boolean;
  is_draft: boolean;
  created_at?: string;
  teacher_name?: string;
}

const tabs = [
  { id: "all", label: "All Lessons" },
  { id: "published", label: "Published" },
  { id: "drafts", label: "Drafts" },
];

export default function Lessons() {
  const { classId, subjectId } = useParams<{
    classId: string;
    subjectId: string;
  }>();
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState("all");
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    fetchLessons();
  }, [classId, subjectId]);

  const fetchLessons = async () => {
    if (!classId || !subjectId) return;

    setIsLoading(true);
    setError("");

    try {
      const response = await apiFetch(
        `/api/v1/lessons/my-class/${classId}/subject/${subjectId}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch lessons");
      }

      const data = await response.json();
      setLessons(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch lessons"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLessons = lessons.filter((lesson) => {
    if (activeTab === "published") return lesson.is_published && !lesson.is_draft;
    if (activeTab === "drafts") return lesson.is_draft;
    return true;
  });

  const handleLessonCreated = () => {
    fetchLessons();
  };

  const handleDeleteLesson = async (lessonId: number) => {
    if (!confirm("Are you sure you want to delete this lesson?")) return;

    try {
      const response = await apiFetch(
        `/api/v1/lessons/${lessonId}`,
        { method: "DELETE" }
      );

      if (!response.ok) {
        throw new Error("Failed to delete lesson");
      }

      setLessons(lessons.filter((l) => l.lesson_id !== lessonId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete lesson");
    }
  };

  const handlePublishLesson = async (lessonId: number) => {
    try {
      const response = await apiFetch(
        `/api/v1/lessons/${lessonId}/publish`,
        { method: "PUT" }
      );

      if (!response.ok) {
        throw new Error("Failed to publish lesson");
      }

      // Refresh the lessons list
      fetchLessons();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish lesson");
    }
  };

  return (
    // <AppLayout className="min-h-screen bg-gray-50">
    <AppLayout>
      <header className="bg-white px-6 py-5 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Lessons</h1>
          <p className="text-gray-600 mt-1">
            Manage lessons for your class and subject
          </p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
        >
          + New Lesson
        </button>
      </header>

      {error && (
        <div className="mx-6 mt-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          {error}
        </div>
      )}

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      <main className="px-6 py-6">
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Loading lessons...</p>
          </div>
        ) : filteredLessons.length > 0 ? (
          <div className="grid gap-4">
            {filteredLessons.map((lesson) => (
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
                  </div>
                  <div className="flex gap-2 ml-4">
                    {lesson.is_draft ? (
                      <span className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full font-medium">
                        Draft
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-green-100 text-green-800 text-sm rounded-full font-medium">
                        Published
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-sm text-gray-500 mb-4">
                  Created{" "}
                  {lesson.created_at
                    ? new Date(lesson.created_at).toLocaleDateString()
                    : ""}
                </div>

                <div className="flex gap-3">
                  <button className="px-4 py-2 text-blue-600 border border-blue-600 rounded-lg hover:bg-blue-50 text-sm font-medium transition-colors">
                    Edit
                  </button>
                  {lesson.is_draft && (
                    <button
                      onClick={() => handlePublishLesson(lesson.lesson_id)}
                      className="px-4 py-2 text-green-600 border border-green-600 rounded-lg hover:bg-green-50 text-sm font-medium transition-colors"
                    >
                      Publish
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteLesson(lesson.lesson_id)}
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
            <p className="text-gray-500">No lessons found</p>
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-4 text-green-600 hover:text-green-700 font-medium"
            >
              Create your first lesson
            </button>
          </div>
        )}
      </main>

      <LessonModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        classId={parseInt(classId || "0")}
        subjectId={parseInt(subjectId || "0")}
        onLessonCreated={handleLessonCreated}
      />
    </AppLayout>
  );
}
