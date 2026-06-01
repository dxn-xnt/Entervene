import { useState } from "react";
import LessonForm, { type LessonFormData } from "@/components/LessonForm";

interface LessonModalProps {
  isOpen: boolean;
  onClose: () => void;
  classId: number;
  subjectId: number;
  onLessonCreated?: (lesson: any) => void;
}

export default function LessonModal({
  isOpen,
  onClose,
  classId,
  subjectId,
  onLessonCreated,
}: LessonModalProps) {
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (data: LessonFormData) => {
    setIsLoading(true);
    try {
      const response = await fetch("http://localhost:8000/api/v1/lessons/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          title: data.title,
          description: data.description,
          content: data.content,
          subject_id: subjectId,
          is_published: data.publishImmediately,
          is_draft: !data.publishImmediately,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to create lesson");
      }

      const lesson = await response.json();
      onLessonCreated?.(lesson);
      onClose();

      // Redirect to subject lessons page if publishing
      if (data.publishImmediately) {
        window.location.href = `/subjects/${subjectId}/lessons`;
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b p-4 flex justify-between items-center">
          <h2 className="text-xl font-semibold">Create New Lesson</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
            disabled={isLoading}
          >
            ×
          </button>
        </div>
        <div className="p-6">
          <LessonForm
            classId={classId}
            subjectId={subjectId}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </div>
    </div>
  );
}
