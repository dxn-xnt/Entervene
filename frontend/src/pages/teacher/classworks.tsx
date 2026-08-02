import {
  ArrowDownAZ,
  ArrowUpDown,
  Archive,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Filter,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import AttachmentDisplay from "@/components/attachment-display";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { API_URL, apiFetch } from "@/lib/api";
import ClassworkCard from "./classworks/ClassworkCard";
import { Badge } from "@/components/retroui/Badge";
import type { QuizAnalysis } from "./classworks/quiz-builder-types";
import QuizGradingModal from "@/components/quiz-grading-modal";
import {
  allowedClassworkMaterialExtensions,
  classworkToEditDraft,
  fileExtension,
  formatFileSize,
  isQuizType,
  isReadingType,
  maxClassworkMaterialSize,
  scoreBand,
  submissionStatusLabel,
} from "@/lib/classwork-utils";
import type {
  AssignmentTracking,
  ClassworkAttachment,
  ClassworkKind,
  EditDraft,
  SortMode,
  TabId,
  TeacherClassLoad,
  TeacherClasswork,
  TeacherSubmissionDetail,
  TrackingStudent,
} from "@/types/classwork";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Select } from "@/components/retroui/Select";
import { Card } from "@/components/retroui/Card";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";
import CreateClassworkModal from "./forms/create-classwork";
import CreateClassworkQuizModal from "./forms/create-classwork-quiz";
import QuizAnalysisView from "./classworks/QuizAnalysisView";

const tabs: Array<TabItem<TabId>> = [
  { id: "all", label: "All", icon: ClipboardList },
  { id: "readings", label: "Readings", icon: BookOpen },
  { id: "activities", label: "Activities", icon: CheckSquare },
  { id: "assignments", label: "Assignments", icon: FileText },
  { id: "quizzes", label: "Quizzes", icon: ClipboardList },
];

const createOptions: Array<{
  type: ClassworkKind;
  title: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    type: "READING",
    title: "Reading",
    description: "Create and publish class topics or resources for learners",
    icon: BookOpen,
  },
  {
    type: "QUIZ",
    title: "Quiz",
    description: "Build and assign quizzes to assess learner understanding",
    icon: ClipboardList,
  },
  {
    type: "ASSIGNMENT",
    title: "Assignment",
    description: "Post tasks or projects for students to complete and submit",
    icon: FileText,
  },
  {
    type: "ACTIVITY",
    title: "Activity",
    description: "Design interactive tasks to enhance learner engagement",
    icon: CheckSquare,
  },
];

const tabType: Partial<Record<TabId, string>> = {
  readings: "READING",
  activities: "ACTIVITY",
  assignments: "ASSIGNMENT",
  quizzes: "QUIZ",
};

