import React, { useEffect, useMemo, useState } from "react";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Input } from "@/components/retroui/Input";
import { Select } from "@/components/retroui/Select";
import {
  TableProperties,
  Plus,
  Trash2,
  Search,
  BookOpen,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { toast } from "sonner";
import { TOSGeneratorScreen } from "../Classes/subject-details/TOSGeneratorScreen";
import type { CompetencyItem } from "../Classes/subject-details/types";

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
    const targetSub =
      selectedSubjectFilter !== "ALL"
        ? subjects.find((s) => s.subject_id === Number(selectedSubjectFilter))
        : null;

    setActiveSubject(targetSub || null);
    setActiveCompetencies([]);
    setActiveExamId(null);
    setIsWizardOpen(true);
  };

  const handleDeleteExam = async (e: React.MouseEvent, examId: number) => {
    e.stopPropagation();
    if (
      !window.confirm(
        "Are you sure you want to delete this Table of Specifications?",
      )
    )
      return;

    setDeletingId(examId);
    try {
      const res = await apiFetch(`/api/v1/tos/${examId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setExams((prev) => prev.filter((ex) => ex.tos_exam_id !== examId));
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

  // If in wizard mode, render TOSGeneratorScreen full-width
  if (isWizardOpen) {
    return (
      <AppLayout>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
              <TOSGeneratorScreen
                subjectId={activeSubject?.subject_id ?? 0}
                subjectName={activeSubject?.subject_name ?? ""}
                competencies={activeCompetencies}
                initialExamId={activeExamId}
                initialStep={activeExamId ? "blueprint" : "test-parts"}
                parentLabel="TOS Generator"
                subjectsList={subjects}
                onBack={() => {
                  setIsWizardOpen(false);
                  setActiveSubject(null);
                  setActiveExamId(null);
                  fetchData();
                }}
              />
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            {/* Header matching other sidebar pages */}
            <header className="flex items-center justify-between gap-3 bg-background py-4 px-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-2xl md:text-4xl font-bold tracking-tight">
                  TOS Generator
                </h1>
              </div>

              <Button
                variant="default"
                size="md"
                onClick={handleStartNewTOS}
                className="gap-2"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">New TOS</span>
                <span className="sm:hidden">+</span>
              </Button>
            </header>

            <div className="border-t-2 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-3">
              {/* Filter Toolbar */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between rounded-lg border-2 border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Subject Filter Dropdown */}
                  <div className="w-full sm:w-auto">
                    <Select
                      value={selectedSubjectFilter}
                      onValueChange={setSelectedSubjectFilter}
                    >
                      <Select.Trigger className="h-9 w-full text-xs font-black sm:w-52">
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

                  {/* Academic Term Filter Chips */}
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {(["ALL", "Term 1", "Term 2", "Term 3"] as const).map(
                      (qTab) => (
                        <button
                          key={qTab}
                          type="button"
                          onClick={() => setSelectedQuarterFilter(qTab)}
                          className={`px-3 py-1 text-xs font-black rounded border-2 transition-all ${selectedQuarterFilter === qTab
                              ? "border-black bg-[#FFD54F] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                              : "border-transparent bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                        >
                          {qTab === "ALL" ? "All Terms" : `${qTab}`}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                {/* Search Input */}
                <div className="relative w-full md:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="Search exam or subject..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full pl-8 text-xs font-bold border-2 border-black"
                  />
                </div>
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
                <Card className="block w-full border-black text-center">
                  <Card.Content className="flex flex-col items-center px-6 py-12">
                    <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg border-2 border-black">
                      <TableProperties className="size-7" />
                    </div>

                    <Card.Title className="mb-2 text-base font-bold">
                      No TOS Exams Found
                    </Card.Title>

                    <p className="mb-6 max-w-md text-sm font-normal text-gray-500">
                      {exams.length === 0
                        ? "Create your first Table of Specifications blueprint and exam questionnaire."
                        : "No exam matches the selected filters."}
                    </p>

                    <Button
                      variant="default"
                      size="md"
                      onClick={handleStartNewTOS}
                      className="gap-2"
                    >
                      <Plus size={16} />
                      <span>Create New TOS</span>
                    </Button>
                  </Card.Content>
                </Card>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredExams.map((ex) => {
                    const isFinalized = ex.status === "FINALIZED";

                    return (
                      <div
                        key={ex.tos_exam_id}
                        className="flex flex-col justify-between rounded-lg border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                      >
                        <div>
                          {/* Top Badges */}
                          <div className="flex items-center justify-between gap-2 border-b border-black/10 pb-2.5">
                            <Badge
                              variant="outline"
                              className="border-black bg-[#E3F2FD] text-blue-950 font-black text-[10px]"
                            >
                              <BookOpen className="mr-1 h-3 w-3" />{" "}
                              {ex.subject_name || "Subject"}
                            </Badge>
                            <div className="flex items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className="border-black bg-amber-100 font-black text-[10px]"
                              >
                                {ex.quarter}
                              </Badge>
                              <Badge
                                variant="outline"
                                className={`border-black font-black text-[10px] ${isFinalized
                                    ? "bg-emerald-100 text-emerald-900"
                                    : "bg-gray-100 text-gray-700"
                                  }`}
                              >
                                {isFinalized ? "FINALIZED" : "DRAFT"}
                              </Badge>
                            </div>
                          </div>

                          {/* Title */}
                          <h4 className="mt-3 text-sm font-black text-black leading-snug line-clamp-2">
                            {ex.title}
                          </h4>

                          {/* Metrics */}
                          <div className="mt-3.5 grid grid-cols-2 gap-2 rounded border border-black/20 bg-gray-50/80 p-2.5 text-center">
                            <div>
                              <p className="text-[10px] font-bold text-gray-500 uppercase">
                                Target Items
                              </p>
                              <p className="text-sm font-black text-black">
                                {ex.total_items || "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-500 uppercase">
                                AI Questions
                              </p>
                              <p className="text-sm font-black text-blue-700">
                                {ex.question_count}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Bottom Toolbar */}
                        <div className="mt-4 flex items-center justify-between border-t border-black/10 pt-3">
                          <span className="text-[11px] font-semibold text-gray-400">
                            {ex.updated_at
                              ? new Date(ex.updated_at).toLocaleDateString()
                              : "Recently"}
                          </span>

                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => handleDeleteExam(e, ex.tos_exam_id)}
                              disabled={deletingId === ex.tos_exam_id}
                              className="h-7 border-2 border-black bg-red-50 px-2 text-red-700 hover:bg-red-100"
                              title="Delete Exam"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleOpenExam(ex)}
                              className="h-7 border-2 border-black bg-[#FFD54F] px-3 text-xs font-black text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                            >
                              Open Exam <ArrowRight className="ml-1 h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default TeacherTOSPage;
