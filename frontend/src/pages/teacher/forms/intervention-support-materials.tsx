import { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from "react";
import { useNavigate } from "react-router-dom";
import { Alert } from "@/components/retroui/Alert";
import { Button } from "@/components/teacher/button";
import { useToast } from "@/components/retroui/Toast";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Avatar } from "@/components/retroui/Avatar";
import { Dialog } from "@/components/retroui/Dialog";
import { Input } from "@/components/retroui/Input";
import { Label } from "@/components/retroui/Label";
import { Select } from "@/components/retroui/Select";
import { Checkbox } from "@/components/retroui/Checkbox";
import { Accordion } from "@/components/retroui/Accordion";
import { Empty } from "@/components/retroui/Empty";
import ClassworkItemLine from "@/components/item-line/classwork";
import { Activity, Check, Plus } from "lucide-react";
import {
  createSupportMaterial,
  generateStudentReviewer,
  listSupportMaterials,
  saveSupportMaterial,
  sendStudentReviewer,
  getRemediationWorkspace,
  saveRemediationPlan,
  generateRemediationAdvisory,
  type RemediationFormat,
  type RemediationPlan,
  type RemediationResource,
  type RemediationFocus,
  type RemediationProgress,
  type RemedialDraft,
  type ReviewerDraft,
  type SupportMaterial,
  type TeacherInterventionDetail,
  type TeacherInterventionSummary,
  type OriginalExamination,
} from "@/lib/teacher-interventions-api";
import { toTitleCase } from "@/lib/formatters";
import Field from "@/components/admin/classes/fields/Field";
import IconContainer from "@/components/icon-container";

const date = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const methods: Array<{ value: RemediationFormat; label: string; detail: string }> = [
  { value: "QUIZ", label: "Quiz", detail: "Focused practice in the existing Quiz builder" },
  { value: "CLASSWORK", label: "Classwork", detail: "Targeted activity in the existing Classwork creator" },
  { value: "TOS", label: "TOS Blueprint", detail: "Assessment blueprint and export only" },
  { value: "EXISTING_MATERIAL_ONLY", label: "Materials Only", detail: "Planning references only, no new graded assessment" },
];

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const componentLabel = (value: string | null | undefined) =>
  value
    ? value
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "Teacher review required";

const isGraded = (choice: RemediationFormat | null) =>
  choice === "QUIZ" || choice === "CLASSWORK";

export interface InterventionSupportMaterialsHandle {
  saveAdjustments: () => Promise<boolean>;
}

export interface InterventionSupportMaterialsProps {
  detail: TeacherInterventionDetail;
  page?: "overview" | "plan";
  previousResolved?: TeacherInterventionSummary;
  onAdjustSupport?: () => void;
}

const InterventionSupportMaterials = forwardRef<
  InterventionSupportMaterialsHandle,
  InterventionSupportMaterialsProps
