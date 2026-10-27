import { useState, useEffect } from "react";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Button } from "@/components/teacher/button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Progress } from "@/components/retroui/Progress";
import {
  BookOpen,
  CheckSquare,
  ClipboardList,
  ExternalLink,
  FileText,
  Paperclip,
  Users,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDate, formatToTitleCase } from "@/lib/formatters";
import { isReadingType } from "@/lib/classwork-utils";
import type { ClassworkDetail, SubmissionTracking } from "../subject-details/types";
import IconContainer from "@/components/icon-container";

interface ClassworkDetailModalProps {
  selectedClasswork: ClassworkDetail | null;
  detailLoadingId: number | null;
  detailError: string;
  onClose: () => void;
  sectionName?: string | null;
  tracking?: SubmissionTracking | null;
}

function ClassworkTypeIcon({
  type,
  size = 18,
}: {
  type?: string | null;
  size?: number;
}) {
  switch (type?.toUpperCase()) {
    case "QUIZ":
      return <ClipboardList size={size} />;
    case "ASSIGNMENT":
      return <BookOpen size={size} />;
    case "ACTIVITY":
      return <CheckSquare size={size} />;
    case "READING":
      return <FileText size={size} />;
    default:
      return <FileText size={size} />;
  }
}

export default function ClassworkDetailModal({
  selectedClasswork,
  detailLoadingId,
  detailError,
  onClose,
  sectionName: _sectionName,
  tracking: propTracking,
}: ClassworkDetailModalProps) {
  const navigate = useNavigate();
  const [internalTracking, setInternalTracking] = useState<SubmissionTracking | null>(null);
  const [trackingLoading, setTrackingLoading] = useState(false);

  useEffect(() => {
    if (propTracking !== undefined) {
      return;
    }
    if (!selectedClasswork) {
      setInternalTracking(null);
      return;
    }

    let isMounted = true;
    setTrackingLoading(true);

    const fetchTracking = async () => {
      try {
        const url = selectedClasswork.classwork_assignment_id
          ? `/api/v1/submissions/assignment/${selectedClasswork.classwork_assignment_id}/tracking`
          : `/api/v1/submissions/classwork/${selectedClasswork.classwork_id}/tracking`;
        const res = await apiFetch(url);
        if (res.ok && isMounted) {
          const data = (await res.json()) as SubmissionTracking;
          setInternalTracking(data);
        }
      } catch (err) {
        console.error("Failed to load tracking data", err);
      } finally {
        if (isMounted) setTrackingLoading(false);
      }
    };

    fetchTracking();

    return () => {
      isMounted = false;
    };
  }, [selectedClasswork?.classwork_assignment_id, selectedClasswork?.classwork_id, propTracking]);

  const activeTracking = propTracking ?? internalTracking;
  const totalStudents = activeTracking?.total_students ?? 0;
  const submittedCount = activeTracking?.submitted_count ?? 0;
  const missingCount = activeTracking?.missing_count ?? Math.max(0, totalStudents - submittedCount);
  const submissionRate = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;

  const isReading = selectedClasswork?.classwork_type?.toUpperCase() === "READING";

  const needsGrading = Boolean(
    selectedClasswork &&
    selectedClasswork.is_graded !== false &&
    !isReading,
  );

  const gradedCount =
    activeTracking?.submitted?.filter(
      (student) =>
        (student.grade !== null && student.grade !== undefined) ||
        student.status === "graded",
    ).length ?? 0;

  const gradingRate =
    submittedCount > 0 ? Math.round((gradedCount / submittedCount) * 100) : 0;

  const isOpen = Boolean(selectedClasswork || detailLoadingId || detailError);
  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content
        size="2xl"
        className="no-scrollbar h-fit max-h-[90vh] overflow-x-hidden"
        overlay={{ className: "bg-black/50" }}
      >
        <Dialog.Header asChild className="border-black">
          <>
            <div>
              <Dialog.Title className="text-xl font-bold text-black">
                Classwork Details
              </Dialog.Title>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger render={
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close modal"
                    className={dialogHeaderCloseButtonClassName}
                  >
                    <X className="size-4" />
                  </button>
                } />
                <TooltipContent>Close modal</TooltipContent>
              </Tooltip>
            </div>
          </>
        </Dialog.Header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {detailLoadingId ? (
            <div className="p-8 text-center text-sm font-semibold text-gray-600">
              Loading classwork details...
            </div>
          ) : detailError ? (
            <div className="m-5 border-2 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-700 font-medium">
              {detailError}
            </div>
          ) : selectedClasswork ? (
            <div className="space-y-4 p-5">
              <Card className="block w-full">
                <Card.Content className="space-y-4">
                  <div className="flex flex-row justify-between items-start gap-3 min-w-0 w-full">
                    <div className="flex flex-row gap-2.5 items-center min-w-0 flex-1">
                      <IconContainer variant="primary" size="xl" className="rounded! shrink-0">
                        <ClassworkTypeIcon type={selectedClasswork.classwork_type} size={20} />
                      </IconContainer>

                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <Card.Title
                            className="text-2xl sm:text-3xl font-bold truncate min-w-0"
                            title={selectedClasswork.title}
                          >
                            {formatToTitleCase(selectedClasswork.title)}
                          </Card.Title>

                          <Badge variant="secondary" size="sm" className="h-fit shrink-0">
                            {formatToTitleCase(selectedClasswork.classwork_type, "Classwork")}
                          </Badge>
                        </div>

                        <p className="text-sm font-normal text-muted-foreground truncate">
                          {selectedClasswork.due_date
                            ? `Due ${formatDate(selectedClasswork.due_date)}`
                            : selectedClasswork.created_at
                              ? `Created ${formatDate(selectedClasswork.created_at)}`
                              : "No due date"}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {!isReadingType(selectedClasswork.classwork_type) && selectedClasswork.classwork_category && (
                        <Badge variant="outline">
                          {formatToTitleCase(selectedClasswork.classwork_category)}
                        </Badge>
                      )}
                      <Badge variant={selectedClasswork.is_published ? "solid" : "default"}>
                        {selectedClasswork.is_published ? "Published" : "Draft"}
                      </Badge>
                      {selectedClasswork.is_locked && (
                        <Badge variant="destructive">
                          Locked
                        </Badge>
                      )}
                    </div>
                  </div>
                </Card.Content>
              </Card>

              {/* Description and Instructions */}
              {(selectedClasswork.description || selectedClasswork.instructions) && (
                <Card className="block">
                  <Card.Content className="space-y-3">
                    {selectedClasswork.description && (
                      <div className={selectedClasswork.instructions ? "mb-3" : ""}>
                        <Card.Title className="mb-1 font-bold text-base">
                          Description
                        </Card.Title>
                        <p className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-3 border border-gray-200 rounded">
                          {selectedClasswork.description}
                        </p>
                      </div>
                    )}
                    {selectedClasswork.instructions && (
                      <div>
                        <Card.Title className="mb-1 font-bold text-base">
                          Instructions
                        </Card.Title>
                        <p className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-3 border border-gray-200 rounded">
                          {selectedClasswork.instructions}
                        </p>
                      </div>
                    )}
                  </Card.Content>
                </Card>
              )}

              {/* Reference Files */}
              <Card className="block">
                <Card.Content className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Paperclip size={18} />
                    <Card.Title className="mb-0 text-base font-bold">
                      Reference Files
                    </Card.Title>
                    <Badge variant="secondary" size="sm" className="ml-auto">
                      {selectedClasswork.attachments?.length || 0}
                    </Badge>
                  </div>

                  {selectedClasswork.attachments && selectedClasswork.attachments.length > 0 ? (
                    <div className="space-y-2">
                      {selectedClasswork.attachments.map((file) => (
                        <div
                          key={file.classwork_attachment_id}
                          className="flex items-center justify-between border-2 border-black p-2.5 bg-gray-50 rounded gap-2"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText size={16} className="shrink-0" />
                            <span
                              className="text-xs font-semibold truncate"
                              title={file.file_name}
                            >
                              {file.file_name}
                            </span>
                          </div>
                          <a
                            href={`${API_URL}/api/v1/classworks/attachments/${file.classwork_attachment_id}/download`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs font-bold text-blue-700 underline shrink-0 hover:text-blue-900"
                          >
                            Download
                          </a>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-600">
                      No classwork files attached.
                    </p>
                  )}
                </Card.Content>
              </Card>

              {/* Tracking Overview Card */}
              <Card className="block bg-primary">
                <Card.Content className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Users size={18} />
                      <Card.Title className="mb-0 text-base font-bold">
                        Submission Tracking
                      </Card.Title>
                    </div>
                    {totalStudents > 0 && (
                      <Badge variant="outline" size="sm" className="bg-white text-black">
                        <span className="font-bold mr-1.5">{submittedCount} / {totalStudents}</span>
                        {isReading ? "Opened" : "Submitted"}
                      </Badge>
                    )}
                  </div>

                  {/* Metric Boxes */}
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="border-2 border-black bg-white p-2 rounded!">
                      <p className="text-2xl font-bold">{totalStudents}</p>
                      <p className="text-[11px] font-semibold">Students</p>
                    </div>
                    <div className="border-2 border-black bg-white p-2 rounded!">
                      <p className="text-2xl font-bold">{submittedCount}</p>
                      <p className="text-[11px] font-semibold">Submitted</p>
                    </div>
                    <div className="border-2 border-black bg-white p-2 rounded!">
                      <p className="text-2xl font-bold">{missingCount}</p>
                      <p className="text-[11px] font-semibold">Pending</p>
                    </div>
                  </div>

                  {/* Progress bars */}
                  <div className="space-y-2 pt-1">
                    <div className="space-y-1">
                      <div className="flex justify-between items-center text-sm font-semibold text-foreground">
                        <span>{isReading ? "Engagement Rate" : "Submission Rate"}</span>
                        <span>{trackingLoading && !activeTracking ? "Loading..." : `${submissionRate}%`}</span>
                      </div>
                      <Progress value={submissionRate} className="w-full h-2.5 bg-white" />
                    </div>

                    {needsGrading && (
                      <div className="space-y-1">
                        <div className="flex justify-between items-center text-sm font-semibold text-foreground">
                          <span>Grading Completion</span>
                          <span>{trackingLoading && !activeTracking ? "Loading..." : `${gradingRate}%`}</span>
                        </div>
                        <Progress value={gradingRate} className="w-full h-2.5 bg-white" />
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      navigate(
                        `/teacher/classworks/${selectedClasswork.classwork_id}`
                      )
                    }
                    className="w-full mt-2"
                  >
                    {isReading ? "Open Reading Workspace" : "Open Submissions Workspace"}
                  </Button>
                </Card.Content>
              </Card>

              {/* Needs Follow-up Card */}
              <Card className="block">
                <Card.Content>
                  <Card.Title className="mb-3 text-base font-bold">
                    Needs Follow-up
                  </Card.Title>
                  <div className="space-y-2">
                    {(activeTracking?.missing ?? []).slice(0, 6).map((student) => (
                      <div
                        key={student.student_id}
                        className="border-2 border-black px-3 py-2 text-sm"
                      >
                        <p className="font-semibold">{student.student_name}</p>
                        <p className="text-xs text-gray-600">
                          {student.status.replace(/_/g, " ")}
                        </p>
                      </div>
                    ))}
                    {(activeTracking?.missing ?? []).length === 0 && (
                      <p className="text-sm text-gray-600">Everyone is accounted for.</p>
                    )}
                  </div>
                </Card.Content>
              </Card>
            </div>
          ) : null}
        </div>

        <Dialog.Footer className="mt-0">
          <Button
            size="sm"
            variant="outline"
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            size="sm"
            onClick={() => selectedClasswork && navigate(`/teacher/classworks/${selectedClasswork.classwork_id}`)}
            disabled={!selectedClasswork}
          >
            <ExternalLink size={14} />
            View Classwork
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
