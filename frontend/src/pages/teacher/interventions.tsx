import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import AppLayout from "@/layouts/app-layout";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/teacher/button";
import { Skeleton } from "@/components/retroui/Skeleton";
import { Table } from "@/components/retroui/Table";
import { Tabs } from "@/components/retroui/Tabs";
import { useToast } from "@/components/retroui/Toast";
import { Activity, AlertTriangle, CheckCircle2, HeartHandshake, UserCheck } from "lucide-react";
import { TeacherEmptyState } from "@/components/teacher/teacher-empty-state";
import InterventionModal from "./forms/intervention-modal";
import {
  activateTeacherCandidate,
  getTeacherActive,
  getTeacherCandidate,
  getTeacherResolved,
  InterventionApiError,
  listTeacherActive,
  listTeacherCandidates,
  listTeacherResolved,
  type TeacherInterventionDetail,
  type TeacherInterventionSummary,
  type TeacherResolvedInterventionDetail,
} from "@/lib/teacher-interventions-api";

const label = (value: string) =>
  value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString("en-PH", {
    dateStyle: "medium",
  });

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-PH", {
    timeStyle: "short",
  });

const sameScope = (
  left: TeacherInterventionSummary,
  right: TeacherInterventionSummary
) =>
  left.student_id === right.student_id &&
  left.class_id === right.class_id &&
  left.subject_id === right.subject_id &&
  left.academic_period_id === right.academic_period_id;

const reason = (candidate: TeacherInterventionSummary) => {
  const weakest = candidate.diagnosis_summary.weakest_supported_components ?? [];
  return weakest.length
    ? `Weakest supported: ${weakest.map(label).join(", ")}`
    : "Component detail unavailable in saved diagnosis";
};

