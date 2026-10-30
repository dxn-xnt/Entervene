import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/teacher/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import {
  TableProperties,
  Plus,
  Trash2,
  Search,
  MoreVertical,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { TOSGeneratorScreen } from "../subject-details/tos-generator-screen";
import type { CompetencyItem } from "../subject-details/types";
import { Text } from "@/components/retroui/Text";
import { Dialog } from "@/components/retroui/Dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getTeacherActive, getRemediationWorkspace, type RemediationFocus } from "@/lib/teacher-interventions-api";
import { formatDate } from "@/lib/classwork-utils";

interface SubjectOption {
  subject_id: number;
  subject_name: string;
  subject_codename?: string;
  section_name?: string;
}

interface AssignedSubjectResponse {
  subject_id?: number;
  subject_name?: string;
  subject_codename?: string;
  section_name?: string;
}

interface SavedTOSSummary {
  tos_exam_id: number;
  subject_id: number;
  subject_name?: string | null;
  title: string;
  quarter: string;
  status: string;
  total_items: number;
  question_count: number;
  created_at?: string;
  updated_at?: string;
}

export const TeacherTOSPage: React.FC = () => {
  const [routeParams, setRouteParams] = useSearchParams();
  const remediationSubject = routeParams.get("subject_id");
  const remediationInterventionId = Number(routeParams.get("intervention_id"));
  const [remediationFocus, setRemediationFocus] = useState<RemediationFocus | null>(null);
  const [remediationError, setRemediationError] = useState("");
  const [exams, setExams] = useState<SavedTOSSummary[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedSubjectFilter, setSelectedSubjectFilter] =
    useState<string>("ALL");
  const [selectedQuarterFilter, setSelectedQuarterFilter] = useState<
    "ALL" | "Term 1" | "Term 2" | "Term 3"
  >("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [examToDelete, setExamToDelete] = useState<SavedTOSSummary | null>(null);

  // Active Wizard Mode State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [activeSubject, setActiveSubject] = useState<{
    subject_id: number;
    subject_name: string;
  } | null>(null);
  const [activeCompetencies, setActiveCompetencies] = useState<
    CompetencyItem[]
  >([]);
  const [activeExamId, setActiveExamId] = useState<number | null>(null);
  const [isOpeningExam, setIsOpeningExam] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [examsRes, classesRes] = await Promise.all([
        apiFetch("/api/v1/tos/").catch(() => null),
        apiFetch("/api/v1/classwork-assignments/teacher/classes").catch(
          () => null,
        ),
      ]);

      if (examsRes && examsRes.ok) {
        const examsData = await examsRes.json();
        setExams(Array.isArray(examsData) ? examsData : []);
      }

      if (classesRes && classesRes.ok) {
        const classesData = await classesRes.json();
        const extracted: SubjectOption[] = [];
        const seen = new Set<number>();

        if (Array.isArray(classesData)) {
          classesData.forEach((item: AssignedSubjectResponse) => {
            const sId = item.subject_id;
            const sName = item.subject_name;
            if (sId && sName && !seen.has(sId)) {
              seen.add(sId);
              extracted.push({
                subject_id: sId,
                subject_name: sName,
                subject_codename: item.subject_codename,
                section_name: item.section_name,
              });
            }
          });
        }
        setSubjects(extracted);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (routeParams.get("remediation") !== "TOS") return;
    if (!Number.isInteger(remediationInterventionId) || remediationInterventionId <= 0) {
      setRemediationError("Open the TOS blueprint from an active Intervention.");
      return;
    }
    let live = true;
    void Promise.all([getTeacherActive(remediationInterventionId), getRemediationWorkspace(remediationInterventionId)])
      .then(([detail, workspace]) => {
        if (!live) return;
        if (workspace.plan.teacher_choice !== "TOS" || detail.subject_id !== Number(remediationSubject)) {
          setRemediationError("The saved Intervention support choice or subject has changed.");
          return;
        }
        setRemediationFocus(workspace.focus);
      })
      .catch((cause) => { if (live) setRemediationError(cause instanceof Error ? cause.message : "Unable to load Intervention focus."); });
    return () => { live = false; };
  }, [remediationInterventionId, remediationSubject, routeParams.get("remediation")]);

  useEffect(() => {
    if (routeParams.get("remediation") !== "TOS" || !subjects.length || !remediationFocus || remediationError) return;
    const subject = subjects.find((item) => item.subject_id === Number(remediationSubject));
    if (!subject) return;
    setActiveSubject(subject);
    setActiveCompetencies([]);
    setActiveExamId(null);
    setIsWizardOpen(true);
    const next = new URLSearchParams(routeParams);
    next.delete("remediation");
    setRouteParams(next, { replace: true });
  }, [subjects, remediationSubject, routeParams, setRouteParams, remediationFocus, remediationError]);

  const handleOpenExam = async (exam: SavedTOSSummary) => {
    setIsOpeningExam(true);
    try {
      const compRes = await apiFetch(
        `/api/v1/competencies/subject/${exam.subject_id}`,
      ).catch(() => null);
      let comps: CompetencyItem[] = [];
      if (compRes && compRes.ok) {
        const compData = await compRes.json();
        comps = Array.isArray(compData) ? compData : [];
      }

      const matchedSubject = subjects.find(
        (s) => s.subject_id === exam.subject_id,
      );
      setActiveSubject({
        subject_id: exam.subject_id,
        subject_name:
          exam.subject_name || matchedSubject?.subject_name || "Subject",
      });
      setActiveCompetencies(comps);
      setActiveExamId(exam.tos_exam_id);
      setIsWizardOpen(true);
    } catch {
      toast.error("Unable to load competencies for this exam.");
    } finally {
      setIsOpeningExam(false);
    }
  };

  const handleStartNewTOS = () => {
    setRemediationFocus(null);
    const targetSub =
      selectedSubjectFilter !== "ALL"
        ? subjects.find((s) => s.subject_id === Number(selectedSubjectFilter))
        : null;

    setActiveSubject(targetSub || null);
    setActiveCompetencies([]);
    setActiveExamId(null);
    setIsWizardOpen(true);
  };

  const handleDeleteExam = async () => {
    if (!examToDelete || deletingId !== null) return;
    const examId = examToDelete.tos_exam_id;
    setDeletingId(examId);
    try {
      const res = await apiFetch(`/api/v1/tos/${examId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setExams((prev) => prev.filter((ex) => ex.tos_exam_id !== examId));
      setExamToDelete(null);
      toast.success("TOS exam deleted.");
    } catch {
      toast.error("Failed to delete TOS exam.");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredExams = useMemo(() => {
    return (exams || []).filter((ex) => {
      if (
        selectedSubjectFilter !== "ALL" &&
        ex.subject_id !== Number(selectedSubjectFilter)
      ) {
        return false;
      }
      if (
        selectedQuarterFilter !== "ALL" &&
        ex.quarter !== selectedQuarterFilter
      ) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = (ex.title || "").toLowerCase().includes(q);
        const matchSub = (ex.subject_name || "").toLowerCase().includes(q);
        if (!matchTitle && !matchSub) return false;
      }
      return true;
    });
  }, [exams, selectedSubjectFilter, selectedQuarterFilter, searchQuery]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* Header matching other sidebar pages */}
            <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl md:text-4xl">
                  TOS Generator
                </h1>
              </div>

              <Button
                variant="default"
                size="header"
                onClick={handleStartNewTOS}
                className="shrink-0 whitespace-nowrap"
              >
                <Plus className="size-4" />
                <span>New TOS</span>
              </Button>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:px-4 sm:py-4 md:px-6">
              {remediationError && <p role="alert" className="rounded border p-3 text-sm text-red-700">{remediationError}</p>}
              {/* Filter Toolbar */}
              <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
                {/* Search Input */}
                <div className="relative min-w-0 flex-1 md:min-w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                  <Input
                    aria-label="Search exam or subject"
                    placeholder="Search exam or subject..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-10 w-full border-black pl-9 pr-3"
                  />
                </div>
                <div className="w-full md:w-72 md:shrink-0">
                  {/* Subject Filter Dropdown */}
                  <Select
                    value={selectedSubjectFilter}
                    onValueChange={setSelectedSubjectFilter}
                  >
                    <Select.Trigger aria-label="Filter by subject" className="h-10 w-full">
                      <Select.Value placeholder="All Assigned Subjects" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="ALL">All Assigned Subjects</Select.Item>
                      {subjects.map((subject) => (
                        <Select.Item
                          key={subject.subject_id}
                          value={String(subject.subject_id)}
                        >
                          {subject.subject_name}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </div>
              </div>
              {/* Academic Term Filter Chips */}
              <div className="flex flex-wrap items-center gap-2">
                <Text as="p" className="text-sm font-semibold">Terms:</Text>
                {(["ALL", "Term 1", "Term 2", "Term 3"] as const).map(
                  (qTab) => (
                    <Button
                      key={qTab}
                      type="button"
                      size="sm"
                      variant={selectedQuarterFilter === qTab ? "default" : "outline"}
                      autoIcon={false}
                      aria-pressed={selectedQuarterFilter === qTab}
                      onClick={() => setSelectedQuarterFilter(qTab)}
                      className="rounded px-3 text-xs font-bold"
                    >
                      {qTab === "ALL" ? "All Terms" : `${qTab}`}
                    </Button>
                  ),
                )}
              </div>

              {/* Exams Grid */}
              {isLoading || isOpeningExam ? (
                <div className="py-20 text-center">
                  <RefreshCw className="mx-auto h-8 w-8 animate-spin text-black" />
                  <p className="mt-3 text-xs font-black text-gray-700">
                    Loading Table of Specifications...
                  </p>
                </div>
              ) : filteredExams.length === 0 ? (
                <TeacherEmptyState
                  icon={<TableProperties />}
                  title={exams.length === 0 ? "No TOS Exams Found" : "No TOS exams match your filters"}
                  description={exams.length === 0
                    ? "Create your first Table of Specifications blueprint and exam questionnaire."
                    : "Try another search, subject, or term."}
                  action={exams.length === 0
                    ? { label: "Create New TOS", icon: <Plus size={16} />, onClick: handleStartNewTOS }
                    : { label: "Clear filters", onClick: () => {
                      setSearchQuery("");
                      setSelectedSubjectFilter("ALL");
                      setSelectedQuarterFilter("ALL");
                    } }}
                />
              ) : (
                <section className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredExams.map((ex) => {
                    const isFinalized = ex.status === "FINALIZED";

                    return (
                      <Card
                        key={ex.tos_exam_id}
                        className="flex h-full min-w-0 w-full flex-col"
                      >
                        <Card.Header className="flex-col items-stretch gap-2">
                          <div className="flex w-full items-start justify-between gap-2">
                            <Card.Title className="min-w-0 flex-1 break-words text-lg font-bold [overflow-wrap:anywhere]">
                              {ex.title}
                            </Card.Title>
                            <DropdownMenu>
                              <Tooltip>
                                <TooltipTrigger render={<span className="inline-flex shrink-0">
                                  <DropdownMenuTrigger asChild>
                                    <Button type="button" variant="secondary" size="sm" className="p-1 shadow-none" aria-label={`Actions for ${ex.title}`}>
                                      <MoreVertical className="size-4" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                </span>} />
                                <TooltipContent>Exam actions</TooltipContent>
                              </Tooltip>
                              <DropdownMenuContent align="end" className="z-50 min-w-[160px] rounded border-2 border-border bg-card p-1 text-xs font-semibold shadow-md">
                                <DropdownMenuItem className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded p-2 text-xs hover:bg-accent" onClick={() => handleOpenExam(ex)}>
                                  <Pencil className="size-4" /><span>Edit</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded p-2 text-xs text-destructive hover:bg-destructive/10" disabled={deletingId !== null} onClick={(event) => {
                                  event.stopPropagation();
                                  setExamToDelete(ex);
                                }}>
                                  <Trash2 className="size-4" /><span>Delete</span>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" size="sm">{ex.subject_name || "Subject"}</Badge>
                            <Badge variant="outline" size="sm">{ex.quarter}</Badge>
                            <Badge variant={isFinalized ? "solid" : "default"} size="sm">
                              {isFinalized ? "Finalized" : "Draft"}
                            </Badge>
                          </div>
                        </Card.Header>

                        <Card.Content className="mt-auto flex flex-col gap-3 pt-2">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">Target items</p>
                              <p className="font-bold text-foreground">{ex.total_items || "—"}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">AI questions</p>
                              <p className="font-bold text-foreground">{ex.question_count}</p>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {ex.created_at ? `Created ${formatDate(ex.created_at)}` : "Recently"}
                          </div>
                        </Card.Content>
                      </Card>
                    );
                  })}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={examToDelete !== null}
        onOpenChange={(open) => {
          if (!open && deletingId === null) setExamToDelete(null);
        }}
        title="Delete TOS"
        confirmationTitle={`Are you sure you want to delete "${examToDelete?.title ?? "this Table of Specifications"}"?`}
        description="This action cannot be undone."
        confirmLabel={deletingId !== null ? "Deleting..." : "Delete TOS"}
        confirmVariant="destructive"
        isLoading={deletingId !== null}
        onConfirm={handleDeleteExam}
      />
      <Dialog open={isWizardOpen} onOpenChange={(open) => {
        if (!open) {
          setIsWizardOpen(false);
          setRemediationFocus(null);
          setActiveSubject(null);
          setActiveExamId(null);
          void fetchData();
        }
      }}>
        {isWizardOpen && (
          <Dialog.Content size="3xl">
            <TOSGeneratorScreen
              modalMode
              initialTitle={routeParams.get("title") || undefined}
              subjectId={activeSubject?.subject_id ?? 0}
              subjectName={activeSubject?.subject_name ?? ""}
              competencies={activeCompetencies}
              remediationFocus={remediationFocus}
              initialExamId={activeExamId}
              initialStep={activeExamId ? "blueprint" : "test-parts"}
              parentLabel="TOS Generator"
              subjectsList={subjects}
              onBack={() => {
                setIsWizardOpen(false);
                setRemediationFocus(null);
                setActiveSubject(null);
                setActiveExamId(null);
                void fetchData();
              }}
            />
          </Dialog.Content>
        )}
      </Dialog>
    </AppLayout>
  );
};

export default TeacherTOSPage;