>(function InterventionSupportMaterials(
  { detail, page = "overview", previousResolved, onAdjustSupport },
  ref
) {
  const toast = useToast();
  const {
    intervention_id: interventionId,
    subject_id: subjectId,
    subject_name: subjectName,
  } = detail;
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<SupportMaterial[]>([]);
  const [resources, setResources] = useState<RemediationResource[]>([]);
  const [focus, setFocus] = useState<RemediationFocus | null>(null);
  const [progress, setProgress] = useState<RemediationProgress | null>(null);
  const [originalExams, setOriginalExams] = useState<OriginalExamination[]>([]);
  const [plan, setPlan] = useState<RemediationPlan>({
    teacher_choice: null,
    grade_treatment: null,
    selected_resources: [],
    ai_suggestion: null,
  });
  const [reviewerDraft, setReviewerDraft] = useState<ReviewerDraft | null>(null);
  const [panel, setPanel] = useState<"" | "reviewer" | "materials" | "classworks">("");
  const [selectedActivityIds, setSelectedActivityIds] = useState<number[]>([]);
  const [lessonFilter, setLessonFilter] = useState("ALL");
  const [sampleChecked, setSampleChecked] = useState(false);
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);

  const setNotice = (message: string) => {
    if (message) toast.success({ title: message });
  };

  const load = async () => {
    setLoading(true);
    try {
      const [support, workspace] = await Promise.all([
        listSupportMaterials(interventionId),
        getRemediationWorkspace(interventionId),
      ]);
      setMaterials(support.items);
      setResources(workspace.resources);
      setPlan(workspace.plan);
      setFocus(workspace.focus);
      setProgress(workspace.progress);
      setOriginalExams(workspace.original_exams ?? []);
      const existingReviewer = support.items.find(
        (item) => item.kind === "STUDENT_REVIEWER"
      );
      setReviewerDraft(
        existingReviewer ? (existingReviewer.current_content as ReviewerDraft) : null
      );
    } catch (cause) {
      toast.error({
        title: "Unable to load support workspace",
        description:
          cause instanceof Error ? cause.message : "Unable to load support workspace.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [interventionId]);

  const reviewer = materials.find((item) => item.kind === "STUDENT_REVIEWER");
  const oldAssessment = materials.find((item) => item.kind === "REMEDIAL_ASSESSMENT");
  const oldDraft = oldAssessment?.current_content as RemedialDraft | undefined;
  const hasOldDraft = Boolean(
    oldDraft &&
    (oldDraft.title.trim() ||
      oldDraft.instructions.trim() ||
      oldDraft.questions.length)
  );
  const selected = useMemo(
    () => new Set(plan.selected_resources.map((item) => `${item.kind}:${item.id}`)),
    [plan]
  );
  const selectedResources = useMemo(
    () =>
      resources.filter(
        (item) => item.kind !== "LESSON" && selected.has(`${item.kind}:${item.id}`)
      ),
    [resources, selected]
  );
  const precise = resources.filter((item) => item.recommended);
  const evidenceSources = resources.filter(
    (item) => item.match_level === "SOURCE_ACTIVITY"
  );
  const manuallySelected = resources.filter(
    (item) =>
      item.kind !== "LESSON" &&
      selected.has(`${item.kind}:${item.id}`) &&
      !item.recommended &&
      item.match_level !== "SOURCE_ACTIVITY"
  );
  const manuallySelectedLessonsList = Array.from(
    new Set(
      manuallySelected
        .flatMap((item) => (item.lesson ? item.lesson.split(",").map((s) => s.trim()) : []))
        .filter(Boolean)
    )
  );
  const manuallySelectedLessons = manuallySelectedLessonsList.join(", ");
  const NO_LESSON = "__NO_LESSON__";
  const lessonKey = (item: RemediationResource) => item.lesson?.trim() || NO_LESSON;
  const materialPool = resources.filter(
    (item) => item.match_level !== "SOURCE_ACTIVITY" && item.kind !== "LESSON"
  );
  const lessonOptions = Array.from(new Set(materialPool.map(lessonKey)));
  const visible = materialPool.filter(
    (item) => lessonFilter === "ALL" || lessonKey(item) === lessonFilter
  );
  const groupedVisible = Array.from(
    visible.reduce((groups, item) => {
      const key = lessonKey(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
      return groups;
    }, new Map<string, RemediationResource[]>())
  );
  const treatmentActivities = useMemo(() => {
    if (!plan.grade_treatment) return [];
    const all = detail.diagnosis_snapshot.supporting_activities ?? [];
    if (plan.grade_treatment === "PRACTICE_ONLY") {
      return all;
    }
    const filtered = all.filter((a) => a.component === plan.grade_treatment);
    if (
      plan.grade_treatment === "EXAMINATION" &&
      filtered.length === 0 &&
      originalExams.length > 0
    ) {
      return originalExams.map((e) => ({
        classwork_id: e.assignment_id,
        title: e.title,
        component: "EXAMINATION",
        score: e.score,
        possible_score: e.total_points,
        percent: e.total_points > 0 ? (e.score / e.total_points) * 100 : 0,
      }));
    }
    return filtered;
  }, [detail.diagnosis_snapshot.supporting_activities, plan.grade_treatment, originalExams]);
  const chosenActivities = useMemo(() => {
    if (!plan.grade_treatment) return [];
    const selectedSet = new Set(selectedActivityIds);
    if (plan.grade_treatment === "EXAMINATION" && plan.original_exam_assignment_id != null) {
      selectedSet.add(plan.original_exam_assignment_id);
    }
    const matched: typeof treatmentActivities = [];
    for (const a of treatmentActivities) {
      const matchingExam = originalExams.find(
        (e) => e.title === a.title || e.assignment_id === a.classwork_id
      );
      if (
        selectedSet.has(a.classwork_id) ||
        (matchingExam && selectedSet.has(matchingExam.assignment_id))
      ) {
        matched.push(a);
      }
    }
    if (plan.grade_treatment === "EXAMINATION") {
      for (const exam of originalExams) {
        if (selectedSet.has(exam.assignment_id)) {
          if (!matched.some((m) => m.title === exam.title || m.classwork_id === exam.assignment_id)) {
            matched.push({
              classwork_id: exam.assignment_id,
              title: exam.title,
              component: "EXAMINATION",
              score: exam.score,
              possible_score: exam.total_points,
              percent: exam.total_points > 0 ? (exam.score / exam.total_points) * 100 : 0,
            });
          }
        }
      }
    }
    return matched;
  }, [
    plan.grade_treatment,
    plan.original_exam_assignment_id,
    selectedActivityIds,
    treatmentActivities,
    originalExams,
  ]);

  const toggleActivitySelection = (activity: (typeof treatmentActivities)[number]) => {
    const matchingExam = originalExams.find(
      (e) => e.title === activity.title || e.assignment_id === activity.classwork_id
    );
    const targetId = activity.classwork_id;
    const examTargetId = matchingExam?.assignment_id ?? targetId;

    setSelectedActivityIds((prev) => {
      const isAlreadySelected =
        prev.includes(targetId) ||
        (matchingExam && prev.includes(matchingExam.assignment_id)) ||
        (plan.grade_treatment === "EXAMINATION" &&
          plan.original_exam_assignment_id != null &&
          (plan.original_exam_assignment_id === targetId ||
            plan.original_exam_assignment_id === examTargetId));

      let next: number[];
      if (isAlreadySelected) {
        next = prev.filter(
          (id) => id !== targetId && (matchingExam ? id !== matchingExam.assignment_id : true)
        );
        if (
          plan.grade_treatment === "EXAMINATION" &&
          (plan.original_exam_assignment_id === targetId ||
            plan.original_exam_assignment_id === examTargetId)
        ) {
          const nextExam = originalExams.find((e) => next.includes(e.assignment_id));
          setPlan((current) => ({
            ...current,
            original_exam_assignment_id: nextExam?.assignment_id ?? (next[0] ?? null),
          }));
        }
      } else {
        next = [...prev, targetId];
        if (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id) {
          setPlan((current) => ({
            ...current,
            original_exam_assignment_id: examTargetId,
          }));
        }
      }
      return next;
    });
  };
  const assigned: NonNullable<RemediationProgress["assigned_remediation"]> =
    progress?.assigned_remediation ??
    progress?.completed_remediation.map((item) => ({
      ...item,
      component: null,
      is_graded: true,
      submission_status: "graded",
    })) ??
    [];
  const phase = progress?.completed_remediation.length
    ? "Monitoring"
    : assigned.some((item) => item.is_published !== false)
      ? "Assigned"
      : assigned.length
        ? "Draft Prepared"
        : plan.teacher_choice
          ? "Preparing Support"
          : "Needs Support";
  const hasSupportingResources = selectedResources.length > 0 || plan.selected_resources.length > 0;
  const hasRemediationActivity = assigned.length > 0;
  const hasConfiguredSupport = Boolean(hasSupportingResources && hasRemediationActivity);
  const focusName = focus?.component
    ? componentLabel(focus.component)
    : "Component unavailable";
  const sourceName =
    focus?.component === "EXAMINATION"
      ? focus.exam_subtype
        ? componentLabel(focus.exam_subtype)
        : "Subtype requires teacher confirmation"
      : null;
  const focusPercent = focus?.component
    ? detail.diagnosis_snapshot.components?.[focus.component]?.percent
    : null;


  const strongestEvidenceText =
    focus?.evidence_level === "QUESTION_SCORE"
      ? "Scored question-level competency evidence"
      : focus?.evidence_level === "SCORED_COMPETENCY"
        ? "Scored whole-activity competency evidence"
        : focus?.evidence_level === "ACTIVITY_COVERAGE"
          ? "Assessment coverage only · competencies are unranked"
          : "Component-level evidence only";

  const action = async (run: () => Promise<void>) => {
    setWorking(true);
    try {
      await run();
    } catch (cause) {
      toast.error({
        title: "Unable to save changes",
        description: cause instanceof Error ? cause.message : undefined,
      });
    } finally {
      setWorking(false);
    }
  };

  const saveAdjustments = async (): Promise<boolean> => {
    if (
      isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id))
    ) {
      const msg = "Choose a grade treatment and original Examination before continuing.";
      toast.error({ title: "Incomplete adjustment", description: msg });
      return false;
    }

    setWorking(true);
    try {
      const result = await saveRemediationPlan(interventionId, {
        teacher_choice: plan.teacher_choice,
        grade_treatment: plan.grade_treatment ?? null,
        ...(plan.grade_treatment === "EXAMINATION"
          ? { original_exam_assignment_id: plan.original_exam_assignment_id ?? null }
          : {}),
        selected_resources: plan.selected_resources,
      });
      setPlan(result.plan);
      setResources(result.resources);
      toast.success({ title: "Adjustments saved successfully." });
      return true;
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Unable to save adjustments.";
      toast.error({ title: "Unable to save adjustments", description: msg });
      return false;
    } finally {
      setWorking(false);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      saveAdjustments,
    }),
    [plan, interventionId]
  );

  const openTool = async () => {
    if (!plan.teacher_choice || plan.teacher_choice === "EXISTING_MATERIAL_ONLY") return;
    if (
      isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id))
    ) {
      toast.error({
        title: "Incomplete adjustment",
        description: "Choose a grade treatment and original Examination before continuing.",
      });
      return;
    }
    const saved = await saveAdjustments();
    if (!saved) return;
    const params = new URLSearchParams({
      remediation: plan.teacher_choice,
      subject_id: String(subjectId),
      intervention_id: String(interventionId),
    });
    if (plan.grade_treatment === "EXAMINATION" && plan.original_exam_assignment_id) {
      params.set(
        "original_exam_assignment_id",
        String(plan.original_exam_assignment_id)
      );
    }
    params.set(
      "title",
      plan.teacher_choice === "TOS"
        ? `${subjectName} remediation blueprint`
        : plan.teacher_choice === "QUIZ"
          ? `${subjectName} focused practice`
          : `${subjectName} remediation task`
    );
    if (isGraded(plan.teacher_choice)) {
      params.set(
        "instructions",
        "Review the Intervention evidence and selected planning references. Assign this activity only to the named student."
      );
    }
    navigate(
      `${plan.teacher_choice === "TOS" ? "/teacher/tos" : "/teacher/classworks"}?${params.toString()}`
    );
  };

  const requestAdvisory = () =>
    void action(async () => {
      const result = await generateRemediationAdvisory(interventionId);
      setPlan(result.plan);
      setNotice("AI advisory ready. Teacher choice remains final.");
    });

  const createReviewer = () =>
    void action(async () => {
      const made = await createSupportMaterial(interventionId, "STUDENT_REVIEWER");
      setMaterials((items) => [...items, made]);
      setReviewerDraft(made.current_content as ReviewerDraft);
      setNotice("Reviewer draft created.");
    });

  const generateReviewer = (materialId: SupportMaterial["material_id"]) =>
    void action(async () => {
      const made = await generateStudentReviewer(interventionId, materialId);
      setMaterials((items) =>
        items.map((item) => (item.material_id === made.material_id ? made : item))
      );
      setReviewerDraft(made.current_content as ReviewerDraft);
      setNotice("Reviewer generated.");
    });

  const saveReviewer = (
    materialId: SupportMaterial["material_id"],
    draft: ReviewerDraft
  ) =>
    void action(async () => {
      const saved = await saveSupportMaterial(interventionId, materialId, draft);
      setMaterials((items) =>
        items.map((item) => (item.material_id === saved.material_id ? saved : item))
      );
      setNotice("Reviewer draft saved.");
    });

  const sendReviewer = (materialId: SupportMaterial["material_id"]) =>
    void action(async () => {
      const sent = await sendStudentReviewer(interventionId, materialId);
      setMaterials((items) =>
        items.map((item) => (item.material_id === sent.material_id ? sent : item))
      );
      setNotice("Reviewer sent to this student.");
    });

  const toggleResource = (item: RemediationResource) => {
    const key = `${item.kind}:${item.id}`;
    const next = selected.has(key)
      ? plan.selected_resources.filter(
        (ref) => !(ref.kind === item.kind && ref.id === item.id)
      )
      : [...plan.selected_resources, { kind: item.kind, id: item.id }];
    setPlan((current) => ({ ...current, selected_resources: next }));
  };

  const continueDisabled =
    working ||
    (isGraded(plan.teacher_choice) &&
      (!plan.grade_treatment ||
        (plan.grade_treatment === "EXAMINATION" && !plan.original_exam_assignment_id)));

  return (
    <section className="flex flex-col gap-4" aria-label="Intervention workflow">
      <div className="flex flex-col gap-2">
        <Card className="w-full space-y-2 border-2 border-black bg-primary">
          <div className="flex items-start gap-4">
            <div className="flex flex-col mt-3 items-center h-full">
              <Avatar variant="student" className="size-14  shrink-0">
                <Avatar.Image
                  src="/avatars/student-avatars/1.svg"
                  alt={detail.student_name}
                />
                <Avatar.Fallback>
                  {(detail.student_name || "?").charAt(0).toUpperCase()}
                </Avatar.Fallback>
              </Avatar>
            </div>

            <div className="flex flex-col gap-1 w-full">
              <div className="flex flex-row justify-between w-full items-end">
                <h2 className="text-xl font-black -mb-1">{detail.student_name}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="solid" size="md">
                    Active
                  </Badge>
                  <Badge variant="outline" size="md">
                    {phase}
                  </Badge>
                </div>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
                <p className="text-sm">
                  Subject: <span className="text-base font-semibold">{subjectName}</span>
                </p>
                <p className="text-sm">
                  Class: <span className="text-base font-semibold">{detail.class_name}</span>
                </p>
                <p>
                  Trigger: <strong>{detail.triggering_predicted_grade.toFixed(2)}</strong>
                </p>
                <p>
                  Latest:{" "}
                  <strong>{progress?.latest_projection?.toFixed(2) ?? "Unavailable"}</strong>
                </p>
              </div>
            </div>
          </div>
        </Card>

        <p className="text-sm text-muted-foreground px-1">
          {progress?.status_reason ?? "Loading current progress."}
        </p>
      </div>

      {previousResolved && (
        <Card className="space-y-2 w-full border-2 border-border">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-base">Current support cycle</h3>
            <Badge variant="surface" size="sm">Active</Badge>
          </div>
          <p className="text-sm">
            A new below-threshold prediction opened this cycle after
            the previous Intervention resolved on{" "}
            <strong>
              {previousResolved.resolved_at
                ? date(previousResolved.resolved_at)
                : "a previous date"}
            </strong>
            . That resolution is past history.
          </p>
        </Card>
      )}

      {loading ? (
        <p>Loading Intervention workflow...</p>
      ) : (
        <>
          {page === "overview" && (
            <>
              <div className="flex flex-col gap-1">
                <h3 className="font-black">Academic Diagnosis</h3>
                <Card className="space-y-2 w-full mb-1">
                  <p className="text-base">
                    Support focus: <strong>{focusName}</strong>
                    <span className="text-sm text-muted-foreground ml-1">{sourceName ? `(${sourceName})` : ""}</span>
                  </p>
                  <p className="text-base">
                    Strongest available evidence: <strong>{strongestEvidenceText}</strong>
                  </p>
                  {focus?.evidence_level === "QUESTION_SCORE" && (
                    <>
                      <p className="text-base">
                        Scored competency focus:{" "}
                        {focus.competencies.map((item) => item.label).join("; ")}
                      </p>
                      {focus.question_evidence.map((item, index) => (
                        <p
                          key={`${item.quiz_question_id ?? "unknown"}-${index}`}
                          className="text-sm"
                        >
                          Question #{item.quiz_question_id ?? "unknown"}: {item.score}/
                          {item.possible_score}
                        </p>
                      ))}
                    </>
                  )}
                  {focus?.evidence_level === "SCORED_COMPETENCY" && (
                    <p className="text-base">
                      Scored competency focus:{" "}
                      {focus.competencies.map((item) => item.label).join("; ")}
                    </p>
                  )}
                  {focus?.evidence_level === "ACTIVITY_COVERAGE" && (
                    <p className="text-sm text-gray-600">
                      Covered competencies are study context. The assessment total does not
                      identify which one was difficult.
                    </p>
                  )}
                  {focusPercent != null && (
                    <p className="text-base">
                      Weakest component:{" "}
                      <strong>{focusName}{" "}</strong>
                      <span className="text-sm text-muted-foreground">({focusPercent.toFixed(0)}%)</span>
                    </p>
                  )}
                </Card>
                {focus?.evidence_level === "COMPONENT_ONLY" && (
                  <p className="text-sm text-muted-foreground px-1">
                    No specific lesson or competency weakness can be identified from the
                    available scored evidence.
                  </p>
                )}
              </div>

              {/* Prepared Support Plan */}
              <div className="flex flex-col gap-1">
                <div className="flex flex-row gap-2">
                  <h4 className="font-bold text-lg">Prepared Support Plan</h4>
                  <div className="flex items-center">
                    {hasConfiguredSupport ? (
                      <Badge variant="solid" size="sm">Configured</Badge>
                    ) : hasSupportingResources || hasRemediationActivity ? (
                      <Badge variant="surface" size="sm">Partially Configured</Badge>
                    ) : (
                      <Badge variant="outline" size="sm">Needs Setup</Badge>
                    )}
                  </div>
                </div>

                <Card className="flex flex-col gap-2">
                  <Card className="w-full p-1 flex flex-col gap-3">
                    {assigned.length > 0 ? (
                      <div className="space-y-3 text-base">
                        {assigned.map((item, idx) => {
                          const methodLabel = item.classwork_type
                            ? item.classwork_type === "QUIZ"
                              ? "Quiz"
                              : item.classwork_type === "ASSIGNMENT"
                                ? "Assignment"
                                : label(item.classwork_type)
                            : methods.find((m) => m.value === plan.teacher_choice)?.label ?? "Classwork";

                          const treatmentLabel = item.is_graded
                            ? item.component
                              ? `Count as ${componentLabel(item.component)}`
                              : "Graded"
                            : "Practice only · No official grade impact";

                          const examLabel = item.original_title
                            ? `${item.original_title}${item.exam_subtype ? ` · ${componentLabel(item.exam_subtype)}` : ""}`
                            : originalExams.find((e) => e.assignment_id === item.original_assignment_id)?.title ?? null;

                          return (
                            <div
                              key={item.assignment_id}
                              className={
                                idx > 0
                                  ? "pt-3 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-2"
                                  : "grid grid-cols-1 sm:grid-cols-2 gap-2"
                              }
                            >
                              <p>
                                Activity: <strong>{item.title}</strong>
                              </p>
                              <p>
                                Method: <strong>{methodLabel}</strong>
                              </p>
                              <p>
                                Grade treatment: <strong>{treatmentLabel}</strong>
                              </p>
                              {item.original_assignment_id && examLabel && (
                                <p className="col-span-full">
                                  Original Exam: <strong>{examLabel}</strong>
                                </p>
                              )}
                              <p className="col-span-full">
                                Recipient: <strong>This student only</strong>
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    ) : plan.teacher_choice ? (
                      <div className="space-y-2 text-base">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <p>
                            Method:{" "}
                            <strong>
                              {methods.find((item) => item.value === plan.teacher_choice)?.label}
                            </strong>
                          </p>
                          {isGraded(plan.teacher_choice) && (
                            <p>
                              Grade treatment:{" "}
                              <strong>
                                {plan.grade_treatment === "PRACTICE_ONLY"
                                  ? "Practice only · No official grade impact"
                                  : plan.grade_treatment
                                    ? `Count as ${componentLabel(plan.grade_treatment)}`
                                    : "Selection required"}
                              </strong>
                            </p>
                          )}
                          {plan.grade_treatment === "EXAMINATION" && (
                            <p className="col-span-full">
                              Original Exam:{" "}
                              <strong>
                                {originalExams.find(
                                  (exam) =>
                                    exam.assignment_id === plan.original_exam_assignment_id
                                )?.title ?? "Selection required"}
                              </strong>
                            </p>
                          )}
                          {isGraded(plan.teacher_choice) && (
                            <p className="col-span-full">
                              Recipient: <strong>This student only</strong>
                            </p>
                          )}
                          {plan.teacher_choice === "TOS" && (
                            <p className="text-muted-foreground">
                              TOS is a blueprint/export. It creates no graded student activity.
                            </p>
                          )}
                          {plan.teacher_choice === "EXISTING_MATERIAL_ONLY" && (
                            <p className="text-muted-foreground">
                              Selected materials remain planning references; they are not
                              privately delivered.
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No support method has been chosen yet. Click Add Intervention Activity below to plan one.
                      </p>
                    )}

                  </Card>

                  {/* Current Support */}
                  {assigned.length > 0 ? (
                    <div className="flex flex-col gap-2">
                      {assigned.map((item) => (
                        <div key={item.assignment_id} className="flex flex-col gap-1.5">
                          <ClassworkItemLine
                            className="border-2! shadow-none!"
                            size="sm"
                            item={{
                              classwork_id: item.classwork_id ?? item.assignment_id,
                              title: item.title,
                              classwork_type:
                                item.classwork_type ??
                                (plan.teacher_choice === "QUIZ" ? "QUIZ" : "ASSIGNMENT"),
                            }}
                            showPublicationStatus={false}
                            showCategory={false}
                            showType={false}
                            rightContent={
                              <div className="flex items-center gap-2">
                                {item.grade != null && item.total_points != null && (
                                  <span className="text-xs font-bold">
                                    {item.grade}
                                    <span className="font-medium text-muted-foreground text-xs">
                                      {" "}
                                      / {item.total_points}
                                    </span>
                                  </span>
                                )}
                                <Badge variant="surface" size="sm">
                                  {item.classwork_type ? label(item.classwork_type) : "Assignment"}
                                </Badge>
                                <Badge
                                  variant={
                                    item.submission_status === "graded"
                                      ? "solid"
                                      : item.is_published === false || item.submission_status === "draft"
                                        ? "secondary"
                                        : "outline"
                                  }
                                  size="sm"
                                >
                                  {item.is_published === false || item.submission_status === "draft"
                                    ? "Draft"
                                    : item.submission_status === "graded"
                                      ? "Completed"
                                      : label(item.submission_status || "Awaiting submission")}
                                </Badge>
                              </div>
                            }
                          />

                          {item.original_assignment_id && (
                            <div className="text-xs text-muted-foreground px-2 py-1 flex flex-wrap gap-x-3 gap-y-0.5">
                              <span>
                                Original: {item.original_title} ·{" "}
                                {componentLabel(item.exam_subtype || "Examination")}
                              </span>
                              <span>
                                Original: {item.original_grade ?? "—"}/{item.total_points ?? "—"}
                              </span>
                              <span>
                                Remedial: {item.grade ?? "Pending"}/{item.total_points ?? "—"}
                              </span>
                              <span>
                                Effective:{" "}
                                <strong>
                                  {item.effective_grade ?? "—"}/{item.total_points ?? "—"}
                                </strong>
                              </span>
                            </div>
                          )}
                        </div>
                      ))}

                      <Card className="border-2! w-full space-y-1.5 p-3 text-sm border-2 border-border">
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-sm">Official Academic Outcome</h4>
                          <Badge variant="outline" size="sm">{phase}</Badge>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm pt-1">
                          <p>
                            Trigger projection: <strong>{progress?.triggering_projection.toFixed(2)}</strong>
                          </p>
                          <p>
                            Latest projected grade:{" "}
                            <strong>{progress?.latest_projection?.toFixed(2) ?? "Unavailable"}</strong>
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                          {progress?.completed_remediation.length
                            ? "The student completed the support activity. "
                            : ""}
                          {progress?.status_reason} Completion alone does not resolve the Intervention.
                        </p>
                      </Card>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                        <Empty.Content>
                          <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                            <IconContainer className="bg-primary" size="sm">
                              <Activity className="size-8" />
                            </IconContainer>
                          </Empty.Icon>
                          <Empty.Title className="text-base!"></Empty.Title>
                          <Empty.Description className="text-sm text-muted-foreground">
                            No support activity has been recorded yet. Click Adjust Support below to configure learning resources and prepare remediation.
                          </Empty.Description>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={onAdjustSupport}
                            className="mt-1"
                          >
                            <Plus className="size-3.5 mr-1.5" />
                            Add Intervention Activity
                          </Button>
                        </Empty.Content>
                      </Empty>
                    </div>
                  )}

                  {/* <div className="flex items-center gap-2 text-base">
                    <span>Student Reviewer:</span>
                    <Badge
                      variant={
                        reviewer?.status === "SENT"
                          ? "solid"
                          : reviewer
                            ? "secondary"
                            : "outline"
                      }
                      size="sm"
                    >
                      {reviewer?.status === "SENT"
                        ? "Sent to student"
                        : reviewer
                          ? "Private draft"
                          : "Not prepared"}
                    </Badge>
                  </div> */}

                  <div className="flex flex-col text-base gap-2">
                    <span>Supporting Resources:</span>
                    {selectedResources.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {selectedResources.map((item) => (
                          <ClassworkItemLine
                            className="border-2! shadow-none!"
                            key={`${item.kind}:${item.id}`}
                            item={{
                              classwork_id: item.id,
                              title: item.title,
                              classwork_type: item.classwork_type ?? item.kind,
                            }}
                            showPublicationStatus={false}
                            showCategory={false}
                          />
                        ))}
                      </div>
                    ) : (
                      <Empty className="p-4 md:p-5 rounded!">
                        <Empty.Content>
                          <Empty.Title className="text-base!">No supporting resources</Empty.Title>
                          <Empty.Description className="text-sm">No supporting materials selected for the student to review before the remediation activity.</Empty.Description>
                        </Empty.Content>
                      </Empty>
                    )}
                  </div>
                </Card>
              </div>
            </>
          )}

          {page === "plan" && (
            <div className="flex flex-col w-full gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="font-black">Recommended Support</h3>
                <Card className="w-full">
                  <p className="text-base">
                    Evidence-based focus: <strong>{focusName}</strong>
                    <span className="text-sm text-muted-foreground ml-1">{sourceName ? `(${sourceName})` : ""}</span>

                  </p>
                  <p className="text-base">
                    {focus?.evidence_level === "COMPONENT_ONLY"
                      ? "General practice and teacher review are appropriate; no specific topic is established."
                      : "Use only the traceable scored or coverage context shown above."}
                  </p>
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={working}
                      onClick={requestAdvisory}
                    >
                      {plan.ai_suggestion ? "Refresh AI advisory" : "Get AI advisory"}
                    </Button>
                  </div>

                  {plan.ai_suggestion && (
                    <Card className="border-2 border-primary/40 bg-primary/10 p-3 space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="solid" size="sm">AI Advisory</Badge>
                        <strong className="font-bold">
                          {
                            methods.find(
                              (item) => item.value === plan.ai_suggestion?.recommended_format
                            )?.label
                          }
                        </strong>
                      </div>
                      <p>{plan.ai_suggestion.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        Format advice only. Diagnosis and grade treatment come from saved
                        evidence and teacher choice.
                      </p>
                    </Card>
                  )}
                </Card>
              </div>

              <div className="flex flex-col gap-1">
                <h3 className="font-black">Supporting Resources</h3>
                <Card className="w-full space-y-2.5">
                  {/* <p>
                  <strong>Student Reviewer</strong> · Optional study support ·{" "}
                  {reviewer?.status === "SENT"
                    ? "Sent to student"
                    : reviewer
                      ? "Private draft"
                      : "Not prepared"}
                </p>
                <p className="text-xs text-gray-600">
                  Grounded from: {focusName} component evidence. Specific competency
                  evidence: {focus?.competency_ids.length ? "Available" : "Unavailable"}.
                  The reviewer is not a grade or proof of improvement.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPanel("reviewer")}
                >
                  Open reviewer
                </Button> */}

                  <div className="flex flex-col gap-1">
                    <p className="text-base font-semibold">Recommended Review Materials</p>
                    <div className="flex flex-col gap-2">
                      {evidenceSources.map((item) => (
                        <ClassworkItemLine
                          key={`evidence:${item.kind}:${item.id}`}
                          className="border-2! shadow-none!"
                          size="sm"
                          item={{
                            classwork_id: item.id,
                            title: item.title,
                            classwork_type: item.classwork_type ?? item.kind,
                          }}
                          showPublicationStatus={false}
                          showCategory={false}
                        />
                      ))}
                    </div>
                  </div>
                  {precise.length ? (
                    <p className="text-sm px-1 -mt-1">
                      {precise.length} evidence-matched learning{" "}
                      {precise.length === 1 ? "resource" : "resources"} available.
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground px-1 -mt-1">
                      No precise lesson/material recommendation can be made from the
                      current component-level evidence.
                    </p>
                  )}

                  <div className="flex flex-col gap-1">
                    <p className="text-base font-semibold">Teacher Selected Materials</p>
                    {manuallySelected.length > 0 ? (
                      <>
                        <div className="flex flex-col gap-2">
                          {manuallySelected.map((item) => (
                            <ClassworkItemLine
                              size="sm"
                              key={`manual:${item.kind}:${item.id}`}
                              className="border-2! shadow-none!"
                              item={{
                                classwork_id: item.id,
                                title: item.title,
                                classwork_type: item.classwork_type ?? item.kind,
                              }}
                              showPublicationStatus={false}
                              showCategory={false}
                            />
                          ))}
                        </div>
                        <p className="text-sm text-muted-foreground px-1 -mt-1">
                          Materials are linked to {manuallySelectedLessons || "no"}{" "}
                          {manuallySelectedLessonsList.length === 1 ? "lesson" : "lessons"}.
                        </p>
                      </>
                    ) : (
                      <Empty className="p-4 md:p-5 rounded!">
                        <Empty.Content>
                          <Empty.Title className="text-base!">No materials selected</Empty.Title>
                          <Empty.Description className="text-sm">
                            No teacher-selected materials added yet. Click Select resources below to pick materials.
                          </Empty.Description>
                        </Empty.Content>
                      </Empty>
                    )}
                  </div>

                  <div className="flex w-full justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setPanel("materials")}
                    >
                      Select resources
                    </Button>
                  </div>
                </Card>
              </div>
              <Dialog
                open={panel === "reviewer"}
                onOpenChange={(open) => setPanel(open ? "reviewer" : "")}
              >
                <Dialog.Content size="md" className="max-h-[85vh]">
                  <Dialog.Header>
                    <div className="flex items-center gap-2">
                      <Dialog.Title className="text-lg font-bold">
                        Student Reviewer
                      </Dialog.Title>
                      {reviewer && (
                        <Badge
                          variant={reviewer.status === "SENT" ? "success" : "secondary"}
                          size="sm"
                        >
                          {reviewer.status === "SENT" ? "Sent" : "Draft"}
                        </Badge>
                      )}
                    </div>
                  </Dialog.Header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-5">
                    {!reviewer && (
                      <p className="text-sm text-muted-foreground">
                        No reviewer draft has been created yet.
                      </p>
                    )}
                    {reviewer && reviewerDraft && (
                      <>
                        {reviewer.status === "SENT" ? (
                          <div className="space-y-2">
                            <strong className="text-base font-bold">{reviewerDraft.title}</strong>
                            <p className="text-sm">{reviewerDraft.introduction}</p>
                            <div className="rounded border-2 border-border bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap">
                              {reviewerDraft.body}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="space-y-1.5">
                              <Label className="text-sm font-bold">Title</Label>
                              <Input
                                className="w-full"
                                value={reviewerDraft.title}
                                onChange={(event) =>
                                  setReviewerDraft({
                                    ...reviewerDraft,
                                    title: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-sm font-bold">Introduction</Label>
                              <textarea
                                className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none"
                                value={reviewerDraft.introduction}
                                onChange={(event) =>
                                  setReviewerDraft({
                                    ...reviewerDraft,
                                    introduction: event.target.value,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-sm font-bold">Review content</Label>
                              <textarea
                                rows={7}
                                className="w-full rounded-[var(--radius)]! border-2 border-border bg-background p-2.5 text-sm font-normal text-foreground shadow-md transition focus:border-black focus-visible:outline-none"
                                value={reviewerDraft.body}
                                onChange={(event) =>
                                  setReviewerDraft({
                                    ...reviewerDraft,
                                    body: event.target.value,
                                  })
                                }
                              />
                              <p className="text-xs text-muted-foreground">
                                Optional study support. The reviewer is not a grade or proof of
                                improvement.
                              </p>
                            </div>
                          </div>
                        )}

                        {reviewer.status === "DRAFT" && !reviewer.generated_content && (
                          <div className="flex justify-end w-full pt-2">
                            <Button
                              size="sm"
                              disabled={working}
                              variant="outline"
                              autoIcon={false}
                              onClick={() => generateReviewer(reviewer.material_id)}
                            >
                              Generate Reviewer
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button variant="outline" onClick={() => setPanel("")}>
                      Close
                    </Button>
                    {!reviewer && (
                      <Button disabled={working} onClick={createReviewer}>
                        Create reviewer draft
                      </Button>
                    )}
                    {reviewer && reviewerDraft && reviewer.status !== "SENT" && (
                      <>
                        <Button
                          variant="outline"
                          disabled={working}
                          onClick={() =>
                            saveReviewer(reviewer.material_id, reviewerDraft)
                          }
                        >
                          Save draft
                        </Button>
                        <Button
                          disabled={
                            working ||
                            JSON.stringify(reviewerDraft) !==
                            JSON.stringify(reviewer.current_content) ||
                            !reviewerDraft.title.trim() ||
                            !reviewerDraft.introduction.trim() ||
                            !reviewerDraft.body.trim()
                          }
                          onClick={() => sendReviewer(reviewer.material_id)}
                        >
                          Approve &amp; Send
                        </Button>
                      </>
                    )}
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>

              <Dialog
                open={panel === "materials"}
                onOpenChange={(open) => setPanel(open ? "materials" : "")}
              >
                <Dialog.Content size="md" className="max-h-[85vh]">
                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-bold">
                      Add Supporting Resources
                    </Dialog.Title>
                  </Dialog.Header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-4 pr-3">
                    <Field label="">
                      <Select value={lessonFilter} onValueChange={(val) => setLessonFilter(val)}>
                        <Select.Trigger className="w-full h-10">
                          <Select.Value placeholder="Filter by lesson" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="ALL">All Lessons</Select.Item>
                          {lessonOptions.map((lesson) => (
                            <Select.Item key={lesson} value={lesson}>
                              {lesson === NO_LESSON ? "No linked lesson" : lesson}
                            </Select.Item>
                          ))}
                        </Select.Content>
                      </Select>
                    </Field>
                    {visible.length ? (
                      <div className="flex flex-col gap-4">
                        <div className="flex flex-col gap-2 mb-2">
                          <p className="text-base font-semibold">(Recommended Lesson)</p>
                          <ClassworkItemLine
                            size="sm"
                            className={`border-2! shadow-none! ${sampleChecked ? "bg-primary!" : ""}`}
                            item={{
                              classwork_id: -1,
                              title: "Foundations & Guided Review Worksheet",
                              classwork_type: "ASSIGNMENT",
                            }}
                            showPublicationStatus={false}
                            showCategory={false}
                            showType={false}
                            onClick={() => setSampleChecked((prev) => !prev)}
                            rightContent={
                              <div className="flex items-center gap-2">
                                <Badge variant={sampleChecked ? "solid" : "surface"} size="sm">
                                  Assignment
                                </Badge>
                                <Checkbox
                                  checked={sampleChecked}
                                  variant="solid"
                                  className={`border-black transition-colors ${sampleChecked ? "bg-black text-white" : "bg-white text-black"}`}
                                  onClick={(e) => e.stopPropagation()}
                                  onCheckedChange={() => setSampleChecked((prev) => !prev)}
                                />
                              </div>
                            }
                          />
                          <p className="text-sm text-muted-foreground">
                            Recommended materials are automatically suggested based on student performance data and diagnostic evidence.
                          </p>
                        </div>


                        {groupedVisible.map(([lesson, items]) => (
                          <div key={lesson} className="flex flex-col gap-2">
                            <p className="text-sm font-bold">
                              {lesson === NO_LESSON ? "No linked lesson" : lesson}
                            </p>
                            {items.map((item) => {
                              const isChecked = selected.has(`${item.kind}:${item.id}`);
                              return (
                                <ClassworkItemLine
                                  key={`${item.kind}:${item.id}`}
                                  size="sm"
                                  className={`border-2! shadow-none! ${isChecked ? "bg-primary!" : ""}`}
                                  item={{
                                    classwork_id: item.id,
                                    title: item.title,
                                    classwork_type: item.classwork_type ?? item.kind,
                                  }}
                                  showPublicationStatus={false}
                                  showCategory={false}
                                  showType={false}
                                  onClick={() => !working && toggleResource(item)}
                                  rightContent={
                                    <div className="flex items-center gap-2">
                                      {(item.recommended || item.match_level === "SOURCE_ACTIVITY") && (
                                        <Badge
                                          variant={item.recommended ? "secondary" : "outline"}
                                          size="sm"
                                        >
                                          {item.recommended ? "Recommended" : "Related source"}
                                        </Badge>
                                      )}
                                      <Badge variant={`${isChecked ? "solid" : "surface"}`} size="sm">
                                        {toTitleCase(item.classwork_type)}
                                      </Badge>

                                      <Checkbox
                                        checked={isChecked}
                                        disabled={working}
                                        variant="solid"
                                        className={`border-black transition-colors ${isChecked ? "bg-black text-white" : "bg-white text-black"}`}
                                        onClick={(e) => e.stopPropagation()}
                                        onCheckedChange={() => toggleResource(item)}
                                      />
                                    </div>
                                  }
                                />
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Empty className="py-6 rounded!">
                        <Empty.Content>
                          <Empty.Description className="max-w-md text-sm">
                            No eligible materials match this lesson.
                          </Empty.Description>
                        </Empty.Content>
                      </Empty>
                    )}
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button onClick={() => setPanel("")}>Done</Button>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>

              <Dialog
                open={panel === "classworks"}
                onOpenChange={(open) => setPanel(open ? "classworks" : "")}
              >
                <Dialog.Content size="md" className="max-h-[85vh]">
                  <Dialog.Header>
                    <Dialog.Title className="text-lg font-bold">
                      Select Targeted Classwork
                    </Dialog.Title>
                  </Dialog.Header>
                  <div className="flex flex-col gap-4 overflow-y-auto p-4 pr-3">
                    <Card className="flex flex-row border-2! bg-primary p-3 w-full justify-between">
                      <label className="text-base font-semibold">
                        Projected Grade
                      </label>
                      <Badge variant="outline" size="sm">
                        93%
                      </Badge>

                    </Card>


                    <div className="flex flex-col gap-1">
                      <p className="text-base font-semibold">Recommended Target Classworks</p>
                      <ClassworkItemLine
                        size="sm"

                        className={`border-2! shadow-none! ${sampleChecked ? "bg-primary!" : ""}`}
                        item={{
                          classwork_id: -1,
                          title: "Foundations & Guided Review Worksheet",
                          classwork_type: "ASSIGNMENT",
                        }}
                        showPublicationStatus={false}
                        showCategory={false}
                        showType={false}
                        onClick={() => setSampleChecked((prev) => !prev)}
                        rightContent={
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold">
                              13
                              <span className="font-medium text-muted-foreground text-xs">
                                {" "}
                                / 30
                              </span>
                            </span>
                            <Badge
                              variant={
                                sampleChecked ? "solid" : "surface"
                              }
                              size="sm"
                            >
                              56%
                            </Badge>
                            <Checkbox
                              checked={sampleChecked}
                              variant="solid"
                              className={`border-black transition-colors ${sampleChecked ? "bg-black text-white" : "bg-white text-black"}`}
                              onClick={(e) => e.stopPropagation()}
                              onCheckedChange={() => setSampleChecked((prev) => !prev)}
                            />
                          </div>
                        }
                      />
                      <p className="text-sm text-muted-foreground">
                        Recommended classwork to improve projected grade.
                      </p>
                    </div>

                    <div className="flex flex-col gap-1 mb-2">
                      <p className="text-base font-semibold">Existing Student's Classwork</p>
                      {treatmentActivities.length > 0 ? (
                        <div className="flex flex-col gap-2">
                          {treatmentActivities.map((activity) => {
                            const resource = resources.find(
                              (r) =>
                                r.kind === "CLASSWORK" &&
                                (r.id === activity.classwork_id || r.title === activity.title)
                            );
                            const matchingExam = originalExams.find(
                              (e) =>
                                e.title === activity.title ||
                                e.assignment_id === activity.classwork_id
                            );
                            const isSelected =
                              selectedActivityIds.includes(activity.classwork_id) ||
                              (matchingExam && selectedActivityIds.includes(matchingExam.assignment_id)) ||
                              (plan.grade_treatment === "EXAMINATION" &&
                                matchingExam &&
                                plan.original_exam_assignment_id === matchingExam.assignment_id);

                            return (
                              <ClassworkItemLine
                                key={`modal-cw-${activity.classwork_id}-${activity.title}`}
                                className={`border-2! shadow-none! transition-all cursor-pointer ${isSelected
                                  ? "bg-primary!"
                                  : ""
                                  }`}
                                iconClassName={isSelected ? "bg-white" : undefined}
                                size="sm"
                                onClick={() => toggleActivitySelection(activity)}
                                item={{
                                  classwork_id: activity.classwork_id,
                                  title: activity.title,
                                  classwork_type:
                                    resource?.classwork_type ??
                                    (activity.component === "EXAMINATION" ? "QUIZ" : "ASSIGNMENT"),
                                }}
                                showPublicationStatus={false}
                                showCategory={false}
                                showType={false}
                                rightContent={
                                  <div className="flex items-center gap-2 shrink-0">
                                    {plan.grade_treatment === "PRACTICE_ONLY" && (
                                      <Badge variant="outline" size="sm">
                                        {componentLabel(activity.component)}
                                      </Badge>
                                    )}
                                    <span className="text-xs font-bold">
                                      {activity.score}
                                      <span className="font-medium text-muted-foreground text-xs">
                                        {" "}
                                        / {activity.possible_score}
                                      </span>
                                    </span>
                                    <Badge
                                      variant={
                                        activity.percent >= 80
                                          ? "success"
                                          : activity.percent >= 75
                                            ? "surface"
                                            : "destructive"
                                      }
                                      size="sm"
                                    >
                                      {activity.percent.toFixed(1)}%
                                    </Badge>

                                    <Checkbox
                                      checked={isSelected}
                                      variant="solid"
                                      className={`border-black transition-colors ${isSelected ? "bg-black text-white" : "bg-white text-black"}`}
                                      onClick={(e) => e.stopPropagation()}
                                      onCheckedChange={() => toggleActivitySelection(activity)}
                                    />
                                  </div>
                                }
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                          <Empty.Content>
                            <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                              <Activity className="size-8" />
                            </Empty.Icon>
                            <Empty.Title className="text-sm font-bold">
                              No classworks available
                            </Empty.Title>
                            <Empty.Description className="text-xs text-muted-foreground">
                              No scored{" "}
                              {plan.grade_treatment === "PRACTICE_ONLY"
                                ? "diagnostic"
                                : componentLabel(plan.grade_treatment).toLowerCase()}{" "}
                              classworks were found for this student.
                            </Empty.Description>
                          </Empty.Content>
                        </Empty>
                      )}
                    </div>
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button onClick={() => setPanel("")}>
                      Done
                    </Button>
                  </Dialog.Footer>
                </Dialog.Content>
              </Dialog>

              <div className="flex flex-col gap-1">
                <h3 className="font-black">Remediation Activity</h3>
                <Card className="flex flex-col gap-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {methods.map((method) => {
                      const isSelected = plan.teacher_choice === method.value;
                      return (
                        <Card
                          key={method.value}
                          className={`p-3 cursor-pointer border-2! transition-all ${isSelected
                            ? "border-primary bg-primary"
                            : "hover:bg-retro"
                            }`}
                          onClick={() => {
                            if (working) return;
                            setPlan((current) => ({
                              ...current,
                              teacher_choice: method.value,
                              grade_treatment: isGraded(method.value)
                                ? (current.grade_treatment ?? "PRACTICE_ONLY")
                                : null,
                            }));
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-base">{method.label}</span>
                            {isSelected && (
                              <Badge variant="solid" size="sm">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <p className={`text-sm mt-1 ${isSelected
                            ? "text-foreground"
                            : "text-muted-foreground"
                            }`}>
                            {method.detail}
                          </p>
                        </Card>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground px-1">
                    Select how you want to deliver remediation.
                  </p>

                  <div className="flex flex-col gap-1 mt-2">
                    <Label className="font-bold text-base">
                      Curated Classwork Activity
                    </Label>
                    {assigned.length > 0 ? (
                      <div className="flex flex-col gap-2">
                        {assigned.map((item) => (
                          <ClassworkItemLine
                            key={item.assignment_id}
                            className="border-2! shadow-none!"
                            size="sm"
                            item={{
                              classwork_id: item.classwork_id ?? item.assignment_id,
                              title: item.title,
                              classwork_type:
                                item.classwork_type ??
                                (plan.teacher_choice === "QUIZ" ? "QUIZ" : "ASSIGNMENT"),
                            }}
                            showPublicationStatus={false}
                            showCategory={false}
                            showType={false}
                            rightContent={
                              <div className="flex items-center gap-2">
                                {item.grade != null && item.total_points != null && (
                                  <span className="text-xs font-bold">
                                    {item.grade}
                                    <span className="font-medium text-muted-foreground text-xs">
                                      {" "}
                                      / {item.total_points}
                                    </span>
                                  </span>
                                )}
                                <Badge variant="surface" size="sm">
                                  {item.classwork_type ? label(item.classwork_type) : "Assignment"}
                                </Badge>
                                {item.submission_status && (
                                  <Badge
                                    variant={item.submission_status === "graded" ? "solid" : "outline"}
                                    size="sm"
                                  >
                                    {label(item.submission_status)}
                                  </Badge>
                                )}
                              </div>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                        <Empty.Content>
                          <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                            <IconContainer className="bg-primary" size="sm">
                              <Activity className="size-8" />
                            </IconContainer>
                          </Empty.Icon>
                          <Empty.Title className="text-xl! font-bold">
                            No activity created yet
                          </Empty.Title>
                          <Empty.Description className="text-sm whitespace-nowrap text-muted-foreground">
                            Configure your support method and continue to create the activity
                          </Empty.Description>
                        </Empty.Content>
                      </Empty>
                    )}

                    {plan.teacher_choice !== "EXISTING_MATERIAL_ONLY" && (
                      <div className="flex flex-row w-full justify-end mt-2">
                        <Button disabled={continueDisabled} onClick={openTool} size="sm" className="gap-2">
                          Continue to{" "}
                          {plan.teacher_choice === "QUIZ"
                            ? "Quiz Builder"
                            : plan.teacher_choice === "CLASSWORK"
                              ? "Classwork Creator"
                              : "TOS Generator"}
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              </div>

              {isGraded(plan.teacher_choice) && (
                <div className="flex flex-col gap-1">
                  <h3 className="font-black text-xl">Grade Treatment</h3>
                  <Card className="flex flex-col gap-3 border-2 bg-card">

                    <div className="flex flex-col gap-1">
                      <Label className="font-bold text-base">
                        How should this activity be treated?
                      </Label>
                      <div className={`grid grid-cols-1 gap-2 ${focus?.component === "EXAMINATION" ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                        {(["PRACTICE_ONLY", "WRITTEN_WORK", "PERFORMANCE_TASK"] as const).map(
                          (choice) => {
                            const isSelected = plan.grade_treatment === choice;
                            return (
                              <Card
                                key={choice}
                                className={`p-2.5 cursor-pointer border-2 transition-all border-2! text-sm font-semibold flex items-center justify-between ${isSelected
                                  ? "border-primary bg-primary"
                                  : "border-border "
                                  }`}
                                onClick={() => {
                                  if (working) return;
                                  setSelectedActivityIds([]);
                                  setPlan((current) => ({
                                    ...current,
                                    grade_treatment: choice,
                                    original_exam_assignment_id: null,
                                  }));
                                }}
                              >
                                <span>
                                  {choice === "PRACTICE_ONLY"
                                    ? "Ungraded Activity"
                                    : componentLabel(choice)}
                                </span>
                                <Checkbox
                                  checked={isSelected}
                                  variant="solid"
                                  className={`border-black transition-colors pointer-events-none ${isSelected ? "bg-black text-white" : "bg-white text-black"}`}
                                />
                              </Card>
                            );
                          }
                        )}
                        {focus?.component === "EXAMINATION" && (
                          <Card
                            className={`p-2.5 cursor-pointer border-2 transition-all border-2! text-sm font-semibold flex items-center justify-between ${plan.grade_treatment === "EXAMINATION"
                              ? "border-primary bg-primary"
                              : "border-border "
                              } ${originalExams.length === 0 ? "opacity-50 pointer-events-none" : ""}`}
                            onClick={() => {
                              if (working || originalExams.length === 0) return;
                              setSelectedActivityIds([]);
                              setPlan((current) => ({
                                ...current,
                                grade_treatment: "EXAMINATION",
                                original_exam_assignment_id: null,
                              }));
                            }}
                          >
                            <span>Remedial Exam</span>
                            <Checkbox
                              checked={plan.grade_treatment === "EXAMINATION"}
                              variant="solid"
                              className={`border-black transition-colors pointer-events-none ${plan.grade_treatment === "EXAMINATION" ? "bg-black text-white" : "bg-white text-black"}`}
                            />
                          </Card>
                        )}
                      </div>
                      {plan.grade_treatment && (
                        <p className="text-sm text-muted-foreground px-1">
                          {{
                            PRACTICE_ONLY:
                              "Ungraded Activity stores completion without changing grades.",
                            WRITTEN_WORK:
                              "Written Work adds a portion of the score to a classwork under the category.",
                            PERFORMANCE_TASK:
                              "Performance Task adds a portion of the score to a performance task under the category.",
                            EXAMINATION:
                              "Remedial Exam replaces the original assessment's effective score only when higher.",
                          }[plan.grade_treatment]}
                        </p>
                      )}
                    </div>

                    {focus?.component === "EXAMINATION" && originalExams.length === 0 && (
                      <Alert status="warning">
                        No scored original Examination is available for this student and
                        period.
                      </Alert>
                    )}

                    {plan.grade_treatment && plan.grade_treatment !== "PRACTICE_ONLY" && (
                      <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-base font-bold">
                            Targeted {componentLabel(plan.grade_treatment)} {chosenActivities.length > 1 ? "Classworks" : "Classwork"}
                          </Label>
                          {chosenActivities.length > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPanel("classworks")}
                            >
                              Reselect Activities
                            </Button>
                          )}
                        </div>
                        {chosenActivities.length > 0 ? (
                          <div className="flex flex-col gap-2">
                            {chosenActivities.map((chosenActivity) => (
                              <ClassworkItemLine
                                key={`chosen-cw-${chosenActivity.classwork_id}-${chosenActivity.title}`}
                                className="border-2! shadow-none!"
                                size="sm"
                                item={{
                                  classwork_id: chosenActivity.classwork_id,
                                  title: chosenActivity.title,
                                  classwork_type:
                                    resources.find(
                                      (r) =>
                                        r.kind === "CLASSWORK" &&
                                        (r.id === chosenActivity.classwork_id || r.title === chosenActivity.title)
                                    )?.classwork_type ??
                                    (chosenActivity.component === "EXAMINATION" ? "QUIZ" : "ASSIGNMENT"),
                                }}
                                showPublicationStatus={false}
                                showCategory={false}
                                showType={false}
                                rightContent={
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-xs font-bold">
                                      {chosenActivity.score}
                                      <span className="font-medium text-muted-foreground text-xs">
                                        {" "}
                                        / {chosenActivity.possible_score}
                                      </span>
                                    </span>
                                    <Badge
                                      variant={
                                        chosenActivity.percent >= 80
                                          ? "success"
                                          : chosenActivity.percent >= 75
                                            ? "surface"
                                            : "destructive"
                                      }
                                      size="sm"
                                    >
                                      {chosenActivity.percent.toFixed(1)}%
                                    </Badge>
                                    <Badge variant="solid" size="sm">
                                      Targeted
                                    </Badge>
                                  </div>
                                }
                              />
                            ))}
                          </div>
                        ) : (
                          <Empty className="w-full border-2 rounded! border-border bg-background p-4 shadow-none hover:shadow-none">
                            <Empty.Content>
                              <Empty.Icon className="size-8 text-muted-foreground flex items-center justify-center">
                                <IconContainer className="bg-primary" size={"sm"}>
                                  <Activity className="size-8" />
                                </IconContainer>
                              </Empty.Icon>
                              <Empty.Title className="text-xl! font-bold">
                                No classwork selected
                              </Empty.Title>
                              <Empty.Description className="text-sm whitespace-nowrap text-muted-foreground">
                                {treatmentActivities.length > 0
                                  ? `Select classwork from ${componentLabel(plan.grade_treatment)} to add score to`
                                  : `No scored ${componentLabel(plan.grade_treatment).toLowerCase()} classworks available for this student`}
                              </Empty.Description>
                              {treatmentActivities.length > 0 && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => setPanel("classworks")}
                                  className="mt-1"
                                >
                                  <Plus className="size-3.5 mr-1.5" />
                                  Select Classwork
                                </Button>
                              )}
                            </Empty.Content>
                          </Empty>
                        )}
                      </div>
                    )}

                    {!plan.grade_treatment && (
                      <Alert status="warning">
                        Choose practice only or an official grade component before
                        continuing.
                      </Alert>
                    )}
                  </Card>
                </div>
              )}

              {hasOldDraft && oldDraft && (
                <Accordion className="w-full">
                  <Accordion.Item
                    value="legacy-draft"
                    className="overflow-hidden rounded border-2 border-border bg-card shadow-sm"
                  >
                    <Accordion.Header className="items-center px-4 py-3 bg-card font-bold text-sm">
                      Previous / legacy support draft
                    </Accordion.Header>
                    <Accordion.Content className="space-y-3 p-4 border-t-2 border-border bg-background">
                      <p className="text-xs text-muted-foreground">
                        Preserved for reference. Use the existing authoring tool for new
                        support.
                      </p>
                      {oldDraft.title.trim() && (
                        <p className="font-bold text-sm">{oldDraft.title}</p>
                      )}
                      {oldDraft.instructions.trim() && (
                        <p className="text-sm">{oldDraft.instructions}</p>
                      )}
                      <Badge variant="outline" size="sm">
                        {oldDraft.questions.length} saved questions
                      </Badge>
                      <div className="space-y-2 pt-1">
                        {oldDraft.questions.map((question, index) => (
                          <Card key={index} className="space-y-1.5 p-3 text-sm">
                            <strong className="block text-sm">
                              {question.question_text || `Question ${index + 1}`}
                            </strong>
                            <div className="space-y-1 pl-2">
                              {question.options.map((option, optionIndex) => (
                                <div key={optionIndex} className="flex items-center gap-1.5 text-xs">
                                  <span>{option.option_text}</span>
                                  {option.is_correct && (
                                    <Badge variant="success" size="sm">
                                      Correct
                                    </Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                            {question.explanation && (
                              <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                                Explanation: {question.explanation}
                              </p>
                            )}
                          </Card>
                        ))}
                      </div>
                    </Accordion.Content>
                  </Accordion.Item>
                </Accordion>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
});

export default InterventionSupportMaterials;