export default function TeacherInterventions() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const candidateParam = params.get("candidate");
  const activeParam = params.get("active");
  const resolvedParam = params.get("resolved");

  const selectedKind = resolvedParam
    ? "resolved"
    : activeParam
      ? "active"
      : "candidate";

  const selectedParam = resolvedParam || activeParam || candidateParam;
  const selectedId =
    selectedParam && /^\d+$/.test(selectedParam) ? Number(selectedParam) : null;

  const view =
    selectedKind !== "candidate"
      ? selectedKind
      : params.get("view") === "resolved"
        ? "resolved"
        : params.get("view") === "active"
          ? "active"
          : "candidate";

  const activeView = view === "active";
  const resolvedView = view === "resolved";

  const [items, setItems] = useState<TeacherInterventionSummary[]>([]);
  const [activeItems, setActiveItems] = useState<TeacherInterventionSummary[]>([]);
  const [resolvedItems, setResolvedItems] = useState<TeacherInterventionSummary[]>([]);

  const [loading, setLoading] = useState(true);
  const [activeLoading, setActiveLoading] = useState(true);
  const [resolvedLoading, setResolvedLoading] = useState(true);

  const [listError, setListError] = useState<string | null>(null);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [resolvedError, setResolvedError] = useState<string | null>(null);

  const [detail, setDetail] = useState<
    TeacherInterventionDetail | TeacherResolvedInterventionDetail | null
  >(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [reviewStale, setReviewStale] = useState(false);

  const refresh = async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await listTeacherCandidates();
      setItems(res.items);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load candidates.";
      setListError(message);
      toast.error({
        title: "Failed to load candidates",
        description: message,
      });
    } finally {
      setLoading(false);
    }
  };

  const refreshActive = async () => {
    setActiveLoading(true);
    setActiveError(null);
    try {
      const res = await listTeacherActive();
      setActiveItems(res.items);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load active interventions.";
      setActiveError(message);
      toast.error({
        title: "Failed to load active interventions",
        description: message,
      });
    } finally {
      setActiveLoading(false);
    }
  };

  const refreshResolved = async () => {
    setResolvedLoading(true);
    setResolvedError(null);
    try {
      const res = await listTeacherResolved();
      setResolvedItems(res.items);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to load resolved interventions.";
      setResolvedError(message);
      toast.error({
        title: "Failed to load resolved interventions",
        description: message,
      });
    } finally {
      setResolvedLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void refreshActive();
    void refreshResolved();
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setDetail(null);
        setDetailLoading(true);
        setDetailError(null);
        setActionError(null);
        setReviewStale(false);
      }
    });

    const fetcher =
      selectedKind === "resolved"
        ? getTeacherResolved(selectedId)
        : selectedKind === "active"
          ? getTeacherActive(selectedId)
          : getTeacherCandidate(selectedId);

    fetcher
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(
            error instanceof Error ? error.message : "Unable to load intervention."
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedKind]);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete("candidate");
    next.delete("active");
    next.delete("resolved");
    setParams(next);
  };

  const open = (id: number) => {
    const next = new URLSearchParams(params);
    next.set(view, String(id));
    setParams(next);
  };

  const selectView = (nextView: "candidate" | "active" | "resolved") => {
    const next = new URLSearchParams(params);
    next.delete("candidate");
    next.delete("active");
    next.delete("resolved");
    if (nextView === "candidate") {
      next.delete("view");
    } else {
      next.set("view", nextView);
    }
    setParams(next);
    if (nextView === "resolved") {
      void refreshResolved();
    }
  };

  const activate = async () => {
    if (!detail || activating || reviewStale) return;
    setActivating(true);
    setActionError(null);
    try {
      const active = await activateTeacherCandidate(detail.intervention_id);
      toast.success({
        title: "Intervention approved",
        description: `Intervention approved for ${active.student_name} in ${active.subject_name}.`,
      });
      const next = new URLSearchParams(params);
      next.delete("candidate");
      next.delete("resolved");
      next.set("view", "active");
      next.set("active", String(active.intervention_id));
      setParams(next);
      await Promise.all([refresh(), refreshActive()]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to approve intervention. Please try again.";
      let alertMsg = message;
      if (error instanceof InterventionApiError && error.status === 409) {
        setReviewStale(true);
        alertMsg =
          /improved|at least 85/i.test(message)
            ? "The current prediction improved. This candidate can no longer be approved. Refresh the list to see its current state."
            : /evidence|ready|unavailable|invalid/i.test(message)
              ? "Current prediction evidence is insufficient or unavailable. Approval was not completed."
              : `Candidate state changed: ${message}`;
        setActionError(alertMsg);
        void refresh();
        void refreshActive();
      } else if (
        error instanceof InterventionApiError &&
        (error.status === 401 || error.status === 403)
      ) {
        alertMsg = "You no longer have teaching access to this candidate.";
        setActionError(alertMsg);
      } else {
        setActionError(message);
      }
      toast.error({
        title: "Unable to approve intervention",
        description: alertMsg,
      });
    } finally {
      setActivating(false);
    }
  };

  const sorted = [
    ...(resolvedView ? resolvedItems : activeView ? activeItems : items),
  ].sort((a, b) =>
    resolvedView
      ? (b.resolved_at || "").localeCompare(a.resolved_at || "")
      : activeView
        ? (b.activated_at || "").localeCompare(a.activated_at || "")
        : (a.triggering_intervention_level === "HIGH_RISK" ? 0 : 1) -
        (b.triggering_intervention_level === "HIGH_RISK" ? 0 : 1) ||
        b.created_at.localeCompare(a.created_at)
  );

  const showingLoading = resolvedView
    ? resolvedLoading
    : activeView
      ? activeLoading
      : loading;

  const showingError = resolvedView
    ? resolvedError
    : activeView
      ? activeError
      : listError;

  const previousResolved =
    detail?.status === "ACTIVE"
      ? resolvedItems.find(
        (row) =>
          sameScope(row, detail) &&
          row.resolved_at &&
          Date.parse(row.resolved_at) <
          Date.parse(detail.activated_at || detail.created_at)
      )
      : undefined;

  const newerActive =
    detail?.status === "RESOLVED" && detail.resolved_at
      ? activeItems.find(
        (row) =>
          sameScope(row, detail) &&
          row.activated_at &&
          Date.parse(row.activated_at) > Date.parse(detail.resolved_at!)
      )
      : undefined;

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-1 flex-col">
            <div data-page-tabs-sticky-region>
              <header className="flex items-center justify-between gap-2 bg-background px-3 py-3 sm:gap-3 sm:px-4 sm:py-4 md:px-6">
                <div className="flex items-center gap-3">
                  <SidebarTrigger className="shrink-0 md:hidden" />
                  <h1 className="text-xl font-bold sm:text-2xl md:text-4xl">
                    Interventions
                  </h1>
                </div>
              </header>
              <div className="sticky top-0 z-30 -mt-[1px] bg-background px-3 sm:static sm:px-4 md:px-6">
                <Tabs
                  tabs={[
                    { id: "candidate", label: "Candidates", icon: UserCheck },
                    { id: "active", label: "Active", icon: Activity },
                    { id: "resolved", label: "Resolved", icon: CheckCircle2 },
                  ]}
                  activeTab={view}
                  onTabChange={(nextView) =>
                    selectView(nextView as "candidate" | "active" | "resolved")
                  }
                />
              </div>
            </div>

            <main className="border-t-1 -mt-[1px] flex min-w-0 flex-col gap-4 border-border px-3 py-4 sm:px-4 md:px-6">
              {showingLoading ? (
                <div
                  aria-label={
                    resolvedView
                      ? "Loading resolved interventions"
                      : activeView
                        ? "Loading active interventions"
                        : "Loading candidates"
                  }
                  className="space-y-3"
                >
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : showingError ? (
                <TeacherEmptyState
                  icon={<AlertTriangle />}
                  title="Unable to load interventions"
                  description={showingError}
                  action={{
                    label: "Retry",
                    onClick: () => void (resolvedView
                      ? refreshResolved()
                      : activeView
                        ? refreshActive()
                        : refresh()),
                  }}
                />
              ) : sorted.length === 0 ? (
                <TeacherEmptyState
                  icon={<HeartHandshake />}
                  title={resolvedView ? "No resolved interventions" : activeView ? "No active interventions" : "No candidates to review"}
                  description={resolvedView
                    ? "Resolved support will appear here."
                    : activeView
                      ? "Approved interventions will appear here."
                      : "New candidates will appear when a current corrected prediction qualifies."}
                />
              ) : (
                <Table wrapperClassName="h-auto">
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>Student</Table.Head>
                      <Table.Head>Subject</Table.Head>
                      <Table.Head className="text-center">Trigger</Table.Head>
                      <Table.Head className="text-center">Status</Table.Head>
                      <Table.Head>Saved reason</Table.Head>
                      <Table.Head>
                        {resolvedView
                          ? "Resolved"
                          : activeView
                            ? "Activated"
                            : "Created"}
                      </Table.Head>
                      <Table.Head className="w-10">Review</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {sorted.map((candidate) => (
                      <Table.Row key={candidate.intervention_id}>
                        <Table.Cell className="font-semibold">
                          {candidate.student_name}
                          <span className="block text-xs text-muted-foreground">
                            {candidate.student_lrn}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="text-sm font-semibold">
                            {candidate.subject_name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {candidate.class_name} · {candidate.academic_period_name}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="font-semibold text-center">
                          {candidate.triggering_predicted_grade.toFixed(2)}
                        </Table.Cell>
                        <Table.Cell className="flex flex-row items-center justify-center mt-2">
                          <Badge variant="surface" size="sm">
                            {label(candidate.triggering_intervention_level)}
                          </Badge>
                        </Table.Cell>
                        <Table.Cell>
                          {resolvedView
                            ? label(candidate.resolution_reason || "Unavailable")
                            : reason(candidate)}
                        </Table.Cell>
                        <Table.Cell>
                          {(() => {
                            const rawDate =
                              resolvedView && candidate.resolved_at
                                ? candidate.resolved_at
                                : activeView && candidate.activated_at
                                  ? candidate.activated_at
                                  : candidate.created_at;
                            if (!rawDate) return "—";
                            return (
                              <div className="flex flex-col leading-tight">
                                <span className="font-semibold text-sm text-black">
                                  {formatDate(rawDate)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {formatTime(rawDate)}
                                </span>
                              </div>
                            );
                          })()}
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            size="sm"
                            variant="outline"
                            autoIcon={false}
                            onClick={() => open(candidate.intervention_id)}
                          >
                            Review
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              )}
            </main>
          </div>
        </div>
      </div>

      <InterventionModal
        isOpen={selectedId !== null}
        onClose={close}
        selectedKind={selectedKind}
        detail={detail}
        detailLoading={detailLoading}
        detailError={detailError}
        actionError={actionError}
        activating={activating}
        reviewStale={reviewStale}
        onActivate={activate}
        previousResolved={previousResolved}
        newerActive={newerActive}
      />
    </AppLayout>
  );
}
