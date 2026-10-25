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
import { Activity, Check, Plus, Search } from "lucide-react";
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

const date = (value: string) =>
  new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });

const methods: Array<{ value: RemediationFormat; label: string; detail: string }> = [
  { value: "QUIZ", label: "Quiz", detail: "Focused practice in the existing Quiz builder" },
  { value: "CLASSWORK", label: "Classwork", detail: "Targeted activity in the existing Classwork creator" },
  { value: "TOS", label: "TOS blueprint", detail: "Assessment blueprint and export only" },
  { value: "EXISTING_MATERIAL_ONLY", label: "Materials only", detail: "Planning references only, no new graded assessment" },
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
  const [browseAll, setBrowseAll] = useState(false);
  const [panel, setPanel] = useState<"" | "reviewer" | "materials">("");
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState("ALL");
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
    () => resources.filter((item) => selected.has(`${item.kind}:${item.id}`)),
    [resources, selected]
  );
  const precise = resources.filter((item) => item.recommended);
  const evidenceSources = resources.filter(
    (item) => item.match_level === "SOURCE_ACTIVITY"
  );
  const manuallySelected = resources.filter(
    (item) =>
      selected.has(`${item.kind}:${item.id}`) &&
      !item.recommended &&
      item.match_level !== "SOURCE_ACTIVITY"
  );
  const visible = resources.filter(
    (item) =>
      item.match_level !== "SOURCE_ACTIVITY" &&
      (browseAll || item.recommended) &&
      (kindFilter === "ALL" || item.kind === kindFilter) &&
      `${item.title} ${item.description} ${item.lesson}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
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
  const hasConfiguredSupport = Boolean(plan.teacher_choice || assigned.length > 0);
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
                        <Card
                          key={item.assignment_id}
                          className="border-2! p-3 text-sm space-y-1.5 w-full"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">{item.title}</span>
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
                          {item.grade != null && item.total_points != null && (
                            <p className="text-xs text-muted-foreground">
                              Score: <strong>{item.grade}/{item.total_points}</strong>
                            </p>
                          )}
                          <div className="text-xs text-muted-foreground pt-1 border-t border-border flex flex-wrap gap-x-3 gap-y-0.5">
                            <span>
                              Treatment:{" "}
                              <strong>
                                {item.is_graded
                                  ? plan.teacher_choice === "EXISTING_MATERIAL_ONLY"
                                    ? "Historical grade treatment"
                                    : `Count as ${componentLabel(item.component)}`
                                  : "Practice only · No official grade impact"}
                              </strong>
                            </span>
                            {item.original_assignment_id && (
                              <>
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
                              </>
                            )}
                          </div>
                        </Card>
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
                            <Activity className="size-8" />
                          </Empty.Icon>
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

                  <div className="flex items-center gap-2 text-base">
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
                  </div>

                  <div className="flex flex-col text-base gap-2">
                    <span>Supporting Resources:</span>
                    {selectedResources.length > 0 ? (
                      <Card className="">
                        {selectedResources.map((item) => item.title).join(", ")}
                      </Card>
                    ) : (
                      <span className="text-muted-foreground">None selected</span>
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
                    <p className="text-sm font-medium">Related evidence sources:</p>
                    <div className="flex flex-col gap-2">
                      {evidenceSources.map((item) => (
                        <Card
                          key={`evidence:${item.kind}:${item.id}`}
                          className="border-2! p-2.5 px-3 text-sm flex items-center justify-between gap-2 hover:bg-retro"
                        >
                          <strong className="font-bold">{item.title}</strong>
                        </Card>
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
                    <p className="text-sm font-medium">Teacher-selected:</p>
                    <div className="flex flex-col gap-2">
                      {manuallySelected.map((item) => (
                        <Card
                          key={`manual:${item.kind}:${item.id}`}
                          className="border-2! p-2.5 px-3 text-sm flex items-center justify-between gap-2 hover:bg-retro"
                        >
                          <strong className="font-bold">{item.title}</strong>
                        </Card>
                      ))}
                    </div>
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
                      {browseAll ? "All eligible materials" : "Recommended Materials"}
                    </Dialog.Title>
                  </Dialog.Header>
                  <div className="flex-1 space-y-3 overflow-y-auto p-5">

                    <div className="flex flex-col sm:flex-row gap-2">
                      <label className="relative min-w-0 flex-1 sm:min-w-48">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50 z-10" />
                        <Input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search materials..."
                          className="h-10 w-full border-black pl-9 pr-3"
                        />
                      </label>

                      <Select value={kindFilter} onValueChange={(val) => setKindFilter(val)}>
                        <Select.Trigger className="w-full sm:w-48 h-10">
                          <Select.Value placeholder="Filter type" />
                        </Select.Trigger>
                        <Select.Content>
                          <Select.Item value="ALL">All Materials</Select.Item>
                          <Select.Item value="LESSON">Lessons</Select.Item>
                          <Select.Item value="CLASSWORK">Classwork & Files</Select.Item>
                        </Select.Content>
                      </Select>
                    </div>
                    {visible.length ? (
                      <Card className="flex flex-col px-3 min-h-40">
                        {visible.map((item) => {
                          const isChecked = selected.has(`${item.kind}:${item.id}`);
                          return (
                            <Card
                              key={`${item.kind}:${item.id}`}
                              className={`flex items-start gap-3 p-3 transition-colors border-2! cursor-pointer border-2 ${isChecked
                                ? "border-primary bg-primary"
                                : "border-border hover:bg-retro"
                                }`}
                              onClick={() => !working && toggleResource(item)}
                            >
                              <Checkbox
                                checked={isChecked}
                                disabled={working}
                                variant="solid"
                                className={`mt-0.5 border-black transition-colors ${isChecked ? "bg-black text-white" : "bg-white text-black"
                                  }`}
                                onClick={(e) => e.stopPropagation()}
                                onCheckedChange={() => toggleResource(item)}
                              />
                              <div className="space-y-1 min-w-0 flex-1">
                                <div className="flex flex-wrap items-center justify-between gap-1.5">
                                  <strong className="text-sm font-bold">{item.title}</strong>

                                  {(item.recommended || item.match_level === "SOURCE_ACTIVITY") && (
                                    <Badge
                                      variant={item.recommended ? "secondary" : "outline"}
                                      size="sm"
                                    >
                                      {item.recommended ? "Recommended" : "Related source"}
                                    </Badge>
                                  )}

                                </div>
                                {item.match_reason && (
                                  <p className="text-xs text-foreground">{item.match_reason}</p>
                                )}
                              </div>
                            </Card>
                          );
                        })}
                      </Card>
                    ) : (
                      <Empty className="py-6 rounded!">
                        <Empty.Content>
                          <Empty.Description className="max-w-md text-sm">
                            {browseAll
                              ? "No eligible materials match this search."
                              : "No precise learning resources match this evidence. Browse all eligible materials for a teacher-selected reference."}
                          </Empty.Description>
                        </Empty.Content>
                      </Empty>
                    )}


                    <div className="flex flex-wrap w-full justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => setBrowseAll((current) => !current)}
                      >
                        {browseAll
                          ? "Show recommended materials"
                          : "Browse eligible materials"}
                      </Button>
                    </div>
                  </div>
                  <Dialog.Footer className="mt-0">
                    <Button onClick={() => setPanel("")}>Done</Button>
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
                    Select how you want to deliver remediation. Graded methods allow grade treatment configuration in the next step.
                  </p>
                </Card>
              </div>

              {plan.teacher_choice && (
                <Card className="space-y-3 border-2">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <h3 className="font-black text-base">Prepared support</h3>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <p>Target: <strong>{detail.student_name}</strong></p>
                    <p>
                      Support focus: <strong>{focusName}</strong>
                      <p className="ml-1.5 text-muted-foreground text-sm">({sourceName})</p>
                    </p>
                    <p>
                      Method:{" "}
                      <Badge variant="outline" size="sm">
                        {methods.find((item) => item.value === plan.teacher_choice)?.label}
                      </Badge>
                    </p>
                    {isGraded(plan.teacher_choice) && (
                      <p>
                        Grade treatment:{" "}
                        <Badge variant="secondary" size="sm">
                          {plan.grade_treatment === "PRACTICE_ONLY"
                            ? "Practice only"
                            : plan.grade_treatment
                              ? componentLabel(plan.grade_treatment)
                              : "Selection required"}
                        </Badge>
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
                      <p className="col-span-full text-xs text-muted-foreground">
                        Recipient: <strong>This student only</strong>
                      </p>
                    )}
                  </div>
                  {plan.teacher_choice === "TOS" && (
                    <p className="text-xs text-muted-foreground">
                      TOS is a blueprint/export. It creates no graded student activity.
                    </p>
                  )}
                  {plan.teacher_choice === "EXISTING_MATERIAL_ONLY" && (
                    <p className="text-xs text-muted-foreground">
                      Selected materials remain planning references; they are not
                      privately delivered.
                    </p>
                  )}
                  {plan.teacher_choice !== "EXISTING_MATERIAL_ONLY" && (
                    <div className="pt-2">
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
                </Card>
              )}

              {isGraded(plan.teacher_choice) && (
                <div className="flex flex-col gap-1">
                  <h3 className="font-black text-xl">Grade Treatment</h3>
                  <Card className="space-y-3 border-2 bg-card">
                    {focus?.component === "EXAMINATION" && (
                      <p className="text-xs text-muted-foreground">
                        Select the student's scored original Examination. Its subtype and
                        maximum points will be fixed for the remedial assessment.
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Practice only stores completion without changing grades. Written
                      Work and Performance Task add a new activity in that component.
                      Remedial Examination replaces the original assessment's effective
                      score only when higher.
                    </p>
                    <div className="space-y-2">
                      <Label className="font-bold text-sm">
                        How should this activity be treated?
                      </Label>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {(["PRACTICE_ONLY", "WRITTEN_WORK", "PERFORMANCE_TASK"] as const).map(
                          (choice) => {
                            const isSelected = plan.grade_treatment === choice;
                            return (
                              <Card
                                key={choice}
                                className={`p-2.5 cursor-pointer border-2 transition-all border-2! text-xs font-semibold flex items-center justify-between ${isSelected
                                  ? "border-primary bg-primary"
                                  : "border-border hover:bg-muted/40"
                                  }`}
                                onClick={() => {
                                  if (working) return;
                                  setPlan((current) => ({
                                    ...current,
                                    grade_treatment: choice,
                                    original_exam_assignment_id: null,
                                  }));
                                }}
                              >
                                <span>
                                  {choice === "PRACTICE_ONLY"
                                    ? "Practice only"
                                    : componentLabel(choice)}
                                </span>
                                {isSelected && (
                                  <Badge variant="solid" size="sm">
                                    <Check className="size-3.5 stroke-[3]" />
                                  </Badge>
                                )}
                              </Card>
                            );
                          }
                        )}
                      </div>
                      {focus?.component === "EXAMINATION" && (
                        <Card
                          className={`p-2.5 cursor-pointer border-2 transition-all text-xs font-semibold flex items-center justify-between ${plan.grade_treatment === "EXAMINATION"
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-muted/40"
                            } ${originalExams.length === 0 ? "opacity-50 pointer-events-none" : ""}`}
                          onClick={() => {
                            if (working || originalExams.length === 0) return;
                            setPlan((current) => ({
                              ...current,
                              grade_treatment: "EXAMINATION",
                              original_exam_assignment_id:
                                (
                                  originalExams.find(
                                    (exam) => exam.subtype === focus.exam_subtype
                                  ) ?? originalExams[0]
                                )?.assignment_id ?? null,
                            }));
                          }}
                        >
                          <span>Remedial Examination · Higher score counts</span>
                          {plan.grade_treatment === "EXAMINATION" && (
                            <Badge variant="solid" size="sm">
                              <Check className="size-3.5 stroke-[3]" />
                            </Badge>
                          )}
                        </Card>
                      )}
                    </div>

                    {focus?.component === "EXAMINATION" && originalExams.length === 0 && (
                      <Alert status="warning">
                        No scored original Examination is available for this student and
                        period.
                      </Alert>
                    )}

                    {plan.grade_treatment === "EXAMINATION" && (
                      <div className="space-y-1.5 pt-1">
                        <Label className="text-sm font-bold">Original Examination</Label>
                        <Select
                          value={plan.original_exam_assignment_id != null ? String(plan.original_exam_assignment_id) : ""}
                          onValueChange={(val) => {
                            if (val) {
                              setPlan((current) => ({
                                ...current,
                                original_exam_assignment_id: Number(val),
                              }));
                            }
                          }}
                          disabled={working}
                        >
                          <Select.Trigger className="w-full h-10">
                            <Select.Value placeholder="Select original examination..." />
                          </Select.Trigger>
                          <Select.Content>
                            {originalExams.map((exam) => (
                              <Select.Item key={exam.assignment_id} value={String(exam.assignment_id)}>
                                {exam.title} · {componentLabel(exam.subtype)} · {exam.score}/{exam.total_points}
                              </Select.Item>
                            ))}
                          </Select.Content>
                        </Select>
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
