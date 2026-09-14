import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/retroui/Button";
import {
  FileText,
  Target,
  BookOpen,
  ClipboardCheck,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  FileDown,
  X,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Dialog } from "@/components/retroui/Dialog";
import { Text } from "@/components/retroui/Text";

import { InfoTab } from "./tabs/info-tab";
import { IntentionsTab } from "./tabs/intentions-tab";
import { LearningExpTab } from "./tabs/learning-exp-tab";
import { AssessmentTab } from "./tabs/assessment-tab";
import { WaysForwardTab } from "./tabs/ways-forward-tab";
import { useLessonPlanner } from "./use-lesson-planner";
import type { LessonPlanDraft } from "./use-lesson-planner";
import { useAuth } from "@/context/AuthContext";
import {
  exportLessonPlanPDF,
  exportLessonPlanWord,
} from "./lesson-plan-exporter";
import { routes } from "@/../routes";

const TABS = [
  {
    value: "info",
    label: "Info",
    headerTitle: "Information",
    headerDescription: "Fill in the basic details of the lesson plan.",
    icon: FileText,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    value: "intentions",
    label: "Intentions",
    headerTitle: "Intentions",
    headerDescription: "Define what students will learn and what you know about them.",
    icon: Target,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
  },
  {
    value: "learning",
    label: "Learning Exp.",
    headerTitle: "Learning Experiences",
    headerDescription: "Map out the flow of learning tasks across the lesson phases.",
    icon: BookOpen,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  {
    value: "assessment",
    label: "Assessment",
    headerTitle: "Assessments",
    headerDescription: "Describe how you will monitor and evaluate student learning.",
    icon: ClipboardCheck,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
  },
  {
    value: "ways",
    label: "Ways Forward",
    headerTitle: "Ways Forward",
    headerDescription: "Plan how you will extend learning and reflect on the lesson's effectiveness.",
    icon: ArrowRight,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-200",
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

interface LessonPlannerWizardProps {
  planId?: number;
  onClose?: () => void;
}

export const LessonPlannerWizard: React.FC<LessonPlannerWizardProps> = ({
  planId,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<TabValue>("info");
  const auth = useAuth();
  const teacherName = auth?.user?.fullName || "Teacher";
  const navigate = useNavigate();

  const {
    draft,
    setField,
    setNestedField,
    saveDraft,
    submitPlan,
    isSaving,
    isSubmitting,
    isFetching,
    errors,
    saveSuccess,
    apiError,
  } = useLessonPlanner(planId);

  const currentIndex = TABS.findIndex((t) => t.value === activeTab);
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === TABS.length - 1;

  const goNext = () => {
    if (!isLast) setActiveTab(TABS[currentIndex + 1].value);
  };
  const goPrev = () => {
    if (!isFirst) setActiveTab(TABS[currentIndex - 1].value);
  };

  const handleSaveDraft = () => saveDraft();

  const handleSubmitWithOption = async (format?: "pdf" | "word" | "none") => {
    const res = await submitPlan();
    if (res && !res.success && res.targetTab) {
      setActiveTab(res.targetTab);
      return;
    }
    if (res && res.success) {
      if (format === "pdf") {
        exportLessonPlanPDF(draft, teacherName);
      } else if (format === "word") {
        exportLessonPlanWord(draft, teacherName);
      }
      if (onClose) {
        onClose();
      } else {
        navigate(routes.teacher.lessonPlanner);
      }
    }
  };

  if (isFetching) {
    return (
      <LoadingPanel label="Loading lesson plan..." className="w-full" />
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <Dialog.Header asChild position="static" className="shrink-0 border-b-2 border-border px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex w-full min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <Text as="h5" className="truncate font-sans text-lg font-bold sm:text-xl">
              {TABS[currentIndex]?.headerTitle || "Lesson Plan"}
            </Text>
            {TABS[currentIndex]?.headerDescription && (
              <p className="text-xs md:text-sm font-normal text-foreground">
                {TABS[currentIndex].headerDescription}
              </p>
            )}
          </div>
          <Text as="h5" className="shrink-0 whitespace-nowrap font-sans text-sm font-semibold sm:text-base">
            Step {currentIndex + 1} of {TABS.length}
          </Text>
        </div>
      </Dialog.Header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 [scrollbar-gutter:stable] sm:gap-6 sm:px-6 sm:py-6">
        {/* Global error banner */}
        {apiError && (
          <div className="flex items-center gap-2.5 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 shadow-2xs w-full animate-in fade-in slide-in-from-top-1 duration-200">
            <AlertCircle className="size-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="font-semibold text-red-900">Validation Error</p>
              <p className="text-xs text-red-700 mt-0.5">{apiError}</p>
            </div>
          </div>
        )}

        {/* Save success banner */}
        {saveSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 w-full">
            <CheckCircle className="size-4 shrink-0" />
            Draft saved successfully.
          </div>
        )}

        {/* Tab content */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabValue)}
          className="w-full flex flex-col"
        >
          <TabsList className="hidden">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="info" className="w-full">
            <InfoTab
              draft={draft}
              errors={errors}
              onChange={(key, value) =>
                setField(
                  key as keyof LessonPlanDraft,
                  value as LessonPlanDraft[keyof LessonPlanDraft],
                )
              }
            />
          </TabsContent>
          <TabsContent value="intentions" className="w-full">
            <IntentionsTab
              draft={draft}
              errors={errors}
              onNestedChange={(section, key, value) =>
                setNestedField(section, key, value)
              }
            />
          </TabsContent>
          <TabsContent value="learning" className="w-full">
            <LearningExpTab
              draft={draft}
              onNestedChange={(section, key, value) =>
                setNestedField(section, key, value)
              }
            />
          </TabsContent>
          <TabsContent value="assessment" className="w-full">
            <AssessmentTab
              draft={draft}
              onNestedChange={(section, key, value) =>
                setNestedField(section, key, value)
              }
            />
          </TabsContent>
          <TabsContent value="ways" className="w-full">
            <WaysForwardTab
              draft={draft}
              onNestedChange={(section, key, value) =>
                setNestedField(section, key, value)
              }
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog Footer using default Dialog structure */}
      <Dialog.Footer className="flex max-h-[42dvh] w-full shrink-0 flex-col items-stretch gap-2 overflow-y-auto border-t-2 border-border bg-background px-3 py-3 sm:max-h-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3 sm:overflow-visible sm:px-6 sm:py-3.5">
        <div className="grid grid-cols-2 items-center gap-2 sm:flex">
          <Button
            type="button"
            variant="default"
            onClick={goPrev}
            disabled={isFirst}
            className="w-full justify-center gap-2 sm:w-auto"
          >
            <ChevronLeft className="size-4" />
            Previous
          </Button>
          {onClose && (
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving || isSubmitting}
              className="w-full justify-center gap-2 sm:w-auto"
            >
              <X className="size-4" />
              Cancel
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 items-center gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSaving || isSubmitting}
            className="w-full justify-center gap-2 sm:w-auto"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isSaving ? "Saving…" : "Save Draft"}
          </Button>

          {isLast ? (
            <>
              <Button
                type="button"
                onClick={() => handleSubmitWithOption("pdf")}
                disabled={isSubmitting}
                className="w-full justify-center gap-2 bg-red-600 text-white hover:bg-red-700 sm:w-auto"
              >
                <FileText className="size-4" />
                Submit &amp; PDF
              </Button>

              <Button
                type="button"
                onClick={() => handleSubmitWithOption("word")}
                disabled={isSubmitting}
                className="w-full justify-center gap-2 bg-blue-600 text-white hover:bg-blue-700 sm:w-auto"
              >
                <FileDown className="size-4" />
                Submit &amp; Word (.docx)
              </Button>

              <Button
                type="button"
                onClick={() => handleSubmitWithOption("none")}
                disabled={isSubmitting}
                className="w-full justify-center gap-2 bg-emerald-600 text-white hover:bg-emerald-700 sm:w-auto"
              >
                {isSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle className="size-4" />
                )}
                {isSubmitting ? "Submitting…" : "Submit Only"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={goNext} className="w-full justify-center gap-2 sm:w-auto">
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </Dialog.Footer>
    </div>
  );
};
