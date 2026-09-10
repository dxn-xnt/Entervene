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
      <Dialog.Header asChild position="static" className="border-b-2 border-border shrink-0">
        <div className="flex items-center justify-between w-full">
          <div>
            <Text as="h5" className="font-sans text-xl font-bold">
              {TABS[currentIndex]?.headerTitle || "Lesson Plan"}
            </Text>
            {TABS[currentIndex]?.headerDescription && (
              <p className="text-xs md:text-sm font-normal text-foreground">
                {TABS[currentIndex].headerDescription}
              </p>
            )}
          </div>
          <Text as="h5" className="font-sans text-base font-semibold shrink-0">
            Step {currentIndex + 1} of {TABS.length}
          </Text>
        </div>
      </Dialog.Header>

      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-6 [scrollbar-gutter:stable]">
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
      <Dialog.Footer className="flex items-center justify-between border-t-2 border-border bg-background px-6 py-3.5 gap-3 w-full shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="default"
            onClick={goPrev}
            disabled={isFirst}
            className="gap-2"
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
              className="gap-2"
            >
              <X className="size-4" />
              Cancel
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSaving || isSubmitting}
            className="gap-2"
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
                className="gap-2 bg-red-600 hover:bg-red-700 text-white"
              >
                <FileText className="size-4" />
                Submit &amp; PDF
              </Button>

              <Button
                type="button"
                onClick={() => handleSubmitWithOption("word")}
                disabled={isSubmitting}
                className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
              >
                <FileDown className="size-4" />
                Submit &amp; Word (.docx)
              </Button>

              <Button
                type="button"
                onClick={() => handleSubmitWithOption("none")}
                disabled={isSubmitting}
                className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
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
            <Button type="button" onClick={goNext} className="gap-2">
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </Dialog.Footer>
    </div>
  );
};
