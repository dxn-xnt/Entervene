import {
  ArrowDownAZ,
  ArrowUpDown,
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Filter,
  Link as LinkIcon,
  Plus,
  Search,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import AttachmentDisplay from "@/components/AttachmentDisplay";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { API_URL, apiFetch } from "@/lib/api";

type ClassworkType = "READING" | "ACTIVITY" | "ASSIGNMENT" | "QUIZ" | string;
type ClassworkKind = "READING" | "ACTIVITY" | "ASSIGNMENT" | "QUIZ";
type TabId = "all" | "readings" | "activities" | "assignments" | "quizzes";
type SortMode = "newest" | "oldest" | "title";
type CreateStep = "type" | "details" | "assign";

type ClassworkAttachment = {
  classwork_attachment_id: number;
  file_name: string;
  file_type?: string;
  file_size: number;
  uploaded_at?: string | null;
};

type ClassworkAssignment = {
  classwork_assignment_id: number;
  classwork_id: number;
  class_id: number;
  title?: string | null;
  due_date?: string | null;
  is_published: boolean;
};

type TeacherClasswork = {
  classwork_id: number;
  title: string;
  description?: string | null;
  instructions?: string | null;
  classwork_type: ClassworkType;
  classwork_category?: string | null;
  total_points?: number | null;
  is_published: boolean;
  is_locked: boolean;
  subject_id: number;
  subject_name?: string | null;
  attachments: ClassworkAttachment[];
  assignments?: ClassworkAssignment[] | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type TeacherClassLoad = {
  subject_load_id: number;
  subject_id: number;
  subject_name: string;
  subject_codename?: string | null;
  class_id: number;
  section_name: string;
};

type TrackingStudent = {
  student_id: string;
  student_name: string;
  status: string;
  submission_id?: number | null;
  grade?: number | null;
  attachment_count?: number;
};

type AssignmentTracking = {
  classwork_assignment_id: number;
  classwork_id: number;
  classwork_title?: string | null;
  total_students: number;
  submitted_count: number;
  missing_count: number;
  submitted: TrackingStudent[];
  missing: TrackingStudent[];
};

type SubmissionAttachment = {
  submission_attachment_id: number;
  file_name: string;
  file_type?: string | null;
  file_size: number;
  uploaded_at?: string | null;
};

type TeacherSubmissionDetail = {
  submission_id: number;
  student_id: string;
  student_name?: string | null;
  classwork_assignment_id: number;
  status: string;
  grade?: number | null;
  feedback?: string | null;
  submitted_at?: string | null;
  attachments: SubmissionAttachment[];
  total_points?: number | null;
};

type CreateDraft = {
  subject_id: string;
  title: string;
  description: string;
  instructions: string;
  classwork_category: string;
  total_points: string;
  due_date: string;
  max_attempts: string;
  is_published: boolean;
};

const emptyDraft: CreateDraft = {
  subject_id: "",
  title: "",
  description: "",
  instructions: "",
  classwork_category: "WRITTEN_WORK",
  total_points: "100",
  due_date: "",
  max_attempts: "1",
  is_published: true,
};

const allowedMaterialExtensions = [
  ".pdf",
  ".docx",
  ".pptx",
  ".jpg",
  ".jpeg",
  ".png",
];
const maxMaterialSize = 4 * 1024 * 1024;

const tabs: Array<{ id: TabId; label: string; icon: LucideIcon }> = [
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

const typeIcon: Record<string, LucideIcon> = {
  READING: BookOpen,
  ACTIVITY: CheckSquare,
  ASSIGNMENT: FileText,
  QUIZ: ClipboardList,
};

function formatDate(value?: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatFileSize(bytes: number) {
  if (bytes === 0) return "0 bytes";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function fileExtension(fileName: string) {
  const suffix = fileName.split(".").pop()?.toLowerCase();
  return suffix ? `.${suffix}` : "";
}

function scoreBand(points: number | null | undefined, ratio: number) {
  if (!points) return "0 pts";
  return `${Math.max(1, Math.round(points * ratio))} pts`;
}

function submissionStatusLabel(status?: string | null) {
  if (status === "graded") return "Graded";
  if (status === "late") return "Late submission";
  if (status === "submitted") return "On-time submission";
  if (status === "pending") return "Ungraded";
  if (status === "not_submitted") return "Missing";
  return "Ungraded";
}

function ClassworkCard({
  item,
  onOpen,
}: {
  item: TeacherClasswork;
  onOpen: (item: TeacherClasswork) => void;
}) {
  // Summary card for the global teacher Classworks page.
  const Icon = typeIcon[item.classwork_type.toUpperCase()] || ClipboardList;
  const assignmentCount = item.assignments?.length ?? 0;
  const attachmentCount = item.attachments?.length ?? 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 hover:bg-[#F6E9B2]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon size={19} className="shrink-0" />
          <h2 className="truncate text-lg font-bold">{item.title}</h2>
        </div>
        <p className="mt-1 text-xs font-medium text-gray-600">
          {[item.subject_name, `Created ${formatDate(item.created_at)}`]
            .filter(Boolean)
            .join(" | ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {assignmentCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
            <LinkIcon size={12} />
            Class {assignmentCount}
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
            <FileText size={12} />
            File {attachmentCount}
          </span>
        )}
      </div>
    </button>
  );
}

export default function Classworks() {
  const [items, setItems] = useState<TeacherClasswork[]>([]);
  const [loads, setLoads] = useState<TeacherClassLoad[]>([]);
  const [activeTab, setActiveTab] = useState<TabId>("all");
  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showFilters, setShowFilters] = useState(false);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [createStep, setCreateStep] = useState<CreateStep>("type");
  const [selectedType, setSelectedType] = useState<ClassworkKind | null>(null);
  const [draft, setDraft] = useState<CreateDraft>(emptyDraft);
  const [materials, setMaterials] = useState<File[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<number[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [selected, setSelected] = useState<TeacherClasswork | null>(null);
  const [tracking, setTracking] = useState<AssignmentTracking | null>(null);
  const [isTrackingLoading, setIsTrackingLoading] = useState(false);
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
      setDraft((current) =>
        current.subject_id || !loadData[0]
          ? current
          : { ...current, subject_id: String(loadData[0].subject_id) },
      );
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

  const selectedSubjectLoads = useMemo(
    () =>
      loads
        .filter(
          (load) =>
            draft.subject_id && load.subject_id === Number(draft.subject_id),
        )
        .sort((a, b) => a.section_name.localeCompare(b.section_name)),
    [draft.subject_id, loads],
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
    setCreateStep(preferredType ? "details" : "type");
    setDraft({
      ...emptyDraft,
      classwork_category:
        preferredType === "QUIZ" ? "PERIODICAL_EXAM" : "WRITTEN_WORK",
      subject_id: subjects[0] ? String(subjects[0].id) : "",
    });
    setMaterials([]);
    setSelectedClassIds([]);
    setCreateError("");
    setShowCreateWizard(true);
  };

  const closeCreateWizard = () => {
    if (isCreating) return;
    setShowCreateWizard(false);
    setCreateStep("type");
    setSelectedType(null);
    setDraft(emptyDraft);
    setMaterials([]);
    setSelectedClassIds([]);
    setCreateError("");
  };

  const chooseType = (type: ClassworkKind) => {
    setSelectedType(type);
    setDraft((current) => ({
      ...current,
      classwork_category: type === "QUIZ" ? "PERIODICAL_EXAM" : "WRITTEN_WORK",
    }));
    setCreateStep("details");
    setCreateError("");
  };

  const addMaterials = (files: FileList | null) => {
    if (!files) return;
    const selectedFiles = Array.from(files);
    const invalid = selectedFiles.find(
      (file) => !allowedMaterialExtensions.includes(fileExtension(file.name)),
    );
    if (invalid) {
      setCreateError(
        `${invalid.name} is not supported. Use PDF, DOCX, PPTX, JPG, or PNG.`,
      );
      return;
    }
    const oversized = selectedFiles.find((file) => file.size > maxMaterialSize);
    if (oversized) {
      setCreateError(`${oversized.name} is larger than the 4 MB limit.`);
      return;
    }
    setCreateError("");
    setMaterials((current) => {
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

  const removeMaterial = (index: number) => {
    setMaterials((current) =>
      current.filter((_, itemIndex) => itemIndex !== index),
    );
  };

  const toggleClass = (classId: number) => {
    setSelectedClassIds((current) =>
      current.includes(classId)
        ? current.filter((id) => id !== classId)
        : [...current, classId],
    );
  };

  const validateDetails = () => {
    if (!selectedType) return "Choose a classwork type.";
    if (!draft.subject_id) return "Choose a subject.";
    if (!draft.title.trim()) return "Topic title is required.";
    const points = Number(draft.total_points);
    if (draft.total_points && (!Number.isFinite(points) || points <= 0)) {
      return "Total points must be greater than zero.";
    }
    const attempts = Number(draft.max_attempts);
    if (!Number.isInteger(attempts) || attempts <= 0) {
      return "Allowed attempts must be a positive whole number.";
    }
    return "";
  };

  const goToAssignStep = () => {
    const validationError = validateDetails();
    if (validationError) {
      setCreateError(validationError);
      return;
    }
    setSelectedClassIds((current) => {
      const validIds = new Set(
        selectedSubjectLoads.map((load) => load.class_id),
      );
      return current.filter((id) => validIds.has(id));
    });
    setCreateError("");
    setCreateStep("assign");
  };

  const createClasswork = async () => {
    // Use the atomic backend endpoint so create/upload/assign cannot partially succeed.
    const validationError = validateDetails();
    if (validationError) {
      setCreateError(validationError);
      setCreateStep("details");
      return;
    }
    if (selectedClassIds.length === 0) {
      setCreateError("Select at least one section to assign this classwork.");
      return;
    }

    setIsCreating(true);
    setCreateError("");
    try {
      if (!selectedType) {
        throw new Error("Select a classwork type first.");
      }
      const totalPoints = draft.total_points
        ? Number(draft.total_points)
        : null;
      const formData = new FormData();
      formData.append("title", draft.title.trim());
      formData.append("description", draft.description.trim());
      formData.append("instructions", draft.instructions.trim());
      formData.append("classwork_type", selectedType);
      if (draft.classwork_category) {
        formData.append("classwork_category", draft.classwork_category);
      }
      if (totalPoints !== null) {
        formData.append("total_points", String(totalPoints));
      }
      formData.append("subject_id", String(draft.subject_id));
      formData.append("is_published", String(draft.is_published));
      formData.append("class_ids", JSON.stringify(selectedClassIds));
      if (draft.due_date) {
        formData.append("due_date", new Date(draft.due_date).toISOString());
      }
      formData.append("max_attempts", String(Number(draft.max_attempts)));
      materials.forEach((material) => formData.append("files", material));

      const createResponse = await apiFetch(
        "/api/v1/classwork-assignments/with-assignments",
        {
          method: "POST",
          body: formData,
        },
      );

      if (!createResponse.ok) {
        const body = await createResponse.json().catch(() => ({}));
        throw new Error(body.detail || "Unable to create classwork.");
      }

      await loadClassworks();
      closeCreateWizard();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Unable to create classwork.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const openClassworkDetail = async (item: TeacherClasswork) => {
    setSelected(item);
    setTracking(null);
    setDetailError("");

    const assignmentId = item.assignments?.[0]?.classwork_assignment_id;
    if (!assignmentId) return;

    setIsTrackingLoading(true);
    try {
      const response = await apiFetch(
        `/api/v1/submissions/assignment/${assignmentId}/tracking`,
      );
      if (!response.ok) {
        throw new Error("Unable to load student submissions.");
      }
      setTracking((await response.json()) as AssignmentTracking);
    } catch (err) {
      setDetailError(
        err instanceof Error
          ? err.message
          : "Unable to load student submissions.",
      );
    } finally {
      setIsTrackingLoading(false);
    }
  };

  const closeClassworkDetail = () => {
    setSelected(null);
    setTracking(null);
    setDetailError("");
    setSelectedStudent(null);
    setSelectedSubmissionDetail(null);
    setSubmissionDetailError("");
    setGradeError("");
    setGradeSuccess("");
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

  const selectedTypeOption = createOptions.find(
    (option) => option.type === selectedType,
  );
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
        <main className="min-h-screen bg-[#F8F6ED] px-5 py-5">
          <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-black/30 pb-4 text-lg font-bold">
            <button
              type="button"
              onClick={closeClassworkDetail}
              className="rounded-full p-1 hover:bg-black/10"
              aria-label="Back to classworks"
            >
              <X size={20} />
            </button>
            <span>
              {selectedAssignment?.title ||
                selected.subject_name ||
                "Classwork"}
            </span>
            <span className="text-black/50">›</span>
            <span>...</span>
            <span className="text-black/50">›</span>
            <span>{selectedStudent?.student_name || selected.title}</span>
          </div>

          <section className="mx-auto max-w-5xl space-y-4">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={
                  selectedStudent
                    ? closeStudentSubmission
                    : closeClassworkDetail
                }
                className="rounded-full border border-transparent p-1 hover:border-black"
                aria-label="Back"
              >
                ‹
              </button>
              <FileText size={24} />
              <h1 className="text-3xl font-bold">{selected.title}</h1>
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
                        disabled={!selectedSubmissionDetail || isPostingGrade}
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
                <div className="rounded-lg border border-black bg-white p-4 text-sm font-semibold shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                  {selected.instructions ||
                    selected.description ||
                    "No instructions provided."}
                </div>

                <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-bold">Attached Files</h2>
                    <span className="rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-bold">
                      File {selected.attachments.length}
                    </span>
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
                    <p className="text-sm font-medium text-gray-500">
                      No files attached.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-black bg-white p-4 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-bold">Activity Score</h2>
                    <p className="text-sm font-bold">
                      Total: {selected.total_points ?? 0} pts
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-5">
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
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="text-2xl font-bold">
                      Student's Submissions
                    </h2>
                    <button
                      type="button"
                      onClick={() =>
                        setSubmissionSort((current) =>
                          current === "name" ? "score" : "name",
                        )
                      }
                      className="inline-flex items-center gap-2 text-sm font-medium"
                    >
                      <ArrowUpDown size={16} />
                      Sort By {submissionSort === "name" ? "Name" : "Score"}
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                    {detailError && (
                      <div className="border-b border-black bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {detailError}
                      </div>
                    )}
                    {isTrackingLoading ? (
                      <p className="px-4 py-6 text-center text-sm font-semibold text-gray-500">
                        Loading submissions...
                      </p>
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
                          <div
                            key={student.student_id}
                            className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-black px-4 py-3 last:border-b-0"
                          >
                            <div className="flex items-center gap-3">
                              <div className="grid h-8 w-8 place-items-center rounded-full bg-[#FFD08A] text-xs font-bold">
                                {student.student_name.slice(0, 1)}
                              </div>
                              <button
                                type="button"
                                onClick={() => openStudentSubmission(student)}
                                className="font-bold hover:underline"
                              >
                                {student.student_name}
                              </button>
                            </div>
                            <span className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium">
                              {submissionStatusLabel(
                                isGraded ? "graded" : student.status,
                              )}
                            </span>
                            <p className="min-w-20 text-right text-sm font-semibold text-gray-700">
                              {scoreLabel}
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <p className="px-4 py-6 text-center text-sm font-semibold text-gray-500">
                        No submissions found for this classwork yet.
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}
          </section>
        </main>
      ) : (
        <>
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold">Classwork</h1>
              </div>

              <button
                type="button"
                onClick={openCreateWizard}
                className="inline-flex items-center gap-2 rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
              >
                <Plus size={17} />
                <span className="hidden sm:inline">New Classwork</span>
                <span className="sm:hidden">New</span>
              </button>
            </header>
          </div>

          <nav className="flex overflow-x-auto border-b border-gray-400 bg-white px-5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "-mb-px rounded-t-lg border border-b-0 border-black bg-white"
                      : ""
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <main className="flex flex-col gap-4 px-5 py-4">
            {error && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <section className="flex flex-col gap-3 border-b border-gray-300 pb-3 md:flex-row md:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-gray-600 bg-white px-3 py-2 md:max-w-sm">
                <Search size={16} />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search classwork"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {subjectFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setSubjectFilter("all")}
                    className="inline-flex items-center gap-2 rounded-full bg-[#F6E9B2] px-3 py-1.5 text-xs font-semibold"
                  >
                    {
                      subjects.find(
                        (subject) => subject.id === Number(subjectFilter),
                      )?.name
                    }
                    <X size={13} />
                  </button>
                )}
                {statusFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="inline-flex items-center gap-2 rounded-full bg-[#F6E9B2] px-3 py-1.5 text-xs font-semibold capitalize"
                  >
                    {statusFilter}
                    <X size={13} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowFilters((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium hover:bg-gray-100"
                >
                  <Filter size={15} />
                  Add Filter
                </button>
                <button
                  type="button"
                  onClick={cycleSort}
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1.5 text-sm font-medium hover:bg-gray-100"
                  title={`Current sort: ${sortMode}`}
                >
                  {sortMode === "title" ? (
                    <ArrowDownAZ size={15} />
                  ) : (
                    <ArrowUpDown size={15} />
                  )}
                  Sort By
                </button>
              </div>
            </section>

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

          {showCreateWizard && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
              <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-black bg-white shadow-[5px_5px_0px_0px_rgba(0,0,0,1)]">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black bg-[#7ABA78] px-5 py-4">
                  <div>
                    <h2 className="text-lg font-bold">
                      {createStep === "type"
                        ? "Create new classwork"
                        : createStep === "details"
                          ? `Create ${selectedTypeOption?.title.toLowerCase() || "classwork"}`
                          : `Assign ${selectedTypeOption?.title.toLowerCase() || "classwork"}`}
                    </h2>
                    <p className="text-xs font-medium">
                      Step{" "}
                      {createStep === "type"
                        ? 1
                        : createStep === "details"
                          ? 2
                          : 3}{" "}
                      of 3
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCreateWizard}
                    disabled={isCreating}
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="space-y-4 p-5">
                  {createError && (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                      {createError}
                    </div>
                  )}

                  {createStep === "type" && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {createOptions.map((option) => {
                        const Icon = option.icon;
                        return (
                          <button
                            key={option.type}
                            type="button"
                            onClick={() => chooseType(option.type)}
                            className="rounded-lg border border-black bg-[#7ABA78] p-4 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5"
                          >
                            <div className="flex items-center gap-2">
                              <Icon size={20} />
                              <h3 className="text-lg font-bold">
                                {option.title}
                              </h3>
                            </div>
                            <p className="mt-2 text-xs font-medium">
                              {option.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {createStep === "details" && (
                    <div className="space-y-4">
                      <label className="block text-xs font-bold">
                        Subject
                        <select
                          value={draft.subject_id}
                          onChange={(event) => {
                            setDraft((current) => ({
                              ...current,
                              subject_id: event.target.value,
                            }));
                            setSelectedClassIds([]);
                          }}
                          disabled={isCreating}
                          className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm font-semibold"
                        >
                          <option value="">Choose subject</option>
                          {subjects.map((subject) => (
                            <option key={subject.id} value={subject.id}>
                              {subject.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block text-xs font-bold">
                        Topic title
                        <input
                          value={draft.title}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          disabled={isCreating}
                          className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm font-semibold"
                          placeholder="Introduction to Programming Reading Materials"
                        />
                      </label>

                      <label className="block text-xs font-bold">
                        Description
                        <input
                          value={draft.description}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          disabled={isCreating}
                          className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          placeholder="Short context for students"
                        />
                      </label>

                      <label className="block text-xs font-bold">
                        Instructions
                        <textarea
                          value={draft.instructions}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              instructions: event.target.value,
                            }))
                          }
                          disabled={isCreating}
                          className="mt-1 min-h-20 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          placeholder="What students need to read, answer, or submit"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block text-xs font-bold">
                          Grading component
                          <select
                            value={draft.classwork_category}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                classwork_category: event.target.value,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm"
                          >
                            <option value="WRITTEN_WORK">Written Works</option>
                            <option value="PERFORMANCE_TASK">
                              Performance Task
                            </option>
                            <option value="PERIODICAL_EXAM">
                              Periodical Exam
                            </option>
                          </select>
                        </label>
                        <label className="block text-xs font-bold">
                          Total points
                          <input
                            type="number"
                            min="1"
                            step="0.01"
                            value={draft.total_points}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                total_points: event.target.value,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-bold">
                          Attempts
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={draft.max_attempts}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                max_attempts: event.target.value,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-xs font-bold">Upload material</p>
                          <p className="text-xs text-gray-500">
                            PDF, DOCX, PPTX, JPG, PNG | 4 MB each
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {materials.map((material, index) => (
                            <div
                              key={`${material.name}-${material.size}`}
                              className="relative flex h-28 w-24 flex-col justify-between rounded-lg border border-black bg-white p-2 text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                            >
                              <button
                                type="button"
                                onClick={() => removeMaterial(index)}
                                disabled={isCreating}
                                className="absolute right-1 top-1 rounded-full border border-black bg-white p-0.5"
                              >
                                <Trash2 size={12} />
                              </button>
                              <FileText className="mx-auto mt-5" size={22} />
                              <div className="min-w-0">
                                <p className="truncate text-[10px] font-semibold">
                                  {material.name}
                                </p>
                                <p className="text-[10px] text-gray-500">
                                  {formatFileSize(material.size)}
                                </p>
                              </div>
                            </div>
                          ))}
                          <label className="flex h-28 w-24 cursor-pointer items-center justify-center rounded-lg border border-dashed border-black bg-[#F6E9B2] text-sm font-bold hover:bg-[#7ABA78]">
                            <Plus size={20} />
                            <input
                              type="file"
                              multiple
                              accept=".pdf,.docx,.pptx,.jpg,.jpeg,.png"
                              onChange={(event) => {
                                addMaterials(event.target.files);
                                event.target.value = "";
                              }}
                              disabled={isCreating}
                              className="hidden"
                            />
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {createStep === "assign" && (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block text-xs font-bold">
                          Due date
                          <input
                            type="datetime-local"
                            value={draft.due_date}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                due_date: event.target.value,
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="block text-xs font-bold">
                          Publish status
                          <select
                            value={draft.is_published ? "published" : "draft"}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                is_published:
                                  event.target.value === "published",
                              }))
                            }
                            disabled={isCreating}
                            className="mt-1 w-full rounded-lg border border-gray-700 bg-white px-3 py-2 text-sm"
                          >
                            <option value="published">Publish now</option>
                            <option value="draft">
                              Save as draft assignment
                            </option>
                          </select>
                        </label>
                      </div>

                      <div>
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-bold">
                            Assign to sections
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedClassIds(
                                selectedSubjectLoads.map(
                                  (load) => load.class_id,
                                ),
                              )
                            }
                            disabled={
                              isCreating || selectedSubjectLoads.length === 0
                            }
                            className="rounded border border-black px-2 py-1 text-xs font-semibold disabled:opacity-50"
                          >
                            Select all
                          </button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {selectedSubjectLoads.map((load) => {
                            const isSelected = selectedClassIds.includes(
                              load.class_id,
                            );
                            return (
                              <button
                                key={load.subject_load_id}
                                type="button"
                                onClick={() => toggleClass(load.class_id)}
                                disabled={isCreating}
                                className={`rounded-lg border border-black px-3 py-3 text-sm font-bold ${
                                  isSelected ? "bg-[#7ABA78]" : "bg-white"
                                }`}
                              >
                                {load.section_name}
                              </button>
                            );
                          })}
                        </div>
                        {selectedSubjectLoads.length === 0 && (
                          <p className="rounded-lg border border-dashed border-gray-400 px-4 py-5 text-center text-sm text-gray-500">
                            No active sections are assigned to this subject.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-black px-5 py-4">
                  <button
                    type="button"
                    onClick={() =>
                      createStep === "type"
                        ? closeCreateWizard()
                        : setCreateStep(
                            createStep === "assign" ? "details" : "type",
                          )
                    }
                    disabled={isCreating}
                    className="rounded-lg border border-black px-4 py-2 text-sm font-bold disabled:opacity-50"
                  >
                    {createStep === "type" ? "Cancel" : "Back"}
                  </button>
                  {createStep === "type" ? null : createStep === "details" ? (
                    <button
                      type="button"
                      onClick={goToAssignStep}
                      disabled={isCreating}
                      className="rounded-lg border border-black bg-white px-4 py-2 text-sm font-bold"
                    >
                      Next
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={createClasswork}
                      disabled={isCreating}
                      className="rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-bold disabled:opacity-50"
                    >
                      {isCreating ? "Creating..." : "Assign"}
                    </button>
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </AppLayout>
  );
}
