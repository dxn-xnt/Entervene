"use client";

import { useEffect, useMemo, useState, type ComponentPropsWithoutRef } from "react";
import { Info, Lock, Users } from "lucide-react";
import { Button } from "@/components/teacher/button";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Alert } from "@/components/retroui/Alert";
import { Table } from "@/components/retroui/Table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { formatStudentRosterName } from "@/lib/classwork-utils";
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
  studentDisplayNames?: Record<string, string>;
  isNested?: boolean;
  finalFocus?: ComponentPropsWithoutRef<typeof Dialog.Content>["finalFocus"];
  onSuccess?: () => void;
  onClose?: () => void;
}

type NameableStudent = Pick<StudentActivityScoreItem, "student_id" | "name"> & {
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
};

const SURNAME_PARTICLES = new Set([
  "da",
  "de",
  "del",
  "dela",
  "di",
  "la",
  "las",
  "los",
  "san",
  "santa",
  "santo",
  "st",
  "st.",
  "van",
  "von",
]);

function normalizeCommaFormattedName(value: string): string {
  const [rawSurname, ...rest] = value.split(",");
  const surname = rawSurname.trim();
  const given = rest.join(",").trim().replace(/\s+/g, " ");
  if (!surname) return given || "Student";
  if (!given) return surname;
  const givenTokens = given.split(" ");
  const lastToken = givenTokens[givenTokens.length - 1];
  if (givenTokens.length >= 2 && /^[A-Za-z]$/.test(lastToken)) {
    givenTokens[givenTokens.length - 1] = `${lastToken.toUpperCase()}.`;
  }
  return `${surname}, ${givenTokens.join(" ")}`;
}

function formatUnformattedFullName(cleaned: string): string {
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length <= 1) return cleaned || "Student";
  if (tokens.length === 2) {
    return `${tokens[1]}, ${tokens[0]}`;
  }

  const middleInitialIndex = tokens.findIndex(
    (token, index) => index > 0 && index < tokens.length - 1 && /^[A-Za-z]\.?$/.test(token),
  );
  if (middleInitialIndex !== -1) {
    const first = tokens.slice(0, middleInitialIndex).join(" ");
    const initial = `${tokens[middleInitialIndex].replace(/\.$/, "").toUpperCase()}.`;
    const surname = tokens.slice(middleInitialIndex + 1).join(" ");
    return `${surname}, ${first} ${initial}`;
  }

  if (
    tokens.length >= 4 &&
    tokens[tokens.length - 3].toLowerCase() === "de" &&
    ["la", "las", "los"].includes(tokens[tokens.length - 2].toLowerCase())
  ) {
    const surname = tokens.slice(-3).join(" ");
    const givenTokens = tokens.slice(0, -3);
    if (givenTokens.length >= 2) {
      const first = givenTokens.slice(0, -1).join(" ");
      const mi = `${givenTokens[givenTokens.length - 1].charAt(0).toUpperCase()}.`;
      return `${surname}, ${first} ${mi}`;
    }
    return `${surname}, ${givenTokens.join(" ")}`;
  }

  if (SURNAME_PARTICLES.has(tokens[tokens.length - 2].toLowerCase())) {
    const surname = tokens.slice(-2).join(" ");
    const givenTokens = tokens.slice(0, -2);
    if (givenTokens.length >= 2) {
      const first = givenTokens.slice(0, -1).join(" ");
      const mi = `${givenTokens[givenTokens.length - 1].charAt(0).toUpperCase()}.`;
      return `${surname}, ${first} ${mi}`;
    }
    return `${surname}, ${givenTokens.join(" ")}`;
  }

  if (tokens.length === 3) {
    const [first, middle, last] = tokens;
    return `${last}, ${first} ${middle.charAt(0).toUpperCase()}.`;
  }

  const surname = tokens[tokens.length - 1];
  const given = tokens.slice(0, -1).join(" ");
  return `${surname}, ${given}`;
}

