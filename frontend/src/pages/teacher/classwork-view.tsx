import {
  Archive,
  FileText,
  Pencil,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import AttachmentDisplay from "@/components/attachment-display";
import { API_URL, apiFetch } from "@/lib/api";
import { Badge } from "@/components/retroui/Badge";
import type { QuizAnalysis } from "./classworks/quiz-builder-types";
import QuizGradingModal from "@/components/quiz-grading-modal";
import {
  isQuizType,
  isReadingType,
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
import { Select } from "@/components/retroui/Select";
import { Alert } from "@/components/retroui/Alert";
import { Avatar } from "@/components/retroui/Avatar";
import QuizAnalysisView from "./classworks/quiz-analysis-view";
import StudentSubmissionView from "./classworks/student-submission-view";
import EditClassworkModal from "./forms/edit-classwork";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import RubricsScoreBoard from "@/components/rubrics-score-board";

export type ClassworkViewProps = {
  classwork?: TeacherClasswork;
  onClose?: () => void;
  onUpdated?: (updated: TeacherClasswork) => void;
  onArchived?: (classworkId: number) => void;
};

export default function ClassworkView({
  classwork,
  onClose,
  onUpdated,
  onArchived,
}: ClassworkViewProps = {}) {
  const navigate = useNavigate();
  const params = useParams<{ classworkId: string }>();
  const isStandalone = !classwork;

  const [selected, setSelected] = useState<TeacherClasswork | null>(classwork ?? null);
  const [isClassworkLoading, setIsClassworkLoading] = useState(!classwork);
  const [classworkFetchError, setClassworkFetchError] = useState("");
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

  // Sync internal selected state when prop changes or fetch if standalone
  useEffect(() => {
    if (classwork) {
      setSelected(classwork);
      setIsClassworkLoading(false);
      return;
    }

    const classworkId = params.classworkId;
    if (!classworkId) {
      setClassworkFetchError("No classwork ID specified.");
      setIsClassworkLoading(false);
      return;
    }

    let isMounted = true;
    setIsClassworkLoading(true);
    setClassworkFetchError("");

    apiFetch(`/api/v1/classwork-assignments/classwork/${classworkId}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Unable to load classwork.");
        }
        return res.json() as Promise<TeacherClasswork>;
      })
      .then((data) => {
        if (isMounted) {
          setSelected(data);
          setIsClassworkLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setClassworkFetchError(
            err instanceof Error ? err.message : "Unable to load classwork.",
          );
          setIsClassworkLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [classwork, params.classworkId]);

  const loadTrackingAndAnalysis = useCallback(async () => {
    if (!selected) return;
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
  }, [selected]);

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
      if (onArchived) {
        onArchived(selected.classwork_id);
      } else {
        navigate("/teacher/classworks");
      }
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

  if (isClassworkLoading) {
    const loadingContent = (
      <main className="flex flex-1 items-center justify-center p-8">
        <p className="text-muted-foreground font-semibold animate-pulse">
          Loading classwork details...
        </p>
      </main>
    );
    return isStandalone ? <AppLayout>{loadingContent}</AppLayout> : loadingContent;
  }

  if (!selected || classworkFetchError) {
    const errorContent = (
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
        <p className="text-red-600 font-semibold">
          {classworkFetchError || "Classwork not found."}
        </p>
        <Button
          onClick={() => (onClose ? onClose() : navigate("/teacher/classworks"))}
        >
          Back to Classworks
        </Button>
      </main>
    );
    return isStandalone ? <AppLayout>{errorContent}</AppLayout> : errorContent;
  }

  if (selectedStudent) {
    const studentSubmissionContent = (
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
    );

    return isStandalone ? (
      <AppLayout>{studentSubmissionContent}</AppLayout>
    ) : (
      studentSubmissionContent
    );
  }

  const mainContent = (
    <main className="flex flex-1 flex-col overflow-x-hidden">
      <div className="@container/main flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
          <div className="flex flex-row gap-3 justify-between items-center">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger className="md:hidden" />
              <Breadcrumb>
                <Breadcrumb.List className="flex-nowrap">
                  <Breadcrumb.Item className="shrink-0">
                    <Breadcrumb.Link
                      onClick={() =>
                        onClose ? onClose() : navigate("/teacher/classworks")
                      }
                      className="cursor-pointer"
                    >
                      Classworks
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator className="shrink-0" />
                  <Breadcrumb.Item className="min-w-0">
                    <Breadcrumb.Page
                      className="block max-w-[200px] truncate sm:max-w-[350px] lg:max-w-[400px]"
                      title={selected?.title ?? "Classwork Title"}
                    >
                      {selected?.title ?? "Classwork Title"}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
            </div>

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
          </div>

          <div className="-mx-4 md:-mx-6 border-b-2 border-border" />

          <Card className="mx-auto w-full space-y-4">
            <Card className="block w-full bg-primary shadow-none">
              <Card.Content>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <Card.Title className="flex flex-row gap-2 mb-0 text-2xl font-extrabold">
                      <FileText className="size-7" />

                      {selected.title}
                    </Card.Title>
                  </div>
                </div>
              </Card.Content>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <Card className="block shadow-none md:col-span-4">
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

              <Card className="block shadow-none md:col-span-2">
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
            </div>


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
                <RubricsScoreBoard totalPoints={selected.total_points} />
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-xl font-bold">Submissions</h2>
                    <div className="flex items-center gap-2">
                      <label className="text-sm font-semibold">
                        Sort by
                      </label>
                      <Select
                        value={submissionSort}
                        onValueChange={(value) =>
                          setSubmissionSort(value as "name" | "score")
                        }
                      >
                        <Select.Trigger className="h-8 text-sm shadow-none">
                          <Select.Value placeholder="Sort by" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="name">Name</Select.Item>
                          <Select.Item value="score">Score</Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                  </div>

                  <Table className="border-black">
                    <Table.Header className="border-black">
                      <Table.Row>
                        <Table.Head>Student</Table.Head>
                        <Table.Head className="text-center">Status</Table.Head>
                        <Table.Head className="min-w-20 text-right">
                          Grade
                        </Table.Head>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {detailError ? (
                        <Table.Row className="hover:bg-transparent">
                          <Table.Cell colSpan={3} className="p-4">
                            <Alert status="error">
                              <Alert.Description>{detailError}</Alert.Description>
                            </Alert>
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
                              className="cursor-pointer"
                              key={student.student_id}
                              onClick={() =>
                                openStudentSubmission(student)
                              }
                            >
                              <Table.Cell>
                                <div className="flex items-center gap-3">
                                  <Avatar variant="student" className="size-8 shrink-0">
                                    <Avatar.Image
                                      src="/avatars/student-avatars/1.svg"
                                      alt={student.student_name}
                                    />
                                    <Avatar.Fallback>
                                      {student.student_name.slice(0, 1).toUpperCase()}
                                    </Avatar.Fallback>
                                  </Avatar>
                                  <span className="text-base font-semibold">
                                    {student.student_name}
                                  </span>
                                </div>
                              </Table.Cell>
                              <Table.Cell className="text-center">
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

            {showArchiveConfirm && (
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
          </Card>
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

  return isStandalone ? <AppLayout>{mainContent}</AppLayout> : mainContent;
}