export default function Classworks() {
  const [searchParams, setSearchParams] = useSearchParams();
  const suppressAutoOpenRef = useRef(false);
  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
  const [tracking, setTracking] = useState<AssignmentTracking | null>(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
  const [quizAnalysis, setQuizAnalysis] = useState<QuizAnalysis | null>(null);
  const [isQuizAnalysisLoading, setIsQuizAnalysisLoading] = useState(false);
  const [quizAnalysisError, setQuizAnalysisError] = useState("");
  const [selectedGradingSubmissionId, setSelectedGradingSubmissionId] = useState<number | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editMaterials, setEditMaterials] = useState<File[]>([]);
  const [removingAttachmentId, setRemovingAttachmentId] = useState<
    number | null
  >(null);
  const [isUploadingEditMaterials, setIsUploadingEditMaterials] =
    useState(false);
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadClassworks = useCallback(async () => {
    // Load real teacher-owned classworks plus active class targets for filters and creation.
    setIsLoading(true);
    setError("");
    try {
      const [classworksResponse, loadsResponse] = await Promise.all([
        apiFetch("/api/v1/classwork-assignments/my-classworks"),
        apiFetch("/api/v1/classwork-assignments/teacher/classes"),
      ]);
      if (!classworksResponse.ok || !loadsResponse.ok) {
        throw new Error("Unable to load your classworks.");
      }
      const loadData = (await loadsResponse.json()) as TeacherClassLoad[];
      setItems((await classworksResponse.json()) as TeacherClasswork[]);
      setLoads(loadData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load your classworks.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClassworks();
  }, [loadClassworks]);

  const subjects = useMemo(
    () =>
      Array.from(
        new Map(
          loads.map((load) => [
            load.subject_id,
            { id: load.subject_id, name: load.subject_name },
          ]),
        ).values(),
      ).sort((a, b) => a.name.localeCompare(b.name)),
    [loads],
  );

  const filteredItems = useMemo(() => {
    const targetType = tabType[activeTab];
    const normalizedSearch = search.trim().toLowerCase();
    const result = items.filter((item) => {
      const matchesType =
        !targetType || item.classwork_type.toUpperCase() === targetType;
      const matchesSearch =
        !normalizedSearch ||
        item.title.toLowerCase().includes(normalizedSearch) ||
        item.subject_name?.toLowerCase().includes(normalizedSearch);
      const matchesSubject =
        subjectFilter === "all" || item.subject_id === Number(subjectFilter);
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "published" ? item.is_published : !item.is_published);
      return matchesType && matchesSearch && matchesSubject && matchesStatus;
    });

    return result.sort((a, b) => {
      if (sortMode === "title") return a.title.localeCompare(b.title);
      const first = new Date(a.created_at ?? 0).getTime();
      const second = new Date(b.created_at ?? 0).getTime();
      return sortMode === "oldest" ? first - second : second - first;
    });
  }, [activeTab, items, search, sortMode, statusFilter, subjectFilter]);

  const openCreateWizard = () => {
    const preferredType = tabType[activeTab] as ClassworkKind | undefined;
    setSelectedType(preferredType ?? null);
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    setShowCreateWizard(false);
    setSelectedType(null);
  };

  const addEditMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find(
      (file) =>
        !allowedClassworkMaterialExtensions.includes(fileExtension(file.name)),
    );
    if (invalid) {
      setDetailError(
        `${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`,
      );
      return;
    }
    const oversized = selectedFiles.find(
      (file) => file.size > maxClassworkMaterialSize,
    );
    if (oversized) {
      setDetailError(`${oversized.name} is larger than the 4 MB limit.`);
      return;
    }
    setDetailError("");
    setEditMaterials((current) => {
      const existing = new Set(
        current.map((file) => `${file.name}-${file.size}`),
      );
      return [
        ...current,
        ...selectedFiles.filter(
          (file) => !existing.has(`${file.name}-${file.size}`),
        ),
      ];
    });
  };

  const removeEditMaterial = (index: number) => {
    setEditMaterials((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const openClassworkDetail = useCallback(
    async (item: TeacherClasswork) => {
      suppressAutoOpenRef.current = false;
      setSelected(item);
      setTracking(null);
      setQuizAnalysis(null);
      setQuizAnalysisError("");
      setDetailError("");
      setIsEditing(false);
      setEditDraft(classworkToEditDraft(item));
      setEditMaterials([]);
      setSearchParams({ classworkId: String(item.classwork_id) });

      const assignmentId = item.assignments?.[0]?.classwork_assignment_id;
      if (!assignmentId) return;

      setIsTrackingLoading(true);
      if (isQuizType(item.classwork_type)) {
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
        if (isQuizType(item.classwork_type)) {
          const analysisResponse = await apiFetch(
            `/api/v1/quizzes/classwork/${item.classwork_id}/analysis`,
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
        if (isQuizType(item.classwork_type)) {
          setQuizAnalysisError(message);
        } else {
          setDetailError(message);
        }
      } finally {
        setIsTrackingLoading(false);
        setIsQuizAnalysisLoading(false);
      }
    },
    [setSearchParams],
  );

  useEffect(() => {
    const classworkId = Number(searchParams.get("classworkId"));
    if (!classworkId) {
      suppressAutoOpenRef.current = false;
      return;
    }
    if (suppressAutoOpenRef.current || selected?.classwork_id === classworkId)
      return;
    const target = items.find((item) => item.classwork_id === classworkId);
    if (target) {
      void openClassworkDetail(target);
    }
  }, [items, openClassworkDetail, searchParams, selected?.classwork_id]);

  const closeClassworkDetail = () => {
    if (isArchiving || isSavingEdit) return;
    // Prevent the URL sync effect from reopening the detail during close.
    suppressAutoOpenRef.current = true;
    setSelected(null);
    setTracking(null);
    setQuizAnalysis(null);
    setQuizAnalysisError("");
    setIsQuizAnalysisLoading(false);
    setShowArchiveConfirm(false);
    setIsEditing(false);
    setEditDraft(null);
    setEditMaterials([]);
    setSearchParams({}, { replace: true });
    setDetailError("");
    setSelectedStudent(null);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
  };

  const saveClassworkEdit = async () => {
    if (!selected || !editDraft) return;

    const isReading = isReadingType(editDraft.classwork_type);
    const totalPoints =
      !isReading && editDraft.total_points
        ? Number(editDraft.total_points)
        : null;
    if (!editDraft.title.trim()) {
      setDetailError("Classwork title is required.");
      return;
    }
    if (
      totalPoints !== null &&
      (!Number.isFinite(totalPoints) || totalPoints <= 0)
    ) {
      setDetailError("Total points must be greater than zero.");
      return;
    }
    const attempts = Number(editDraft.max_attempts);
    if (
      isQuizType(editDraft.classwork_type) &&
      (!Number.isInteger(attempts) || attempts <= 0)
    ) {
      setDetailError("Allowed attempts must be a positive whole number.");
      return;
    }

    setIsSavingEdit(true);
    setDetailError("");
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${selected.classwork_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: editDraft.title.trim(),
            description: editDraft.description.trim() || null,
            instructions: editDraft.instructions.trim() || null,
            classwork_type: editDraft.classwork_type,
            classwork_category: editDraft.classwork_category || null,
            total_points: totalPoints,
            is_published: editDraft.is_published,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to update classwork.");
      }

      let updated = (await response.json()) as TeacherClasswork;
      const assignedClassIds =
        selected.assignments?.map((assignment) => assignment.class_id) ?? [];
      if (assignedClassIds.length > 0) {
        const assignResponse = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/assign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              class_ids: assignedClassIds,
              due_date: editDraft.due_date
                ? new Date(editDraft.due_date).toISOString()
                : null,
              lock_date: editDraft.lock_date
                ? new Date(editDraft.lock_date).toISOString()
                : null,
              allow_late_submissions: editDraft.allow_late_submissions,
              max_attempts: isQuizType(editDraft.classwork_type)
                ? attempts
                : null,
              is_published: editDraft.is_published,
            }),
          },
        );
        if (!assignResponse.ok) {
          const body = await assignResponse.json().catch(() => ({}));
          throw new Error(
            body.detail || "Unable to update assignment settings.",
          );
        }
        const refreshed = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${selected.classwork_id}`,
        );
        if (refreshed.ok) {
          updated = (await refreshed.json()) as TeacherClasswork;
        }
      }
      setItems((current) =>
        current.map((item) =>
          item.classwork_id === updated.classwork_id ? updated : item,
        ),
      );
      setSelected(updated);
      setEditDraft(classworkToEditDraft(updated));
      setIsEditing(false);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Unable to update classwork.",
      );
    } finally {
      setIsSavingEdit(false);
    }
  };

  const uploadEditMaterials = async () => {
    if (!selected || editMaterials.length === 0) return;

    setIsUploadingEditMaterials(true);
    setDetailError("");
    try {
      const uploaded: ClassworkAttachment[] = [];
      for (const material of editMaterials) {
        const formData = new FormData();
        formData.append("file", material);
        const response = await apiFetch(
          `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/attachments`,
          { method: "POST", body: formData },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || `Unable to upload ${material.name}.`);
        }
        uploaded.push((await response.json()) as ClassworkAttachment);
      }

      const updated = {
        ...selected,
        attachments: [...selected.attachments, ...uploaded],
      };
      setSelected(updated);
      setItems((current) =>
        current.map((item) =>
          item.classwork_id === updated.classwork_id ? updated : item,
        ),
      );
      setEditMaterials([]);
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Unable to upload classwork material.",
      );
    } finally {
      setIsUploadingEditMaterials(false);
    }
  };

  const removeSelectedAttachment = async (attachmentId: number) => {
    if (!selected) return;

    setRemovingAttachmentId(attachmentId);
    setDetailError("");
    try {
      const response = await apiFetch(
        `/api/v1/classwork-assignments/classwork/${selected.classwork_id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to remove classwork material.");
      }

      const updated = {
        ...selected,
        attachments: selected.attachments.filter(
          (attachment) => attachment.classwork_attachment_id !== attachmentId,
        ),
      };
      setSelected(updated);
      setItems((current) =>
        current.map((item) =>
          item.classwork_id === updated.classwork_id ? updated : item,
        ),
      );
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Unable to remove classwork material.",
      );
    } finally {
      setRemovingAttachmentId(null);
    }
  };

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

      setItems((current) =>
        current.filter((item) => item.classwork_id !== selected.classwork_id),
      );
      setShowArchiveConfirm(false);
      setSelected(null);
      setTracking(null);
      setSelectedStudent(null);
      setSelectedSubmissionDetail(null);
      setSearchParams({});
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "Unable to archive classwork.",
      );
    } finally {
      setIsArchiving(false);
    }
  };

  const openStudentSubmission = async (student: TrackingStudent) => {
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
    // Grade endpoint doubles as update, so teachers can correct scores/feedback.
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

  const cycleSort = () => {
    setSortMode((current) =>
      current === "newest"
        ? "oldest"
        : current === "oldest"
          ? "title"
          : "newest",
    );
  };

  const selectedAssignment = selected?.assignments?.[0] ?? null;
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
    <AppLayout>
      {selected ? (
        <main className="flex flex-1 flex-col overflow-x-hidden">
          <div className="@container/main flex flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
              <Breadcrumb>
                <Breadcrumb.List>
                  <Breadcrumb.Item>
                    <Breadcrumb.Link asChild>
                      <button
                        type="button"
                        onClick={
                          selectedStudent
                            ? closeStudentSubmission
                            : closeClassworkDetail
                        }
                      >
                        {selectedAssignment?.title ||
                          selected.subject_name ||
                          "Classwork"}
                      </button>
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>

                  <Breadcrumb.Separator />

                  <Breadcrumb.Item>
                    <Breadcrumb.Ellipsis />
                  </Breadcrumb.Item>

                  <Breadcrumb.Separator />

                  <Breadcrumb.Item>
                    <Breadcrumb.Page>
                      {selectedStudent?.student_name || selected.title}
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>

              <div className="-mx-4 md:-mx-6 border-b-2 border-border" />

              <section className="mx-auto w-full max-w-5xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <FileText className="size-7" />
                    <h1 className="text-2xl font-bold md:text-4xl">
                      {selected.title}
                    </h1>
                  </div>

                  {!selectedStudent && (
                    <div className="flex flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setIsEditing(false);
                              setEditDraft(classworkToEditDraft(selected));
                              setDetailError("");
                            }}
                            disabled={isSavingEdit}
                            className="border-black bg-white font-bold"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={saveClassworkEdit}
                            disabled={isSavingEdit}
                            className="border-black bg-[#7ABA78] hover:bg-[#7ABA78] font-bold"
                          >
                            {isSavingEdit ? "Saving..." : "Save Changes"}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="md"
                          onClick={() => {
                            setEditDraft(classworkToEditDraft(selected));
                            setIsEditing(true);
                            setDetailError("");
                          }}
                          disabled={isArchiving}
                          className="gap-2"
                        >
                          <Pencil size={16} />
                          Edit Classwork
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="md"
                        onClick={() => setShowArchiveConfirm(true)}
                        disabled={isArchiving || isEditing}
                        className="gap-2 bg-primary"
                      >
                        <Archive size={16} />
                        {isArchiving ? "Archiving..." : "Archive Classwork"}
                      </Button>
                    </div>
                  )}
                </div>

                {selectedStudent ? (
                  // Student-level review view shown after clicking a name.
                  <>
                    <div className="overflow-hidden rounded-lg border border-black bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                      <div className="flex items-center justify-between gap-3 border-b border-black bg-[#F6E9B2] px-4 py-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h2 className="text-2xl font-bold">
                            {selectedStudent.student_name} Submission
                          </h2>
                          <span className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium">
                            {submissionStatusLabel(selectedStudent.status)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={closeStudentSubmission}
                          className="rounded border border-black px-2 py-1 text-xs font-bold"
                        >
                          Back
                        </button>
                      </div>
                      <div className="min-h-48 p-5">
                        {isSubmissionLoading ? (
                          <p className="text-center text-sm font-semibold text-gray-500">
                            Loading submission...
                          </p>
                        ) : submissionDetailError ? (
                          <p className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                            {submissionDetailError}
                          </p>
                        ) : selectedSubmissionDetail ? (
                          selectedSubmissionDetail.attachments.length > 0 ? (
                            <AttachmentDisplay
                              attachments={selectedSubmissionDetail.attachments.map(
                                (attachment) => ({
                                  ...attachment,
                                  file_type: attachment.file_type ?? undefined,
                                }),
                              )}
                              type="submission"
                              downloadUrl={(attachmentId) =>
                                `${API_URL}/api/v1/submissions/${selectedSubmissionDetail.submission_id}/attachments/${attachmentId}/download`
                              }
                            />
                          ) : (
                            <p className="text-sm font-medium text-gray-500">
                              No submitted files attached.
                            </p>
                          )
                        ) : (
                          <p className="text-sm font-medium text-gray-500">
                            This student has not submitted work yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-xl font-bold">Score & Feedback</h2>
                        <div className="flex items-center gap-1 rounded border border-black px-2 py-1">
                          <input
                            type="number"
                            min="0"
                            max={selected.total_points ?? undefined}
                            value={gradeDraft}
                            onChange={(event) => {
                              setGradeDraft(event.target.value);
                              setGradeError("");
                              setGradeSuccess("");
                            }}
                            disabled={
                              !selectedSubmissionDetail || isPostingGrade
                            }
                            className="w-12 bg-transparent text-right text-lg font-bold outline-none"
                            placeholder="0"
                          />
                          <span className="text-sm">
                            /{selected.total_points ?? 0}
                          </span>
                        </div>
                      </div>
                      <div className="mb-4 grid gap-3 md:grid-cols-5">
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
                        ].map(([label, points, description], index) => (
                          <div
                            key={label}
                            className={`rounded-lg border border-black p-3 ${index === 0 ? "bg-[#8BCB88]" : ""}`}
                          >
                            <div className="mb-3 flex items-center justify-between gap-2">
                              <p className="font-bold">{label}</p>
                              <p className="text-sm font-bold">{points}</p>
                            </div>
                            <p className="text-xs">{description}</p>
                          </div>
                        ))}
                      </div>
                      <label className="block text-sm font-bold">
                        Comments
                        <textarea
                          value={feedbackDraft}
                          onChange={(event) => {
                            setFeedbackDraft(event.target.value);
                            setGradeError("");
                            setGradeSuccess("");
                          }}
                          disabled={!selectedSubmissionDetail || isPostingGrade}
                          className="mt-2 min-h-20 w-full rounded-lg border border-black px-3 py-2 text-sm outline-none"
                          placeholder="Write feedback for the student."
                        />
                      </label>
                      {gradeSuccess && (
                        <p className="mt-3 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                          {gradeSuccess}
                        </p>
                      )}
                      {gradeError && (
                        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                          {gradeError}
                        </p>
                      )}
                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={postGrade}
                          disabled={!selectedSubmissionDetail || isPostingGrade}
                          className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold disabled:opacity-50"
                        >
                          {isPostingGrade
                            ? "Saving..."
                            : selectedSubmissionDetail?.status === "graded"
                              ? "Update"
                              : "Post"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {isEditing && editDraft ? (
                      <Card className="block w-full space-y-4 border-black p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition-none hover:shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-xs font-bold">
                            Title
                            <Input
                              value={editDraft.title}
                              onChange={(event) =>
                                setEditDraft((current) =>
                                  current
                                    ? { ...current, title: event.target.value }
                                    : current,
                                )
                              }
                              disabled={isSavingEdit}
                              className="mt-1 w-full rounded-none border-black text-sm font-semibold shadow-none"
                            />
                          </label>
                          <label className="block text-xs font-bold">
                            Type
                            <Select
                              value={editDraft.classwork_type}
                              onValueChange={(v) =>
                                setEditDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        classwork_type: v,
                                      }
                                    : current,
                                )
                              }
                            >
                              <Select.Trigger
                                disabled={isSavingEdit}
                                className="mt-1 w-full h-10 border-2 border-black bg-white text-sm font-semibold shadow-none"
                              >
                                <Select.Value />
                              </Select.Trigger>
                              <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                <Select.Item value="READING">
                                  Reading
                                </Select.Item>
                                <Select.Item value="ACTIVITY">
                                  Activity
                                </Select.Item>
                                <Select.Item value="ASSIGNMENT">
                                  Assignment
                                </Select.Item>
                                <Select.Item value="QUIZ">Quiz</Select.Item>
                              </Select.Content>
                            </Select>
                          </label>
                        </div>

                        <div
                          className={`grid gap-3 ${isReadingType(editDraft.classwork_type) ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}
                        >
                          <label className="block text-xs font-bold">
                            Grading component
                            <Select
                              value={editDraft.classwork_category || "NONE"}
                              onValueChange={(v) =>
                                setEditDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        classwork_category:
                                          v === "NONE" ? "" : v,
                                      }
                                    : current,
                                )
                              }
                            >
                              <Select.Trigger
                                disabled={isSavingEdit}
                                className="mt-1 w-full h-10 border-2 border-black bg-white text-sm shadow-none"
                              >
                                <Select.Value placeholder="None" />
                              </Select.Trigger>
                              <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                <Select.Item value="NONE">None</Select.Item>
                                <Select.Item value="WRITTEN_WORK">
                                  Written Works
                                </Select.Item>
                                <Select.Item value="PERFORMANCE_TASK">
                                  Performance Task
                                </Select.Item>
                                <Select.Item value="QUARTERLY_ASSESSMENT">
                                  Quarterly Assessment
                                </Select.Item>
                              </Select.Content>
                            </Select>
                          </label>
                          {!isReadingType(editDraft.classwork_type) && (
                            <label className="block text-xs font-bold">
                              Total points
                              <Input
                                type="number"
                                min="1"
                                step="1"
                                inputMode="decimal"
                                value={editDraft.total_points}
                                onChange={(event) =>
                                  setEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          total_points: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                disabled={isSavingEdit}
                                className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                              />
                            </label>
                          )}
                          <label className="block text-xs font-bold">
                            <span className="invisible">Published</span>
                            <span className="mt-1 flex h-10 w-full items-center gap-2 border-2 border-black px-3 text-sm font-normal">
                              <Input
                                type="checkbox"
                                checked={editDraft.is_published}
                                onChange={(event) =>
                                  setEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          is_published: event.target.checked,
                                        }
                                      : current,
                                  )
                                }
                                disabled={isSavingEdit}
                                className="h-4 w-4 rounded-none border-black p-0 shadow-none accent-black"
                              />
                              Published
                            </span>
                          </label>
                        </div>

                        <Card className="block w-full border-black p-3 shadow-none transition-none hover:shadow-none">
                          <p className="mb-3 text-xs font-bold">
                            Assignment settings
                          </p>
                          <div
                            className={`grid gap-3 ${isQuizType(editDraft.classwork_type) ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}
                          >
                            <label className="block text-xs font-bold">
                              Due date
                              <Input
                                type="datetime-local"
                                value={editDraft.due_date}
                                onChange={(event) =>
                                  setEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          due_date: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                disabled={isSavingEdit}
                                className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                              />
                            </label>
                            <label className="block text-xs font-bold">
                              Locked until
                              <Input
                                type="datetime-local"
                                value={editDraft.lock_date}
                                onChange={(event) =>
                                  setEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          lock_date: event.target.value,
                                        }
                                      : current,
                                  )
                                }
                                disabled={
                                  isSavingEdit || !editDraft.is_published
                                }
                                className="mt-1 w-full rounded-none border-black text-sm shadow-none disabled:bg-gray-100"
                              />
                            </label>
                            {isQuizType(editDraft.classwork_type) && (
                              <label className="block text-xs font-bold">
                                Attempts
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={editDraft.max_attempts}
                                  onChange={(event) =>
                                    setEditDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            max_attempts: event.target.value,
                                          }
                                        : current,
                                    )
                                  }
                                  disabled={isSavingEdit}
                                  className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                                />
                              </label>
                            )}
                          </div>
                          <p className="mt-2 text-xs font-medium text-gray-600">
                            Published classwork is visible to students. A future
                            lock date keeps it visible but blocks access until
                            that time; clear it to unlock now.
                          </p>
                          {editDraft.due_date &&
                            !isReadingType(editDraft.classwork_type) && (
                              <label className="mt-3 flex items-start gap-3 border-2 border-black bg-primary px-3 py-2 text-xs font-bold">
                                <input
                                  type="checkbox"
                                  checked={editDraft.allow_late_submissions}
                                  onChange={(event) =>
                                    setEditDraft((current) =>
                                      current
                                        ? {
                                            ...current,
                                            allow_late_submissions:
                                              event.target.checked,
                                          }
                                        : current,
                                    )
                                  }
                                  disabled={isSavingEdit}
                                  className="mt-0.5 accent-black"
                                />
                                <span>
                                  Allow submissions/resubmissions after the due
                                  date
                                  <span className="block font-medium text-gray-700">
                                    Accepted work will be marked late.
                                  </span>
                                </span>
                              </label>
                            )}
                        </Card>

                        <label className="block text-xs font-bold">
                          Description
                          <Input
                            value={editDraft.description}
                            onChange={(event) =>
                              setEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      description: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            disabled={isSavingEdit}
                            className="mt-1 w-full rounded-none border-black text-sm shadow-none"
                          />
                        </label>

                        <label className="block text-xs font-bold">
                          Instructions
                          <textarea
                            value={editDraft.instructions}
                            onChange={(event) =>
                              setEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      instructions: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            disabled={isSavingEdit}
                            className="mt-1 min-h-24 w-full border-2 border-black px-3 py-2 text-sm outline-none focus:border-black"
                          />
                        </label>

                        <Card className="block w-full border-black p-3 shadow-none transition-none hover:shadow-none">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-bold">Materials</h3>
                              <p className="text-xs text-gray-500">
                                Add or remove files attached to this classwork.
                              </p>
                            </div>
                            <Button
                              asChild
                              variant="default"
                              size="sm"
                              className="cursor-pointer gap-2 font-bold "
                            >
                              <label>
                                <Plus size={14} />
                                Add files
                                <input
                                  type="file"
                                  multiple
                                  accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                                  className="hidden"
                                  disabled={
                                    isUploadingEditMaterials ||
                                    removingAttachmentId !== null
                                  }
                                  onChange={(event) => {
                                    addEditMaterials(event.target.files);
                                    event.target.value = "";
                                  }}
                                />
                              </label>
                            </Button>
                          </div>

                          {selected.attachments.length > 0 ? (
                            <div className="space-y-2">
                              {selected.attachments.map((attachment) => (
                                <div
                                  key={attachment.classwork_attachment_id}
                                  className="flex items-center gap-3 border-2 border-black px-3 py-2 text-sm"
                                >
                                  <FileText size={16} />
                                  <span className="min-w-0 flex-1 truncate font-semibold">
                                    {attachment.file_name}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      removeSelectedAttachment(
                                        attachment.classwork_attachment_id,
                                      )
                                    }
                                    disabled={
                                      removingAttachmentId ===
                                        attachment.classwork_attachment_id ||
                                      isUploadingEditMaterials
                                    }
                                    className="text-red-600 hover:bg-red-50 disabled:opacity-50"
                                    aria-label={`Remove ${attachment.file_name}`}
                                  >
                                    <Trash2 size={15} />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="border-2 border-dashed border-black/40 px-3 py-4 text-center text-sm text-gray-500">
                              No files attached yet.
                            </p>
                          )}

                          {editMaterials.length > 0 && (
                            <div className="mt-3 space-y-2">
                              <p className="text-xs font-bold">
                                Pending uploads
                              </p>
                              {editMaterials.map((material, index) => (
                                <div
                                  key={`${material.name}-${material.size}`}
                                  className="flex items-center gap-3 border-2 border-black px-3 py-2 text-sm"
                                >
                                  <FileText size={16} />
                                  <span className="min-w-0 flex-1 truncate font-semibold">
                                    {material.name}
                                  </span>
                                  <span className="text-xs text-gray-500">
                                    {formatFileSize(material.size)}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeEditMaterial(index)}
                                    disabled={isUploadingEditMaterials}
                                    className="text-red-600 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <Trash2 size={15} />
                                  </Button>
                                </div>
                              ))}
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                onClick={uploadEditMaterials}
                                disabled={isUploadingEditMaterials}
                                className="border-black bg-[#7ABA78] font-bold disabled:opacity-50"
                              >
                                {isUploadingEditMaterials
                                  ? "Uploading..."
                                  : "Upload selected files"}
                              </Button>
                            </div>
                          )}
                        </Card>
                      </Card>
                    ) : (
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
                    )}

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
                    ) : (
                      <>
                        {isQuizType(selected.classwork_type) && (
                          <QuizAnalysisView
                            quizAnalysis={quizAnalysis}
                            isQuizAnalysisLoading={isQuizAnalysisLoading}
                            quizAnalysisError={quizAnalysisError}
                            selected={selected}
                            setSelectedGradingSubmissionId={setSelectedGradingSubmissionId}
                          />
                        )}

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
                                <Card key={label} className="block shadow-none">
                                  <Card.Content className="space-y-3">
                                    <div className="flex items-start justify-between gap-2">
                                      <h3 className="font-bold">{label}</h3>

                                      <Badge
                                        variant="secondary"
                                        size="sm"
                                        className="shrink-0 whitespace-nowrap"
                                      >
                                        {points}
                                      </Badge>
                                    </div>

                                    <p className="text-sm text-muted-foreground">
                                      {description}
                                    </p>
                                  </Card.Content>
                                </Card>
                              ))}
                            </div>
                          </Card.Content>
                        </Card>

                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <h2 className="text-2xl font-bold">
                              Student's Submissions
                            </h2>
                            <Select
                              value={submissionSort}
                              onValueChange={(v) =>
                                setSubmissionSort(v as "name" | "score")
                              }
                            >
                              <Select.Trigger className="h-10 text-sm bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-semibold">
                                <ArrowUpDown size={16} className="mr-2" />
                                <Select.Value />
                              </Select.Trigger>
                              <Select.Content className="border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                <Select.Item value="name">
                                  Sort By Name
                                </Select.Item>
                                <Select.Item value="score">
                                  Sort By Score
                                </Select.Item>
                              </Select.Content>
                            </Select>
                          </div>

                          <Table
                            wrapperClassName="overflow-x-auto"
                            className="border-black"
                          >
                            <Table.Body>
                              {detailError && (
                                <Table.Row className="border-black hover:bg-transparent">
                                  <Table.Cell
                                    colSpan={3}
                                    className="bg-red-50 text-sm font-semibold text-red-700"
                                  >
                                    {detailError}
                                  </Table.Cell>
                                </Table.Row>
                              )}
                              {isTrackingLoading ? (
                                <Table.Row className="hover:bg-transparent">
                                  <Table.Cell
                                    colSpan={3}
                                    className="py-6 text-center text-sm font-semibold text-gray-500"
                                  >
                                    Loading submissions...
                                  </Table.Cell>
                                </Table.Row>
                              ) : trackingRows.length > 0 ? (
                                trackingRows.map((student) => {
                                  const isGraded =
                                    student.status === "graded" ||
                                    (student.grade !== null &&
                                      student.grade !== undefined);
                                  const scoreLabel = isGraded
                                    ? `${student.grade ?? 0}/${selected.total_points ?? 0}`
                                    : `0/${selected.total_points ?? 0}`;
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
        </main>
      ) : (
        // Main list view
        <>
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold">Classwork</h1>
              </div>

              <Button
                type="button"
                onClick={openCreateWizard}
                className="gap-2"
              >
                <Plus size={17} />
                <span className="hidden sm:inline">New Classwork</span>
                <span className="sm:hidden">New</span>
              </Button>
            </header>

            <Tabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={setActiveTab}
            />
          </div>

          <main className="flex flex-col gap-4 px-5 py-4 pt-0!">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div className="grid gap-3 py-2 md:grid-cols-[1fr_auto_auto]">
              <label className="relative shadow-md transition-shadow hover:shadow-none">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search classwork..."
                  className="h-10 w-full border-black pl-9 pr-3 shadow-none"
                />
              </label>

              <Button
                variant="outline"
                size="md"
                onClick={() => setShowFilters((current) => !current)}
                className="gap-1.5"
              >
                <Filter size={15} />
                Add Filter
              </Button>

              <Button
                variant="outline"
                size="md"
                onClick={cycleSort}
                className="gap-1.5"
                title={`Current sort: ${sortMode}`}
              >
                {sortMode === "title" ? (
                  <ArrowDownAZ size={15} />
                ) : (
                  <ArrowUpDown size={15} />
                )}
                Sort By
              </Button>

              {subjectFilter !== "all" && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="flex w-fit items-center gap-2"
                  onClick={() => setSubjectFilter("all")}
                >
                  {
                    subjects.find(
                      (subject) => subject.id === Number(subjectFilter),
                    )?.name
                  }
                  <X size={13} />
                </Badge>
              )}

              {statusFilter !== "all" && (
                <Badge
                  variant="secondary"
                  size="sm"
                  className="flex w-fit items-center gap-2 capitalize"
                  onClick={() => setStatusFilter("all")}
                >
                  {statusFilter}
                  <X size={13} />
                </Badge>
              )}
            </div>

            {showFilters && (
              <section className="grid gap-3 rounded-lg border border-black bg-[#F6E9B2] p-3 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] sm:grid-cols-2">
                <label className="text-xs font-bold">
                  Subject
                  <select
                    value={subjectFilter}
                    onChange={(event) => setSubjectFilter(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
                  >
                    <option value="all">All subjects</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-bold">
                  Publication status
                  <select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="mt-1 w-full rounded border border-gray-700 bg-white px-3 py-2 text-sm font-medium"
                  >
                    <option value="all">All statuses</option>
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </label>
              </section>
            )}

            {isLoading ? (
              <p className="py-12 text-center text-sm font-semibold text-gray-500">
                Loading classworks...
              </p>
            ) : filteredItems.length > 0 ? (
              <section className="space-y-3">
                {filteredItems.map((item) => (
                  <ClassworkCard
                    key={item.classwork_id}
                    item={item}
                    onOpen={openClassworkDetail}
                  />
                ))}
              </section>
            ) : (
              <section className="rounded-lg border border-dashed border-gray-400 bg-white px-5 py-14 text-center">
                <ClipboardList
                  className="mx-auto mb-2 text-gray-400"
                  size={36}
                />
                <p className="font-bold">No classworks found</p>
                <p className="mt-1 text-sm text-gray-500">
                  Try another tab, search term, or filter.
                </p>
              </section>
            )}
          </main>

          <Dialog
            open={showCreateWizard}
            onOpenChange={(open) => {
              if (!open) closeCreateWizard();
            }}
          >
            {showCreateWizard &&
              (selectedType === null ? (
                <Dialog.Content size="lg">
                  <Dialog.Header position="fixed" asChild>
                    <div className="flex items-center justify-between w-full">
                      <Text as="h5" className="font-sans text-xl font-bold">
                        Choose Classwork Type
                      </Text>
                      <button
                        type="button"
                        onClick={closeCreateWizard}
                        className="cursor-pointer text-white hover:text-gray-200"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </Dialog.Header>
                  <section className="p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {createOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.type}
                            type="button"
                            onClick={() => setSelectedType(option.type)}
                            className="rounded-lg border-2 border-black bg-[#7ABA78] p-5 text-left shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 cursor-pointer text-black"
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={20} className="text-black" />
                              <h3 className="text-lg font-bold text-black">
                                {option.title}
                              </h3>
                            </div>
                            <p className="mt-2 text-xs font-semibold text-black/80">
                              {option.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                  <Dialog.Footer position="fixed">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={closeCreateWizard}
                    >
                      Cancel
                    </Button>
                  </Dialog.Footer>
                </Dialog.Content>
              ) : isQuizType(selectedType) ? (
                <CreateClassworkQuizModal
                  selectedType={selectedType}
                  subjects={subjects}
                  loads={loads}
                  onClose={closeCreateWizard}
                  onSuccess={async () => {
                    await loadClassworks();
                    closeCreateWizard();
                  }}
                  onBack={() => setSelectedType(null)}
                />
              ) : (
                <CreateClassworkModal
                  selectedType={selectedType}
                  subjects={subjects}
                  loads={loads}
                  onClose={closeCreateWizard}
                  onSuccess={async () => {
                    await loadClassworks();
                    closeCreateWizard();
                  }}
                  onBack={() => setSelectedType(null)}
                />
              ))}
          </Dialog>
        </>
      )}

      {selectedGradingSubmissionId && (
        <QuizGradingModal
          submissionId={selectedGradingSubmissionId}
          isOpen={Boolean(selectedGradingSubmissionId)}
          onClose={() => setSelectedGradingSubmissionId(null)}
          onSuccess={() => {
            if (selected) {
              void openClassworkDetail(selected);
            }
          }}
        />
      )}
    </AppLayout>
  );
}