function formatGradebookStudentName(
  student: NameableStudent,
  rosterDisplayName?: string | null,
): string {
  const preferred = rosterDisplayName?.trim().replace(/\s+/g, " ");
  if (preferred) {
    return preferred.includes(",")
      ? normalizeCommaFormattedName(preferred)
      : formatUnformattedFullName(preferred);
  }

  if (student.first_name?.trim() && student.last_name?.trim()) {
    return formatStudentRosterName({
      student_name: student.name,
      first_name: student.first_name,
      middle_name: student.middle_name,
      last_name: student.last_name,
    });
  }

  const cleaned = student.name.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Student";
  if (cleaned.includes(",")) {
    return normalizeCommaFormattedName(cleaned);
  }
  return formatUnformattedFullName(cleaned);
}

function splitFormattedName(formattedName: string): { surname: string; given: string } {
  const commaIndex = formattedName.indexOf(",");
  if (commaIndex === -1) {
    return { surname: formattedName.trim(), given: "" };
  }
  return {
    surname: formattedName.slice(0, commaIndex).trim(),
    given: formattedName.slice(commaIndex + 1).trim(),
  };
}

function compareStudentsBySurname(
  left: { student_id: string; displayName: string },
  right: { student_id: string; displayName: string },
): number {
  const a = splitFormattedName(left.displayName);
  const b = splitFormattedName(right.displayName);
  return (
    a.surname.localeCompare(b.surname, undefined, { sensitivity: "base" }) ||
    a.given.localeCompare(b.given, undefined, { sensitivity: "base" }) ||
    left.student_id.localeCompare(right.student_id)
  );
}

function getScoreRestrictionLabel(
  student: StudentActivityScoreItem,
  isOnlineActivity: boolean,
): string {
  if (!student.assigned) {
    return "Not assigned";
  }
  const reason = student.score_entry_reason?.trim() ?? "";
  if (isOnlineActivity && (!reason || /submit/i.test(reason))) {
    return "No submission yet";
  }
  return "Unavailable";
}

