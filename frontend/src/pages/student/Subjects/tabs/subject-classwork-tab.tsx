import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUpDown, BookOpen, ChevronDown, ChevronUp, ClipboardList, FileText, Search } from "lucide-react";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionViewer from "@/components/SubmissionViewer";
import AttachmentDisplay from "@/components/AttachmentDisplay";
import { Alert } from "@/components/retroui/Alert";
import { API_URL, apiFetch } from "@/lib/api";

interface Attachment {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string;
}

interface Submission {
  submission_id: number;
  classwork_assignment_id: number;
  status: string;
  submitted_at?: string;
  grade?: number;
  feedback?: string;
  attempt_count: number;
  attachments: Array<{
    submission_attachment_id: number;
    file_name: string;
    file_type?: string;
    file_size: number;
    uploaded_at?: string;
  }>;
}

interface ClassworkAssignment {
  classwork_assignment_id: number;
  classwork_id: number;
  title: string;
  description?: string;
  instructions?: string;
  classwork_type?: string;
  classwork_category?: string;
  total_points?: number;
  due_date?: string;
  lock_date?: string;
  allow_late_submissions?: boolean;
  is_published: boolean;
  is_locked?: boolean;
  max_attempts?: number;
  teacher_name?: string;
  attachments: Attachment[];
  submission_status?: string;
}

type SubjectClassworkTabProps = {
  classId?: number;
  subjectId?: number;
};

type SortMode = "due" | "newest" | "title";
type Notice = {
  status: "success" | "error";
  title: string;
  description: string;
};

function isReadingType(value?: string | null) {
  return value?.toUpperCase() === "READING";
}

function classworkIcon(type?: string | null) {
  switch (type?.toUpperCase()) {
    case "READING":
      return BookOpen;
    case "QUIZ":
      return ClipboardList;
    default:
      return FileText;
  }
}

function statusBadge(status?: string | null, dueDate?: string, locked?: boolean) {
  if (locked) return { label: "Locked", cls: "bg-yellow-100 text-yellow-800 border-yellow-300" };
  if (status === "graded") return { label: "Graded", cls: "bg-green-100 text-green-800 border-green-300" };
  if (status === "submitted") return { label: "Submitted", cls: "bg-blue-100 text-blue-800 border-blue-300" };
  if (status === "late") return { label: "Late", cls: "bg-red-100 text-red-800 border-red-300" };
  if (dueDate && new Date() > new Date(dueDate)) return { label: "Missing", cls: "bg-red-100 text-red-800 border-red-300" };
  return { label: "Pending", cls: "bg-orange-100 text-orange-800 border-orange-300" };
}

function dueBadge(dueDate?: string) {
  if (!dueDate) return null;
  const diffDays = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000);
  if (diffDays < 0) return { label: `${Math.abs(diffDays)} days late`, cls: "bg-[#FF4B4B] text-white" };
  if (diffDays === 0) return { label: "Due today", cls: "bg-orange-400 text-white" };
  return { label: `Due in ${diffDays} days`, cls: "bg-[#7ABA78] text-white" };
}

function urgencyScore(cw: ClassworkAssignment, submission?: Submission) {
  if (submission?.status === "graded" || submission?.status === "submitted") return Number.MAX_SAFE_INTEGER;
  if (!cw.due_date) return Number.MAX_SAFE_INTEGER - 1;
  return new Date(cw.due_date).getTime();
}

