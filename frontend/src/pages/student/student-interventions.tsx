import { useState, useEffect, useMemo } from "react";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Select } from "@/components/retroui/Select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import {
  Shield,
  Sparkles,
  CheckCircle2,
  BookOpen,
  Loader2,
  Clock,
  ArrowRight,
  PartyPopper,
} from "lucide-react";
import { LoadingPanel } from "@/components/loading-panel";
import { EmptyStateCard } from "@/components/empty-state-card";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";
import {
  fetchMyInterventions,
  completeMyIntervention,
  markInterventionViewed,
  type StudentSuggestionItem,
} from "@/lib/interventions-api";

export default function StudentInterventions() {
  const navigate = useNavigate();
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
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load study recommendations.");
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
      loadData();
    } catch (err) {
      console.error(err);
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

  // KPIs
  const activeCount = useMemo(() => items.filter((s) => s.status === "ACTIVE").length, [items]);
  const highPriorityCount = useMemo(
    () => items.filter((s) => s.priority === "HIGH" || s.priority === "URGENT").length,
    [items]
  );
  const completedCount = useMemo(() => items.filter((s) => s.status === "COMPLETED").length, [items]);

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-4xl font-black tracking-tight flex items-center gap-2 text-black">
                  <Shield className="size-8 text-black fill-yellow-300" />
                  My Study Interventions
                </h1>
              </div>
              <Badge className="bg-yellow-300 text-black border-2 border-black font-extrabold text-xs px-2.5 py-1 uppercase shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                Personalized Learning Tasks
              </Badge>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-black -mt-[1px]" />

            <div className="flex flex-col gap-6 py-3">
              {/* KPI Header Cards */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <OverviewCard
                  title="Active Study Tasks"
                  count={activeCount.toString()}
                  stat="Pending Action"
                />
                <OverviewCard
                  title="Urgent / High Priority"
                  count={highPriorityCount.toString()}
                  stat="Recommended First"
                />
                <OverviewCard
                  title="Completed Tasks"
                  count={completedCount.toString()}
                  stat="Finished"
                />
              </div>

              {/* Filter Toolbar */}
              <div className="flex items-center justify-between gap-3 flex-wrap bg-white p-3 border-2 border-black shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase text-black">Status Filter:</span>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <Select.Trigger className="w-[160px] h-9 border-2 border-black bg-white font-bold text-xs shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
                      <Select.Value placeholder="Select Status" />
                    </Select.Trigger>
                    <Select.Content className="border-2 border-black bg-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
                      <Select.Item value="ACTIVE">ACTIVE TASKS</Select.Item>
                      <Select.Item value="COMPLETED">COMPLETED</Select.Item>
                      <Select.Item value="All">ALL INTERVENTIONS</Select.Item>
                    </Select.Content>
                  </Select>
                </div>
                <div className="text-xs font-bold text-gray-600">
                  Showing {items.length} intervention recommendation{items.length === 1 ? "" : "s"}
                </div>
              </div>

              {/* Main Content Area */}
              {loading ? (
                <LoadingPanel label="Loading your study recommendations..." />
              ) : error ? (
                <div className="p-6 border-2 border-black bg-rose-50 text-rose-700 font-bold text-sm shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                  {error}
                </div>
              ) : items.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {items.map((item) => (
                    <Card
                      key={item.suggestion_id}
                      className="p-5 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between gap-4 rounded-none hover:translate-y-[-2px] transition-transform"
                    >
                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.prediction_id && (
                              <Badge className="bg-yellow-300 border-2 border-black text-[9px] font-black uppercase px-1.5 py-0.5">
                                <Sparkles className="size-3 mr-1 fill-black inline" />
                                AI Recommended
                              </Badge>
                            )}
                            <Badge
                              className={`border-2 border-black text-[9px] font-black uppercase px-2 py-0.5 ${
                                item.resource_type === "LESSON"
                                  ? "bg-sky-300 text-black"
                                  : "bg-purple-300 text-black"
                              }`}
                            >
                              {item.resource_type}
                            </Badge>
                          </div>

                          <Badge
                            className={`border-2 border-black text-[10px] font-extrabold uppercase px-2 py-0.5 ${
                              item.priority === "URGENT"
                                ? "bg-rose-400 text-black"
                                : item.priority === "HIGH"
                                ? "bg-amber-300 text-black"
                                : "bg-sky-200 text-black"
                            }`}
                          >
                            {item.priority} PRIORITY
                          </Badge>
                        </div>

                        <h2 className="text-lg font-black text-black leading-snug">
                          {item.title}
                        </h2>

                        {item.description && (
                          <p className="text-xs text-gray-700 font-semibold leading-relaxed line-clamp-2">
                            {item.description}
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-xs font-bold text-gray-600 pt-1 border-t border-black/10">
                          <span className="flex items-center gap-1">
                            <BookOpen className="size-3.5 text-black" />
                            {item.subject_name || `Subject #${item.subject_id}`}
                          </span>
                          {item.created_at && (
                            <span className="flex items-center gap-1 text-[11px] text-gray-500">
                              <Clock className="size-3" />
                              Assigned {new Date(item.created_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Card Action Buttons */}
                      <div className="flex items-center justify-between gap-2 pt-3 border-t-2 border-black">
                        <Button
                          size="sm"
                          onClick={() => handleViewMaterial(item)}
                          className="bg-white hover:bg-gray-100 text-black border-2 border-black font-extrabold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        >
                          <BookOpen className="size-3.5 mr-1" />
                          View Material
                          <ArrowRight className="size-3 ml-1" />
                        </Button>

                        {item.status === "ACTIVE" ? (
                          <Button
                            size="sm"
                            disabled={completingId === item.suggestion_id}
                            onClick={() => handleComplete(item.suggestion_id)}
                            className="bg-emerald-400 hover:bg-emerald-500 text-black border-2 border-black font-black text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                          >
                            {completingId === item.suggestion_id ? (
                              <Loader2 className="size-3.5 animate-spin mr-1" />
                            ) : (
                              <CheckCircle2 className="size-3.5 mr-1" />
                            )}
                            Mark as Completed
                          </Button>
                        ) : (
                          <Badge className="bg-emerald-100 text-emerald-800 border-2 border-black font-extrabold text-xs px-2.5 py-1">
                            <CheckCircle2 className="size-3.5 mr-1 inline" />
                            Completed
                          </Badge>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              ) : (
                /* Clean RetroUI Empty State */
                <EmptyStateCard
                  icon={<PartyPopper size={24} />}
                  title="No Active Interventions"
                  description="You currently have no pending study interventions or remedial tasks assigned for this view. Keep up the great work in your classes!"
                >
                  <Button
                    size="sm"
                    onClick={() => navigate(routes.student.subjects)}
                    className="bg-yellow-300 hover:bg-yellow-400 text-black border-2 border-black font-extrabold text-xs shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] mt-2"
                  >
                    <BookOpen className="size-4 mr-1.5" />
                    Browse Subjects & Lessons
                  </Button>
                </EmptyStateCard>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
