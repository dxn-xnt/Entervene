import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { Search } from "lucide-react";
import LessonModal from "@/components/LessonModal";
import { SidebarTrigger } from "@/components/ui/sidebar";
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
  const [searchQuery, setSearchQuery] = useState("");
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
        `/api/v1/lessons/my-class/${classId}/subject/${subjectId}`,
      );

      if (!response.ok) {
        throw new Error("Failed to fetch lessons");
      }

      const data = await response.json();
      setLessons(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch lessons");
    } finally {
      setIsLoading(false);
    }
  };

  const filteredLessons = lessons.filter((lesson) => {
    const matchesTab =
      activeTab === "published"
        ? lesson.is_published && !lesson.is_draft
        : activeTab === "drafts"
          ? lesson.is_draft
          : true;

    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [
        lesson.title,
        lesson.description,
        lesson.subject_name,
        lesson.teacher_name,
      ]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(query));

    return matchesTab && matchesSearch;
  });

  const handleLessonCreated = () => {
    fetchLessons();
  };

  const handleDeleteLesson = async (lessonId: number) => {
    if (!confirm("Are you sure you want to delete this lesson?")) return;

    try {
      const response = await apiFetch(`/api/v1/lessons/${lessonId}`, {
        method: "DELETE",
      });

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
      const response = await apiFetch(`/api/v1/lessons/${lessonId}/publish`, {
        method: "PUT",
      });

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
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-semibold">
                    Lessons
                  </h1>
                  <p className="text-sm text-gray-500">
                    Manage lessons for your class and subject
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1.5 rounded-lg border border-black bg-[#79bd80] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
              >
                <span className="hidden sm:inline">+ New Lesson</span>
                <span className="sm:hidden">+</span>
              </button>
            </header>

            <div className="-mx-4 md:-mx-6">
              <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
            </div>

            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2 rounded-lg border border-black bg-white px-3 py-2 md:w-96 shadow-[2px_2px_0_#000]">
              <Search size={16} className="text-gray-500 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
                placeholder="Search lessons"
              />
            </div>

            {isLoading ? (
              <p className="py-12 text-center text-gray-500">
                Loading lessons...
              </p>
            ) : filteredLessons.length > 0 ? (
              <div className="grid gap-4">
                {filteredLessons.map((lesson) => (
                  <div
                    key={lesson.lesson_id}
                    className="rounded-lg border border-black bg-white px-5 py-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <div className="flex justify-between items-start mb-3 gap-3">
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
                      <div>
                        {lesson.is_draft ? (
                          <span className="px-3 py-1 bg-[#F6E9B2] border border-black text-xs rounded-full font-semibold">
                            Draft
                          </span>
                        ) : (
                          <span className="px-3 py-1 bg-[#79bd80] border border-black text-xs rounded-full font-semibold">
                            Published
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-xs text-gray-500 mb-4">
                      Created{" "}
                      {lesson.created_at
                        ? new Date(lesson.created_at).toLocaleDateString()
                        : ""}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button className="px-4 py-1.5 text-sm font-semibold border border-black rounded-lg shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none">
                        Edit
                      </button>
                      {lesson.is_draft && (
                        <button
                          onClick={() => handlePublishLesson(lesson.lesson_id)}
                          className="px-4 py-1.5 text-sm font-semibold border border-black bg-[#79bd80] rounded-lg shadow-[2px_2px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
                        >
                          Publish
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteLesson(lesson.lesson_id)}
                        className="px-4 py-1.5 text-sm font-semibold border border-red-400 text-red-600 rounded-lg shadow-[2px_2px_0_rgba(239,68,68,1)] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-black bg-white py-12 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <p className="text-gray-500 text-sm">
                  {lessons.length > 0
                    ? "No matching lessons found"
                    : "No lessons found"}
                </p>
                {lessons.length === 0 && (
                  <button
                    onClick={() => setIsModalOpen(true)}
                    className="mt-4 text-sm font-semibold text-black underline underline-offset-2"
                  >
                    Create your first lesson
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

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
