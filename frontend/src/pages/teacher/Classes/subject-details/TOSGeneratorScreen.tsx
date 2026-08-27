import { useState, useEffect, useMemo } from "react";
import {
  TableProperties,
  Sparkles,
  FileDown,
  Plus,
  Trash2,
  RefreshCw,
  Edit3,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Save,
  FileText,
  Check,
  Search,
  Clock,
} from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Input } from "@/components/retroui/Input";
import { Badge } from "@/components/retroui/Badge";
import { Switch } from "@/components/retroui/Switch";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { apiFetch } from "@/lib/api";
import type { CompetencyItem } from "./types";
import {
  computeTOS,
  validateTOS,
  validateTOSRow,
  buildBloomSummary,
  type TestPart,
  type TestPartType,
  type TOSCompetencyInput,
  type TOSDifficultyRatio,
  type TOSDraft,
  type TOSRow,
  type CognitiveLevel,
  type DifficultyBand,
} from "@/lib/tos-calculator";
import {
  exportTosBlueprintPdf,
  exportTosBlueprintDocx,
  exportTosExamPdf,
  exportTosExamDocx,
  type TOSExportQuestion,
} from "@/lib/tos-export";

export interface TOSGeneratorScreenProps {
  subjectId?: number;
  subjectName?: string;
  competencies?: CompetencyItem[];
  initialExamId?: number | null;
  initialStep?: WizardStep;
  parentLabel?: string;
  subjectsList?: Array<{ subject_id: number; subject_name: string; section_name?: string }>;
  onBack: () => void;
}

type WizardStep =
  | "saved-list"
  | "test-parts"
  | "competencies"
  | "difficulty"
  | "blueprint"
  | "ai-review"
  | "export";

