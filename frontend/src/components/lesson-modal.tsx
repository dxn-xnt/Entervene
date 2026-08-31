import { useState } from "react";
import LessonForm, { type LessonFormData } from "@/components/lesson-form";

import { Dialog } from "@/components/retroui/Dialog";
import { Card } from "@/components/retroui/Card";

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

      if (data.publishImmediately) {
        window.location.href = `/subjects/${subjectId}/lessons`;
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="2xl" className="max-h-[90vh] p-0">
        {/* Header */}
        <Dialog.Header position="fixed" className="bg-[#F6E9B2]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs">Lesson Management</p>

              <h2 className="text-xl font-bold">Create New Lesson</h2>
            </div>

          </div>
        </Dialog.Header>

        {/* Body */}
        <div className="max-h-[calc(90vh-88px)] overflow-y-auto p-5">
          <Card className="block shadow-none">
            <LessonForm
              classId={classId}
              subjectId={subjectId}
              onSubmit={handleSubmit}
              isLoading={isLoading}
            />
          </Card>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