export default function SubjectClassworkTab({
  classId,
  subjectId,
}: SubjectClassworkTabProps) {
  const [searchParams] = useSearchParams();
  const [classworks, setClassworks] = useState<ClassworkAssignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, Submission>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("due");
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchClassworks = useCallback(async () => {
    // Load assigned classworks, then merge in the student's current submission state.
    if (!classId || !subjectId) return;

    setIsLoading(true);
    setError("");
    setNotice(null);

    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/class/${classId}/subject/${subjectId}`
      );

      if (!response.ok) {
        throw new Error("Failed to fetch classworks");
      }

      const data = await response.json();
      setClassworks(data);

      const submissionsData: Record<number, Submission> = {};
      const submissionsResponse = await apiFetch("/api/v1/submissions/my-submissions");
      const allSubmissions = submissionsResponse.ok
        ? ((await submissionsResponse.json()) as Submission[])
        : [];
      for (const cw of data as ClassworkAssignment[]) {
        const sub = allSubmissions.find(
          (submission) => submission.classwork_assignment_id === cw.classwork_assignment_id
        );
        if (sub) {
          submissionsData[cw.classwork_assignment_id] = sub;
        }
      }
      setSubmissions(submissionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch classworks");
    } finally {
      setIsLoading(false);
    }
  }, [classId, subjectId]);

  useEffect(() => {
    if (classId && subjectId) {
      fetchClassworks();
    }
  }, [classId, subjectId, fetchClassworks]);

  useEffect(() => {
    const targetId = Number(searchParams.get("classworkAssignmentId"));
    if (!targetId || classworks.length === 0) return;
    if (!classworks.some((classwork) => classwork.classwork_assignment_id === targetId)) return;
    setExpandedId(targetId);
    window.setTimeout(() => {
      document.getElementById(`student-classwork-${targetId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 80);
  }, [classworks, searchParams]);

  const fetchSubmission = async (
    assignmentId: number
  ): Promise<Submission | null> => {
    // The backend exposes submissions as a student list; pick the matching assignment.
    try {
      const response = await apiFetch("/api/v1/submissions/my-submissions");
      if (!response.ok) return null;
      const data = (await response.json()) as Submission[];
      return data.find((submission) => submission.classwork_assignment_id === assignmentId) ?? null;
    } catch (err) {
      console.error("Error fetching submission:", err);
    }
    return null;
  };

  const handleSubmit = async (assignmentId: number, files: File[]) => {
    setSubmittingId(assignmentId);
    try {
      const formData = new FormData();
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await apiFetch(`/api/v1/submissions/assignment/${assignmentId}/submit`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to submit assignment");
      }

      const submission = await response.json();
      setSubmissions({
        ...submissions,
        [assignmentId]: submission,
      });

      setNotice({
        status: "success",
        title: "Assignment submitted",
        description: "Your work was submitted successfully.",
      });
    } catch (err) {
      setNotice({
        status: "error",
        title: "Submission failed",
        description: err instanceof Error ? err.message : "Failed to submit assignment",
      });
    } finally {
      setSubmittingId(null);
    }
  };

  const handleDeleteSubmission = async (
    assignmentId: number
  ) => {
    // Backend clears files but keeps attempt history, so max attempts stay enforced.
    setDeletingId(assignmentId);
    try {
      const response = await apiFetch(`/api/v1/submissions/assignment/${assignmentId}/submit`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete submission");
      }

      const newSubmissions = { ...submissions };
      delete newSubmissions[assignmentId];
      setSubmissions(newSubmissions);
      setNotice({
        status: "success",
        title: "Submission deleted",
        description: "You can now resubmit your work.",
      });
    } catch (err) {
      setNotice({
        status: "error",
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Failed to delete submission",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return "No due date";
    return new Date(dateString).toLocaleDateString();
  };

  const formatDateTime = (dateString?: string): string => {
    if (!dateString) return "the unlock time";
    return new Date(dateString).toLocaleString();
  };

  const visibleClassworks = useMemo(() => {
    const term = search.trim().toLowerCase();
    return classworks
      .filter((cw) => {
        if (!term) return true;
        return [cw.title, cw.description, cw.instructions, cw.classwork_type, cw.teacher_name]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(term));
      })
      .sort((a, b) => {
        if (sortMode === "title") return a.title.localeCompare(b.title);
        if (sortMode === "newest") return b.classwork_assignment_id - a.classwork_assignment_id;
        const urgent = urgencyScore(a, submissions[a.classwork_assignment_id]) -
          urgencyScore(b, submissions[b.classwork_assignment_id]);
        return urgent || a.title.localeCompare(b.title);
      });
  }, [classworks, search, sortMode, submissions]);

  if (isLoading) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">Loading classworks...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500 mb-4">{error}</p>
        <button
          onClick={fetchClassworks}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-black bg-[#F6E9B2] px-5 py-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <h3 className="text-2xl font-bold text-gray-900">Classworks</h3>
        <p className="mt-1 text-sm font-medium text-gray-700">
          Find assignments, readings, activities, and quizzes for this subject.
        </p>
      </div>

      {notice ? (
        <Alert status={notice.status}>
          <Alert.Title>{notice.title}</Alert.Title>
          <Alert.Description>{notice.description}</Alert.Description>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 rounded-lg border border-black bg-white p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:flex-row sm:items-center">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-[#FFFBEE] px-3 py-2">
          <Search size={16} className="shrink-0 text-gray-500" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search classwork"
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <label className="flex items-center gap-2 rounded-lg border border-gray-300 bg-[#FFFBEE] px-3 py-2 text-sm font-semibold">
          <ArrowUpDown size={15} />
          <span>Sort</span>
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as SortMode)}
            className="bg-transparent text-sm font-semibold outline-none"
          >
            <option value="due">Nearest due</option>
            <option value="newest">Newest</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>

      {visibleClassworks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white px-5 py-10 text-center text-gray-500">
          {classworks.length === 0 ? "No classworks assigned yet." : "No classworks match your search."}
        </div>
      ) : visibleClassworks.map((cw) => {
        const submission = submissions[cw.classwork_assignment_id];
        const isExpanded = expandedId === cw.classwork_assignment_id;
        const badge = statusBadge(submission?.status ?? cw.submission_status, cw.due_date, cw.is_locked);
        const deadline = dueBadge(cw.due_date);
        const Icon = classworkIcon(cw.classwork_type);

        return (
          <div
            key={cw.classwork_assignment_id}
            id={`student-classwork-${cw.classwork_assignment_id}`}
            className="overflow-hidden rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
          >
            <button
              onClick={() =>
                setExpandedId(
                  isExpanded ? null : cw.classwork_assignment_id
                )
              }
              className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[#FFFBEE]"
            >
              <div className="flex min-w-0 flex-1 gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-black bg-[#F6E9B2]">
                  <Icon size={20} />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-lg font-bold text-gray-900">{cw.title}</h4>
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${badge.cls}`}>
                      {badge.label}
                    </span>
                    {deadline && (
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${deadline.cls}`}>
                        {deadline.label}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-medium text-gray-600">
                    {[cw.classwork_type, formatDate(cw.due_date), cw.total_points ? `${cw.total_points} pts` : null]
                      .filter(Boolean)
                      .join(" | ")}
                  </p>
                  {cw.description ? (
                    <p className="mt-1 line-clamp-1 text-xs text-gray-500">{cw.description}</p>
                  ) : null}
                </div>
              </div>

              <div className="pt-1">
                {isExpanded ? (
                  <ChevronUp className="text-gray-500" />
                ) : (
                  <ChevronDown className="text-gray-500" />
                )}
              </div>
            </button>

            {/* Details */}
            {isExpanded && (
              <div className="border-t border-gray-200 px-4 py-4 bg-gray-50 space-y-4">
                {cw.is_locked ? (
                  <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
                    This classwork is published but locked until {formatDateTime(cw.lock_date)}.
                    You can view the title now, but files and submissions open after it unlocks.
                  </div>
                ) : (
                  <>
                {/* Description & Instructions */}
                {(cw.description || cw.instructions) && (
                  <div className="space-y-3">
                    {cw.description && (
                      <div>
                        <h5 className="font-medium text-gray-900 mb-1">
                          Description
                        </h5>
                        <p className="text-sm text-gray-700">{cw.description}</p>
                      </div>
                    )}
                    {cw.instructions && (
                      <div>
                        <h5 className="font-medium text-gray-900 mb-1">
                          Instructions
                        </h5>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap">
                          {cw.instructions}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Attachments */}
                {cw.attachments && cw.attachments.length > 0 && (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-2">
                      Attachments
                    </h5>
                    <AttachmentDisplay
                      attachments={cw.attachments}
                      type="classwork"
                      downloadUrl={(attachmentId) =>
                        `${API_URL}/api/v1/classwork-assignments/classwork/${cw.classwork_id}/attachments/${attachmentId}/download`
                      }
                    />
                  </div>
                )}

                {/* Submission Status or Form */}
                {isReadingType(cw.classwork_type) ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
                    Reading material only. Review the content and attached files; no submission is required.
                  </div>
                ) : submission ? (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-2">
                      Your Submission
                    </h5>
                    <SubmissionViewer
                      submission={submission}
                      dueDate={cw.due_date}
                      isLocked={cw.is_locked}
                      allowLateSubmissions={cw.allow_late_submissions}
                      maxAttempts={cw.max_attempts}
                      onDeleteSubmission={() =>
                        handleDeleteSubmission(
                          cw.classwork_assignment_id
                        )
                      }
                      onResubmit={() => fetchSubmission(cw.classwork_assignment_id)}
                      isDeleting={deletingId === cw.classwork_assignment_id}
                    />
                  </div>
                ) : (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-2">
                      Submit Your Work
                    </h5>
                    <SubmissionForm
                      assignmentId={cw.classwork_assignment_id}
                      maxAttempts={cw.max_attempts}
                      currentAttempt={0}
                      onSubmit={(files) =>
                        handleSubmit(cw.classwork_assignment_id, files)
                      }
                      isLoading={submittingId === cw.classwork_assignment_id}
                    />
                  </div>
                )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
