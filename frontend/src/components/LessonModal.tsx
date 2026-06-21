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
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-lg border border-black shadow-[4px_4px_0_#000]">
        <div className="sticky top-0 flex items-center justify-between border-b border-black bg-[#7ABA78] px-5 py-4">
          <h2 className="text-xl font-bold">Create New Lesson</h2>
          <button
            onClick={onClose}
            className="hover:text-gray-700 text-2xl leading-none"
            disabled={isLoading}
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto bg-white p-6">
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
