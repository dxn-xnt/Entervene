import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import Tabs from "@/components/tabs";
import { Alert } from "@/components/retroui/Alert";
import {
  BookOpen,
  Plus,
  Trash2,
  Loader2,
  Search,
  Calendar,
} from "lucide-react";
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
      setError(err instanceof Error ? err.message : "Unable to load lesson plans.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleDelete = async (e: React.MouseEvent, planId: number) => {
    e.stopPropagation();
    if (!window.confirm("Are you sure you want to delete this lesson plan?")) return;

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
      (plan.learning_area && plan.learning_area.toLowerCase().includes(query)) ||
      (plan.grade_section && plan.grade_section.toLowerCase().includes(query));

    return matchesTab && matchesSearch;
  });

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            {/* Header */}
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <div>
                  <h1 className="text-2xl md:text-4xl font-semibold">
                    Lesson Planner
                  </h1>
                  <p className="text-xs md:text-sm text-gray-500 mt-0.5">
                    ILAW (DO 016, s. 2026) · legacy DLP/DLL · SURY-assisted
                  </p>
                </div>
              </div>

              <button
                onClick={() => navigate(routes.teacher.lessonPlannerCreate)}
                className="flex items-center gap-1.5 rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
              >
                <Plus className="size-4" />
                <span className="hidden sm:inline">+ Create Lesson Plan</span>
                <span className="sm:hidden">+</span>
              </button>
            </header>

            {/* Navigation Tabs */}
            <div className="-mx-4 md:-mx-6">
              <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
            </div>

            {/* Error Alert */}
            {error && (
              <Alert status="error">
                <Alert.Title>Lesson plan error</Alert.Title>
                <Alert.Description>{error}</Alert.Description>
              </Alert>
            )}

            {/* Search Bar */}
            <div className="flex items-center gap-2 rounded-lg border border-black bg-white px-3 py-2 md:w-96 shadow-[2px_2px_0_#000]">
              <Search size={16} className="text-gray-500 shrink-0" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-500"
                placeholder="Search lesson plans..."
              />
            </div>

            {/* Loading state */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
                <Loader2 className="size-7 animate-spin text-[#7ABA78]" />
                <p className="text-sm font-medium">Loading your lesson plans…</p>
              </div>
            )}

            {/* Empty state */}
            {!isLoading && filteredPlans.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-lg border border-black bg-white p-8 shadow-[3px_3px_0_#000]">
                <div className="size-14 rounded-lg border border-black bg-[#E6F4EA] flex items-center justify-center text-emerald-800 mb-3 shadow-[2px_2px_0_#000]">
                  <BookOpen className="size-7" />
                </div>
                <h3 className="text-lg font-bold text-gray-900">No Lesson Plans Found</h3>
                <p className="text-sm text-gray-500 max-w-md mt-1 mb-5">
                  {searchQuery
                    ? "No lesson plans match your search filter."
                    : "Start structuring your lessons using the DepEd ILAW format with built-in AI assistance."}
                </p>
                <button
                  onClick={() => navigate(routes.teacher.lessonPlannerCreate)}
                  className="flex items-center gap-1.5 rounded-lg border border-black bg-[#7ABA78] px-4 py-2 text-sm font-semibold text-black shadow-[3px_3px_0_#000] transition hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[1px_1px_0_#000]"
                >
                  <Plus className="size-4" />
                  <span>Create Lesson Plan</span>
                </button>
              </div>
            )}

            {/* Lesson Plans List */}
            {!isLoading && filteredPlans.length > 0 && (
              <div className="flex flex-col gap-3.5 w-full">
                {filteredPlans.map((plan) => (
                  <div
                    key={plan.plan_id}
                    onClick={() => navigate(`/teacher/lesson-planner/${plan.plan_id}`)}
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
                          {plan.learning_area && <span>{plan.learning_area}</span>}
                          {plan.learning_area && plan.grade_section && <span>&middot;</span>}
                          {plan.grade_section && <span>{plan.grade_section}</span>}
                          {(plan.date || plan.created_at) && <span>&middot;</span>}
                          {plan.date ? (
                            <span className="flex items-center gap-1">
                              <Calendar className="size-3 shrink-0" />
                              {plan.date}
                            </span>
                          ) : plan.created_at ? (
                            <span>Created {new Date(plan.created_at).toLocaleDateString()}</span>
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
    </AppLayout>
  );
};

export default LessonPlannerListPage;
