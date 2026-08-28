import * as React from "react";
import AppLayout from "@/layouts/app-layout";
import { Text } from "@/components/retroui/Text";
import { Button } from "@/components/retroui/Button";
import { Table } from "@/components/retroui/Table";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";
import { Breadcrumb } from "@/components/retroui/Breadcrumb";
import { Input } from "@/components/retroui/Input";
import { Dialog } from "@/components/retroui/Dialog";
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
  CheckCircle2,
  Edit,
  Layers,
  Loader2,
  Plus,
  Search,
  StopCircle,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";


export default function AdminSubstitutions() {
  const [substitutions, setSubstitutions] = React.useState<TeacherSubstitution[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [activeTab, setActiveTab] = React.useState<"all" | "active" | "completed" | "cancelled">("all");
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
    } catch (err: any) {
      setError(err?.message || "Failed to load teacher substitutions.");
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
    } catch (err: any) {
      toast.error(err?.message || "Failed to end substitution.");
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
    } catch (err: any) {
      toast.error(err?.message || "Failed to end program substitutions.");
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
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel substitution.");
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
      <div className="flex flex-1 flex-col gap-6 p-6">
        {/* Header with Breadcrumb & Action */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="-ml-1" />
            <div className="space-y-1">
              <Breadcrumb>
                <Breadcrumb.List className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Breadcrumb.Item>
                    <Breadcrumb.Link href="/admin/dashboard" className="text-xs font-normal">
                      Admin
                    </Breadcrumb.Link>
                  </Breadcrumb.Item>
                  <Breadcrumb.Separator />
                  <Breadcrumb.Item>
                    <Breadcrumb.Page className="text-xs font-semibold text-foreground">
                      Teacher Substitutions
                    </Breadcrumb.Page>
                  </Breadcrumb.Item>
                </Breadcrumb.List>
              </Breadcrumb>
              <Text as="h3" className="font-sans text-2xl font-bold tracking-tight">
                Teacher Substitution Management
              </Text>
            </div>
          </div>

          <Button
            onClick={() => setIsAssignModalOpen(true)}
            className="flex items-center gap-2 self-start sm:self-auto"
          >
            <Plus className="h-4 w-4" />
            <span>Assign Substitute</span>
          </Button>
        </div>

        {/* Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <UserCheck className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Active Substitutions</p>
              <h4 className="text-2xl font-bold">{activeCount}</h4>
            </div>
          </div>

          <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Completed Handbacks</p>
              <h4 className="text-2xl font-bold">{completedCount}</h4>
            </div>
          </div>

          <div className="p-4 rounded-xl border bg-card text-card-foreground shadow-sm flex items-center gap-4">
            <div className="p-3 rounded-lg bg-slate-500/10 text-slate-600 dark:text-slate-400">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Total Tracked</p>
              <h4 className="text-2xl font-bold">{substitutions.length}</h4>
            </div>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 border rounded-lg p-1 bg-muted/30">
            {(
              [
                { id: "all", label: `All (${substitutions.length})` },
                { id: "active", label: `Active (${activeCount})` },
                { id: "completed", label: `Completed (${completedCount})` },
                { id: "cancelled", label: `Cancelled (${cancelledCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  activeTab === tab.id
                    ? "bg-background text-foreground shadow-sm font-semibold"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search teacher, class, subject..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
        </div>

        {/* Table Content */}
        <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
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
              <Table>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>Teacher on Leave</Table.Head>
                    <Table.Head>Class & Subject</Table.Head>
                    <Table.Head>Substitute Teacher</Table.Head>
                    <Table.Head>Coverage Window</Table.Head>
                    <Table.Head>Status</Table.Head>
                    <Table.Head>Reason</Table.Head>
                    <Table.Head className="text-right">Actions</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredSubstitutions.map((sub) => {
                    const isFuture = sub.start_date > todayStr;
                    const isActionLoading = actionLoadingId === sub.substitution_id || (sub.batch_id && actionLoadingId === sub.batch_id);
                    const isBatchRow = Boolean(sub.batch_id && (batchCounts[sub.batch_id] || 0) > 1);
                    const batchTotal = sub.batch_id ? (batchCounts[sub.batch_id] || 0) : 0;

                    return (
                      <Table.Row key={sub.substitution_id}>
                        <Table.Cell>
                          <div className="font-semibold text-sm">{sub.original_staff_name}</div>
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
                          <div className="font-semibold text-sm text-primary flex items-center gap-1.5">
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
