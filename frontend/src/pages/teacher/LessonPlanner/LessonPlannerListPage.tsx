import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tabs } from "@/components/retroui/Tabs";
import { Input } from "@/components/retroui/Input";
import { Card } from "@/components/retroui/Card";
import { Button } from "@/components/retroui/Button";
import { Alert } from "@/components/retroui/Alert";
import {
  BookOpen,
  Plus,
  Trash2,
  Loader2,
  Search,
  Calendar,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { apiFetch } from "@/lib/api";
import { routes } from "@/../routes";
import { toast } from "sonner";

interface LessonPlanItem {
  plan_id: number;
  status: "DRAFT" | "SUBMITTED";
  title: string;
  learning_area?: string;
  grade_section?: string;
  date?: string;
  sessions?: string;
  created_at?: string;
  updated_at?: string;
}

const TABS = [
  { id: "all", label: "All Plans" },
  { id: "submitted", label: "Submitted" },
  { id: "drafts", label: "Drafts" },
];

export const LessonPlannerListPage: React.FC = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<LessonPlanItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchPlans = async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await apiFetch("/api/v1/lesson-plans/");
      if (!res.ok) throw new Error("Failed to fetch lesson plans.");
      const data = await res.json();
      setPlans(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load lesson plans.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleDelete = async (e: React.MouseEvent, planId: number) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this lesson plan?"))
      return;

    setDeletingId(planId);
    try {
      const res = await apiFetch(`/api/v1/lesson-plans/${planId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete lesson plan.");
      setPlans((prev) => prev.filter((p) => p.plan_id !== planId));
      toast.success("Lesson plan deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredPlans = plans.filter((plan) => {
    const matchesTab =
      activeTab === "submitted"
        ? plan.status === "SUBMITTED"
        : activeTab === "drafts"
          ? plan.status === "DRAFT"
          : true;

    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !query ||
      plan.title.toLowerCase().includes(query) ||
      (plan.learning_area &&
        plan.learning_area.toLowerCase().includes(query)) ||
      (plan.grade_section && plan.grade_section.toLowerCase().includes(query));

    return matchesTab && matchesSearch;
  });

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <header className="flex items-center justify-between gap-3 bg-background py-4 px-4 md:px-6">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-bold">
                    Lesson Planner
                  </h1>
                </div>
              </div>

              <Button
                variant="default"
                size="md"
                onClick={() => navigate(routes.teacher.lessonPlannerCreate)}
                className="gap-2"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">Create Lesson Plan</span>
                <span className="sm:hidden">+</span>
              </Button>
            </header>
            <div className="px-4 md:px-6 bg-background -mt-[1px]">
              <Tabs
                tabs={TABS}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </div>

            <div className="border-t-1 border-border -mt-[1px] py-4 px-4 md:px-6 flex flex-col gap-3">

            {/* Error Alert */}
            {error && (
              <Alert status="error">
                <Alert.Title>Lesson plan error</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}

            <label className="relative w-full md:w-96 shadow-md transition-shadow hover:shadow-none">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />

              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search lesson plans..."
                className="h-10 w-full border-black pl-9 pr-3 shadow-none"
              />
            </label>

            {/* Loading state */}
            {isLoading && (
              <LoadingPanel label="Loading your lesson plans..." />
            )}

            {/* Empty state */}
            {!isLoading && filteredPlans.length === 0 && (
              <Card className="block w-full text-center border-black">
                <Card.Content className="flex flex-col items-center px-6 py-12">
                  <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-lg border-2 border-black">
                    <BookOpen className="size-7" />
                  </div>

                  <Card.Title className="mb-2 text-base font-bold">
                    No Lesson Plans Found
                  </Card.Title>

                  <p className="mb-6 max-w-md text-sm font-normal text-gray-500">
                    {searchQuery
                      ? "No lesson plans match your search filter."
                      : "Start structuring your lessons using the DepEd ILAW format with built-in AI assistance."}
                  </p>

                  <Button
                    variant="default"
                    size="md"
                    onClick={() => navigate(routes.teacher.lessonPlannerCreate)}
                    className="gap-2"
                  >
                    <Plus size={16} />
                    <span>Create Lesson Plan</span>
                  </Button>
                </Card.Content>
              </Card>
            )}

            {/* Lesson Plans List */}
            {!isLoading && filteredPlans.length > 0 && (
              <div className="flex flex-col gap-3.5 w-full">
                {filteredPlans.map((plan) => (
                  <div
                    key={plan.plan_id}
                    onClick={() =>
                      navigate(`/teacher/lesson-planner/${plan.plan_id}`)
                    }
                    className="group flex items-center justify-between gap-4 p-4 rounded-lg border border-black bg-white shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000] cursor-pointer"
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="flex size-10 items-center justify-center rounded-lg border border-black bg-[#E6F4EA] text-emerald-800 font-bold shrink-0 shadow-[2px_2px_0_#000]">
                        <BookOpen className="size-5" />
                      </div>

                      <div className="flex flex-col min-w-0 flex-1">
                        <h2 className="text-base md:text-lg font-bold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">
                          {plan.title || "Untitled Lesson Plan"}
                        </h2>
                        <div className="flex items-center gap-2 text-xs md:text-sm text-gray-500 flex-wrap mt-0.5">
                          {plan.learning_area && (
                            <span>{plan.learning_area}</span>
                          )}
                          {plan.learning_area && plan.grade_section && (
                            <span>&middot;</span>
                          )}
                          {plan.grade_section && (
                            <span>{plan.grade_section}</span>
                          )}
                          {(plan.date || plan.created_at) && (
                            <span>&middot;</span>
                          )}
                          {plan.date ? (
                            <span className="flex items-center gap-1">
                              <Calendar className="size-3 shrink-0" />
                              {plan.date}
                            </span>
                          ) : plan.created_at ? (
                            <span>
                              Created{" "}
                              {new Date(plan.created_at).toLocaleDateString()}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {/* Badges & Delete Action */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      <span className="rounded-full border border-black bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900 shadow-[1px_1px_0_#000]">
                        ILAW
                      </span>

                      <span
                        className={`rounded-full border border-black px-2.5 py-0.5 text-xs font-semibold shadow-[1px_1px_0_#000] ${
                          plan.status === "SUBMITTED"
                            ? "bg-[#7ABA78] text-black"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {plan.status === "SUBMITTED" ? "Submitted" : "Draft"}
                      </span>

                      <button
                        type="button"
                        disabled={deletingId === plan.plan_id}
                        onClick={(e) => handleDelete(e, plan.plan_id)}
                        className="rounded p-1 text-gray-400 hover:text-red-600 hover:bg-gray-100 transition"
                        title="Delete lesson plan"
                      >
                        {deletingId === plan.plan_id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default LessonPlannerListPage;
