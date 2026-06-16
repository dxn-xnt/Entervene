import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import SubmissionForm from "@/components/SubmissionForm";
import SubmissionViewer from "@/components/SubmissionViewer";
import AttachmentDisplay from "@/components/AttachmentDisplay";
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

export default function SubjectClassworkTab({
  classId,
  subjectId,
}: SubjectClassworkTabProps) {
  const [classworks, setClassworks] = useState<ClassworkAssignment[]>([]);
  const [submissions, setSubmissions] = useState<Record<number, Submission>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchClassworks = useCallback(async () => {
    // Load assigned classworks, then merge in the student's current submission state.
    if (!classId || !subjectId) return;

    setIsLoading(true);
    setError("");

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

      // Show success message
      alert("Assignment submitted successfully!");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to submit assignment");
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
      alert("Submission deleted. You can now resubmit.");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete submission");
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString?: string): string => {
    if (!dateString) return "No due date";
    return new Date(dateString).toLocaleDateString();
  };

  const isOverdue = (dueDate?: string): boolean => {
    if (!dueDate) return false;
    return new Date() > new Date(dueDate);
  };

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

  if (classworks.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No classworks assigned yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-2xl font-semibold text-gray-900">Classworks</h3>

      {classworks.map((cw) => {
        const submission = submissions[cw.classwork_assignment_id];
        const isExpanded = expandedId === cw.classwork_assignment_id;
        const overdue = isOverdue(cw.due_date);

        return (
          <div
            key={cw.classwork_assignment_id}
            className="border border-gray-200 rounded-lg overflow-hidden bg-white"
          >
            {/* Header */}
            <button
              onClick={() =>
                setExpandedId(
                  isExpanded ? null : cw.classwork_assignment_id
                )
              }
              className="w-full px-4 py-4 flex items-start justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="font-semibold text-gray-900">{cw.title}</h4>
                  {submission && (
                    <span
                      className={`text-xs px-2 py-1 rounded font-medium ${
                        submission.status === "graded"
                          ? "bg-green-100 text-green-800"
                          : submission.status === "submitted" ||
                            submission.status === "late"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {submission.status}
                    </span>
                  )}
                  {!submission && (
                    <span className="text-xs px-2 py-1 rounded font-medium bg-orange-100 text-orange-800">
                      Not submitted
                    </span>
                  )}
                  {overdue && (
                    <span className="text-xs px-2 py-1 rounded font-medium bg-red-100 text-red-800">
                      Overdue
                    </span>
                  )}
                </div>

                <div className="text-sm text-gray-600 space-y-1">
                  {cw.classwork_type && (
                    <p>
                      <span className="font-medium">Type:</span> {cw.classwork_type}
                    </p>
                  )}
                  <p>
                    <span className="font-medium">Due:</span>{" "}
                    {formatDate(cw.due_date)}
                  </p>
                  {cw.total_points && (
                    <p>
                      <span className="font-medium">Points:</span>{" "}
                      {cw.total_points}
                    </p>
                  )}
                </div>
              </div>

              <div className="ml-4">
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
                {submission ? (
                  <div>
                    <h5 className="font-medium text-gray-900 mb-2">
                      Your Submission
                    </h5>
                    <SubmissionViewer
                      submission={submission}
                      dueDate={cw.due_date}
                      isLocked={cw.is_locked}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
