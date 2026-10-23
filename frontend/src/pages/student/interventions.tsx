import { useState, useEffect, useMemo } from "react";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { useToast } from "@/components/retroui/Toast";
import { Select } from "@/components/retroui/Select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import {
  Sparkles,
  CheckCircle2,
  BookOpen,
  Loader2,
  Clock,
  ArrowRight,
  PartyPopper,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { Empty } from "@/components/retroui/Empty";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import {
  fetchMyInterventions,
  completeMyIntervention,
  markInterventionViewed,
  type StudentSuggestionItem,
} from "@/lib/interventions-api";
import StudentReviewerSection from "./intervention/student-reviewer-section";
import StudentActiveInterventions from "./intervention/student-active-interventions";
import StudentResolvedInterventions from "./intervention/student-resolved-interventions";

export default function StudentInterventions() {
  const navigate = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState<StudentSuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<number | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMyInterventions(statusFilter === "All" ? undefined : statusFilter);
      setItems(res.suggestions || []);
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to load study recommendations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  const handleComplete = async (id: number) => {
    setCompletingId(id);
    try {
      await completeMyIntervention(id);
      toast.success({ title: "Study recommendation completed" });
      void loadData();
    } catch (err) {
      toast.error({ title: "Unable to complete recommendation", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setCompletingId(null);
    }
  };

  const handleViewMaterial = async (item: StudentSuggestionItem) => {
    // Mark as viewed in background
    if (!item.is_viewed) {
      markInterventionViewed(item.suggestion_id).catch(console.error);
    }
    // Navigate to subjects page
    navigate(routes.student.subjects);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex flex-col items-start gap-2 bg-background px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <SidebarTrigger className="shrink-0 md:hidden" />
                <h1 className="truncate text-lg font-black tracking-tight text-black sm:text-2xl md:text-4xl">
                  My Study Interventions
                </h1>
              </div>
            </header>

            <div className="-mt-[1px] flex min-w-0 flex-col gap-4 border-t-2 border-border px-3 py-3 sm:gap-6 sm:px-4 sm:py-4 md:px-6">
              {import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEVELOPMENT_PREDICTIONS === "true" &&
                <>
                  <StudentActiveInterventions />
                  <StudentResolvedInterventions />
                  <StudentReviewerSection />
                </>
              }


            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
