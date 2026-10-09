import { useState, useEffect } from "react";
import { Dialog, dialogHeaderCloseButtonClassName } from "@/components/retroui/Dialog";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { Progress } from "@/components/retroui/Progress";
import { BookOpen, CheckSquare, ClipboardList, ExternalLink, FileText, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { API_URL, apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/formatters";
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

function toTitleCase(str?: string | null, fallback = "Classwork") {
  if (!str) return fallback;
  return str
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
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
        size="xl"
        className="no-scrollbar overflow-x-hidden"
        overlay={{ className: "bg-black/50" }}
      >
        <Dialog.Header asChild className="border-black">
          <>
            <div>
              <Dialog.Title className="text-xl font-bold text-black">
                Classwork Preview
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
            <div className="flex flex-col gap-3 p-4">
              <div className="space-y-3">
                <Card className="p-0 border-0! w-full shadow-none">
                  <Card.Header className="flex flex-row justify-between">
                    <div className="flex flex-col w-full gap-3 md:flex-row items-center md:justify-between">
                      <Card.Title className="flex flex-row items-center gap-3 mb-0 text-3xl font-bold">

                        <IconContainer variant="primary" size="xl" className="rounded!">
                          <ClassworkTypeIcon type={selectedClasswork.classwork_type} size={48} />
                        </IconContainer>

                        <div className="flex flex-col gap-1">
                          <div className="flex flex-row items-center gap-2">
                            <span>{selectedClasswork.title}</span>
                            <Badge variant="secondary" size="sm" className="h-fit ml-1">
                              {toTitleCase(selectedClasswork.classwork_type)}
                            </Badge>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {selectedClasswork.due_date && (
                              <div>
                                <p className="font-normal text-sm">
                                  Due on {new Date(selectedClasswork.due_date).toLocaleString()}
                                </p>
                              </div>
                            )}

                            {selectedClasswork.due_date && selectedClasswork.created_at && selectedClasswork.is_published && (
                              <span className="font-normal text-sm text-muted-foreground">|</span>
                            )}

                            {selectedClasswork.created_at && selectedClasswork.is_published && (
                              <div>
                                <p className="font-normal text-sm">
                                  Created on
                                  <span className="ml-1">
                                    {selectedClasswork.publish_date || selectedClasswork.created_at
                                      ? formatDate(selectedClasswork.publish_date || selectedClasswork.created_at)
                                      : selectedClasswork.is_published
                                        ? "Published"
                                        : "No published date"}
                                  </span>
                                </p>
                              </div>
                            )}
                          </div>
                        </div>

                      </Card.Title>
                      <div className="flex flex-wrap items-center gap-2">
                        {!isReadingType(selectedClasswork.classwork_type) && selectedClasswork.classwork_category && (
                          <Badge
                            variant="outline"
                            size="md"
                            className="w-fit"
                          >
                            {toTitleCase(selectedClasswork.classwork_category)}
                          </Badge>
                        )}
                        <Badge
                          variant={selectedClasswork.is_published ? "solid" : "default"}
                        >
                          {selectedClasswork.is_published ? "Published" : "Draft"}
                        </Badge>
                      </div>

                    </div>
                  </Card.Header>

                  <Card.Content className="space-y-3">

                  </Card.Content>
                </Card>

                {(selectedClasswork.description ||
                  selectedClasswork.instructions ||
                  (selectedClasswork.attachments &&
                    selectedClasswork.attachments.length > 0)) && (
                    <div
                      className={`grid grid-cols-1 ${(selectedClasswork.description ||
                        selectedClasswork.instructions) &&
                        selectedClasswork.attachments &&
                        selectedClasswork.attachments.length > 0
                        ? "md:grid-cols-3"
                        : ""
                        } gap-3`}
                    >
                      {(selectedClasswork.description ||
                        selectedClasswork.instructions) && (
                          <div
                            className={
                              selectedClasswork.attachments &&
                                selectedClasswork.attachments.length > 0
                                ? "md:col-span-2"
                                : ""
                            }
                          >
                            <Card className="w-full h-full shadow-none">
                              <Card.Content className="space-y-3">
                                {selectedClasswork.description && (
                                  <div>
                                    <Card.Title className="mb-1 font-bold text-sm">
                                      Description
                                    </Card.Title>
                                    <p className="text-sm text-gray-800">
                                      {selectedClasswork.description}
                                    </p>
                                  </div>
                                )}
                                {selectedClasswork.instructions && (
                                  <div>
                                    <Card.Title className="mb-1 font-bold text-sm">
                                      Instructions
                                    </Card.Title>
                                    <p className="whitespace-pre-wrap text-sm text-gray-800 bg-gray-50 p-3 border border-gray-200 rounded">
                                      {selectedClasswork.instructions}
                                    </p>
                                  </div>
                                )}
                              </Card.Content>
                            </Card>
                          </div>
                        )}

                      {/* Reference Materials / Attachments */}
                      {selectedClasswork.attachments &&
                        selectedClasswork.attachments.length > 0 && (
                          <div
                            className={
                              selectedClasswork.description ||
                                selectedClasswork.instructions
                                ? "md:col-span-1"
                                : ""
                            }
                          >
                            <Card className="p-0 px-2 border-0 w-full h-full shadow-none">
                              <Card.Content className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <Card.Title className="mb-0 text-base font-bold">
                                    Reference Files
                                  </Card.Title>
                                </div>
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
                              </Card.Content>
                            </Card>
                          </div>
                        )}
                    </div>
                  )}
              </div>

              <div className="space-y-4">
                <Card className="w-full shadow-none bg-primary">
                  <Card.Content className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Card.Title className="text-lg font-bold">
                        {isReading ? "Reading Engagement Rate" : "Submissions & Grading"}
                      </Card.Title>
                      {activeTracking && totalStudents > 0 && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="bg-white"
                        >
                          <span className="font-bold! mr-1.5">{submittedCount} / {totalStudents}</span>
                          {isReading ? "Opened" : "Submitted"}
                        </Badge>
                      )}
                    </div>

                    {/* Submission Rate / Reading Engagement Progress */}
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center text-sm text-foreground">
                        <span>{isReading ? "Engagement Rate" : "Submission Rate"}</span>
                        <span>
                          {trackingLoading && !activeTracking
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
                        <div className="flex justify-between items-center text-xs font-bold text-gray-800">
                          <span>Grading Completion</span>
                          <span>
                            {trackingLoading && !activeTracking
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

                    <Button
                      autoIcon={false}
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        navigate(
                          `/teacher/classworks/${selectedClasswork.classwork_id}`,
                        )
                      }
                      className="w-full shadow-none rounded!"
                    >
                      {isReading ? "Open Reading Workspace" : "Open Submissions Workspace"}
                    </Button>
                  </Card.Content>
                </Card>
              </div>
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
            autoIcon={false}
            onClick={() => selectedClasswork && navigate(`/teacher/classworks/${selectedClasswork.classwork_id}`)}
            disabled={!selectedClasswork}
          >
            <ExternalLink />
            View Classwork
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog >
  );
}
