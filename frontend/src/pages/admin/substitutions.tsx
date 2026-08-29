import * as React from "react";
import AppLayout from "@/layouts/app-layout";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
import { Card } from "@/components/retroui/Card";
import { OverviewCard } from "@/components/overview-cards";
import { Tabs, type TabItem } from "@/components/retroui/Tabs";
import {
  getSubstitutions,
  endSubstitutionEarly,
  cancelSubstitution,
  endBatchSubstitutionsEarly,
  type TeacherSubstitution,
} from "@/lib/api";
import AssignSubstituteModal from "./forms/assign-substitute-modal";
import AdjustSubstitutionModal, { type AdjustModalTarget } from "./forms/adjust-substitution-modal";
import {
  AlertCircle,
  Calendar,
  Edit,
  Layers,
  Loader2,
  Plus,
  Search,
  StopCircle,
  UserCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type SubstitutionTab = "all" | "active" | "completed" | "cancelled";

const substitutionTabs: Array<TabItem<SubstitutionTab>> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "cancelled", label: "Cancelled" },
];

export default function AdminSubstitutions() {
  const [substitutions, setSubstitutions] = React.useState<TeacherSubstitution[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [activeTab, setActiveTab] = React.useState<SubstitutionTab>("all");
  const [searchQuery, setSearchQuery] = React.useState("");

  const [isAssignModalOpen, setIsAssignModalOpen] = React.useState(false);
  const [selectedAdjustTarget, setSelectedAdjustTarget] = React.useState<AdjustModalTarget | null>(null);

  const [actionLoadingId, setActionLoadingId] = React.useState<string | number | null>(null);

  const fetchSubstitutions = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await getSubstitutions();
      setSubstitutions(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to load teacher substitutions."));
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchSubstitutions();
  }, [fetchSubstitutions]);

  // Compute counts per batch_id
  const batchCounts = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of substitutions) {
      if (s.batch_id) {
        counts[s.batch_id] = (counts[s.batch_id] || 0) + 1;
      }
    }
    return counts;
  }, [substitutions]);

  const handleEndEarly = async (sub: TeacherSubstitution) => {
    if (!window.confirm(`Are you sure you want to end substitution for ${sub.subject_name} (${sub.section_name}) early today? This will restore original teacher access immediately.`)) {
      return;
    }

    setActionLoadingId(sub.substitution_id);
    try {
      await endSubstitutionEarly(sub.substitution_id);
      toast.success("Substitution ended successfully. Coverage ended today.");
      await fetchSubstitutions();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to end substitution."));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleEndBatchEarly = async (batchId: string, count: number, teacherName: string) => {
    if (!window.confirm(`Are you sure you want to end all ${count} active subject loads in this program takeover for ${teacherName} today? Access will immediately restore for all loads.`)) {
      return;
    }

    setActionLoadingId(batchId);
    try {
      await endBatchSubstitutionsEarly(batchId);
      toast.success(`Successfully concluded all active loads for ${teacherName}'s leave program.`);
      await fetchSubstitutions();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to end program substitutions."));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (sub: TeacherSubstitution) => {
    if (!window.confirm(`Are you sure you want to cancel this scheduled future substitution?`)) {
      return;
    }

    setActionLoadingId(sub.substitution_id);
    try {
      await cancelSubstitution(sub.substitution_id);
      toast.success("Substitution cancelled.");
      await fetchSubstitutions();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, "Failed to cancel substitution."));
    } finally {
      setActionLoadingId(null);
    }
  };

  // Filtered rows
  const filteredSubstitutions = React.useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return substitutions.filter((sub) => {
      if (activeTab !== "all" && sub.status !== activeTab) {
        return false;
      }
      if (!query) return true;
      return (
        sub.original_staff_name.toLowerCase().includes(query) ||
        sub.original_staff_id.toLowerCase().includes(query) ||
        sub.substitute_staff_name.toLowerCase().includes(query) ||
        sub.substitute_staff_id.toLowerCase().includes(query) ||
        sub.subject_name.toLowerCase().includes(query) ||
        (sub.subject_codename && sub.subject_codename.toLowerCase().includes(query)) ||
        sub.section_name.toLowerCase().includes(query) ||
        (sub.reason && sub.reason.toLowerCase().includes(query))
      );
    });
  }, [substitutions, activeTab, searchQuery]);

  // Counts for metric cards
  const activeCount = substitutions.filter((s) => s.status === "active").length;
  const completedCount = substitutions.filter((s) => s.status === "completed").length;
  const cancelledCount = substitutions.filter((s) => s.status === "cancelled").length;

  const todayStr = new Date().toISOString().split("T")[0];

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-5">
        {/* Header */}
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="md:hidden" />
              <h1 className="text-2xl font-bold tracking-tight md:text-4xl">
                Teacher Substitution Management
              </h1>
          </div>

          <Button
            variant="default"
            size="md"
            onClick={() => setIsAssignModalOpen(true)}
            className="gap-2 self-start whitespace-nowrap sm:self-auto"
          >
            <Plus className="size-4" />
            <span>Assign Substitute</span>
          </Button>
        </header>

        <div className="-mx-4 -mt-[1px] border-b-2 border-border md:-mx-6" />

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-3 md:py-6">
          <OverviewCard title="Active Substitutions" count={String(activeCount)} />
          <OverviewCard title="Completed Handbacks" count={String(completedCount)} />
          <OverviewCard title="Total Tracked" count={String(substitutions.length)} />
        </div>

        {/* Status Tabs & Search */}
        <Tabs
          tabs={substitutionTabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          counts={{
            all: substitutions.length,
            active: activeCount,
            completed: completedCount,
            cancelled: cancelledCount,
          }}
        />

        <div className="flex justify-start py-1">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search teacher, class, subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
        </div>

        {/* Table Content */}
        <Card className="mt-1 w-full rounded-none border-2 border-black bg-white p-0 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          {isLoading ? (
            <div className="p-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              <p className="text-sm">Loading substitution records...</p>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-destructive flex flex-col items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={fetchSubstitutions} className="mt-2">
                Retry
              </Button>
            </div>
          ) : filteredSubstitutions.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-2">
              <UserCheck className="h-8 w-8 text-muted-foreground/50" />
              <p className="font-medium text-base text-foreground">No substitutions found</p>
              <p className="text-xs">
                {searchQuery
                  ? "Try adjusting your search terms or filters."
                  : "Assign a substitute when a teacher goes on maternity leave or extended leave."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="w-full border-collapse text-sm">
                <Table.Header className="border-b-2 border-black bg-yellow-300 text-xs font-black uppercase">
                  <Table.Row>
                    <Table.Head className="font-black text-black">Teacher on Leave</Table.Head>
                    <Table.Head className="font-black text-black">Class & Subject</Table.Head>
                    <Table.Head className="font-black text-black">Substitute Teacher</Table.Head>
                    <Table.Head className="font-black text-black">Coverage Window</Table.Head>
                    <Table.Head className="font-black text-black">Status</Table.Head>
                    <Table.Head className="font-black text-black">Reason</Table.Head>
                    <Table.Head className="text-right font-black text-black">Actions</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredSubstitutions.map((sub) => {
                    const isFuture = sub.start_date > todayStr;
                    const isActionLoading = actionLoadingId === sub.substitution_id || (sub.batch_id && actionLoadingId === sub.batch_id);
                    const isBatchRow = Boolean(sub.batch_id && (batchCounts[sub.batch_id] || 0) > 1);
                    const batchTotal = sub.batch_id ? (batchCounts[sub.batch_id] || 0) : 0;

                    return (
                      <Table.Row key={sub.substitution_id} className="border-b border-black/10 hover:bg-yellow-50/50">
                        <Table.Cell>
                          <div className="text-sm font-extrabold text-black">{sub.original_staff_name}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {sub.original_staff_id}
                          </div>
                          {isBatchRow && (
                            <Badge variant="secondary" className="mt-1 text-[10px] bg-primary/10 text-primary border-primary/20 flex items-center gap-1 w-fit">
                              <Layers className="h-3 w-3" />
                              <span>Program Batch ({batchTotal} loads)</span>
                            </Badge>
                          )}
                        </Table.Cell>

                        <Table.Cell>
                          <div className="font-medium text-sm">
                            {sub.subject_name}{" "}
                            {sub.subject_codename ? (
                              <span className="text-xs text-muted-foreground font-mono">
                                ({sub.subject_codename})
                              </span>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {sub.section_name} • {sub.period_name}
                          </div>
                        </Table.Cell>

                        <Table.Cell>
                          <div className="flex items-center gap-1.5 text-sm font-bold text-black">
                            <UserCheck className="h-3.5 w-3.5" />
                            <span>{sub.substitute_staff_name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {sub.substitute_staff_id}
                          </div>
                        </Table.Cell>

                        <Table.Cell>
                          <div className="text-xs flex items-center gap-1.5 font-medium">
                            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{sub.start_date}</span>
                            <span className="text-muted-foreground">→</span>
                            <span>{sub.end_date || "Open-ended"}</span>
                          </div>
                          {isFuture && sub.status === "active" && (
                            <span className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                              Starts in advance
                            </span>
                          )}
                        </Table.Cell>

                        <Table.Cell>
                          {sub.status === "active" ? (
                            <Badge
                              variant="outline"
                              className="bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300"
                            >
                              Active
                            </Badge>
                          ) : sub.status === "completed" ? (
                            <Badge variant="outline" className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              Completed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300">
                              Cancelled
                            </Badge>
                          )}
                        </Table.Cell>

                        <Table.Cell className="max-w-[180px] truncate text-xs text-muted-foreground">
                          {sub.reason || "—"}
                        </Table.Cell>

                        <Table.Cell className="text-right">
                          {sub.status === "active" && (
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {/* Row-level Adjust */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedAdjustTarget({ type: "single", substitution: sub })}
                                title="Adjust this specific load's end date"
                                className="h-7 px-2 text-xs"
                              >
                                <Edit className="h-3 w-3 mr-1" />
                                Adjust
                              </Button>

                              {/* Row-level End Today */}
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEndEarly(sub)}
                                disabled={Boolean(isActionLoading)}
                                title="End this load today"
                                className="h-7 px-2 text-xs text-amber-600 border-amber-300 hover:bg-amber-50"
                              >
                                <StopCircle className="h-3 w-3 mr-1" />
                                End Today
                              </Button>

                              {/* Batch Actions if multi-load batch */}
                              {isBatchRow && sub.batch_id && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() =>
                                      setSelectedAdjustTarget({
                                        type: "batch",
                                        batchId: sub.batch_id!,
                                        batchCount: batchTotal,
                                        originalTeacherName: sub.original_staff_name,
                                        substituteTeacherName: sub.substitute_staff_name,
                                        startDate: sub.start_date,
                                        currentEndDate: sub.end_date,
                                      })
                                    }
                                    title="Adjust end date for all loads in this program takeover"
                                    className="h-7 px-2 text-xs text-primary border-primary/30 hover:bg-primary/5"
                                  >
                                    <Layers className="h-3 w-3 mr-1" />
                                    Adjust All ({batchTotal})
                                  </Button>

                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleEndBatchEarly(sub.batch_id!, batchTotal, sub.original_staff_name)}
                                    disabled={Boolean(isActionLoading)}
                                    title="End all loads in this program takeover today"
                                    className="h-7 px-2 text-xs text-amber-700 border-amber-400 bg-amber-50/50 hover:bg-amber-100"
                                  >
                                    End All ({batchTotal})
                                  </Button>
                                </>
                              )}

                              {isFuture && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancel(sub)}
                                  disabled={Boolean(isActionLoading)}
                                  title="Cancel future substitution"
                                  className="h-7 px-2 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                                >
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Cancel
                                </Button>
                              )}
                            </div>
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table>
            </div>
          )}
        </Card>
          </div>
        </div>
      </div>

      {/* Assign Substitute Modal */}
      <Dialog open={isAssignModalOpen} onOpenChange={setIsAssignModalOpen}>
        <AssignSubstituteModal
          onClose={() => setIsAssignModalOpen(false)}
          onSuccess={fetchSubstitutions}
        />
      </Dialog>

      {/* Adjust Date Modal (Single or Batch) */}
      {selectedAdjustTarget && (
        <Dialog
          open={Boolean(selectedAdjustTarget)}
          onOpenChange={(open) => {
            if (!open) setSelectedAdjustTarget(null);
          }}
        >
          <AdjustSubstitutionModal
            target={selectedAdjustTarget}
            onClose={() => setSelectedAdjustTarget(null)}
            onSuccess={fetchSubstitutions}
          />
        </Dialog>
      )}
    </AppLayout>
  );
}
