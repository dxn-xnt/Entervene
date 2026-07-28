import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
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
} from "lucide-react";

import { InfoTab } from "./tabs/InfoTab";
import { IntentionsTab } from "./tabs/IntentionsTab";
import { LearningExpTab } from "./tabs/LearningExpTab";
import { AssessmentTab } from "./tabs/AssessmentTab";
import { WaysForwardTab } from "./tabs/WaysForwardTab";
import { useLessonPlanner } from "./useLessonPlanner";
import type { LessonPlanDraft } from "./useLessonPlanner";
import { useAuth } from "@/context/AuthContext";
import {
  exportLessonPlanPDF,
  exportLessonPlanWord,
} from "./LessonPlanExporter";
import { routes } from "@/../routes";

const TABS = [
  {
    value: "info",
    label: "Info",
    icon: FileText,
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  {
    value: "intentions",
    label: "Intentions",
    icon: Target,
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
  },
  {
    value: "learning",
    label: "Learning Exp.",
    icon: BookOpen,
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
  },
  {
    value: "assessment",
    label: "Assessment",
    icon: ClipboardCheck,
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
  },
  {
    value: "ways",
    label: "Ways Forward",
    icon: ArrowRight,
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    borderColor: "border-rose-200",
  },
] as const;

type TabValue = (typeof TABS)[number]["value"];

interface LessonPlannerWizardProps {
  planId?: number;
}

export const LessonPlannerWizard: React.FC<LessonPlannerWizardProps> = ({
  planId,
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
      navigate(routes.teacher.lessonPlanner);
    }
  };

  if (isFetching) {
    return (
      <div className="flex items-center justify-center py-24 gap-3 text-muted-foreground w-full">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Loading lesson plan…</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full">
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

      {/* Progress stepper */}
      <div className="flex items-center justify-center overflow-x-auto py-2">
        {TABS.map((tab, idx) => {
          const Icon = tab.icon;
          const isDone = idx < currentIndex;
          const isActive = tab.value === activeTab;

          return (
            <React.Fragment key={tab.value}>
              <Button
                type="button"
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() => setActiveTab(tab.value)}
                className="gap-2 shrink-0"
              >
                {isDone ? <CheckCircle size={16} /> : <Icon size={16} />}

                <span>{tab.label}</span>

                {isActive && (
                  <Badge size="sm" variant="secondary">
                    Current
                  </Badge>
                )}
              </Button>

              {idx < TABS.length - 1 && (
                <div className="mx-3 flex w-10 items-center">
                  <div
                    className={`h-[2px] w-full rounded-full transition-colors ${
                      isDone ? "bg-primary" : "bg-border"
                    }`}
                  />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

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

        <Card className="w-full block">
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
        </Card>
      </Tabs>

      {/* Footer (Single location for action buttons) */}
      <div className="flex items-center justify-between pt-2 border-t w-full gap-4 flex-wrap">
        <Button
          variant="outline"
          onClick={goPrev}
          disabled={isFirst}
          className="gap-2"
        >
          <ChevronLeft className="size-4" />
          Previous
        </Button>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Button
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
            <Button onClick={goNext} className="gap-2">
              Next
              <ChevronRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
