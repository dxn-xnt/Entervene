import {
  Archive,
  FileText,
  Pencil,
  X,
  AlertTriangle,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import AttachmentDisplay from "@/components/attachment-display";
import { API_URL, apiFetch } from "@/lib/api";
import { Badge } from "@/components/retroui/Badge";
import type { QuizAnalysis } from "./classworks/quiz-builder-types";
import QuizGradingModal from "@/components/quiz-grading-modal";
import {
  formatDate,
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
import { useToast } from "@/components/retroui/use-toast";
import { Table } from "@/components/retroui/Table";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { Select } from "@/components/retroui/Select";
import { Alert } from "@/components/retroui/Alert";
import { Avatar } from "@/components/retroui/Avatar";
import QuizAnalysisView from "./classworks/quiz-analysis-view";
import StudentSubmissionView from "./classworks/student-submission-view";
import EditClassworkModal from "./forms/edit-classwork";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import RubricsScoreBoard from "@/components/rubrics-score-board";
import DeadlineSummaryModal from "@/components/teacher/deadline-summary-modal";

export type ClassworkViewProps = {
  classwork?: TeacherClasswork;
  onClose?: () => void;
  onUpdated?: (updated: TeacherClasswork) => void;
  onArchived?: (classworkId: number) => void;
};

function toTitleCase(str?: string | null, fallback = "Classwork") {
  if (!str) return fallback;
  return str
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function ClassworkView({
  classwork,
  onClose,
  onUpdated,
  onArchived,
}: ClassworkViewProps = {}) {
  const toast = useToast();
  const navigate = useNavigate();
  const params = useParams<{ classworkId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isStandalone = !classwork;

  const [selected, setSelected] = useState<TeacherClasswork | null>(classwork ?? null);
  const [isClassworkLoading, setIsClassworkLoading] = useState(!classwork);
  const [classworkFetchError, setClassworkFetchError] = useState("");
  const [tracking, setTracking] = useState<AssignmentTracking | null>(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<
    number | "all"
  >("all");
  const [readingStatusFilter, setReadingStatusFilter] = useState<
    "all" | "opened" | "not_opened"
  >("all");
  const [quizAnalysis, setQuizAnalysis] = useState<QuizAnalysis | null>(null);
  const [isQuizAnalysisLoading, setIsQuizAnalysisLoading] = useState(false);
  const [quizAnalysisError, setQuizAnalysisError] = useState("");
  const [selectedGradingSubmissionId, setSelectedGradingSubmissionId] =
    useState<number | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isDeadlineSummaryOpen, setIsDeadlineSummaryOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "graded" | "on_time" | "late" | "missing"
  >("all");
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

  useEffect(() => {
    if (searchParams.get("focus") === "deadline_summary") {
      setIsDeadlineSummaryOpen(true);
    }
  }, [searchParams]);

  const handleCloseDeadlineSummary = () => {
    setIsDeadlineSummaryOpen(false);
    if (searchParams.has("focus")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("focus");
      setSearchParams(nextParams, { replace: true });
    }
  };

  const handleSelectStudentFromSummary = (student: TrackingStudent) => {
    handleCloseDeadlineSummary();
    void openStudentSubmission(student);
  };

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

  useEffect(() => {
    setSelectedAssignmentId("all");
  }, [selected?.classwork_id]);

  const loadTrackingAndAnalysis = useCallback(async () => {
    if (!selected) return;
    const trackingUrl =
      selectedAssignmentId !== "all"
        ? `/api/v1/submissions/assignment/${selectedAssignmentId}/tracking`
        : `/api/v1/submissions/classwork/${selected.classwork_id}/tracking`;

    setIsTrackingLoading(true);
    if (isQuizType(selected.classwork_type)) {
      setIsQuizAnalysisLoading(true);
    }
    try {
      const response = await apiFetch(trackingUrl);
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
  }, [selected, selectedAssignmentId]);

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
      toast.success({ title: "Classwork archived" });
      if (onArchived) {
        onArchived(selected.classwork_id);
      } else {
        navigate("/teacher/classworks");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to archive classwork.";
      setDetailError(message);
      toast.error({ title: "Unable to archive classwork", description: message });
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

  const handleSelectSection = (id: number | "all") => {
    setSelectedAssignmentId(id);
    closeStudentSubmission();
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
      toast.success({ title: "Grade and feedback saved" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to post grade.";
      setGradeError(message);
      toast.error({ title: "Unable to save grade", description: message });
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

  const filterCounts = useMemo(() => {
    const all = [...(tracking?.submitted ?? []), ...(tracking?.missing ?? [])];
    const graded = all.filter(
      (s) => (s.grade !== null && s.grade !== undefined) || s.status === "graded",
    ).length;
    const onTime = all.filter((s) => s.status === "submitted").length;
    const late = all.filter((s) => s.status === "late").length;
    const missing = all.filter(
      (s) =>
        s.status === "not_submitted" ||
        !s.submission_id ||
        !["submitted", "late", "graded"].includes(s.status),
    ).length;
    return {
      all: all.length,
      graded,
      on_time: onTime,
      late,
      missing,
    };
  }, [tracking]);

  const filteredTrackingRows = useMemo(() => {
    return trackingRows.filter((student) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "graded") {
        return (
          (student.grade !== null && student.grade !== undefined) ||
          student.status === "graded"
        );
      }
      if (statusFilter === "on_time") {
        return student.status === "submitted";
      }
      if (statusFilter === "late") {
        return student.status === "late";
      }
      if (statusFilter === "missing") {
        return (
          student.status === "not_submitted" ||
          !student.submission_id ||
          !["submitted", "late", "graded"].includes(student.status)
        );
      }
      return true;
    });
  }, [statusFilter, trackingRows]);

  const isReading = Boolean(selected && isReadingType(selected.classwork_type));
  const totalStudents = tracking?.total_students ?? 0;
  const submittedCount = tracking?.submitted_count ?? 0;
  const submissionRate =
    totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;

  const needsGrading = Boolean(
    selected &&
    (selected as any).is_graded !== false &&
    !isReading,
  );

  const gradedCount =
    tracking?.submitted?.filter(
      (student) =>
        (student.grade !== null && student.grade !== undefined) ||
        student.status === "graded",
    ).length ?? 0;

  const gradingRate =
    submittedCount > 0 ? Math.round((gradedCount / submittedCount) * 100) : 0;

  const isStudentOpened = (student: TrackingStudent) => {
    return (
      student.status === "submitted" ||
      student.status === "late" ||
      student.status === "graded" ||
      Boolean(student.submitted_at)
    );
  };

  const filteredReadingRows = useMemo(() => {
    const rows = [...(tracking?.submitted ?? []), ...(tracking?.missing ?? [])];
    rows.sort((a, b) => a.student_name.localeCompare(b.student_name));
    return rows.filter((student) => {
      const opened = isStudentOpened(student);
      if (readingStatusFilter === "opened") return opened;
      if (readingStatusFilter === "not_opened") return !opened;
      return true;
    });
  }, [readingStatusFilter, tracking]);

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
        <div className="flex flex-1 flex-col">
          <header className="flex min-w-0 flex-row items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
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
                    <Tooltip>
                      <TooltipTrigger render={<Breadcrumb.Page
                        className="block max-w-[200px] truncate sm:max-w-[350px] lg:max-w-[400px]"
                        tabIndex={0}
                      >
                        {selected?.title ?? "Classwork Title"}
                      </Breadcrumb.Page>} />
                      <TooltipContent>{selected?.title ?? "Classwork Title"}</TooltipContent>
                    </Tooltip>
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
          </header>

          <div className="-mt-[1px] flex flex-col min-w-0 border-t-2 border-border px-3 py-3 gap-3 sm:px-4 sm:py-4 md:px-6">
            <Card className="mx-auto w-full space-y-4 px-5 py-6">
              <Card className="w-full border-0 p-0 shadow-none">
                <Card.Content className="flex flex-col gap-1">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <Card.Title className="flex flex-row items-center gap-3 mb-0 text-3xl font-abold">
                      <FileText className="size-14 shrink-0" strokeWidth={1.70} />
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-row items-center gap-2">
                          <span>{selected.title}</span>
                          <Badge variant="secondary" size="sm" className="h-fit ml-1">
                            {toTitleCase(selected.classwork_type)}
                          </Badge>
                        </div>
                        <div className="gap-3">
                          {(() => {
                            const activeAssignment =
                              selectedAssignmentId !== "all"
                                ? selected.assignments?.find(
                                  (a) =>
                                    a.classwork_assignment_id === selectedAssignmentId,
                                )
                                : selected.assignments?.find((a) => a.due_date);
                            const due = activeAssignment?.due_date;
                            if (!due) return null;
                            return (
                              <div className="rounded! border-2 border-black bg-background p-2 px-3 rounded">
                                <p className="font-bold text-sm">
                                  {new Date(due).toLocaleString()} |
                                </p>
                              </div>
                            );
                          })()}
                          {selected.created_at && selected.is_published && (
                            <div className="">
                              <p className="font-normal text-sm">Created on
                                <span className="ml-1">
                                  {selected.created_at
                                    ? formatDate(selected.created_at)
                                    : selected.is_published
                                      ? "Published"
                                      : "No published date"}
                                </span>
                              </p>
                            </div>
                          )}
                        </div>
                      </div>

                    </Card.Title>

                    <div className="flex flex-wrap items-center gap-2 px-2">
                      <Badge
                        variant="outline"
                        size="md"
                        className="w-fit"
                      >
                        {toTitleCase(selected.classwork_category)}
                      </Badge>
                      <Badge variant="solid" size="md">
                        {selected.is_published ? "Published" : "Draft"}
                      </Badge>
                      {selected.is_locked && (
                        <Badge variant="outline" size="sm" className="bg-white">
                          Locked
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card.Content>
              </Card>

              <div className="flex flex-col gap-4 pt-1">
                <Card className="w-full p-0 border-0 shadow-none px-2">
                  <Card.Content>
                    <Card.Title className="mb-1 text-lg">
                      Instructions
                    </Card.Title>
                    <Card className=" shadow-none w-full p-2">
                      <p className="text-sm px-2">
                        {selected.instructions ||
                          selected.description ||
                          "No instructions provided."}
                      </p>
                    </Card>
                  </Card.Content>
                </Card>

                <Card className="w-full p-0 border-0 shadow-none px-2">
                  <Card.Content className="space-y-3">
                    <Card.Title className="mb-1 text-lg">
                      Attached Files
                    </Card.Title>

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

              <RubricsScoreBoard
                totalPoints={selected.total_points}
                rubricLevels={
                  selected.classwork_type === "ACTIVITY"
                    ? selected.rubric_levels
                    : undefined
                }
              />
              {showArchiveConfirm && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4">
                  <Card className="block w-full max-w-md border-border bg-background p-0 text-foreground shadow-[4px_4px_0_#000] transition-none hover:shadow-[4px_4px_0_#000]">
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

            {/* Submissions & Grading / Reading Engagement Progress Card */}
            <Card className="w-full">
              <Card.Header className="pb-1 flex flex-row flex-wrap items-center justify-between gap-2">
                <Card.Title className="text-lg font-bold">
                  {isReadingType(selected.classwork_type)
                    ? "Reading Engagement Rate"
                    : isQuizType(selected.classwork_type)
                      ? "Quiz Analysis"
                      : "Submissions & Grading"}
                </Card.Title>
                {tracking && totalStudents > 0 && (
                  <Badge
                    variant="outline"
                    size="sm"
                    className="bg-white"
                  >
                    <span className="font-bold! mr-1.5">{submittedCount} / {totalStudents}</span>
                    {isReadingType(selected.classwork_type) ? "Opened" : "Submitted"}
                  </Badge>
                )}
              </Card.Header>

              {/* Assigned Sections Filter */}
              {selected.assignments && selected.assignments.length > 0 && (
                <div className="flex flex-row items-center gap-2 overflow-x-auto pb-1 px-2">
                  <span className="shrink-0 text-sm font-regular text-muted-foreground">
                    Section:
                  </span>
                  {selected.assignments.length > 1 && (
                    <Button
                      autoIcon={false}
                      variant={selectedAssignmentId === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleSelectSection("all")}
                      className="shrink-0 border-black shadow-none h-fit!"
                    >
                      All Sections
                    </Button>
                  )}
                  {selected.assignments.map((assignment) => {
                    const isSelected =
                      selectedAssignmentId === assignment.classwork_assignment_id ||
                      (selected.assignments!.length === 1 && selectedAssignmentId === "all");
                    return (
                      <Button
                        key={assignment.classwork_assignment_id}
                        autoIcon={false}
                        variant={isSelected ? "default" : "outline"}
                        size="sm"
                        onClick={() =>
                          handleSelectSection(assignment.classwork_assignment_id)
                        }
                        className="shrink-0 border-black shadow-none h-fit!"
                      >
                        {assignment.title || `Section ${assignment.class_id}`}
                      </Button>
                    );
                  })}
                </div>
              )}

              {/* Submissions & Grading / Reading Engagement Progress Card */}
              {isReadingType(selected.classwork_type) ? (
                <div className="space-y-6">
                  <Card className="w-full shadow-none bg-primary">
                    <Card.Content className="space-y-3">

                      {/* Reading Engagement Progress */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-sm text-foreground">
                          <span>Engagement Rate</span>
                          <span>
                            {isTrackingLoading && !tracking
                              ? "Loading..."
                              : totalStudents > 0
                                ? `${submissionRate}%`
                                : "0%"}
                          </span>
                        </div>
                        <Progress
                          value={submissionRate}
                          className="w-full h-3 border-2 border-black bg-gray-100"
                          indicatorClassName="bg-black"
                        />
                      </div>
                    </Card.Content>
                  </Card>

                  {/* Reading Students Table */}
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-xl font-bold">Reading Status</h2>
                        {totalStudents > 0 && (
                          <span className="text-sm font-semibold text-muted-foreground">
                            {submittedCount} of {totalStudents} students opened
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Reading Status Filter Chips */}
                    <div className="flex flex-row items-center gap-2 overflow-x-auto pb-1 px-2">
                      <span className="shrink-0 text-sm font-regular text-muted-foreground">
                        Status:
                      </span>
                      {[
                        { id: "all" as const, label: "All" },
                        { id: "opened" as const, label: "Opened" },
                        { id: "not_opened" as const, label: "Not Opened" },
                      ].map((chip) => (
                        <Button
                          key={chip.id}
                          autoIcon={false}
                          variant={readingStatusFilter === chip.id ? "default" : "outline"}
                          size="sm"
                          onClick={() => setReadingStatusFilter(chip.id)}
                          className="shrink-0 border-black shadow-none h-fit!"
                        >
                          {chip.label}
                        </Button>
                      ))}
                    </div>

                    <Table wrapperClassName="border-black">
                      <Table.Header className="border-black">
                        <Table.Row>
                          <Table.Head>Student</Table.Head>
                          <Table.Head className="text-center">Status</Table.Head>
                          <Table.Head className="min-w-32 text-right">
                            Date Opened
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
                        ) : filteredReadingRows.length > 0 ? (
                          filteredReadingRows.map((student) => {
                            const opened = isStudentOpened(student);
                            return (
                              <Table.Row key={student.student_id}>
                                <Table.Cell>
                                  <div className="flex items-center gap-3">
                                    <Avatar variant="student" className="size-8 shrink-0">
                                      <Avatar.Image
                                        src={student.avatar || "/avatars/student-avatars/1.svg"}
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
                                    variant={opened ? "solid" : "outline"}
                                    size="sm"
                                    className={`w-fit rounded font-medium ${opened
                                      ? "bg-[#8BCB88] text-black border-black"
                                      : "bg-muted/30 text-muted-foreground"
                                      }`}
                                  >
                                    {opened ? "Opened" : "Not Opened"}
                                  </Badge>
                                </Table.Cell>
                                <Table.Cell className="min-w-32 text-right text-sm font-semibold text-gray-700">
                                  {opened && student.submitted_at
                                    ? new Date(student.submitted_at).toLocaleString()
                                    : "—"}
                                </Table.Cell>
                              </Table.Row>
                            );
                          })
                        ) : (
                          <Table.Row className="hover:bg-transparent">
                            <Table.Cell
                              colSpan={3}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              {isTrackingLoading
                                ? "Loading students..."
                                : readingStatusFilter !== "all"
                                  ? `No students found with status "${readingStatusFilter === "opened" ? "Opened" : "Not Opened"}".`
                                  : "No student records found."}
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table>
                  </div>
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
                  {/* Submissions & Grading Progress Card */}
                  <Card className="w-full shadow-none bg-primary">
                    <Card.Content className="space-y-3">
                      {/* Submission Rate */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center text-sm text-foreground">
                          <span>Submission Rate</span>
                          <span>
                            {isTrackingLoading && !tracking
                              ? "Loading..."
                              : totalStudents > 0
                                ? `${submissionRate}%`
                                : "0%"}
                          </span>
                        </div>
                        <Progress
                          value={submissionRate}
                          className="w-full h-3 border-2 border-black bg-gray-100"
                          indicatorClassName="bg-black"
                        />
                      </div>

                      {/* Grading Completion Progress */}
                      {needsGrading && (
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-sm text-gray-800">
                            <span>Grading Completion</span>
                            <span>
                              {isTrackingLoading && !tracking
                                ? "Loading..."
                                : submittedCount > 0
                                  ? `${gradingRate}%`
                                  : "0%"}
                            </span>
                          </div>
                          <Progress
                            value={gradingRate}
                            className="w-full h-3 border-2 border-black bg-gray-100"
                            indicatorClassName="bg-black"
                          />
                        </div>
                      )}
                    </Card.Content>
                  </Card>

                  <div className="space-y-4 mt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex flex-wrap items-center gap-3">
                        {(filterCounts.late > 0 || filterCounts.missing > 0) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setIsDeadlineSummaryOpen(true)}
                            className="h-7 gap-1 px-2.5 text-xs font-bold border-black bg-[#F6E9B2] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#F6E9B2]/80"
                          >
                            <AlertTriangle className="size-3.5" />
                            <span>Deadline Summary</span>
                          </Button>
                        )}

                        {/* Status Filter Chips */}
                        <div className="flex flex-row items-center gap-2 overflow pb-1 px-2">
                          <span className="shrink-0 text-sm font-regular text-muted-foreground">
                            Status:
                          </span>
                          {[
                            { id: "all" as const, label: "All" },
                            { id: "graded" as const, label: "Graded" },
                            { id: "on_time" as const, label: "On Time" },
                            { id: "late" as const, label: "Late" },
                            { id: "missing" as const, label: "Missing" },
                          ].map((chip) => (
                            <Button
                              key={chip.id}
                              autoIcon={false}
                              variant={statusFilter === chip.id ? "default" : "outline"}
                              size="sm"
                              onClick={() => setStatusFilter(chip.id)}
                              className="shrink-0 border-black shadow-none"
                            >
                              {chip.label}
                            </Button>
                          ))}
                        </div>
                      </div>

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

                    <Table wrapperClassName="border-black shadow-none">
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
                          <Table.Row className="hover:bg-accent">
                            <Table.Cell colSpan={3} className="p-4">
                              <Alert status="error">
                                <Alert.Description>{detailError}</Alert.Description>
                              </Alert>
                            </Table.Cell>
                          </Table.Row>
                        ) : filteredTrackingRows.length > 0 ? (
                          filteredTrackingRows.map((student) => {
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
                                        src={student.avatar || "/avatars/student-avatars/1.svg"}
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
                                    className="w-fit rounded font-medium"
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
                              {statusFilter === "all"
                                ? "No submissions found for this classwork yet."
                                : `No students match the "${statusFilter.replace("_", " ")}" filter.`}
                            </Table.Cell>
                          </Table.Row>
                        )}
                      </Table.Body>
                    </Table>
                  </div>
                </>
              )}
            </Card>
          </div>
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

      {/* Deadline Summary Modal */}
      <DeadlineSummaryModal
        isOpen={isDeadlineSummaryOpen}
        onClose={handleCloseDeadlineSummary}
        tracking={tracking}
        classworkTitle={selected?.title}
        dueDate={
          (selectedAssignmentId !== "all"
            ? selected?.assignments?.find(
              (a) => a.classwork_assignment_id === selectedAssignmentId,
            )
            : selected?.assignments?.[0]
          )?.due_date
        }
        totalPoints={selected?.total_points}
        onSelectStudent={handleSelectStudentFromSummary}
      />
    </main>
  );

  return isStandalone ? <AppLayout>{mainContent}</AppLayout> : mainContent;
}
