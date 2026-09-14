import { useState } from "react";
import { CardContent } from "@/components/ui/card";

interface LessonFormProps {
  classId: number;
  subjectId: number;
  onSubmit: (data: LessonFormData) => Promise<void>;
  isLoading?: boolean;
  initialData?: Partial<LessonFormData>;
}

export interface LessonFormData {
  title: string;
  description: string;
  content: string;
  publishImmediately: boolean;
}

export default function LessonForm({
  onSubmit,
  isLoading = false,
  initialData,
}: LessonFormProps) {
  const [formData, setFormData] = useState<LessonFormData>({
    title: initialData?.title || "",
    description: initialData?.description || "",
    content: initialData?.content || "",
    publishImmediately: initialData?.publishImmediately || false,
  });

  const [error, setError] = useState<string>("");

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;
    if (type === "checkbox") {
      setFormData({
        ...formData,
        [name]: (e.target as HTMLInputElement).checked,
      });
    } else {
      setFormData({
        ...formData,
        [name]: value,
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!formData.title.trim()) {
      setError("Lesson title is required");
      return;
    }

    try {
      await onSubmit(formData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lesson");
    }
  };

  const buttonLabel = formData.publishImmediately
    ? "Publish Lesson"
    : "Save Draft";

  return (
    <div className="w-full">
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-none border border-red-400 bg-red-100 p-3 text-red-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium mb-2">
              Lesson Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              name="title"
              value={formData.title}
              onChange={handleChange}
              placeholder="Enter lesson title"
<<<<<<< HEAD
              className="w-full px-4 py-2 border rounded focus:border-ring focus:ring-2 focus:ring-ring/35"
=======
              className="w-full rounded-none border px-4 py-2 focus:border-ring focus:ring-2 focus:ring-ring/35"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              htmlFor="description"
              className="block text-sm font-medium mb-2"
            >
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Enter lesson description (optional)"
              rows={3}
<<<<<<< HEAD
              className="w-full px-4 py-2 border rounded focus:border-ring focus:ring-2 focus:ring-ring/35"
=======
              className="w-full rounded-none border px-4 py-2 focus:border-ring focus:ring-2 focus:ring-ring/35"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="content" className="block text-sm font-medium mb-2">
              Content
            </label>
            <textarea
              id="content"
              name="content"
              value={formData.content}
              onChange={handleChange}
              placeholder="Enter lesson content"
              rows={6}
<<<<<<< HEAD
              className="w-full px-4 py-2 border rounded focus:border-ring focus:ring-2 focus:ring-ring/35"
=======
              className="w-full rounded-none border px-4 py-2 focus:border-ring focus:ring-2 focus:ring-ring/35"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
              disabled={isLoading}
            />
          </div>

<<<<<<< HEAD
          <div className="flex items-center gap-3 p-4 bg-gray-50 rounded">
=======
          <div className="flex items-center gap-3 rounded-none bg-gray-50 p-4">
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
            <input
              type="checkbox"
              id="publishImmediately"
              name="publishImmediately"
              checked={formData.publishImmediately}
              onChange={handleChange}
              className="w-4 h-4"
              disabled={isLoading}
            />
            <label htmlFor="publishImmediately" className="text-sm font-medium">
              Publish Immediately
            </label>
            <span className="text-xs text-gray-500 ml-auto">
              {formData.publishImmediately
                ? "Lesson will be published to students"
                : "Lesson will be saved as draft"}
            </span>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              type="button"
<<<<<<< HEAD
              className="px-6 py-2 border rounded hover:bg-gray-50"
=======
              className="rounded-none border px-6 py-2 hover:bg-gray-50"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
              disabled={isLoading}
              onClick={() => window.history.back()}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
<<<<<<< HEAD
              className={`px-6 py-2 text-black border rounded font-medium transition-colors bg-[#7ABA78] disabled:opacity-50 disabled:cursor-not-allowed`}
=======
              className="rounded-none border bg-primary px-6 py-2 font-medium text-primary-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-50"
>>>>>>> db4c0c452e2d9c605335b22d05f6935487b30b3d
            >
              {isLoading ? "Saving..." : buttonLabel}
            </button>
          </div>
        </form>
      </CardContent>
    </div>
  );
}
