import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import AttachmentDisplay from "@/components/AttachmentDisplay";

interface LessonAttachment {
  lesson_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface Lesson {
  lesson_id: number;
  title: string;
  description?: string;
  content?: string;
  subject_name?: string;
  teacher_name?: string;
  is_published: boolean;
  created_at?: string;
  updated_at?: string;
  attachments: LessonAttachment[];
}

type SubjectLessonTabProps = {
  classId?: number;
  subjectId?: number;
  subject?: string;
};

export default function SubjectLessonTab({
  classId,
  subjectId,
}: SubjectLessonTabProps) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (classId && subjectId) {
      fetchLessons();
    }
  }, [classId, subjectId]);

  const fetchLessons = async () => {
    if (!classId || !subjectId) return;

    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(
        `http://localhost:8000/api/v1/lessons/my-class/${classId}/subject/${subjectId}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        }
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

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Loading lessons...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={fetchLessons}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No lessons available for this subject</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold text-gray-900">Lessons</h3>

      {lessons.map((lesson) => {
        const isExpanded = expandedId === lesson.lesson_id;

        return (
          <div
            key={lesson.lesson_id}
            className="border border-gray-200 rounded-lg overflow-hidden bg-white"
          >
            {/* Header */}
            <button
              onClick={() =>
                setExpandedId(isExpanded ? null : lesson.lesson_id)
              }
              className="w-full px-4 py-4 flex items-start justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 text-left">
                <h4 className="font-semibold text-gray-900 mb-2">
                  {lesson.title}
                </h4>
                <div className="text-sm text-gray-600 space-y-1">
                  {lesson.teacher_name && (
                    <p>
                      <span className="font-medium">Teacher:</span>{" "}
                      {lesson.teacher_name}
                    </p>
                  )}
                  {lesson.attachments && lesson.attachments.length > 0 && (
                    <p>
                      <span className="font-medium">Files:</span>{" "}
                      {lesson.attachments.length} attachment(s)
                    </p>
                  )}
                </div>
              </div>

              <div className="ml-4">
                {isExpanded ? (
                  <ChevronUp className="text-gray-500" />
                ) : (
                  <ChevronDown className="text-gray-500" />
                )}
              </div>
            </button>

            {/* Details */}
            {isExpanded && (
              <div className="border-t border-gray-200 px-4 py-4 bg-gray-50 space-y-4">
                {/* Description */}
                {lesson.description && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-1">
                      Description
                    </h5>
                    <p className="text-sm text-gray-700">{lesson.description}</p>
                  </div>
                )}

                {/* Content */}
                {lesson.content && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-1">Content</h5>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap bg-white p-3 rounded border border-gray-200 max-h-64 overflow-y-auto">
                      {lesson.content}
                    </div>
                  </div>
                )}

                {/* Attachments */}
                {lesson.attachments && lesson.attachments.length > 0 && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-2">
                      Attachments
                    </h5>
                    <AttachmentDisplay
                      attachments={lesson.attachments}
                      type="lesson"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
