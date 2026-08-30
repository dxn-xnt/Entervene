import {
  Archive,
  FileText,
  Pencil,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import AttachmentDisplay from "@/components/attachment-display";
import { API_URL, apiFetch } from "@/lib/api";
import { Badge } from "@/components/retroui/Badge";
import type { QuizAnalysis } from "./classworks/quiz-builder-types";
import QuizGradingModal from "@/components/quiz-grading-modal";
import {
  isQuizType,
  isReadingType,
  scoreBand,
  submissionStatusLabel,
} from "@/lib/classwork-utils";
import type {
  AssignmentTracking,
  TeacherClasswork,
  TeacherSubmissionDetail,
  TrackingStudent,
} from "@/types/classwork";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { Card } from "@/components/retroui/Card";
import QuizAnalysisView from "./classworks/quiz-analysis-view";
import StudentSubmissionView from "./classworks/student-submission-view";
import EditClassworkModal from "./forms/edit-classwork";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";

export type ClassworkViewProps = {
  classwork: TeacherClasswork;
  onClose: () => void;
  onUpdated?: (updated: TeacherClasswork) => void;
  onArchived?: (classworkId: number) => void;
};

export default function ClassworkView({
  classwork,
  onUpdated,
  onArchived,
}: ClassworkViewProps) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<TeacherClasswork>(classwork);
  const [tracking, setTracking] = useState<AssignmentTracking | null>(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
  const [quizAnalysis, setQuizAnalysis] = useState<QuizAnalysis | null>(null);
  const [isQuizAnalysisLoading, setIsQuizAnalysisLoading] = useState(false);
  const [quizAnalysisError, setQuizAnalysisError] = useState("");
  const [selectedGradingSubmissionId, setSelectedGradingSubmissionId] =
    useState<number | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [submissionSort, setSubmissionSort] = useState<"name" | "score">(
    "name",
  );
  const [selectedStudent, setSelectedStudent] =
    useState<TrackingStudent | null>(null);
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] =
    useState<TeacherSubmissionDetail | null>(null);
  const [isSubmissionLoading, setIsSubmissionLoading] = useState(false);
  const [submissionDetailError, setSubmissionDetailError] = useState("");
  const [gradeError, setGradeError] = useState("");
  const [gradeDraft, setGradeDraft] = useState("");
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [isPostingGrade, setIsPostingGrade] = useState(false);
  const [gradeSuccess, setGradeSuccess] = useState("");

  // Sync internal selected state when prop changes
  useEffect(() => {
    setSelected(classwork);
  }, [classwork]);

  const loadTrackingAndAnalysis = useCallback(async () => {
    const assignmentId = selected.assignments?.[0]?.classwork_assignment_id;
    if (!assignmentId) return;

    setIsTrackingLoading(true);
    if (isQuizType(selected.classwork_type)) {
      setIsQuizAnalysisLoading(true);
    }
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/tracking`,
      );
      if (!response.ok) {
        throw new Error("Unable to load student submissions.");
      }
      setTracking((await response.json()) as AssignmentTracking);
      if (isQuizType(selected.classwork_type)) {
        const analysisResponse = await apiFetch(
          `/api/v1/quizzes/classwork/${selected.classwork_id}/analysis`,
        );
        if (!analysisResponse.ok) {
          const body = await analysisResponse.json().catch(() => ({}));
          throw new Error(body.detail || "Unable to load quiz analysis.");
        }
        setQuizAnalysis((await analysisResponse.json()) as QuizAnalysis);
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to load student submissions.";
      if (isQuizType(selected.classwork_type)) {
        setQuizAnalysisError(message);
      } else {
        setDetailError(message);
      }
    } finally {
      setIsTrackingLoading(false);
      setIsQuizAnalysisLoading(false);
    }
  }, [selected.assignments, selected.classwork_id, selected.classwork_type]);

  useEffect(() => {
    loadTrackingAndAnalysis();
  }, [loadTrackingAndAnalysis]);

  const archiveSelectedClasswork = async () => {
    if (!selected) return;

    setIsArchiving(true);
    setDetailError("");
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/archive`,
        { method: "PUT" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to archive classwork.");
      }

      setShowArchiveConfirm(false);
      onArchived?.(selected.classwork_id);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Unable to archive classwork.",
      );
    } finally {
      setIsArchiving(false);
    }
  };

  const openStudentSubmission = async (student: TrackingStudent) => {
    // For quizzes, open the specialized Quiz Question Grading Modal directly
    if (selected && isQuizType(selected.classwork_type)) {
      if (student.submission_id) {
        setSelectedGradingSubmissionId(student.submission_id);
      }
      return;
    }

    // Opens the teacher review view for a single student's submission.
    setSelectedStudent(student);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
    setGradeDraft(
      student.grade !== null && student.grade !== undefined
        ? String(student.grade)
        : "",
    );
    setFeedbackDraft("");

    if (!student.submission_id) return;

    setIsSubmissionLoading(true);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/${student.submission_id}/detail`,
      );
      if (!response.ok) {
        throw new Error("Unable to load submission detail.");
      }
      const detail = (await response.json()) as TeacherSubmissionDetail;
      setSelectedSubmissionDetail(detail);
      setGradeDraft(
        detail.grade !== null && detail.grade !== undefined
          ? String(detail.grade)
          : "",
      );
      setFeedbackDraft(detail.feedback ?? "");
    } catch (err) {
      setSubmissionDetailError(
        err instanceof Error
          ? err.message
          : "Unable to load submission detail.",
      );
    } finally {
      setIsSubmissionLoading(false);
    }
  };

  const closeStudentSubmission = () => {
    setSelectedStudent(null);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
  };

  const postGrade = async () => {
    if (!selectedSubmissionDetail || !selected) return;
    const grade = Number(gradeDraft);
    if (!Number.isFinite(grade) || grade < 0) {
      setGradeError("Enter a valid score.");
      return;
    }
    if (
      selected.total_points !== null &&
      selected.total_points !== undefined &&
      grade > selected.total_points
    ) {
      setGradeError(`Score cannot be greater than ${selected.total_points}.`);
      return;
    }

    setIsPostingGrade(true);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
    try {
      const response = await apiFetch(
        `/api/v1/submissions/${selectedSubmissionDetail.submission_id}/grade`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grade,
            feedback: feedbackDraft.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to post grade.");
      }
      const updated = (await response.json()) as TeacherSubmissionDetail;
      setSelectedSubmissionDetail(updated);
      setSelectedStudent((current) =>
        current
          ? { ...current, status: updated.status, grade: updated.grade ?? null }
          : current,
      );
      setTracking((current) => {
        if (!current) return current;
        const updateRow = (row: TrackingStudent) =>
          row.submission_id === updated.submission_id
            ? { ...row, status: updated.status, grade: updated.grade ?? null }
            : row;
        return {
          ...current,
          submitted: current.submitted.map(updateRow),
          missing: current.missing.map(updateRow),
        };
      });
      setGradeSuccess("Grade and feedback saved.");
    } catch (err) {
      setGradeError(
        err instanceof Error ? err.message : "Unable to post grade.",
      );
    } finally {
      setIsPostingGrade(false);
    }
  };

  const trackingRows = useMemo(() => {
    const rows = [...(tracking?.submitted ?? []), ...(tracking?.missing ?? [])];
    return rows.sort((a, b) => {
      if (submissionSort === "score") {
        return (b.grade ?? -1) - (a.grade ?? -1);
      }
      return a.student_name.localeCompare(b.student_name);
    });
  }, [submissionSort, tracking]);

  return (
    <main className="flex flex-1 flex-col overflow-x-hidden">
      <div className="@container/main flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
          <div className="flex flex-row gap-3 justify-between items-center">
            <div className="flex items-center gap-3 min-w-0">
              <Breadcrumb>
                <Breadcrumb.List className="flex-nowrap">
                  <Breadcrumb.Item className="shrink-0">
                    <Breadcrumb.Link
                      onClick={() => navigate("/teacher/classworks")}
                      className="cursor-pointer"
                    >
                      Classworks
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator className="shrink-0" />
                  <Breadcrumb.Item className="min-w-0">
                    <Breadcrumb.Page
                      className="block max-w-[200px] truncate sm:max-w-[350px] md:max-w-[500px] lg:max-w-[550px]"
                      title={selected?.title ?? "Classwork Title"}
                    >
                      {selected?.title ?? "Classwork Title"}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </div>

            {!selectedStudent && (
              <div className="flex items-center gap-2 flex-col lg:flex-row lg:flex-nowrap">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowEditModal(true)}
                  disabled={isArchiving}
                  className="whitespace-nowrap gap-2"
                >
                  <Pencil size={16} />
                  Edit Classwork
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowArchiveConfirm(true)}
                  disabled={isArchiving}
                  className="whitespace-nowrap gap-2 bg-primary"
                >
                  <Archive size={16} />
                  Archive Classwork
                </Button>
              </div>
            )}
          </div>

          <div className="-mx-4 md:-mx-6 border-b-2 border-border" />

          <section className="mx-auto w-full space-y-4">
            <div className="flex items-center gap-3">
              <FileText className="size-7" />
              <h1 className="text-xl font-bold md:text-2xl">
                {selected.title}
              </h1>
            </div>

            {selectedStudent ? (
              <StudentSubmissionView
                selectedStudent={selectedStudent}
                selected={selected}
                selectedSubmissionDetail={selectedSubmissionDetail}
                isSubmissionLoading={isSubmissionLoading}
                submissionDetailError={submissionDetailError}
                gradeDraft={gradeDraft}
                feedbackDraft={feedbackDraft}
                gradeError={gradeError}
                gradeSuccess={gradeSuccess}
                isPostingGrade={isPostingGrade}
                onClose={closeStudentSubmission}
                onGradeChange={(value) => {
                  setGradeDraft(value);
                  setGradeError("");
                  setGradeSuccess("");
                }}
                onFeedbackChange={(value) => {
                  setFeedbackDraft(value);
                  setGradeError("");
                  setGradeSuccess("");
                }}
                onPostGrade={postGrade}
                onOpenQuizGrading={(submissionId) =>
                  setSelectedGradingSubmissionId(submissionId)
                }
              />
            ) : (
              <>
                <Card className="block">
                  <Card.Content>
                    <Card.Title className="mb-3 text-xl">
                      Instructions
                    </Card.Title>
                    <p className="text-sm">
                      {selected.instructions ||
                        selected.description ||
                        "No instructions provided."}
                    </p>
                  </Card.Content>
                </Card>

                <Card className="block">
                  <Card.Content className="space-y-6">
                    <div className="flex items-center justify-between">
                      <Card.Title className="mb-0 text-xl">
                        Attached Files
                      </Card.Title>

                      <Badge variant="secondary" size="sm">
                        File {selected.attachments.length}
                      </Badge>
                    </div>

                    {selected.attachments.length > 0 ? (
                      <AttachmentDisplay
                        attachments={selected.attachments}
                        type="classwork"
                        downloadUrl={(attachmentId) =>
                          `${API_URL}/api/v1/classwork-assignments/classwork/${selected.classwork_id}/attachments/${attachmentId}/download`
                        }
                      />
                    ) : (
                      <div className="py-8 text-center">
                        <p className="text-sm text-muted-foreground">
                          No files attached.
                        </p>
                      </div>
                    )}
                  </Card.Content>
                </Card>

                {isReadingType(selected.classwork_type) ? (
                  <div className="rounded-lg border border-black bg-[#F6E9B2] p-4 text-sm font-semibold shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                    This is a reading material, so scores, attempts, and
                    student submissions are not required.
                  </div>
                ) : isQuizType(selected.classwork_type) ? (
                  <QuizAnalysisView
                    quizAnalysis={quizAnalysis}
                    isQuizAnalysisLoading={isQuizAnalysisLoading}
                    quizAnalysisError={quizAnalysisError}
                    selected={selected}
                    setSelectedGradingSubmissionId={setSelectedGradingSubmissionId}
                  />
                ) : (
                  <>
                    <Card className="block">
                      <Card.Content className="space-y-6">
                        <div className="flex items-center justify-between">
                          <Card.Title className="mb-0 text-xl">
                            Activity Score
                          </Card.Title>

                          <Badge variant="secondary" size="sm">
                            Total: {selected.total_points ?? 0} pts
                          </Badge>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                          {[
                            [
                              "Excellent",
                              scoreBand(selected.total_points, 1),
                              "Displays all required components clearly and accurately.",
                            ],
                            [
                              "Good",
                              scoreBand(selected.total_points, 0.8),
                              "Most components are present with minor errors.",
                            ],
                            [
                              "Fair",
                              scoreBand(selected.total_points, 0.6),
                              "Some required parts are missing or unclear.",
                            ],
                            [
                              "Needs Improvement",
                              scoreBand(selected.total_points, 0.4),
                              "Many required elements are missing.",
                            ],
                            [
                              "Poor",
                              scoreBand(selected.total_points, 0.2),
                              "Work is incomplete or not submitted.",
                            ],
                          ].map(([label, points, description]) => (
                            <div
                              key={label}
                              className="rounded-lg border border-black p-3"
                            >
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <p className="font-bold">{label}</p>
                                <p className="text-sm font-bold">{points}</p>
                              </div>
                              <p className="text-xs">{description}</p>
                            </div>
                          ))}
                        </div>
                      </Card.Content>
                    </Card>

                    <div className="space-y-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <h2 className="text-xl font-bold">Submissions</h2>
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-bold text-gray-600">
                            Sort by
                          </label>
                          <select
                            value={submissionSort}
                            onChange={(event) =>
                              setSubmissionSort(
                                event.target.value as "name" | "score",
                              )
                            }
                            className="rounded border border-black bg-white px-2 py-1 text-xs font-bold"
                          >
                            <option value="name">Name</option>
                            <option value="score">Score</option>
                          </select>
                        </div>
                      </div>

                      <Table className="border-black">
                        <Table.Header className="border-black">
                          <Table.Row className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-black font-bold">
                            <Table.Head>Student</Table.Head>
                            <Table.Head>Status</Table.Head>
                            <Table.Head className="min-w-20 text-right">
                              Grade
                            </Table.Head>
                          </Table.Row>
                        </Table.Header>
                        <Table.Body>
                          {isTrackingLoading ? (
                            <Table.Row className="hover:bg-transparent">
                              <Table.Cell
                                colSpan={3}
                                className="py-6 text-center text-sm font-semibold text-gray-500"
                              >
                                Loading submissions...
                              </Table.Cell>
                            </Table.Row>
                          ) : detailError ? (
                            <Table.Row className="hover:bg-transparent">
                              <Table.Cell
                                colSpan={3}
                                className="py-6 text-center text-sm font-semibold text-red-600"
                              >
                                {detailError}
                              </Table.Cell>
                            </Table.Row>
                          ) : trackingRows.length > 0 ? (
                            trackingRows.map((student) => {
                              const isGraded =
                                student.grade !== null &&
                                student.grade !== undefined;
                              const scoreLabel = isGraded
                                ? `${student.grade} / ${selected.total_points ?? 0}`
                                : "Not graded";

                              return (
                                <Table.Row
                                  key={student.student_id}
                                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-black"
                                >
                                  <Table.Cell>
                                    <div className="flex items-center gap-3">
                                      <div className="grid h-8 w-8 place-items-center rounded-full border-2 border-black bg-[#FFD08A] text-xs font-bold">
                                        {student.student_name.slice(0, 1)}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openStudentSubmission(student)
                                        }
                                        className="font-bold hover:underline"
                                      >
                                        {student.student_name}
                                      </button>
                                    </div>
                                  </Table.Cell>
                                  <Table.Cell>
                                    <Badge
                                      variant="outline"
                                      size="sm"
                                      className="w-fit rounded-none font-medium"
                                    >
                                      {submissionStatusLabel(
                                        isGraded
                                          ? "graded"
                                          : student.status,
                                      )}
                                    </Badge>
                                  </Table.Cell>
                                  <Table.Cell className="min-w-20 text-right text-sm font-semibold text-gray-700">
                                    {scoreLabel}
                                  </Table.Cell>
                                </Table.Row>
                              );
                            })
                          ) : (
                            <Table.Row className="hover:bg-transparent">
                              <Table.Cell
                                colSpan={3}
                                className="py-6 text-center text-sm font-semibold text-gray-500"
                              >
                                No submissions found for this classwork yet.
                              </Table.Cell>
                            </Table.Row>
                          )}
                        </Table.Body>
                      </Table>
                    </div>
                  </>
                )}
              </>
            )}

            {showArchiveConfirm && !selectedStudent && (
              <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                <Card className="block w-full max-w-md border-black p-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-none hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="flex items-center justify-between border-b-2 border-black bg-red-100 px-5 py-3">
                    <div className="flex items-center gap-2 text-red-800">
                      <Archive size={18} />
                      <h2 className="font-bold">Archive Classwork?</h2>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowArchiveConfirm(false)}
                      disabled={isArchiving}
                      className="hover:bg-white/60 disabled:opacity-50"
                      aria-label="Close archive confirmation"
                    >
                      <X size={16} />
                    </Button>
                  </div>
                  <div className="space-y-3 p-5">
                    <p className="text-sm font-medium">
                      Are you sure you want to archive{" "}
                      <span className="font-bold">"{selected.title}"</span>?
                    </p>
                    <p className="text-xs text-gray-600">
                      This only works while no student work is turned in. If
                      there are submissions, ask students to unsubmit first.
                      Linked lessons stay intact.
                    </p>
                  </div>
                  <div className="flex justify-end gap-3 border-t-2 border-black px-5 py-4">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowArchiveConfirm(false)}
                      disabled={isArchiving}
                      className="border-black font-semibold disabled:opacity-50"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={archiveSelectedClasswork}
                      disabled={isArchiving}
                      className="border-black bg-red-600 font-bold text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-red-700 disabled:opacity-50"
                    >
                      {isArchiving ? "Archiving..." : "Archive Classwork"}
                    </Button>
                  </div>
                </Card>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Edit Classwork Modal */}
      <EditClassworkModal
        classwork={selected}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        onSuccess={(updated) => {
          setSelected(updated);
          onUpdated?.(updated);
        }}
      />

      {selectedGradingSubmissionId && (
        <QuizGradingModal
          submissionId={selectedGradingSubmissionId}
          isOpen={Boolean(selectedGradingSubmissionId)}
          onClose={() => setSelectedGradingSubmissionId(null)}
          onSuccess={() => {
            void loadTrackingAndAnalysis();
          }}
        />
      )}
    </main>
  );
}