export default function EnterManualScoresModal({
  activityId,
  classId,
  activityTitle,
  maxScore,
  studentDisplayNames,
  isNested = false,
  finalFocus,
  onSuccess,
  onClose,
}: EnterManualScoresModalProps) {
  const [students, setStudents] = useState<StudentActivityScoreItem[]>([]);
  const [activityMode, setActivityMode] = useState<string>("MANUAL");
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
        setActivityMode(data.activity_mode);
        const initialMap: Record<string, string> = {};
        data.students.forEach((s) => {
          initialMap[s.student_id] = s.score !== null && s.score !== undefined ? String(s.score) : "";
        });
        setScoreInputs(initialMap);
      })
      .catch((err: unknown) => {
        if (isMounted) setErrorMessage(err instanceof Error ? err.message : "Failed to load activity scores.");
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activityId, classId]);

  const sortedStudents = useMemo(
    () =>
      students
        .map((student) => ({
          student,
          student_id: student.student_id,
          displayName: formatGradebookStudentName(
            student,
            studentDisplayNames?.[student.student_id],
          ),
        }))
        .sort(compareStudentsBySurname),
    [students, studentDisplayNames],
  );

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

    const payloadScores = Object.entries(scoreInputs)
      .filter(([student_id]) =>
        students.some(
          (student) =>
            student.student_id === student_id &&
            student.assigned &&
            student.can_enter_score,
        ),
      )
      .map(([student_id, val]) => {
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
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save scores. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const isOnlineActivity = !loading && activityMode.toUpperCase() === "ONLINE";

  return (
    <Dialog.Content
      size="lg"
      overlay={isNested ? { forceRender: true, className: "z-[1000] bg-black/35" } : undefined}
      finalFocus={finalFocus}
      className={isNested ? "z-[1001] max-w-2xl lg:max-w-2xl" : "max-w-2xl lg:max-w-2xl"}
    >
      <Dialog.Header className="border-black px-5 py-4">
        <div className="min-w-0 flex-1 pr-3">
          <Text as="h5" className="font-sans text-xl font-bold leading-tight text-black">
            Enter Scores
          </Text>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-black/80">
            <span className="max-w-full truncate">{activityTitle}</span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap font-bold text-black">
              Max score: {maxScore}
            </span>
          </div>
        </div>
      </Dialog.Header>

      <section
        data-testid="enter-scores-modal-body"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {errorMessage && (
          <Alert status="error" className="px-3 py-2 text-xs font-medium">
            {errorMessage}
          </Alert>
        )}

        {isOnlineActivity && (
          <div
            role="note"
            className="flex items-start gap-2 rounded border-2 border-black bg-yellow-50 px-3 py-2 text-xs leading-snug font-medium text-black sm:items-center"
          >
            <Info className="mt-0.5 size-3.5 shrink-0 text-black sm:mt-0" aria-hidden="true" />
            <span>Online scores can be entered only after a student submits their work.</span>
          </div>
        )}

        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Loading student roster...
          </div>
        ) : sortedStudents.length === 0 ? (
          errorMessage ? null : (
            <TeacherEmptyState
              compact
              className="rounded! bg-card shadow-none hover:shadow-none"
              icon={<Users />}
              title="No enrolled students"
              description="There are no enrolled students in this class yet."
            />
          )
        ) : (
          <Table
            wrapperClassName="h-auto rounded border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
            containerClassName="h-auto overflow-x-auto"
            className="w-full border-collapse text-sm"
          >
            <Table.Header className="border-b-2 border-black bg-primary text-xs font-head">
              <Table.Row className="hover:bg-primary hover:text-black">
                <Table.Head className="h-10 px-3 text-left font-head text-sm font-bold text-black">
                  Learner's Name
                </Table.Head>
                <Table.Head className="h-10 w-36 px-3 text-right font-head text-sm font-bold text-black sm:w-44">
                  Score
                </Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sortedStudents.map(({ student, displayName }) => {
                const currentValue = scoreInputs[student.student_id] ?? "";
                const err = fieldErrors[student.student_id];
                const isGradeable = student.assigned && student.can_enter_score;
                const restrictionLabel = getScoreRestrictionLabel(student, isOnlineActivity);
                const unavailableReason =
                  student.score_entry_reason ??
                  (!student.assigned
                    ? "Not assigned to this classwork."
                    : "Online scores can be entered only after a student submits their work.");
                const reasonId = `score-unavailable-reason-${student.student_id}`;

                return (
                  <Table.Row
                    key={student.student_id}
                    className="border-b border-black/10 hover:bg-primary/50 hover:text-black"
                  >
                    <Table.Cell className="break-words px-3 py-2 text-sm font-extrabold text-black">
                      {displayName}
                    </Table.Cell>

                    <Table.Cell className="whitespace-nowrap px-3 py-2 text-right align-middle">
                      {isGradeable ? (
                        <div className="flex flex-col items-end">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <Input
                              type="number"
                              step="any"
                              min={0}
                              max={maxScore}
                              placeholder="—"
                              aria-label={`Score for ${displayName}`}
                              aria-invalid={Boolean(err) || undefined}
                              value={currentValue}
                              onChange={(e) => handleScoreChange(student.student_id, e.target.value)}
                              className={`h-8 w-16 px-2 py-1 text-right text-sm font-bold tabular-nums shadow-none sm:w-20 sm:px-2.5 ${
                                err ? "border-red-500 bg-red-50" : ""
                              }`}
                            />
                            <span className="min-w-10 text-left text-xs font-semibold text-muted-foreground tabular-nums sm:min-w-11">
                              / {maxScore}
                            </span>
                          </div>
                          {err && (
                            <span className="mt-0.5 text-[11px] font-semibold text-red-600">
                              {err}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex justify-end">
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span
                                  tabIndex={0}
                                  aria-label={`${restrictionLabel} for ${displayName}`}
                                  aria-describedby={reasonId}
                                  className="inline-flex h-8 cursor-help items-center gap-1.5 rounded px-2 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                                >
                                  <Lock
                                    className="size-3.5 shrink-0 text-muted-foreground/80"
                                    aria-hidden="true"
                                  />
                                  <span>{restrictionLabel}</span>
                                </span>
                              }
                            />
                            <TooltipContent side="left" align="center">
                              {unavailableReason}
                            </TooltipContent>
                          </Tooltip>
                          <span id={reasonId} className="sr-only">
                            {unavailableReason}
                          </span>
                        </div>
                      )}
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table>
        )}
      </section>

      <Dialog.Footer className="mt-0 border-black px-5 py-4">
        <Dialog.Close>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
        </Dialog.Close>
        <Button
          type="button"
          variant="default"
          onClick={handleSave}
          disabled={loading || saving || Object.keys(fieldErrors).length > 0}
        >
          {saving ? "Saving..." : "Save Scores"}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  );
}
