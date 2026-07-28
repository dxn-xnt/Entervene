"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/retroui/Button";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import {
  getActivityScores,
  bulkUpdateActivityScores,
  type StudentActivityScoreItem,
} from "@/lib/api";

interface EnterManualScoresModalProps {
  activityId: number;
  classId: number;
  activityTitle: string;
  maxScore: number;
  onSuccess?: () => void;
  onClose?: () => void;
}

export default function EnterManualScoresModal({
  activityId,
  classId,
  activityTitle,
  maxScore,
  onSuccess,
  onClose,
}: EnterManualScoresModalProps) {
  const [students, setStudents] = useState<StudentActivityScoreItem[]>([]);
  // Local state map: student_id -> score string value (empty string = ungraded)
  const [scoreInputs, setScoreInputs] = useState<Record<string, string>>({});
  // Inline errors map: student_id -> error string
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    getActivityScores(activityId, classId)
      .then((data) => {
        if (!isMounted) return;
        setStudents(data.students);
        const initialMap: Record<string, string> = {};
        data.students.forEach((s) => {
          initialMap[s.student_id] = s.score !== null && s.score !== undefined ? String(s.score) : "";
        });
        setScoreInputs(initialMap);
      })
      .catch((err: any) => {
        if (isMounted) setErrorMessage(err.message || "Failed to load activity scores.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activityId, classId]);

  const handleScoreChange = (studentId: string, value: string) => {
    setScoreInputs((prev) => ({ ...prev, [studentId]: value }));

    // Validate inline
    if (value.trim() === "") {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
      return;
    }

    const num = parseFloat(value);
    if (isNaN(num)) {
      setFieldErrors((prev) => ({ ...prev, [studentId]: "Numeric values only." }));
    } else if (num < 0) {
      setFieldErrors((prev) => ({ ...prev, [studentId]: "Cannot be negative." }));
    } else if (num > maxScore) {
      setFieldErrors((prev) => ({ ...prev, [studentId]: `Cannot exceed ${maxScore}.` }));
    } else {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[studentId];
        return next;
      });
    }
  };

  const handleSave = async () => {
    setErrorMessage(null);

    // Check if any inline field errors exist
    if (Object.keys(fieldErrors).length > 0) {
      setErrorMessage("Please resolve invalid score entries before saving.");
      return;
    }

    const payloadScores = Object.entries(scoreInputs).map(([student_id, val]) => {
      const trimmed = val.trim();
      const score = trimmed !== "" ? parseFloat(trimmed) : null;
      return { student_id, score };
    });

    try {
      setSaving(true);
      await bulkUpdateActivityScores(activityId, {
        class_id: classId,
        scores: payloadScores,
      });

      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to save scores. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Content size={"xl"}>
      <Dialog.Header asChild>
        <Text as="h5" className="font-sans text-xl font-bold">
          Enter Scores: {activityTitle}
        </Text>
      </Dialog.Header>

      <section className="flex flex-col gap-4 p-4 max-h-[70vh] overflow-y-auto">
        <div className="flex items-center justify-between bg-muted/40 p-3 rounded-lg border border-border">
          <span className="text-sm font-semibold text-foreground">
            Activity: <span className="font-bold">{activityTitle}</span>
          </span>
          <span className="text-sm font-bold bg-background px-3 py-1 rounded-full border border-border">
            Maximum Score: {maxScore}
          </span>
        </div>

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-md font-medium">
            {errorMessage}
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-500">Loading student roster...</div>
        ) : students.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">No enrolled students found.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {students.map((student) => {
              const currentValue = scoreInputs[student.student_id] ?? "";
              const err = fieldErrors[student.student_id];

              return (
                <div
                  key={student.student_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-white border border-border rounded-lg shadow-sm hover:border-black/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-8 rounded-full bg-primary/20 text-primary-foreground border border-black flex items-center justify-center font-bold text-xs shrink-0">
                      {student.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <span className="font-semibold text-foreground text-sm">{student.name}</span>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-auto">
                    <div className="flex flex-col items-end">
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          max={maxScore}
                          placeholder="—"
                          value={currentValue}
                          onChange={(e) => handleScoreChange(student.student_id, e.target.value)}
                          className={`w-24 text-center font-bold text-base h-9 ${
                            err ? "border-red-500 bg-red-50" : ""
                          }`}
                        />
                        <span className="text-xs text-muted-foreground font-semibold">/ {maxScore}</span>
                      </div>
                      {err && <span className="text-[11px] text-red-600 font-semibold mt-0.5">{err}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Dialog.Footer>
        <Dialog.Close>
          <Button type="button" variant={"outline"} onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </Dialog.Close>
        <Button
          type="button"
          variant={"default"}
          onClick={handleSave}
          disabled={loading || saving || Object.keys(fieldErrors).length > 0}
        >
          {saving ? "Saving..." : "Save Scores"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
