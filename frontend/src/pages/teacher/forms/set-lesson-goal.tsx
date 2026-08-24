"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { createActivity, apiFetch } from "@/lib/api";

interface AddClassworkScoreModalProps {
  categoryName: string;
  classId?: number;
  subjectId?: number;
  onSuccess?: () => void;
  onClose?: () => void;
}

interface LessonItem {
  lesson_id: number;
  title: string;
}

export default function AddClassworkScoreModal({
  categoryName,
  classId,
  subjectId,
  onSuccess,
  onClose,
}: AddClassworkScoreModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>(categoryName);
  const [activityMode, setActivityMode] = useState<string>("MANUAL"); // MANUAL or ONLINE
  const [title, setTitle] = useState<string>("");
  const [maxScore, setMaxScore] = useState<string>("100");
  const [dateTaken, setDateTaken] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [selectedLessonIds, setSelectedLessonIds] = useState<number[]>([]);

  const [availableLessons, setAvailableLessons] = useState<LessonItem[]>([]);
  const [loadingLessons, setLoadingLessons] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (classId && subjectId) {
      setLoadingLessons(true);
      apiFetch(`/api/v1/lessons/my-class/${classId}/subject/${subjectId}`)
        .then((res) => {
          if (res.ok) return res.json();
          return [];
        })
        .then((data: LessonItem[]) => {
          setAvailableLessons(data || []);
        })
        .catch(() => setAvailableLessons([]))
        .finally(() => setLoadingLessons(false));
    }
  }, [classId, subjectId]);

  const mapCategoryToEnum = (cat: string): string => {
    if (cat.toLowerCase().includes("written")) return "WRITTEN_WORK";
    if (cat.toLowerCase().includes("performance")) return "PERFORMANCE_TASK";
    if (cat.toLowerCase().includes("quarter")) return "QUARTERLY_ASSESSMENT";
    return "WRITTEN_WORK";
  };

  const isQuarterly = mapCategoryToEnum(selectedCategory) === "QUARTERLY_ASSESSMENT";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!title.trim()) {
      setErrorMessage("Activity Name is required.");
      return;
    }

    const points = parseFloat(maxScore);
    if (isNaN(points) || points <= 0) {
      setErrorMessage("Maximum Score must be a positive number.");
      return;
    }

    if (!classId || !subjectId) {
      setErrorMessage("Missing class or subject parameters.");
      return;
    }

    if (isQuarterly && selectedLessonIds.length === 0) {
      setErrorMessage("Quarterly Assessment requires at least one lesson to be linked.");
      return;
    }

    try {
      setLoading(true);
      await createActivity({
        title: title.trim(),
        classwork_category: mapCategoryToEnum(selectedCategory),
        total_points: points,
        class_id: classId,
        subject_id: subjectId,
        activity_mode: activityMode,
        description: description.trim() || undefined,
        due_date: dateTaken ? new Date(dateTaken).toISOString() : undefined,
        lesson_ids: selectedLessonIds.length > 0 ? selectedLessonIds : undefined,
      });

      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to create activity.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog.Content size={"lg"}>
      <Dialog.Header asChild>
        <Text as="h5" className="font-sans text-xl font-bold">
          Add Activity ({selectedCategory})
        </Text>
      </Dialog.Header>

      <form onSubmit={handleSubmit}>
        <section className="flex flex-col gap-3 p-4 max-h-[60vh] sm:max-h-[65vh] overflow-y-auto">
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-md font-medium">
              {errorMessage}
            </div>
          )}

          {/* Activity Mode Selection */}
          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-sm font-semibold">Activity Mode</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`py-2 px-3 text-sm font-bold border-2 rounded-md transition-colors ${activityMode === "MANUAL"
                    ? "bg-primary text-primary-foreground border-black shadow-sm"
                    : "bg-muted text-muted-foreground border-gray-300 hover:bg-gray-100"
                  }`}
                onClick={() => setActivityMode("MANUAL")}
              >
                Manual Activity
              </button>
              <button
                type="button"
                className={`py-2 px-3 text-sm font-bold border-2 rounded-md transition-colors ${activityMode === "ONLINE"
                    ? "bg-primary text-primary-foreground border-black shadow-sm"
                    : "bg-muted text-muted-foreground border-gray-300 hover:bg-gray-100"
                  }`}
                onClick={() => setActivityMode("ONLINE")}
              >
                Online Activity
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {activityMode === "MANUAL"
                ? "Scores are recorded manually by the teacher outside the LMS."
                : "Students will submit responses online through the platform."}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-sm font-semibold">Grading Category</label>
            <Select value={selectedCategory} onValueChange={(val) => setSelectedCategory(val)}>
              <Select.Trigger className="w-full">
                <Select.Value placeholder="Select category" />
              </Select.Trigger>
              <Select.Content>
                <Select.Group>
                  <Select.Item value="Written Works">Written Works</Select.Item>
                  <Select.Item value="Performance Tasks">Performance Tasks</Select.Item>
                  <Select.Item value="Quarterly Assessment">Quarterly Assessment</Select.Item>
                </Select.Group>
              </Select.Content>
            </Select>
          </div>

          {/* Multi-Select Covered Lessons */}
          <div className="flex flex-col gap-1.5 w-full">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold">
                Covered Lessons {isQuarterly ? "*" : "(Optional)"}
              </label>
              {availableLessons.length > 0 && (
                <span className="text-xs text-muted-foreground font-medium">
                  {selectedLessonIds.length} selected
                </span>
              )}
            </div>

            {loadingLessons ? (
              <div className="text-xs text-muted-foreground py-2">Loading available lessons...</div>
            ) : availableLessons.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 bg-muted/30 px-3 rounded-md border border-border">
                No lessons found for this class & subject.
              </div>
            ) : (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto border border-border p-2 rounded-md bg-background shadow-inner">
                {availableLessons.map((l) => {
                  const isChecked = selectedLessonIds.includes(l.lesson_id);
                  return (
                    <label
                      key={l.lesson_id}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer text-sm font-medium transition-colors ${isChecked
                          ? "bg-primary/10 text-foreground font-semibold"
                          : "hover:bg-muted/40 text-muted-foreground"
                        }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLessonIds((prev) => [...prev, l.lesson_id]);
                          } else {
                            setSelectedLessonIds((prev) => prev.filter((id) => id !== l.lesson_id));
                          }
                        }}
                        className="size-4 rounded border-gray-400 text-primary focus:ring-primary"
                      />
                      <span>{l.title}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {isQuarterly && (
              <p className="text-xs text-muted-foreground">
                Select one or more lessons that this Quarterly Assessment covers.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-sm font-semibold">Activity Name *</label>
            <Input
              placeholder="e.g. Oral Recitation 1, Seatwork #2"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-sm font-semibold">Maximum Score *</label>
            <Input
              placeholder="100"
              type="number"
              min={1}
              value={maxScore}
              onChange={(e) => setMaxScore(e.target.value)}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-sm font-semibold">Date Activity Taken (Optional)</label>
            <Input
              type="date"
              value={dateTaken}
              onChange={(e) => setDateTaken(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5 w-full">
            <label className="text-sm font-semibold">Description / Notes (Optional)</label>
            <Input
              placeholder="Additional notes for this activity"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </section>

        <Dialog.Footer>
          <Dialog.Close>
            <Button type="button" variant={"outline"} onClick={onClose}>
              Cancel
            </Button>
          </Dialog.Close>
          <Button type="submit" variant={"default"} disabled={loading}>
            {loading ? "Creating..." : "Create Activity"}
          </Button>
        </Dialog.Footer>
      </form>
    </Dialog.Content>
  );
}