export function TOSGeneratorScreen({
  subjectId = 0,
  subjectName = "",
  competencies = [],
  initialExamId,
  initialStep,
  parentLabel,
  subjectsList,
  onBack,
}: TOSGeneratorScreenProps) {
  // Default entry point: initialStep or "test-parts" when creating new, "blueprint" when loading existing
  const [step, setStep] = useState<WizardStep>(
    initialStep || (initialExamId ? "blueprint" : "test-parts")
  );
  const [currentSubjectId, setCurrentSubjectId] = useState<number>(subjectId);
  const [currentSubjectName, setCurrentSubjectName] = useState<string>(subjectName);
  const [availableSubjects, setAvailableSubjects] = useState<
    Array<{ subject_id: number; subject_name: string; section_name?: string }>
  >(subjectsList || []);
  const [language, setLanguage] = useState<"English" | "Filipino">("English");
  const [loadedCompetencies, setLoadedCompetencies] = useState<CompetencyItem[]>(competencies);

  const [examId, setExamId] = useState<number | null>(null);
  const [savedExams, setSavedExams] = useState<Array<any>>([]);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [examFilterQuarter, setExamFilterQuarter] = useState<string>("ALL");
  const [examSearchQuery, setExamSearchQuery] = useState<string>("");
  const [deletingExamId, setDeletingExamId] = useState<number | null>(null);

  // Step 1: Exam Info & Test Parts
  const [title, setTitle] = useState("Summative Assessment 1");
  const [quarter, setQuarter] = useState("Term 1");
  const [testParts, setTestParts] = useState<TestPart[]>([
    { type: "MULTIPLE_CHOICE", count: 15 },
  ]);

  // Step 2: Competency inputs
  const [compInputs, setCompInputs] = useState<TOSCompetencyInput[]>([]);

  // Step 3: Difficulty Ratio (DepEd 60/30/10)
  const [difficultyRatio, setDifficultyRatio] = useState<{
    easy: number;
    average: number;
    difficult: number;
  }>({
    easy: 60,
    average: 30,
    difficult: 10,
  });

  // Step 4: Computed Blueprint Rows & Overrides
  const [rows, setRows] = useState<TOSRow[]>([]);
  const [grandTotal, setGrandTotal] = useState<TOSRow | null>(null);

  // Step 5: AI Questions & Inline Edit
  const [questions, setQuestions] = useState<TOSExportQuestion[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState("");
  const [generationError, setGenerationError] = useState("");

  const [editingQuestionIdx, setEditingQuestionIdx] = useState<number | null>(null);
  const [editQuestionForm, setEditQuestionForm] = useState<TOSExportQuestion | null>(null);
  const [regeneratingIdx, setRegeneratingIdx] = useState<number | null>(null);

  // Step 6: Export settings
  const [includeAnswerKey, setIncludeAnswerKey] = useState(true);
  const [isExporting, setIsExporting] = useState<"blueprint-pdf" | "blueprint-docx" | "exam-pdf" | "exam-docx" | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState("");

  // Fetch available subjects list if not passed from parent
  useEffect(() => {
    if (availableSubjects.length === 0) {
      apiFetch("/api/v1/classwork-assignments/teacher/classes")
        .then((res) => (res.ok ? res.json() : []))
        .then((classesData) => {
          if (Array.isArray(classesData)) {
            const extracted: Array<{ subject_id: number; subject_name: string; section_name?: string }> = [];
            const seen = new Set<number>();
            classesData.forEach((item: any) => {
              const sId = item.subject_id;
              const sName = item.subject_name;
              if (sId && sName && !seen.has(sId)) {
                seen.add(sId);
                extracted.push({
                  subject_id: sId,
                  subject_name: sName,
                  section_name: item.section_name,
                });
              }
            });
            if (extracted.length > 0) {
              setAvailableSubjects(extracted);
            }
          }
        })
        .catch(() => {});
    }
  }, [availableSubjects.length]);

  // Keep subject in sync if prop changes
  useEffect(() => {
    if (subjectId && subjectId !== currentSubjectId) {
      setCurrentSubjectId(subjectId);
      setCurrentSubjectName(subjectName || "");
    }
  }, [subjectId, subjectName]);

  // Initialize competencies and load exams list
  useEffect(() => {
    if (competencies && competencies.length > 0) {
      setLoadedCompetencies(competencies);
      const initial = competencies.map((c) => ({
        competency_id: c.competency_id,
        label: c.statement,
        code: c.competency_code || undefined,
        days: c.target_hours ? Math.max(1, Math.round(c.target_hours / 4)) : 2,
        is_adhoc: false,
      }));
      setCompInputs(initial);
    } else if (currentSubjectId) {
      apiFetch(`/api/v1/competencies/subject/${currentSubjectId}`)
        .then((res) => (res.ok ? res.json() : []))
        .then((compData: CompetencyItem[]) => {
          if (Array.isArray(compData) && compData.length > 0) {
            setLoadedCompetencies(compData);
            setCompInputs(
              compData.map((c) => ({
                competency_id: c.competency_id,
                label: c.statement,
                code: c.competency_code || undefined,
                days: c.target_hours ? Math.max(1, Math.round(c.target_hours / 4)) : 2,
                is_adhoc: false,
              }))
            );
          } else {
            setLoadedCompetencies([]);
            setCompInputs([]);
          }
        })
        .catch(() => {
          setLoadedCompetencies([]);
          setCompInputs([]);
        });
    } else {
      setLoadedCompetencies([]);
      setCompInputs([]);
    }
    if (initialExamId) {
      handleLoadExam(initialExamId);
    } else if (currentSubjectId) {
      loadSavedExams();
    }
  }, [competencies, currentSubjectId, initialExamId]);

  const availableCompetencies = useMemo(() => {
    return (loadedCompetencies || []).filter(
      (c) => !compInputs.some((input) => input.competency_id === c.competency_id)
    );
  }, [loadedCompetencies, compInputs]);

  const handleSelectCompetency = (compIdStr: string) => {
    if (!compIdStr) return;
    const compId = Number(compIdStr);
    const targetComp = (loadedCompetencies || []).find((c) => c.competency_id === compId);
    if (!targetComp) return;

    setCompInputs((prev) => [
      ...prev,
      {
        competency_id: targetComp.competency_id,
        code: targetComp.competency_code || undefined,
        label: targetComp.statement,
        days: targetComp.target_hours ? Math.max(1, Math.round(targetComp.target_hours / 4)) : 2,
        is_adhoc: false,
      },
    ]);
  };

  const loadSavedExams = async () => {
    if (!currentSubjectId) return;
    setIsLoadingSaved(true);
    try {
      const res = await apiFetch(`/api/v1/tos/subject/${currentSubjectId}`);
      if (res.ok) {
        const data = await res.json();
        setSavedExams(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.error("Failed to load saved TOS exams", e);
    } finally {
      setIsLoadingSaved(false);
    }
  };

  const handleSubjectChange = async (newSubjectIdNum: number) => {
    if (!newSubjectIdNum) {
      setCurrentSubjectId(0);
      setCurrentSubjectName("");
      setLoadedCompetencies([]);
      setCompInputs([]);
      return;
    }
    const targetSub = availableSubjects.find((s) => s.subject_id === newSubjectIdNum);
    setCurrentSubjectId(newSubjectIdNum);
    if (targetSub) {
      setCurrentSubjectName(targetSub.subject_name);
    }
    try {
      const compRes = await apiFetch(`/api/v1/competencies/subject/${newSubjectIdNum}`);
      if (compRes.ok) {
        const compData = (await compRes.json()) as CompetencyItem[];
        setLoadedCompetencies(compData);
        if (compData.length > 0) {
          setCompInputs(
            compData.map((c) => ({
              competency_id: c.competency_id,
              label: c.statement,
              code: c.competency_code || undefined,
              days: c.target_hours ? Math.max(1, Math.round(c.target_hours / 4)) : 2,
              is_adhoc: false,
            }))
          );
        } else {
          setCompInputs([
            { label: "Unit 1: Core Concepts and Foundations", code: "LC-01", days: 3, is_adhoc: true },
            { label: "Unit 2: Practical Applications and Problem Solving", code: "LC-02", days: 4, is_adhoc: true },
          ]);
        }
      }
    } catch (err) {
      console.error("Failed to load competencies for selected subject", err);
    }
  };

  const startNewExam = () => {
    setExamId(null);
    setTitle(`Summative Assessment ${savedExams.length + 1}`);
    setQuarter("Term 1");
    setTestParts([{ type: "MULTIPLE_CHOICE", count: 15 }]);
    setLanguage("English");
    if (!subjectId) {
      setCurrentSubjectId(0);
      setCurrentSubjectName("");
      setLoadedCompetencies([]);
      setCompInputs([]);
    } else if (loadedCompetencies && loadedCompetencies.length > 0) {
      setCompInputs(
        loadedCompetencies.map((c) => ({
          competency_id: c.competency_id,
          label: c.statement,
          code: c.competency_code || undefined,
          days: c.target_hours ? Math.max(1, Math.round(c.target_hours / 4)) : 2,
        }))
      );
    } else {
      setCompInputs([]);
    }
    setDifficultyRatio({ easy: 60, average: 30, difficult: 10 });
    setRows([]);
    setGrandTotal(null);
    setQuestions([]);
    setStep("test-parts");
  };

  const totalItems = useMemo(() => {
    return testParts.reduce((sum, p) => sum + (p.count || 0), 0);
  }, [testParts]);

  const totalDays = useMemo(() => {
    return compInputs.reduce((sum, c) => sum + (c.days || 0), 0);
  }, [compInputs]);

  const ratioDecimal: TOSDifficultyRatio = useMemo(() => {
    const sum = (difficultyRatio.easy || 0) + (difficultyRatio.average || 0) + (difficultyRatio.difficult || 0);
    if (sum === 0) return { easy: 0.6, average: 0.3, difficult: 0.1 };
    return {
      easy: difficultyRatio.easy / sum,
      average: difficultyRatio.average / sum,
      difficult: difficultyRatio.difficult / sum,
    };
  }, [difficultyRatio]);

  const handleRecalculate = () => {
    const computed = computeTOS({
      subject_id: currentSubjectId,
      subject_name: currentSubjectName,
      title,
      quarter,
      test_parts: testParts,
      total_items: totalItems,
      competencies: compInputs,
      difficulty_ratio: ratioDecimal,
    });
    setRows(computed.rows);
    setGrandTotal(computed.grand_total);
  };

  useEffect(() => {
    if (step === "blueprint" && rows.length === 0) {
      handleRecalculate();
    }
  }, [step]);

  const handleLoadExam = async (savedId: number) => {
    try {
      const res = await apiFetch(`/api/v1/tos/${savedId}`);
      if (!res.ok) throw new Error("Failed to load exam details");
      const exam = await res.json();
      if (exam) {
        setExamId(exam.tos_exam_id);
        setTitle(exam.title || "TOS Exam");
        setQuarter(exam.quarter || "Term 1");
        if (exam.subject_id) {
          setCurrentSubjectId(exam.subject_id);
          const matched = availableSubjects.find((s) => s.subject_id === exam.subject_id);
          if (matched) setCurrentSubjectName(matched.subject_name);
        }
        if (exam.difficulty_ratio?.language) {
          setLanguage(exam.difficulty_ratio.language as "English" | "Filipino");
        }
        setTestParts(exam.test_parts || [{ type: "MULTIPLE_CHOICE", count: 15 }]);
        setCompInputs(exam.competencies || []);
        if (exam.difficulty_ratio) {
          setDifficultyRatio({
            easy: exam.difficulty_ratio.easy ? Math.round(exam.difficulty_ratio.easy * 100) : 60,
            average: exam.difficulty_ratio.average ? Math.round(exam.difficulty_ratio.average * 100) : 30,
            difficult: exam.difficulty_ratio.difficult ? Math.round(exam.difficulty_ratio.difficult * 100) : 10,
          });
        }
        const loadedQuestions = exam.questions || [];
        setQuestions(loadedQuestions);

        const computed = computeTOS({
          subject_id: exam.subject_id || currentSubjectId,
          subject_name: exam.subject_name || currentSubjectName,
          title: exam.title,
          quarter: exam.quarter,
          test_parts: exam.test_parts || [{ type: "MULTIPLE_CHOICE", count: 15 }],
          total_items: (exam.test_parts || []).reduce((s: number, p: any) => s + (p.count || 0), 0),
          competencies: exam.competencies || [],
          difficulty_ratio: exam.difficulty_ratio || { easy: 0.6, average: 0.3, difficult: 0.1 },
        });
        setRows(computed.rows);
        setGrandTotal(computed.grand_total);

        // Resume at the appropriate wizard step
        if (loadedQuestions.length > 0) {
          setStep("ai-review");
        } else if (computed.rows.length > 0) {
          setStep("blueprint");
        } else {
          setStep("test-parts");
        }
      }
    } catch (e) {
      console.error("Failed to load exam details", e);
    }
  };

  const handleDeleteExam = async (savedId: number) => {
    if (!confirm("Are you sure you want to delete this Table of Specifications draft?")) return;
    setDeletingExamId(savedId);
    try {
      const res = await apiFetch(`/api/v1/tos/${savedId}`, { method: "DELETE" });
      if (res.ok) {
        setSavedExams((prev) => prev.filter((e) => e.tos_exam_id !== savedId));
        if (examId === savedId) {
          setExamId(null);
        }
      }
    } catch (e) {
      console.error("Failed to delete exam", e);
    } finally {
      setDeletingExamId(null);
    }
  };

  const handleSaveDraft = async () => {
    setIsSaving(true);
    setSaveSuccessMsg("");
    try {
      const payload = {
        title,
        quarter,
        status: questions.length > 0 ? "FINALIZED" : "DRAFT",
        test_parts: testParts,
        competencies: compInputs,
        difficulty_ratio: {
          ...ratioDecimal,
          language: language,
        },
        questions: questions.map((q, idx) => ({
          competency_id: (q as any).competency_id || null,
          competency_label: q.competency_label || "General",
          question_text: q.question_text,
          question_type: q.question_type,
          difficulty_band: q.difficulty_band || "EASY",
          cognitive_level: q.cognitive_level || "REMEMBER",
          display_order: q.display_order || idx + 1,
          points: q.points || 1.0,
          explanation: q.explanation || null,
          options: (q.options || []).map((o, oIdx) => ({
            option_text: o.option_text,
            is_correct: !!o.is_correct,
            option_order: o.option_order || oIdx + 1,
          })),
        })),
      };

      let res: Response;
      if (examId) {
        res = await apiFetch(`/api/v1/tos/${examId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await apiFetch(`/api/v1/tos/subject/${currentSubjectId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || "Failed to save TOS Exam.");
      }

      const result = await res.json();
      if (result?.tos_exam_id) {
        setExamId(result.tos_exam_id);
      }
      setSaveSuccessMsg("TOS Exam saved successfully!");
      loadSavedExams();
      setTimeout(() => setSaveSuccessMsg(""), 4000);
    } catch (e: any) {
      console.error("Failed to save exam", e);
      alert(e.message || "Failed to save TOS Exam.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateQuestions = async () => {
    setIsGenerating(true);
    setGenerationError("");
    setGenerationProgress("Preparing blueprint payload for AI assessment specialist...");

    try {
      const rowRequests = rows.map((r) => ({
        competency_id: r.competency_id || null,
        label: r.label,
        code: r.code || null,
        type_counts: r.type_counts,
        bloom_targets: {
          REMEMBER: r.remember,
          UNDERSTAND: r.understand,
          APPLY: r.apply,
          ANALYZE: r.analyze,
          EVALUATE: r.evaluate,
          CREATE: r.create_,
        },
      }));

      setGenerationProgress(`Calling AI engine (${language}) for ${totalItems} question(s) across ${rows.length} competency row(s)...`);

      const res = await apiFetch("/api/v1/ai/generate-tos-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: currentSubjectId,
          subject_name: currentSubjectName,
          language: language,
          rows: rowRequests,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || "AI question generation failed. Please retry.");
      }

      const response = (await res.json()) as { questions: TOSExportQuestion[]; warnings: string[] };

      if (response && response.questions) {
        setQuestions(response.questions);
        setStep("ai-review");
      }
    } catch (e: any) {
      console.error("AI Question generation failed", e);
      setGenerationError(e.message || "AI question generation failed. Please retry.");
    } finally {
      setIsGenerating(false);
      setGenerationProgress("");
    }
  };

  const handleRegenerateQuestion = async (index: number) => {
    const targetQ = questions[index];
    if (!targetQ) return;
    setRegeneratingIdx(index);

    try {
      const res = await apiFetch("/api/v1/ai/generate-tos-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_id: currentSubjectId,
          subject_name: currentSubjectName,
          language: language,
          rows: [
            {
              competency_id: (targetQ as any).competency_id || null,
              label: targetQ.competency_label || "Topic",
              type_counts: { [targetQ.question_type]: 1 },
              bloom_targets: { [targetQ.cognitive_level || "REMEMBER"]: 1 },
            },
          ],
        }),
      });

      if (!res.ok) throw new Error("AI single question generation failed");

      const resData = (await res.json()) as { questions: TOSExportQuestion[] };
      if (resData && resData.questions && resData.questions[0]) {
        const updated = [...questions];
        updated[index] = {
          ...resData.questions[0],
          display_order: targetQ.display_order || index + 1,
        };
        setQuestions(updated);
      }
    } catch (e: any) {
      alert("Failed to regenerate single question: " + (e.message || "AI Error"));
    } finally {
      setRegeneratingIdx(null);
    }
  };

  const fullDraft: TOSDraft | null = useMemo(() => {
    if (!grandTotal || rows.length === 0) return null;
    return {
      subject_id: currentSubjectId,
      subject_name: currentSubjectName,
      title,
      quarter,
      test_parts: testParts,
      total_items: totalItems,
      competencies: compInputs,
      difficulty_ratio: ratioDecimal,
      rows,
      grand_total: grandTotal,
    };
  }, [currentSubjectId, currentSubjectName, title, quarter, testParts, totalItems, compInputs, ratioDecimal, rows, grandTotal]);

  const draftValidation = useMemo(() => {
    if (!fullDraft) return { valid: false, errors: [] };
    return validateTOS(fullDraft);
  }, [fullDraft]);

  const handleCellEdit = (
    rowIdx: number,
    field: "remember" | "understand" | "apply" | "analyze" | "evaluate" | "create_",
    val: number
  ) => {
    const nextRows = [...rows];
    const targetRow = { ...nextRows[rowIdx], [field]: Math.max(0, val) };

    targetRow.easy = targetRow.remember + targetRow.understand;
    targetRow.average = targetRow.apply + targetRow.analyze;
    targetRow.difficult = targetRow.evaluate + targetRow.create_;
    targetRow.reconciled_band_total = targetRow.easy + targetRow.average + targetRow.difficult;
    nextRows[rowIdx] = targetRow;
    setRows(nextRows);

    if (grandTotal) {
      setGrandTotal({
        ...grandTotal,
        easy: nextRows.reduce((s, r) => s + r.easy, 0),
        average: nextRows.reduce((s, r) => s + r.average, 0),
        difficult: nextRows.reduce((s, r) => s + r.difficult, 0),
        remember: nextRows.reduce((s, r) => s + r.remember, 0),
        understand: nextRows.reduce((s, r) => s + r.understand, 0),
        apply: nextRows.reduce((s, r) => s + r.apply, 0),
        analyze: nextRows.reduce((s, r) => s + r.analyze, 0),
        evaluate: nextRows.reduce((s, r) => s + r.evaluate, 0),
        create_: nextRows.reduce((s, r) => s + r.create_, 0),
      });
    }
  };

  const groupedQuestions = useMemo(() => {
    const map = new Map<string, { label: string; questions: Array<{ q: TOSExportQuestion; globalIdx: number }> }>();
    questions.forEach((q, idx) => {
      const key = q.competency_label || "General Assessment";
      if (!map.has(key)) {
        map.set(key, { label: key, questions: [] });
      }
      map.get(key)!.questions.push({ q, globalIdx: idx });
    });
    return Array.from(map.values());
  }, [questions]);

  const filteredSavedExams = useMemo(() => {
    return savedExams.filter((ex) => {
      const matchesQuarter = examFilterQuarter === "ALL" || ex.quarter === examFilterQuarter;
      const matchesSearch =
        !examSearchQuery ||
        ex.title?.toLowerCase().includes(examSearchQuery.toLowerCase()) ||
        ex.quarter?.toLowerCase().includes(examSearchQuery.toLowerCase());
      return matchesQuarter && matchesSearch;
    });
  }, [savedExams, examFilterQuarter, examSearchQuery]);

  return (
    <div className="flex flex-col gap-5">
      {/* ── Breadcrumb & Action Header ── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Breadcrumb>
          <Breadcrumb.List className="flex items-center gap-2 text-xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-black [&_a]:!text-muted-foreground [&_a]:!text-inherit [&_a]:!font-inherit [&_button]:!text-muted-foreground [&_button]:!text-inherit [&_button]:!font-inherit [&_[aria-current=page]]:!text-black [&_[aria-current=page]]:!text-inherit [&_[aria-current=page]]:!font-extrabold">
            <Breadcrumb.Item>
              <Breadcrumb.Link onClick={onBack} className="cursor-pointer hover:text-black">
                {parentLabel || (currentSubjectName || "TOS Generator")}
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator />
            <Breadcrumb.Item>
              <Breadcrumb.Page>
                {step === "saved-list" ? "My TOS Exams" : (title || "New Assessment Blueprint")}
              </Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>

        <div className="flex items-center gap-2 flex-wrap">
          {step === "saved-list" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onBack}
                className="border-2 border-black bg-white font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-100"
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to {parentLabel || (currentSubjectName || "TOS Generator")}
              </Button>
              <Button
                size="sm"
                onClick={startNewExam}
                className="border-2 border-black bg-[#FFD54F] font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
              >
                <Plus className="mr-1.5 h-4 w-4" /> New TOS
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onBack}
                className="border-2 border-black bg-white font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-100"
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to {parentLabel || "TOS Exams"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={isSaving}
                onClick={handleSaveDraft}
                className="border-2 border-black bg-[#C8E6C9] text-xs font-bold hover:bg-[#A5D6A7] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <Save className="mr-1 h-3.5 w-3.5" />
                {isSaving ? "Saving..." : "Save Draft"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="-mx-4 md:-mx-6 border-b-2 border-black" />

      {/* ── Main Container (Full-Width, No Sidebar Inside Wizard) ── */}
      <div className="rounded-lg border-2 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] overflow-hidden">
        {/* Top Banner */}
        <div className="flex flex-col gap-2 border-b-2 border-black bg-[#E3F2FD] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
              <TableProperties className="h-5 w-5 text-black" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-black">
                {step === "saved-list" ? "My TOS Exams" : "Table of Specifications (TOS) Generator"}
              </h2>
              <p className="text-xs font-semibold text-gray-700">
                {currentSubjectName
                  ? `${currentSubjectName} • ${step === "saved-list" ? "Assessment Blueprint & Question Archive" : `${quarter} Assessment Blueprint & AI Exam Creator (${language})`}`
                  : `Select subject curriculum & configure ${quarter} blueprint (${language})`}
              </p>
            </div>
          </div>
          {saveSuccessMsg && (
            <span className="text-xs font-bold text-green-800 bg-green-100 border border-green-700 rounded px-2.5 py-1">
              {saveSuccessMsg}
            </span>
          )}
        </div>

        {/* Stepper Navigation (Only shown when inside wizard steps) */}
        {step !== "saved-list" && (
          <div className="flex items-center justify-between border-b-2 border-black bg-[#FFF9C4] px-6 py-2.5 text-xs font-bold">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setStep("test-parts")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${step === "test-parts" ? "border border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "text-gray-600 hover:text-black"}`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">1</span>
                Test Parts
              </button>
              <span className="text-gray-400">→</span>
              <button
                onClick={() => setStep("competencies")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${step === "competencies" ? "border border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "text-gray-600 hover:text-black"}`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">2</span>
                Competencies
              </button>
              <span className="text-gray-400">→</span>
              <button
                onClick={() => setStep("difficulty")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${step === "difficulty" ? "border border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "text-gray-600 hover:text-black"}`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">3</span>
                Difficulty
              </button>
              <span className="text-gray-400">→</span>
              <button
                onClick={() => {
                  handleRecalculate();
                  setStep("blueprint");
                }}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${step === "blueprint" ? "border border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "text-gray-600 hover:text-black"}`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">4</span>
                Blueprint Table
              </button>
              <span className="text-gray-400">→</span>
              <button
                disabled={rows.length === 0}
                onClick={() => setStep("ai-review")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${step === "ai-review" ? "border border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "text-gray-600 hover:text-black"} disabled:opacity-40`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">5</span>
                Questions ({questions.length})
              </button>
              <span className="text-gray-400">→</span>
              <button
                disabled={questions.length === 0}
                onClick={() => setStep("export")}
                className={`flex items-center gap-1.5 rounded px-2.5 py-1 ${step === "export" ? "border border-black bg-[#FFD54F] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "text-gray-600 hover:text-black"} disabled:opacity-40`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-black text-[10px] text-white">6</span>
                Export
              </button>
            </div>

            <Badge variant="outline" className="border-black bg-white font-bold">
              Total Target Items: {totalItems}
            </Badge>
          </div>
        )}

        {/* Screen Content Body */}
        <div className="p-6">
          {/* ══════════════════════════════════════════════════════════════════
              LANDING PAGE: MY TOS EXAMS ARCHIVE
             ══════════════════════════════════════════════════════════════════ */}
          {step === "saved-list" && (
            <div className="space-y-6">
              {/* Filter & Action Toolbar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b-2 border-black pb-4">
                {/* Academic Term Tabs */}
                <div className="flex items-center gap-1.5 overflow-x-auto">
                  {(["ALL", "Term 1", "Term 2", "Term 3"] as const).map((qTab) => (
                    <button
                      key={qTab}
                      type="button"
                      onClick={() => setExamFilterQuarter(qTab)}
                      className={`px-3 py-1 text-xs font-black rounded border-2 transition-all ${examFilterQuarter === qTab
                          ? "border-black bg-[#FFD54F] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                          : "border-transparent bg-gray-100 text-gray-700 hover:bg-gray-200"
                        }`}
                    >
                      {qTab === "ALL" ? "All Terms" : `${qTab} Exams`}
                    </button>
                  ))}
                </div>

                {/* Search Bar & New Button */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-gray-400" />
                    <Input
                      placeholder="Search exam title..."
                      value={examSearchQuery}
                      onChange={(e) => setExamSearchQuery(e.target.value)}
                      className="h-8 w-48 pl-8 text-xs font-semibold border-2 border-black"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="border-2 border-black bg-[#FFD54F] font-black text-xs text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                    onClick={startNewExam}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> New TOS
                  </Button>
                </div>
              </div>

              {/* Exam Cards Grid */}
              {isLoadingSaved ? (
                <div className="py-16 text-center">
                  <RefreshCw className="mx-auto h-8 w-8 animate-spin text-gray-400" />
                  <p className="mt-3 text-xs font-bold text-gray-600">Loading your Table of Specifications...</p>
                </div>
              ) : filteredSavedExams.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-black/30 bg-[#FAFAFA] p-12 text-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl border-2 border-black bg-[#FFD54F] shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                    <TableProperties className="h-7 w-7 text-black" />
                  </div>
                  <h3 className="mt-4 text-base font-black text-black">No TOS Exams Found</h3>
                  <p className="mt-1 text-xs font-medium text-gray-600 max-w-sm mx-auto">
                    {savedExams.length === 0
                      ? "Create your first Table of Specifications blueprint and exam questionnaire."
                      : "No exam matches the selected quarter or search query."}
                  </p>
                  <Button
                    size="sm"
                    onClick={startNewExam}
                    className="mt-5 border-2 border-black bg-[#FFD54F] font-black text-xs text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                  >
                    <Plus className="mr-1.5 h-4 w-4" /> Create New TOS
                  </Button>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredSavedExams.map((ex) => {
                    const isFinal = ex.status === "FINALIZED" || ex.question_count > 0;

                    return (
                      <div
                        key={ex.tos_exam_id}
                        className="flex flex-col justify-between rounded-lg border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-transform hover:-translate-y-0.5"
                      >
                        <div>
                          {/* Top Badges */}
                          <div className="flex items-center justify-between gap-2 border-b border-black/10 pb-2.5">
                            <Badge
                              variant="outline"
                              className="border-black bg-[#E3F2FD] text-blue-950 font-black text-[10px]"
                            >
                              {ex.quarter || "Term 1"}
                            </Badge>
                            <Badge
                              variant="outline"
                              className={`border-black font-black text-[10px] ${isFinal ? "bg-[#C8E6C9] text-green-950" : "bg-[#FFF9C4] text-yellow-950"}`}
                            >
                              {isFinal ? "COMPLETED" : "DRAFT"}
                            </Badge>
                          </div>

                          {/* Title */}
                          <h4 className="mt-3 text-sm font-black text-black line-clamp-2">
                            {ex.title}
                          </h4>
                          <p className="text-[11px] font-semibold text-gray-500 mt-0.5">
                            {ex.subject_name || currentSubjectName}
                          </p>

                          {/* Metric Badges */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] pt-1">
                            <span className="rounded border border-black/30 bg-gray-50 px-2 py-0.5 font-bold text-gray-700">
                              {ex.total_items || 0} Target Items
                            </span>
                            <span className="rounded border border-black/30 bg-purple-50 px-2 py-0.5 font-bold text-purple-900">
                              {ex.question_count || 0} Questions
                            </span>
                          </div>
                        </div>

                        {/* Card Footer */}
                        <div className="mt-5 flex items-center justify-between border-t border-black/20 pt-3 text-[11px]">
                          <span className="flex items-center gap-1 text-gray-400 font-medium">
                            <Clock className="h-3 w-3" />
                            {new Date(ex.updated_at || ex.created_at).toLocaleDateString()}
                          </span>

                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDeleteExam(ex.tos_exam_id)}
                              disabled={deletingExamId === ex.tos_exam_id}
                              className="h-7 border-2 border-black bg-red-50 px-2 text-xs font-bold text-red-700 hover:bg-red-100 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                              title="Delete Draft"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => handleLoadExam(ex.tos_exam_id)}
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
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WIZARD STEP 1: TEST PARTS & COMPOSITION
             ══════════════════════════════════════════════════════════════════ */}
          {step === "test-parts" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold">Step 1 — Configure Assessment Parts</h3>
                <p className="text-xs text-gray-600">
                  Define the subject curriculum, exam language, and item-type composition. The sum of all parts determines your total target items.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="text-xs font-bold text-gray-700 block">Subject Curriculum</label>
                  <select
                    value={currentSubjectId || ""}
                    onChange={(e) => handleSubjectChange(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border-2 border-black bg-white px-3 py-2 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none cursor-pointer"
                  >
                    <option value="">-- Select Subject Curriculum --</option>
                    {availableSubjects.map((s) => (
                      <option key={s.subject_id} value={s.subject_id}>
                        {s.subject_name} {s.section_name ? `(${s.section_name})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block">Exam Language</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as "English" | "Filipino")}
                    className="mt-1 w-full rounded-md border-2 border-black bg-white px-3 py-2 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none cursor-pointer"
                  >
                    <option value="English">English</option>
                    <option value="Filipino">Filipino</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block">Exam Title</label>
                  <Input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Summative Assessment 1"
                    className="mt-1 border-2 border-black font-semibold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-700 block">Academic Term (Trimester)</label>
                  <select
                    value={quarter}
                    onChange={(e) => setQuarter(e.target.value)}
                    className="mt-1 w-full rounded-md border-2 border-black bg-white px-3 py-2 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] focus:outline-none cursor-pointer"
                  >
                    <option value="Term 1">1st Term (Term 1)</option>
                    <option value="Term 2">2nd Term (Term 2)</option>
                    <option value="Term 3">3rd Term (Term 3)</option>
                  </select>
                </div>
              </div>

              <div className="rounded-lg border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center justify-between border-b-2 border-black pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700">Question Types & Item Composition</span>
                  <span className="text-xs font-bold text-black">
                    Total Items Target: <span className="text-lg font-black text-blue-700">{totalItems}</span>
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {(
                    [
                      { type: "MULTIPLE_CHOICE", label: "Multiple Choice (4 Options)" },
                      { type: "TRUE_FALSE", label: "True or False" },
                      { type: "IDENTIFICATION", label: "Identification / Short Answer" },
                      { type: "MATCHING", label: "Matching Type" },
                      { type: "ESSAY", label: "Essay / Open-Ended" },
                    ] as const
                  ).map((t) => {
                    const part = testParts.find((p) => p.type === t.type);
                    const count = part ? part.count : 0;

                    return (
                      <div
                        key={t.type}
                        className="flex flex-col gap-2 rounded-md border-2 border-black bg-[#FAFAFA] p-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div>
                          <p className="text-xs font-black text-black">{t.label}</p>
                          <p className="text-[11px] text-gray-500 font-medium">Tag: {t.type}</p>
                        </div>

                        <div className="flex items-center gap-2">
                          {[0, 5, 10, 15, 20, 30].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() => {
                                const filtered = testParts.filter((p) => p.type !== t.type);
                                if (preset > 0) {
                                  setTestParts([...filtered, { type: t.type, count: preset }]);
                                } else {
                                  setTestParts(filtered);
                                }
                              }}
                              className={`rounded border-2 px-2.5 py-1 text-[11px] font-extrabold transition-all ${count === preset ? "border-black bg-[#FFD54F] text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]" : "border-black/30 bg-white text-gray-700 hover:bg-yellow-50"}`}
                            >
                              {preset}
                            </button>
                          ))}
                          <Input
                            type="number"
                            min="0"
                            value={count}
                            onChange={(e) => {
                              const val = Math.max(0, parseInt(e.target.value) || 0);
                              const filtered = testParts.filter((p) => p.type !== t.type);
                              if (val > 0) {
                                setTestParts([...filtered, { type: t.type, count: val }]);
                              } else {
                                setTestParts(filtered);
                              }
                            }}
                            className="h-9 w-20 border-2 border-black text-center font-black text-sm"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={onBack}
                  className="border-2 border-black font-bold"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Cancel & Back
                </Button>
                <Button
                  disabled={totalItems <= 0 || !currentSubjectId}
                  onClick={() => setStep("competencies")}
                  className="border-2 border-black bg-[#FFD54F] font-bold text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28] disabled:opacity-50"
                >
                  Next: Competencies & Days <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WIZARD STEP 2: COMPETENCIES & DAYS
             ══════════════════════════════════════════════════════════════════ */}
          {step === "competencies" && (
            <div className="space-y-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-bold">Step 2 — Learning Competencies & Days Taught</h3>
                  <p className="text-xs text-gray-600">
                    Select curriculum competencies from your database or add ad-hoc topics. Enter the number of days taught per competency.
                  </p>
                </div>
                <Badge variant="outline" className="border-black bg-[#E3F2FD] font-bold text-xs py-1 px-2.5 self-start sm:self-auto">
                  Total Days: {totalDays}
                </Badge>
              </div>

              {/* Competency Picker Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border-2 border-black bg-[#FFF9C4] p-3.5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex-1">
                  <select
                    onChange={(e) => {
                      handleSelectCompetency(e.target.value);
                      e.target.value = "";
                    }}
                    className="w-full h-9 rounded border-2 border-black bg-white px-3 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] outline-none cursor-pointer focus:bg-yellow-50"
                  >
                    <option value="">
                      {availableCompetencies.length > 0
                        ? `+ Select Competency from Curriculum (${availableCompetencies.length} available)...`
                        : "All curriculum competencies added to assessment"}
                    </option>
                    {availableCompetencies.map((c) => (
                      <option key={c.competency_id} value={c.competency_id}>
                        {c.competency_code ? `[${c.competency_code}] ` : ""}
                        {c.statement.length > 90 ? `${c.statement.substring(0, 90)}...` : c.statement}
                      </option>
                    ))}
                  </select>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCompInputs([
                      ...compInputs,
                      { label: `Ad-hoc Topic #${compInputs.length + 1}`, days: 2, is_adhoc: true },
                    ]);
                  }}
                  className="border-2 border-black bg-white font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-gray-100 h-9 text-xs shrink-0"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Ad-hoc Topic
                </Button>
              </div>

              {/* Competency Items List */}
              <div className="space-y-3">
                {compInputs.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center bg-gray-50">
                    <p className="text-xs font-bold text-gray-600">No competencies selected yet.</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Use the dropdown above to add competencies from your curriculum bank or add an ad-hoc topic.
                    </p>
                  </div>
                ) : (
                  compInputs.map((comp, idx) => {
                    const isCurriculum = !!comp.competency_id;

                    return (
                      <div
                        key={idx}
                        className="flex flex-col gap-2.5 rounded-lg border-2 border-black bg-white p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                      >
                        {/* 1. Top row: Competency name/code (Bold, larger font) + Weight % badge aligned top-right (small/muted) */}
                        <div className="flex items-center justify-between gap-2 border-b border-black/10 pb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm sm:text-base font-black text-black">
                              {comp.code || `Competency #${idx + 1}`}
                            </span>
                            <Badge
                              variant="outline"
                              className={`border-black text-[10px] font-black ${isCurriculum ? "bg-[#E3F2FD] text-blue-950" : "bg-amber-100 text-amber-950"
                                }`}
                            >
                              {isCurriculum ? "CURRICULUM" : "AD-HOC TOPIC"}
                            </Badge>
                          </div>

                          <span className="rounded border border-black/30 bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-600 shrink-0">
                            {totalDays > 0 ? `${((comp.days / totalDays) * 100).toFixed(1)}% Weight` : "0% Weight"}
                          </span>
                        </div>

                        {/* 2. Middle: Full competency statement wrapped across multiple lines — no truncation, regular weight */}
                        <div className="py-1">
                          {isCurriculum ? (
                            <p className="text-xs sm:text-sm font-medium text-gray-800 leading-relaxed whitespace-normal break-words select-text">
                              {comp.label}
                            </p>
                          ) : (
                            <div>
                              <label className="text-[11px] font-bold text-gray-600 block mb-1">Topic Description</label>
                              <textarea
                                rows={2}
                                value={comp.label}
                                onChange={(e) => {
                                  const updated = [...compInputs];
                                  updated[idx].label = e.target.value;
                                  setCompInputs(updated);
                                }}
                                placeholder="Enter ad-hoc topic description..."
                                className="w-full rounded border-2 border-black/60 bg-white p-2 text-xs sm:text-sm font-medium text-gray-900 leading-relaxed outline-none focus:border-black"
                              />
                            </div>
                          )}
                        </div>

                        {/* 3. Bottom row: Days Taught input + delete icon */}
                        <div className="flex items-center justify-between border-t border-black/10 pt-2.5">
                          <div className="flex items-center gap-2">
                            <label className="text-xs font-bold text-gray-700">Days Taught:</label>
                            <Input
                              type="number"
                              min="1"
                              value={comp.days}
                              onChange={(e) => {
                                const updated = [...compInputs];
                                updated[idx].days = Math.max(1, parseInt(e.target.value) || 1);
                                setCompInputs(updated);
                              }}
                              className="h-8 w-20 border-2 border-black text-center font-black text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] bg-white"
                            />
                            <span className="text-[11px] text-gray-500 font-semibold">day(s)</span>
                          </div>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCompInputs(compInputs.filter((_, i) => i !== idx));
                            }}
                            className="h-8 border-2 border-black bg-red-50 px-2.5 text-xs font-bold text-red-700 hover:bg-red-100 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                            title="Remove Competency"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("test-parts")}
                  className="border-2 border-black font-bold"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                </Button>
                <Button
                  disabled={compInputs.length === 0 || totalDays <= 0}
                  onClick={() => setStep("difficulty")}
                  className="border-2 border-black bg-[#FFD54F] font-bold text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                >
                  Next: Difficulty Ratio <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WIZARD STEP 3: DIFFICULTY RATIO
             ══════════════════════════════════════════════════════════════════ */}
          {step === "difficulty" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold">Step 3 — Cognitive & Difficulty Balance</h3>
                <p className="text-xs text-gray-600">
                  Configure the target difficulty ratio. Standard DepEd ratio is 60% Easy, 30% Average, 10% Difficult.
                </p>
              </div>

              <div className="rounded-lg border-2 border-black bg-white p-6 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="grid gap-6 sm:grid-cols-3">
                  <div className="space-y-2 rounded-lg border-2 border-black bg-[#E8F5E9] p-4 text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-xs font-black text-green-900 uppercase tracking-wider">Easy (60%)</p>
                    <p className="text-[11px] font-semibold text-green-700">Remember & Understand</p>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={difficultyRatio.easy}
                      onChange={(e) =>
                        setDifficultyRatio({ ...difficultyRatio, easy: parseInt(e.target.value) || 0 })
                      }
                      className="mx-auto h-12 w-24 border-2 border-black text-center text-xl font-black bg-white"
                    />
                    <span className="text-xs font-bold text-gray-600 block">
                      ≈ {Math.round((totalItems * (difficultyRatio.easy || 0)) / 100)} Items
                    </span>
                  </div>

                  <div className="space-y-2 rounded-lg border-2 border-black bg-[#FFF9C4] p-4 text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-xs font-black text-yellow-900 uppercase tracking-wider">Average (30%)</p>
                    <p className="text-[11px] font-semibold text-yellow-700">Apply & Analyze</p>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={difficultyRatio.average}
                      onChange={(e) =>
                        setDifficultyRatio({ ...difficultyRatio, average: parseInt(e.target.value) || 0 })
                      }
                      className="mx-auto h-12 w-24 border-2 border-black text-center text-xl font-black bg-white"
                    />
                    <span className="text-xs font-bold text-gray-600 block">
                      ≈ {Math.round((totalItems * (difficultyRatio.average || 0)) / 100)} Items
                    </span>
                  </div>

                  <div className="space-y-2 rounded-lg border-2 border-black bg-[#FFEBEE] p-4 text-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                    <p className="text-xs font-black text-red-900 uppercase tracking-wider">Difficult (10%)</p>
                    <p className="text-[11px] font-semibold text-red-700">Evaluate & Create</p>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={difficultyRatio.difficult}
                      onChange={(e) =>
                        setDifficultyRatio({ ...difficultyRatio, difficult: parseInt(e.target.value) || 0 })
                      }
                      className="mx-auto h-12 w-24 border-2 border-black text-center text-xl font-black bg-white"
                    />
                    <span className="text-xs font-bold text-gray-600 block">
                      ≈ {Math.round((totalItems * (difficultyRatio.difficult || 0)) / 100)} Items
                    </span>
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between border-t-2 border-black pt-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">Sum of Target Ratios:</span>
                    <Badge
                      variant="outline"
                      className={`border-black font-extrabold ${difficultyRatio.easy + difficultyRatio.average + difficultyRatio.difficult === 100 ? "bg-green-200 text-green-900" : "bg-red-200 text-red-900"}`}
                    >
                      {difficultyRatio.easy + difficultyRatio.average + difficultyRatio.difficult}%
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setDifficultyRatio({ easy: 60, average: 30, difficult: 10 })}
                    className="border-2 border-black text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    Reset to 60/30/10 Standard
                  </Button>
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("competencies")}
                  className="border-2 border-black font-bold"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                </Button>
                <Button
                  disabled={difficultyRatio.easy + difficultyRatio.average + difficultyRatio.difficult !== 100}
                  onClick={() => {
                    handleRecalculate();
                    setStep("blueprint");
                  }}
                  className="border-2 border-black bg-[#FFD54F] font-bold text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                >
                  Calculate Blueprint <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WIZARD STEP 4: BLUEPRINT GRID TABLE
             ══════════════════════════════════════════════════════════════════ */}
          {step === "blueprint" && (
            <div className="space-y-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-base font-bold">Step 4 — Table of Specifications Blueprint</h3>
                  <p className="text-xs text-gray-600">
                    Auto-computed via Largest Remainder Method with column reconciliation. Every cognitive level cell is interactive and editable.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRecalculate}
                    className="border-2 border-black bg-white text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Recalculate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (fullDraft) {
                        setIsExporting("blueprint-pdf");
                        await exportTosBlueprintPdf(fullDraft);
                        setIsExporting(null);
                      }
                    }}
                    className="border-2 border-black bg-[#E3F2FD] text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#BBDEFB]"
                  >
                    <FileDown className="mr-1.5 h-3.5 w-3.5" /> Blueprint PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      if (fullDraft) {
                        setIsExporting("blueprint-docx");
                        await exportTosBlueprintDocx(fullDraft);
                        setIsExporting(null);
                      }
                    }}
                    className="border-2 border-black bg-[#E8F5E9] text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#C8E6C9]"
                  >
                    <FileText className="mr-1.5 h-3.5 w-3.5" /> Word (.docx)
                  </Button>
                </div>
              </div>

              {/* Informative Hint Banner */}
              <div className="flex items-center gap-2 rounded-lg border-2 border-black bg-[#FFF9C4] px-4 py-2.5 text-xs font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                <span className="text-base">💡</span>
                <span>
                  <strong>Interactive Cells:</strong> The number inputs under Bloom's Taxonomy (Rem, Und, App, Ana, Eva, Cre) are fully editable. Changes update the Easy/Average/Difficult subtotals and Grand Totals automatically.
                </span>
              </div>

              {!draftValidation.valid && (
                <div className="rounded-lg border-2 border-red-500 bg-red-50 p-3 text-xs font-bold text-red-800">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-red-600" />
                    <span>Blueprint Validation Warnings:</span>
                  </div>
                  <ul className="mt-1 list-disc pl-5 font-normal">
                    {draftValidation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* DepEd Standard 2-Tier Structured Table */}
              <div className="overflow-x-auto rounded-lg border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    {/* Header Row 1 */}
                    <tr className="border-b-2 border-black bg-[#EAEAEA] font-black text-black">
                      <th rowSpan={2} className="border-r-2 border-black px-4 py-3 min-w-[240px]">
                        Competency / Learning Objective
                      </th>
                      <th rowSpan={2} className="border-r-2 border-black px-3 py-3 text-center w-16">
                        Days
                      </th>
                      <th rowSpan={2} className="border-r-2 border-black px-3 py-3 text-center w-16">
                        % Wt
                      </th>
                      <th rowSpan={2} className="border-r-2 border-black px-3 py-3 text-center bg-blue-100 w-16">
                        Items
                      </th>
                      <th colSpan={6} className="border-r-2 border-black px-2 py-2 text-center bg-[#FFF8E1]">
                        Cognitive Process Dimensions (Bloom's Taxonomy)
                      </th>
                      <th colSpan={3} className="border-r-2 border-black px-2 py-2 text-center bg-[#F3E5F5]">
                        Difficulty Distribution
                      </th>
                      <th rowSpan={2} className="px-3 py-3 text-center min-w-[100px]">
                        Placement
                      </th>
                    </tr>

                    {/* Header Row 2 */}
                    <tr className="border-b-2 border-black bg-[#F5F5F5] font-bold text-black text-[11px]">
                      {/* Bloom */}
                      <th className="border-r border-black p-2 text-center bg-emerald-50 text-emerald-900">Remember</th>
                      <th className="border-r border-black p-2 text-center bg-emerald-50 text-emerald-900">Understand</th>
                      <th className="border-r border-black p-2 text-center bg-amber-50 text-amber-900">Apply</th>
                      <th className="border-r border-black p-2 text-center bg-amber-50 text-amber-900">Analyze</th>
                      <th className="border-r border-black p-2 text-center bg-rose-50 text-rose-900">Evaluate</th>
                      <th className="border-r-2 border-black p-2 text-center bg-rose-50 text-rose-900">Create</th>
                      {/* Difficulty */}
                      <th className="border-r border-black p-2 text-center bg-emerald-100 text-emerald-950 font-black">Easy</th>
                      <th className="border-r border-black p-2 text-center bg-amber-100 text-amber-950 font-black">Average</th>
                      <th className="border-r-2 border-black p-2 text-center bg-rose-100 text-rose-950 font-black">Difficult</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((r, idx) => {
                      const rowVal = validateTOSRow(r);
                      return (
                        <tr key={idx} className="border-b-2 border-black font-semibold hover:bg-yellow-50/30 transition-colors">
                          <td className="border-r-2 border-black p-3">
                            <p className="font-extrabold text-black text-xs leading-snug">{r.label}</p>
                            {r.code && <span className="text-[10px] font-bold text-gray-500">{r.code}</span>}
                            {rowVal.reconciliation_note && (
                              <p className="mt-1 text-[10px] text-amber-800 font-bold">
                                ℹ️ {rowVal.reconciliation_note}
                              </p>
                            )}
                          </td>
                          <td className="border-r-2 border-black p-2 text-center font-black">{r.days}</td>
                          <td className="border-r-2 border-black p-2 text-center text-gray-600 font-bold">
                            {r.weight_percent.toFixed(1)}%
                          </td>
                          <td className="border-r-2 border-black p-2 text-center font-black text-sm bg-blue-50/60">
                            {r.items}
                          </td>

                          {/* Editable Bloom Input Cells */}
                          <td className="border-r border-black p-2 text-center bg-emerald-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.remember}
                              onChange={(e) => handleCellEdit(idx, "remember", parseInt(e.target.value) || 0)}
                              className="h-8 w-12 rounded border-2 border-black bg-white text-center font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 focus:bg-yellow-100 focus:outline-none"
                            />
                          </td>
                          <td className="border-r border-black p-2 text-center bg-emerald-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.understand}
                              onChange={(e) => handleCellEdit(idx, "understand", parseInt(e.target.value) || 0)}
                              className="h-8 w-12 rounded border-2 border-black bg-white text-center font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 focus:bg-yellow-100 focus:outline-none"
                            />
                          </td>
                          <td className="border-r border-black p-2 text-center bg-amber-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.apply}
                              onChange={(e) => handleCellEdit(idx, "apply", parseInt(e.target.value) || 0)}
                              className="h-8 w-12 rounded border-2 border-black bg-white text-center font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 focus:bg-yellow-100 focus:outline-none"
                            />
                          </td>
                          <td className="border-r border-black p-2 text-center bg-amber-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.analyze}
                              onChange={(e) => handleCellEdit(idx, "analyze", parseInt(e.target.value) || 0)}
                              className="h-8 w-12 rounded border-2 border-black bg-white text-center font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 focus:bg-yellow-100 focus:outline-none"
                            />
                          </td>
                          <td className="border-r border-black p-2 text-center bg-rose-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.evaluate}
                              onChange={(e) => handleCellEdit(idx, "evaluate", parseInt(e.target.value) || 0)}
                              className="h-8 w-12 rounded border-2 border-black bg-white text-center font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 focus:bg-yellow-100 focus:outline-none"
                            />
                          </td>
                          <td className="border-r-2 border-black p-2 text-center bg-rose-50/30">
                            <input
                              type="number"
                              min="0"
                              value={r.create_}
                              onChange={(e) => handleCellEdit(idx, "create_", parseInt(e.target.value) || 0)}
                              className="h-8 w-12 rounded border-2 border-black bg-white text-center font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50 focus:bg-yellow-100 focus:outline-none"
                            />
                          </td>

                          {/* Difficulty Pill Cells */}
                          <td className="border-r border-black p-2 text-center">
                            <span className="inline-block px-2.5 py-0.5 rounded-full border border-emerald-400 bg-emerald-100 text-emerald-950 font-black text-xs">
                              {r.easy}
                            </span>
                          </td>
                          <td className="border-r border-black p-2 text-center">
                            <span className="inline-block px-2.5 py-0.5 rounded-full border border-amber-400 bg-amber-100 text-amber-950 font-black text-xs">
                              {r.average}
                            </span>
                          </td>
                          <td className="border-r-2 border-black p-2 text-center">
                            <span className="inline-block px-2.5 py-0.5 rounded-full border border-rose-400 bg-rose-100 text-rose-950 font-black text-xs">
                              {r.difficult}
                            </span>
                          </td>

                          <td className="p-2 text-center font-black text-gray-800">
                            {r.items > 0 ? `${r.item_start}–${r.item_end}` : "-"}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Grand Total Row */}
                    {grandTotal && (
                      <tr className="bg-[#E5E5E5] font-black text-black text-xs">
                        <td className="border-r-2 border-black p-3">TOTAL ASSESSMENT TARGETS</td>
                        <td className="border-r-2 border-black p-2 text-center">{grandTotal.days}</td>
                        <td className="border-r-2 border-black p-2 text-center">100.0%</td>
                        <td className="border-r-2 border-black p-2 text-center text-blue-900 bg-blue-200 text-sm">
                          {grandTotal.items}
                        </td>
                        <td className="border-r border-black p-2 text-center bg-emerald-100">{grandTotal.remember}</td>
                        <td className="border-r border-black p-2 text-center bg-emerald-100">{grandTotal.understand}</td>
                        <td className="border-r border-black p-2 text-center bg-amber-100">{grandTotal.apply}</td>
                        <td className="border-r border-black p-2 text-center bg-amber-100">{grandTotal.analyze}</td>
                        <td className="border-r border-black p-2 text-center bg-rose-100">{grandTotal.evaluate}</td>
                        <td className="border-r-2 border-black p-2 text-center bg-rose-100">{grandTotal.create_}</td>
                        <td className="border-r border-black p-2 text-center bg-emerald-200 text-emerald-950 font-black">
                          {grandTotal.easy}
                        </td>
                        <td className="border-r border-black p-2 text-center bg-amber-200 text-amber-950 font-black">
                          {grandTotal.average}
                        </td>
                        <td className="border-r-2 border-black p-2 text-center bg-rose-200 text-rose-950 font-black">
                          {grandTotal.difficult}
                        </td>
                        <td className="p-2 text-center font-black text-black">
                          {grandTotal.items > 0 ? `1–${grandTotal.items}` : "-"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("difficulty")}
                  className="border-2 border-black font-bold"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                </Button>
                <Button
                  disabled={isGenerating}
                  onClick={handleGenerateQuestions}
                  className="border-2 border-black bg-[#FFD54F] font-bold text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Generating {totalItems} Questions...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-4 w-4 text-purple-700" /> Generate Exam Questions (AI)
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WIZARD STEP 5: AI QUESTION REVIEW & EDIT
             ══════════════════════════════════════════════════════════════════ */}
          {step === "ai-review" && (
            <div className="space-y-6">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h3 className="text-base font-bold">Step 5 — Review & Polish Exam Questions</h3>
                  <p className="text-xs text-gray-600">
                    Generated based on your Table of Specifications quota with difficulty & cognitive level tags.
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isGenerating}
                    onClick={handleGenerateQuestions}
                    className="border-2 border-black bg-white text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Regenerate All ({totalItems})
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setStep("export")}
                    className="border-2 border-black bg-[#FFD54F] text-xs font-bold text-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                  >
                    Proceed to Export <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {generationProgress && (
                <div className="rounded-lg border-2 border-blue-500 bg-blue-50 p-4 text-center text-xs font-bold text-blue-800 animate-pulse">
                  {generationProgress}
                </div>
              )}

              {generationError && (
                <div className="rounded-lg border-2 border-red-500 bg-red-50 p-3 text-xs font-bold text-red-800">
                  {generationError}
                </div>
              )}

              {questions.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
                  <Sparkles className="mx-auto h-8 w-8 text-yellow-500" />
                  <p className="mt-2 text-sm font-bold text-gray-700">No questions generated yet.</p>
                  <Button
                    size="sm"
                    onClick={handleGenerateQuestions}
                    className="mt-3 border-2 border-black bg-[#FFD54F] font-bold text-black"
                  >
                    Generate {totalItems} Questions Now
                  </Button>
                </div>
              ) : (
                <div className="space-y-6">
                  {groupedQuestions.map((grp, gIdx) => {
                    const grpQuestions = grp.questions.map((item) => item.q);
                    const bloomActual = buildBloomSummary(grpQuestions);

                    return (
                      <div
                        key={gIdx}
                        className="rounded-lg border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                      >
                        {/* Competency Group Header */}
                        <div className="flex flex-col justify-between border-b-2 border-black pb-3 sm:flex-row sm:items-center">
                          <div>
                            <h4 className="font-extrabold text-black text-sm">{grp.label}</h4>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs font-bold">
                              <span className="text-gray-600 font-semibold mr-1">Cognitive Distribution:</span>
                              <Badge variant="outline" className="border-black bg-emerald-50 text-[10px]">
                                Rem: {bloomActual.REMEMBER}
                              </Badge>
                              <Badge variant="outline" className="border-black bg-emerald-50 text-[10px]">
                                Und: {bloomActual.UNDERSTAND}
                              </Badge>
                              <Badge variant="outline" className="border-black bg-amber-50 text-[10px]">
                                App: {bloomActual.APPLY}
                              </Badge>
                              <Badge variant="outline" className="border-black bg-amber-50 text-[10px]">
                                Ana: {bloomActual.ANALYZE}
                              </Badge>
                              <Badge variant="outline" className="border-black bg-rose-50 text-[10px]">
                                Eva: {bloomActual.EVALUATE}
                              </Badge>
                              <Badge variant="outline" className="border-black bg-rose-50 text-[10px]">
                                Cre: {bloomActual.CREATE}
                              </Badge>
                            </div>
                          </div>
                          <Badge variant="outline" className="mt-2 border-black bg-[#FFD54F] font-black text-xs sm:mt-0 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                            {grp.questions.length} Item(s)
                          </Badge>
                        </div>

                        {/* Standard RetroUI Question Cards */}
                        <div className="mt-4 space-y-4">
                          {grp.questions.map(({ q, globalIdx }) => {
                            const isEditingThis = editingQuestionIdx === globalIdx;

                            return (
                              <div
                                key={globalIdx}
                                className="rounded-lg border-2 border-black bg-[#FAFAFA] p-4 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                              >
                                {isEditingThis && editQuestionForm ? (
                                  /* Inline Edit Mode */
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-between border-b-2 border-black pb-2">
                                      <span className="font-extrabold text-xs">Edit Question #{globalIdx + 1}</span>
                                      <div className="flex items-center gap-2">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => setEditingQuestionIdx(null)}
                                          className="h-7 border-2 border-black bg-white text-xs font-bold"
                                        >
                                          Cancel
                                        </Button>
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            const updated = [...questions];
                                            updated[globalIdx] = editQuestionForm;
                                            setQuestions(updated);
                                            setEditingQuestionIdx(null);
                                          }}
                                          className="h-7 border-2 border-black bg-[#FFD54F] text-xs font-bold text-black"
                                        >
                                          Save
                                        </Button>
                                      </div>
                                    </div>

                                    <div>
                                      <label className="text-[11px] font-bold text-gray-700">Question Prompt</label>
                                      <textarea
                                        rows={3}
                                        value={editQuestionForm.question_text}
                                        onChange={(e) =>
                                          setEditQuestionForm({ ...editQuestionForm, question_text: e.target.value })
                                        }
                                        className="mt-1 w-full rounded border-2 border-black bg-white p-2.5 text-xs font-semibold"
                                      />
                                    </div>

                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                      <div>
                                        <label className="text-[11px] font-bold text-gray-700">Question Type</label>
                                        <select
                                          value={editQuestionForm.question_type}
                                          onChange={(e) =>
                                            setEditQuestionForm({
                                              ...editQuestionForm,
                                              question_type: e.target.value as TestPartType,
                                            })
                                          }
                                          className="mt-1 w-full rounded border-2 border-black bg-white p-2 text-xs font-bold"
                                        >
                                          <option value="MULTIPLE_CHOICE">Multiple Choice</option>
                                          <option value="TRUE_FALSE">True / False</option>
                                          <option value="IDENTIFICATION">Identification</option>
                                          <option value="MATCHING">Matching Type</option>
                                          <option value="ESSAY">Essay</option>
                                        </select>
                                      </div>

                                      <div>
                                        <label className="text-[11px] font-bold text-gray-700">Difficulty</label>
                                        <select
                                          value={editQuestionForm.difficulty_band || "EASY"}
                                          onChange={(e) =>
                                            setEditQuestionForm({
                                              ...editQuestionForm,
                                              difficulty_band: e.target.value as DifficultyBand,
                                            })
                                          }
                                          className="mt-1 w-full rounded border-2 border-black bg-white p-2 text-xs font-bold"
                                        >
                                          <option value="EASY">Easy</option>
                                          <option value="AVERAGE">Average</option>
                                          <option value="DIFFICULT">Difficult</option>
                                        </select>
                                      </div>

                                      <div>
                                        <label className="text-[11px] font-bold text-gray-700">Cognitive Level</label>
                                        <select
                                          value={editQuestionForm.cognitive_level || "REMEMBER"}
                                          onChange={(e) =>
                                            setEditQuestionForm({
                                              ...editQuestionForm,
                                              cognitive_level: e.target.value as CognitiveLevel,
                                            })
                                          }
                                          className="mt-1 w-full rounded border-2 border-black bg-white p-2 text-xs font-bold"
                                        >
                                          <option value="REMEMBER">Remember</option>
                                          <option value="UNDERSTAND">Understand</option>
                                          <option value="APPLY">Apply</option>
                                          <option value="ANALYZE">Analyze</option>
                                          <option value="EVALUATE">Evaluate</option>
                                          <option value="CREATE">Create</option>
                                        </select>
                                      </div>
                                    </div>

                                    {editQuestionForm.options && editQuestionForm.options.length > 0 && (
                                      <div className="space-y-1.5 pt-2">
                                        <label className="text-[11px] font-bold text-gray-700">Options & Correct Answer</label>
                                        {editQuestionForm.options.map((opt, oIdx) => (
                                          <div key={oIdx} className="flex items-center gap-2">
                                            <input
                                              type="radio"
                                              name={`correct_opt_${globalIdx}`}
                                              checked={!!opt.is_correct}
                                              onChange={() => {
                                                const updatedOpts = editQuestionForm.options!.map((o, idx) => ({
                                                  ...o,
                                                  is_correct: idx === oIdx,
                                                }));
                                                setEditQuestionForm({ ...editQuestionForm, options: updatedOpts });
                                              }}
                                            />
                                            <Input
                                              value={opt.option_text}
                                              onChange={(e) => {
                                                const updatedOpts = [...editQuestionForm.options!];
                                                updatedOpts[oIdx].option_text = e.target.value;
                                                setEditQuestionForm({ ...editQuestionForm, options: updatedOpts });
                                              }}
                                              className="h-8 border-2 border-black bg-white text-xs font-semibold"
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    <div>
                                      <label className="text-[11px] font-bold text-gray-700">Answer Key / Explanation</label>
                                      <Input
                                        value={editQuestionForm.explanation || ""}
                                        onChange={(e) =>
                                          setEditQuestionForm({ ...editQuestionForm, explanation: e.target.value })
                                        }
                                        placeholder="Model answer or grading rubric..."
                                        className="mt-1 border-2 border-black bg-white text-xs font-semibold"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  /* Display Mode */
                                  <div className="space-y-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-black/20 pb-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-black text-sm text-black">#{globalIdx + 1}.</span>
                                        <Badge
                                          variant="outline"
                                          className="border-2 border-black bg-white text-[11px] font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                        >
                                          {q.question_type.replace(/_/g, " ")}
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className={`border-2 border-black text-[11px] font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${q.difficulty_band === "EASY" ? "bg-emerald-100 text-emerald-950" : q.difficulty_band === "AVERAGE" ? "bg-amber-100 text-amber-950" : "bg-rose-100 text-rose-950"}`}
                                        >
                                          {q.difficulty_band || "EASY"}
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className="border-2 border-black bg-purple-100 text-[11px] text-purple-950 font-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                        >
                                          {q.cognitive_level || "REMEMBER"}
                                        </Badge>
                                        <span className="text-[11px] font-bold text-gray-500">{q.points || 1} pt</span>
                                      </div>

                                      <div className="flex items-center gap-1.5">
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setEditingQuestionIdx(globalIdx);
                                            setEditQuestionForm({ ...q });
                                          }}
                                          className="h-7 border-2 border-black bg-white px-2.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50"
                                        >
                                          <Edit3 className="h-3.5 w-3.5 mr-1" /> Edit
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          disabled={regeneratingIdx === globalIdx}
                                          onClick={() => handleRegenerateQuestion(globalIdx)}
                                          className="h-7 border-2 border-black bg-white px-2.5 text-xs font-bold shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:bg-yellow-50"
                                        >
                                          <RefreshCw className={`h-3.5 w-3.5 ${regeneratingIdx === globalIdx ? "animate-spin" : ""}`} />
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          onClick={() => {
                                            setQuestions(questions.filter((_, i) => i !== globalIdx));
                                          }}
                                          className="h-7 border-2 border-black bg-red-50 px-2 text-xs font-bold text-red-700 hover:bg-red-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                      </div>
                                    </div>

                                    {/* Question Text */}
                                    <p className="text-xs font-bold text-black leading-relaxed">{q.question_text}</p>

                                    {/* Options Display */}
                                    {q.options && q.options.length > 0 ? (
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                                        {q.options.map((opt, oIdx) => (
                                          <div
                                            key={oIdx}
                                            className={`flex items-center gap-2 rounded-md border-2 p-2 text-xs font-semibold ${opt.is_correct ? "border-emerald-600 bg-emerald-50 text-emerald-950 font-bold shadow-[2px_2px_0px_0px_rgba(16,185,129,0.3)]" : "border-black/20 bg-white text-gray-800"}`}
                                          >
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-black/40 text-[10px] font-black">
                                              {String.fromCharCode(65 + oIdx)}
                                            </span>
                                            <span className="flex-1">{opt.option_text}</span>
                                            {opt.is_correct && <Check className="h-4 w-4 text-emerald-700 shrink-0" />}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      q.explanation && (
                                        <div className="rounded border-2 border-dashed border-black/30 bg-amber-50/80 p-2.5 text-xs text-amber-950 font-medium">
                                          <strong>Model Key / Rubric:</strong> {q.explanation}
                                        </div>
                                      )
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep("blueprint")}
                  className="border-2 border-black font-bold"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Blueprint
                </Button>
                <Button
                  disabled={questions.length === 0}
                  onClick={() => setStep("export")}
                  className="border-2 border-black bg-[#FFD54F] font-bold text-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] hover:bg-[#FFCA28]"
                >
                  Proceed to Final Export <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              WIZARD STEP 6: FINAL EXAM EXPORT
             ══════════════════════════════════════════════════════════════════ */}
          {step === "export" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold">Step 6 — Export Assessment Questionnaire</h3>
                <p className="text-xs text-gray-600">
                  Export your finalized assessment package formatted with official DepEd headers and layouts.
                </p>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                {/* Blueprint Summary Card */}
                <div className="rounded-lg border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <h4 className="font-bold text-black flex items-center gap-2">
                    <TableProperties className="h-4 w-4 text-blue-700" />
                    Table of Specifications Document
                  </h4>
                  <p className="mt-1 text-xs text-gray-600">
                    15-column competency matrix grid with Bloom cognitive distribution and item placement.
                  </p>

                  <div className="mt-6 flex flex-col gap-2">
                    <Button
                      disabled={isExporting !== null}
                      onClick={async () => {
                        if (fullDraft) {
                          setIsExporting("blueprint-pdf");
                          await exportTosBlueprintPdf(fullDraft);
                          setIsExporting(null);
                        }
                      }}
                      className="border-2 border-black bg-[#E3F2FD] font-bold text-black hover:bg-[#BBDEFB] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <FileDown className="mr-2 h-4 w-4" /> Export Blueprint PDF (Landscape Legal)
                    </Button>
                    <Button
                      disabled={isExporting !== null}
                      onClick={async () => {
                        if (fullDraft) {
                          setIsExporting("blueprint-docx");
                          await exportTosBlueprintDocx(fullDraft);
                          setIsExporting(null);
                        }
                      }}
                      className="border-2 border-black bg-white font-bold text-black hover:bg-gray-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <FileText className="mr-2 h-4 w-4" /> Export Blueprint Word (.docx)
                    </Button>
                  </div>
                </div>

                {/* Exam Paper Card */}
                <div className="rounded-lg border-2 border-black bg-white p-5 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <h4 className="font-bold text-black flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-yellow-600" />
                    Summative Examination Paper
                  </h4>
                  <p className="mt-1 text-xs text-gray-600">
                    Formatted exam questionnaire supporting all 5 question types (MC, T/F, ID, Matching, Essay).
                  </p>

                  <div className="mt-4 flex items-center gap-2 rounded border-2 border-black bg-yellow-50 p-2.5">
                    <Switch checked={includeAnswerKey} onCheckedChange={setIncludeAnswerKey} />
                    <label className="text-xs font-bold text-black">Append Answer Key at bottom</label>
                  </div>

                  <div className="mt-4 flex flex-col gap-2">
                    <Button
                      disabled={isExporting !== null || questions.length === 0}
                      onClick={async () => {
                        setIsExporting("exam-pdf");
                        await exportTosExamPdf(questions, {
                          title,
                          subjectName: currentSubjectName,
                          quarter,
                          includeAnswerKey,
                        });
                        setIsExporting(null);
                      }}
                      className="border-2 border-black bg-[#FFD54F] font-bold text-black hover:bg-[#FFCA28] shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <FileDown className="mr-2 h-4 w-4" /> Export Exam Paper PDF (Portrait Legal)
                    </Button>
                    <Button
                      disabled={isExporting !== null || questions.length === 0}
                      onClick={async () => {
                        setIsExporting("exam-docx");
                        await exportTosExamDocx(questions, {
                          title,
                          subjectName: currentSubjectName,
                          quarter,
                          includeAnswerKey,
                        });
                        setIsExporting(null);
                      }}
                      className="border-2 border-black bg-white font-bold text-black hover:bg-gray-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <FileText className="mr-2 h-4 w-4" /> Export Exam Paper Word (.docx)
                    </Button>
                  </div>
                </div>
              </div>

              <div className="flex justify-between gap-2 pt-4 border-t-2 border-black">
                <Button
                  variant="outline"
                  onClick={() => setStep("ai-review")}
                  className="border-2 border-black font-bold"
                >
                  <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Review
                </Button>
                <Button
                  onClick={() => {
                    handleSaveDraft();
                    setStep("saved-list");
                  }}
                  className="border-2 border-black bg-[#C8E6C9] font-bold text-green-900 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]"
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Save & Return to TOS Archive
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TOSGeneratorScreen;
