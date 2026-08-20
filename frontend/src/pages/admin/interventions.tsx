import { useState, useEffect, useMemo } from "react";
import { OverviewCard } from "@/components/overview-cards";
import { Card } from "@/components/retroui/Card";
import { Progress } from "@/components/retroui/Progress";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { Badge } from "@/components/retroui/Badge";
import { Select } from "@/components/retroui/Select";
import { Input } from "@/components/retroui/Input";
import { Button } from "@/components/retroui/Button";
import { Search, Sparkles, CheckCircle2, XCircle, Archive, Shield, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import {
  fetchTeacherInterventions,
  approveIntervention,
  dismissIntervention,
  archiveIntervention,
  type StudentSuggestionItem,
} from "@/lib/interventions-api";

export default function AdminInterventions() {
  const { user } = useAuth();
  const isTeacher = user?.role === "teacher";
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState<StudentSuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTeacherInterventions({
        status: statusFilter === "All" ? undefined : statusFilter,
      });
      setItems(res.suggestions || []);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load interventions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [statusFilter]);

  // Derived filtering
  const uniqueClasses = useMemo(() => {
    const classes = items.map((s) => s.class_name).filter(Boolean) as string[];
    return [...new Set(classes)];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        !search.trim() ||
        (item.student_name || item.student_id).toLowerCase().includes(search.toLowerCase()) ||
        (item.title || "").toLowerCase().includes(search.toLowerCase()) ||
        (item.subject_name || "").toLowerCase().includes(search.toLowerCase());
      const matchesClass =
        classFilter === "All" || item.class_name === classFilter;
      return matchesSearch && matchesClass;
    });
  }, [items, search, classFilter]);

  // KPI Calculations
  const activeCount = useMemo(
    () => items.filter((s) => s.status === "ACTIVE").length,
    [items]
  );
  const highPriorityCount = useMemo(
    () => items.filter((s) => s.priority === "HIGH" || s.priority === "URGENT").length,
    [items]
  );
  const completedCount = useMemo(
    () => items.filter((s) => s.status === "COMPLETED").length,
    [items]
  );
  const aiLinkedCount = useMemo(
    () => items.filter((s) => Boolean(s.prediction_id)).length,
    [items]
  );

  // Actions
  const handleApprove = async (id: number) => {
    setActionLoadingId(id);
    try {
      await approveIntervention(id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDismiss = async (id: number) => {
    setActionLoadingId(id);
    try {
      await dismissIntervention(id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchive = async (id: number) => {
    setActionLoadingId(id);
    try {
      await archiveIntervention(id);
      await loadData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoadingId(null);
    }
  };

  // Progress breakdowns
  const totalItems = items.length || 1;
  const urgentPercent = Math.round(
    (items.filter((s) => s.priority === "URGENT").length / totalItems) * 100
  );
  const highPercent = Math.round(
    (items.filter((s) => s.priority === "HIGH").length / totalItems) * 100
  );
  const normalPercent = Math.round(
    (items.filter((s) => s.priority === "NORMAL").length / totalItems) * 100
  );
  const lowPercent = Math.round(
    (items.filter((s) => s.priority === "LOW").length / totalItems) * 100
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-3 py-4 md:py-5 px-4 md:px-6">
            <header className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="md:hidden" />
                <h1 className="text-4xl font-black  flex items-center gap-2 text-black">
                  Interventions Dashboard
                </h1>
                {isAdmin && (
                  <Badge size="sm" className="">
                    Read-Only (Admin View)
                  </Badge>
                )}
              </div>
            </header>

            <div className="-mx-4 md:-mx-6 border-b-2 border-black -mt-[1px]" />

            <div className="flex flex-col gap-4 py-2 md:gap-6 md:py-3">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 items-start">
                {/* Left column — Main Dashboard Content */}
                <div className="lg:col-span-3 flex flex-col gap-6">
                  {/* KPI Overview Cards */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <OverviewCard
                      title="Active Interventions"
                      count={activeCount.toString()}
                      stat="Active"
                    />
                    <OverviewCard
                      title="High/Urgent Priority"
                      count={highPriorityCount.toString()}
                      stat="Urgent"
                    />
                    <OverviewCard
                      title="Completed Remediations"
                      count={completedCount.toString()}
                      stat="Resolved"
                    />
                    <OverviewCard
                      title="AI Scored Predictions"
                      count={aiLinkedCount.toString()}
                      stat="ML Linked"
                    />
                  </div>

                  {/* Filter Toolbar */}
                  <div className="flex flex-col gap-4">
                    <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
                      <label className="relative">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-black/50" />
                        <Input
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Search student, title, or subject..."
                          className="h-10 w-full border-black pl-9 pr-3"
                        />
                      </label>

                      <Select value={classFilter} onValueChange={setClassFilter}>
                        <Select.Trigger className="w-full">
                          <Select.Value placeholder="Class Filter" />
                        </Select.Trigger>
                        <Select.Content className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                          <Select.Group>
                            <Select.Item value="All">All Classes</Select.Item>
                            {uniqueClasses.map((className) => (
                              <Select.Item key={className} value={className}>
                                {className}
                              </Select.Item>
                            ))}
                          </Select.Group>
                        </Select.Content>
                      </Select>

                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <Select.Trigger className="w-full">
                          <Select.Value placeholder="Status Filter" />
                        </Select.Trigger>
                        <Select.Content className="border-2 border-black bg-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)]">
                          <Select.Group>
                            <Select.Item value="All">All Statuses</Select.Item>
                            <Select.Item value="ACTIVE">Active</Select.Item>
                            <Select.Item value="COMPLETED">Completed</Select.Item>
                            <Select.Item value="DISMISSED">Dismissed</Select.Item>
                            <Select.Item value="DRAFT">Draft</Select.Item>
                            <Select.Item value="ARCHIVED">Archived</Select.Item>
                          </Select.Group>
                        </Select.Content>
                      </Select>
                    </div>

                    {/* Table Container */}
                    <Card className="p-0 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-none">
                      {loading ? (
                        <div className="p-8 flex items-center justify-center gap-2 text-black font-extrabold text-sm">
                          <Loader2 className="animate-spin size-5" />
                          Loading interventions...
                        </div>
                      ) : error ? (
                        <div className="p-6 text-rose-600 font-bold text-sm">
                          {error}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <Table>
                            <Table.Header className="bg-yellow-300 border-b-2 border-black font-black uppercase text-xs">
                              <Table.Row>
                                <Table.Head className="text-black font-black">Learner Name</Table.Head>
                                <Table.Head className="text-black font-black">Subject / Class</Table.Head>
                                <Table.Head className="text-black font-black">Intervention Title</Table.Head>
                                <Table.Head className="text-black font-black">Priority</Table.Head>
                                <Table.Head className="text-black font-black">Status</Table.Head>
                                {isTeacher && (
                                  <Table.Head className="text-black font-black text-right">Actions</Table.Head>
                                )}
                              </Table.Row>
                            </Table.Header>
                            <Table.Body>
                              {filteredItems.length > 0 ? (
                                filteredItems.map((item) => (
                                  <Table.Row key={item.suggestion_id} className="border-b border-black/10 hover:bg-yellow-50/50">
                                    <Table.Cell className="font-extrabold text-sm text-black">
                                      {item.student_name || item.student_id}
                                    </Table.Cell>
                                    <Table.Cell className="font-semibold text-xs text-gray-800">
                                      <div>{item.subject_name || `Subject #${item.subject_id}`}</div>
                                      <div className="text-[10px] text-gray-500 font-bold uppercase">{item.class_name || "Enrolled Class"}</div>
                                    </Table.Cell>
                                    <Table.Cell className="font-bold text-xs text-black">
                                      <div className="flex items-center gap-1.5">
                                        {item.prediction_id && (
                                          <Badge className="bg-yellow-300 border-2 border-black text-[9px] font-black px-1 uppercase">
                                            <Sparkles className="size-2.5 mr-0.5 inline fill-black" />
                                            ML Linked
                                          </Badge>
                                        )}
                                        <span>{item.title}</span>
                                      </div>
                                    </Table.Cell>
                                    <Table.Cell>
                                      <Badge
                                        className={`border-2 border-black text-[10px] font-extrabold px-2 uppercase ${item.priority === "URGENT"
                                          ? "bg-rose-400 text-black"
                                          : item.priority === "HIGH"
                                            ? "bg-amber-300 text-black"
                                            : item.priority === "NORMAL"
                                              ? "bg-sky-300 text-black"
                                              : "bg-gray-200 text-black"
                                          }`}
                                      >
                                        {item.priority}
                                      </Badge>
                                    </Table.Cell>
                                    <Table.Cell>
                                      <Badge
                                        className={`border-2 border-black text-[10px] font-extrabold px-2 uppercase ${item.status === "ACTIVE"
                                          ? "bg-amber-300 text-black"
                                          : item.status === "COMPLETED"
                                            ? "bg-emerald-400 text-black"
                                            : item.status === "DISMISSED"
                                              ? "bg-rose-300 text-black"
                                              : "bg-gray-200 text-black"
                                          }`}
                                      >
                                        {item.status}
                                      </Badge>
                                    </Table.Cell>
                                    {isTeacher && (
                                      <Table.Cell className="text-right">
                                        <div className="flex items-center justify-end gap-1.5">
                                          {item.status === "ACTIVE" && (
                                            <>
                                              <Button
                                                size="sm"
                                                disabled={actionLoadingId === item.suggestion_id}
                                                onClick={() => handleApprove(item.suggestion_id)}
                                                title="Approve / Confirm Remediation"
                                                className="h-7 px-2 bg-emerald-400 hover:bg-emerald-500 text-black border-2 border-black font-extrabold text-[11px] shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                              >
                                                {actionLoadingId === item.suggestion_id ? (
                                                  <Loader2 className="size-3.5 animate-spin mr-1" />
                                                ) : (
                                                  <CheckCircle2 className="size-3.5 mr-1" />
                                                )}
                                                Approve
                                              </Button>
                                              <Button
                                                size="sm"
                                                disabled={actionLoadingId === item.suggestion_id}
                                                onClick={() => handleDismiss(item.suggestion_id)}
                                                title="Dismiss Remediation"
                                                className="h-7 px-2 bg-rose-300 hover:bg-rose-400 text-black border-2 border-black font-extrabold text-[11px] shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                              >
                                                {actionLoadingId === item.suggestion_id ? (
                                                  <Loader2 className="size-3.5 animate-spin mr-1" />
                                                ) : (
                                                  <XCircle className="size-3.5 mr-1" />
                                                )}
                                                Dismiss
                                              </Button>
                                            </>
                                          )}
                                          {item.status !== "ACTIVE" && item.status !== "ARCHIVED" && (
                                            <Button
                                              size="sm"
                                              disabled={actionLoadingId === item.suggestion_id}
                                              onClick={() => handleArchive(item.suggestion_id)}
                                              title="Archive Intervention"
                                              className="h-7 px-2 bg-gray-200 hover:bg-gray-300 text-black border-2 border-black font-extrabold text-[11px] shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
                                            >
                                              {actionLoadingId === item.suggestion_id ? (
                                                <Loader2 className="size-3.5 animate-spin mr-1" />
                                              ) : (
                                                <Archive className="size-3.5 mr-1" />
                                              )}
                                              Archive
                                            </Button>
                                          )}
                                        </div>
                                      </Table.Cell>
                                    )}
                                  </Table.Row>
                                ))
                              ) : (
                                <Table.Row key="empty-row">
                                  <Table.Cell colSpan={6} className="text-center py-8 font-bold text-gray-500 italic">
                                    No persistent interventions match the selected filters.
                                  </Table.Cell>
                                </Table.Row>
                              )}
                            </Table.Body>
                          </Table>
                        </div>
                      )}
                    </Card>
                  </div>
                </div>

                {/* Right column — Metrics & Breakdown Cards */}
                <div className="lg:col-span-1 flex flex-col gap-6 self-start">
                  <Card className="w-full p-4 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3 rounded-none">
                    <h2 className="text-sm font-black uppercase text-black flex items-center gap-1.5">
                      <Sparkles className="size-4 text-yellow-500 fill-yellow-400" />
                      Priority Distribution
                    </h2>
                    <div className="space-y-3 pt-1">
                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-bold text-black">
                          <span>URGENT</span>
                          <span>{urgentPercent}%</span>
                        </div>
                        <Progress value={urgentPercent} className="h-2 border border-black bg-gray-100" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-bold text-black">
                          <span>HIGH</span>
                          <span>{highPercent}%</span>
                        </div>
                        <Progress value={highPercent} className="h-2 border border-black bg-gray-100" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-bold text-black">
                          <span>NORMAL</span>
                          <span>{normalPercent}%</span>
                        </div>
                        <Progress value={normalPercent} className="h-2 border border-black bg-gray-100" />
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-xs font-bold text-black">
                          <span>LOW</span>
                          <span>{lowPercent}%</span>
                        </div>
                        <Progress value={lowPercent} className="h-2 border border-black bg-gray-100" />
                      </div>
                    </div>
                  </Card>

                  <Card className="w-full p-4 border-2 border-black bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3 rounded-none">
                    <h2 className="text-sm font-black uppercase text-black flex items-center gap-1.5">
                      <Shield className="size-4 text-emerald-500 fill-emerald-300" />
                      Intervention Summary
                    </h2>
                    <p className="text-xs text-gray-700 font-semibold leading-relaxed">
                      This dashboard reflects active, approved, and prediction-linked student suggestions. Administrators view all school-wide remediations; teachers view remediations scoped to their assigned subjects & classes.
                    </p>
                  </Card>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
