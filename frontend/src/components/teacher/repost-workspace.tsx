import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Award,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  FileText,
  FolderSync,
  Inbox,
  Loader2,
  Package,
  PackageCheck,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { Button } from "@/components/retroui/Button";
import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Dialog } from "@/components/retroui/Dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  cloneSelfMaterials,
  createContentRequest,
  createPackage,
  decidePackage,
  declineContentRequest,
  getContentRequests,
  getDestinationScopes,
  getEligibleMaterials,
  getPackagePreview,
  getSelfCloneMaterials,
  getSourceTeachers,
  type ContentCloneOperation,
  type ContentShareRequest,
  type ContentShareRequestListResponse,
  type DestinationScope,
  type OwnerEligibleMaterialItem,
  type RequesterVisiblePackageSummary,
  type SourceTeacher,
} from "@/lib/content-cloning-api";
import {
  getAcademicPeriodsSettings,
  getAcademicYearsSettings,
  type AcademicPeriodSettingItem,
  type AcademicYearSettingItem,
} from "@/lib/settings-api";

export type RepostWorkspaceTab = "reuse" | "request" | "received" | "sent";

export interface RepostWorkspaceProps {
  initialTab?: RepostWorkspaceTab;
  destinationClassId?: number;
  destinationSubjectId?: number;
  destinationAcademicPeriodId?: number;
  sectionName?: string;
  subjectName?: string;
  academicPeriodName?: string;
  onClonedSuccess?: () => void;
  isDialogContext?: boolean;
  onCloseDialog?: () => void;
}

export function RepostWorkspace({
  initialTab = "reuse",
  destinationClassId: propClassId,
  destinationSubjectId: propSubjectId,
  destinationAcademicPeriodId: propPeriodId,
  sectionName: propSectionName,
  subjectName: propSubjectName,
  academicPeriodName: propPeriodName,
  onClonedSuccess,
  isDialogContext = false,
  onCloseDialog,
}: RepostWorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // URL query parameter resolution
  const urlBox = searchParams.get("box");
  const urlTab = searchParams.get("tab") as RepostWorkspaceTab | null;
  const urlRequestId = searchParams.get("request_id") || searchParams.get("requestId") || "";

  const computedInitialTab = useMemo<RepostWorkspaceTab>(() => {
    if (urlBox === "incoming") return "received";
    if (urlBox === "outgoing") return "sent";
    if (urlTab === "reuse" || urlTab === "request" || urlTab === "received" || urlTab === "sent") {
      return urlTab;
    }
    return initialTab;
  }, [urlBox, urlTab, initialTab]);

  const [activeTab, setActiveTab] = useState<RepostWorkspaceTab>(computedInitialTab);

  // Sync tab with URL parameter changes if not in dialog context
  useEffect(() => {
    if (!isDialogContext) {
      if (urlBox === "incoming") setActiveTab("received");
      else if (urlBox === "outgoing") setActiveTab("sent");
      else if (urlTab) setActiveTab(urlTab);
    }
  }, [urlBox, urlTab, isDialogContext]);

  // Destination scopes state (when opened without direct props)
  const [availableScopes, setAvailableScopes] = useState<DestinationScope[]>([]);
  const [loadingScopes, setLoadingScopes] = useState(false);
  const [selectedScopeKey, setSelectedScopeKey] = useState<string>("");

  useEffect(() => {
    if (!propClassId || !propSubjectId || !propPeriodId) {
      setLoadingScopes(true);
      getDestinationScopes()
        .then((scopes) => {
          setAvailableScopes(scopes || []);
          if (scopes && scopes.length > 0) {
            setSelectedScopeKey(`${scopes[0].class_id}:${scopes[0].subject_id}:${scopes[0].academic_period_id}`);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingScopes(false));
    }
  }, [propClassId, propSubjectId, propPeriodId]);

  // Active destination scope
  const activeDestination = useMemo(() => {
    if (propClassId && propSubjectId && propPeriodId) {
      return {
        classId: propClassId,
        subjectId: propSubjectId,
        periodId: propPeriodId,
        sectionName: propSectionName || "Assigned Class",
        subjectName: propSubjectName || "Subject",
        periodName: propPeriodName || "Active Term",
      };
    }
    if (availableScopes.length > 0) {
      const match = availableScopes.find(
        (s) => `${s.class_id}:${s.subject_id}:${s.academic_period_id}` === selectedScopeKey,
      );
      if (match) {
        return {
          classId: match.class_id,
          subjectId: match.subject_id,
          periodId: match.academic_period_id,
          sectionName: match.section_name,
          subjectName: match.subject_name,
          periodName: match.period_name,
        };
      }
    }
    return null;
  }, [
    propClassId,
    propSubjectId,
    propPeriodId,
    propSectionName,
    propSubjectName,
    propPeriodName,
    availableScopes,
    selectedScopeKey,
  ]);

  // -------------------------------------------------------------------------
  // TAB 1: Reuse My Previous Materials
  // -------------------------------------------------------------------------
  const [selfLoading, setSelfLoading] = useState(false);
  const [selfError, setSelfError] = useState("");
  const [selfMaterials, setSelfMaterials] = useState<OwnerEligibleMaterialItem[]>([]);
  const [selfItemTypeFilter, setSelfItemTypeFilter] = useState<string>("ALL");
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [cloningInProgress, setCloningInProgress] = useState(false);
  const [cloneSuccessResult, setCloneSuccessResult] = useState<ContentCloneOperation | null>(null);

  const loadSelfMaterials = useCallback(async () => {
    if (!activeDestination) return;
    setSelfLoading(true);
    setSelfError("");
    setCloneSuccessResult(null);
    try {
      const res = await getSelfCloneMaterials({
        destination_class_id: activeDestination.classId,
        destination_subject_id: activeDestination.subjectId,
        destination_academic_period_id: activeDestination.periodId,
      });
      setSelfMaterials(res.items || []);
      setSelectedTokens(new Set());
    } catch (err: any) {
      setSelfError(err.message || "Unable to load prior materials for self-cloning.");
    } finally {
      setSelfLoading(false);
    }
  }, [activeDestination]);

  useEffect(() => {
    if (activeTab === "reuse" && activeDestination) {
      void loadSelfMaterials();
    }
  }, [activeTab, activeDestination, loadSelfMaterials]);

  const filteredSelfMaterials = useMemo(() => {
    if (selfItemTypeFilter === "ALL") return selfMaterials;
    return selfMaterials.filter((item) => item.item_type === selfItemTypeFilter);
  }, [selfMaterials, selfItemTypeFilter]);

  const toggleItemSelection = (token: string) => {
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      if (next.has(token)) next.delete(token);
      else next.add(token);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedTokens((prev) => {
      const next = new Set(prev);
      filteredSelfMaterials.forEach((item) => next.add(item.source_revision_token));
      return next;
    });
  };

  const deselectAll = () => {
    setSelectedTokens(new Set());
  };

  const handleSelfCloneExecute = async () => {
    if (!activeDestination || selectedTokens.size === 0) return;
    setCloningInProgress(true);
    setSelfError("");
    try {
      const itemsToClone = selfMaterials
        .filter((item) => selectedTokens.has(item.source_revision_token))
        .map((item) => ({
          item_type: item.item_type,
          source_entity_id: item.source_entity_id,
          source_revision_token: item.source_revision_token,
        }));

      const op = await cloneSelfMaterials({
        destination_class_id: activeDestination.classId,
        destination_subject_id: activeDestination.subjectId,
        destination_academic_period_id: activeDestination.periodId,
        items: itemsToClone,
      });

      setCloneSuccessResult(op);
      onClonedSuccess?.();
    } catch (err: any) {
      setSelfError(err.message || "Failed to clone selected materials.");
    } finally {
      setCloningInProgress(false);
    }
  };

  // -------------------------------------------------------------------------
  // TAB 2: Request from Another Teacher
  // -------------------------------------------------------------------------
  const [scopeMode, setScopeMode] = useState<"ANY" | "ALL_TERMS" | "PERIOD">("ANY");
  const [selectedSourceYearId, setSelectedSourceYearId] = useState<string>("");
  const [selectedSourcePeriodId, setSelectedSourcePeriodId] = useState<string>("");

  const [allAcademicYears, setAllAcademicYears] = useState<AcademicYearSettingItem[]>([]);
  const [allAcademicPeriods, setAllAcademicPeriods] = useState<AcademicPeriodSettingItem[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(false);

  // Load calendar settings (years and periods) to build dynamic selectors
  useEffect(() => {
    let active = true;
    setLoadingCalendar(true);
    Promise.all([getAcademicYearsSettings(), getAcademicPeriodsSettings()])
      .then(([years, periods]) => {
        if (!active) return;
        setAllAcademicYears(years || []);
        setAllAcademicPeriods(periods || []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingCalendar(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Determine threshold: destination period start date (in ms)
  const destinationPeriodStartDateMs = useMemo(() => {
    if (!activeDestination || allAcademicPeriods.length === 0) return null;
    const destPeriod = allAcademicPeriods.find((p) => p.id === activeDestination.periodId);
    if (destPeriod && destPeriod.startDate) {
      return new Date(destPeriod.startDate).getTime();
    }
    return null;
  }, [activeDestination, allAcademicPeriods]);

  // Valid historical academic periods (strictly end_date < destination_period.start_date)
  const eligibleHistoricalPeriods = useMemo(() => {
    if (!destinationPeriodStartDateMs) {
      // Fallback: exclude the active destination period itself
      return allAcademicPeriods.filter((p) => p.id !== activeDestination?.periodId);
    }
    return allAcademicPeriods.filter((p) => {
      if (!p.endDate) return false;
      const endMs = new Date(p.endDate).getTime();
      return endMs < destinationPeriodStartDateMs;
    });
  }, [allAcademicPeriods, destinationPeriodStartDateMs, activeDestination]);

  // Valid historical academic years (must contain at least one eligible period)
  const eligibleHistoricalYears = useMemo(() => {
    const eligibleYearIds = new Set(eligibleHistoricalPeriods.map((p) => p.academic_year_id));
    return allAcademicYears.filter((y) => eligibleYearIds.has(y.academic_year_id));
  }, [allAcademicYears, eligibleHistoricalPeriods]);

  // Filtered periods for the currently selected source year (for PERIOD mode)
  const periodsForSelectedYear = useMemo(() => {
    if (!selectedSourceYearId) return [];
    const yearIdNum = Number(selectedSourceYearId);
    return eligibleHistoricalPeriods.filter((p) => p.academic_year_id === yearIdNum);
  }, [eligibleHistoricalPeriods, selectedSourceYearId]);

  // Reset dependent selections when search mode changes
  const handleScopeModeChange = (newMode: "ANY" | "ALL_TERMS" | "PERIOD") => {
    setScopeMode(newMode);
    setTeachersError("");
    setRequestSentSuccess(null);
    if (newMode === "ANY") {
      setSelectedSourceYearId("");
      setSelectedSourcePeriodId("");
    } else if (newMode === "ALL_TERMS") {
      setSelectedSourcePeriodId("");
      if (!selectedSourceYearId && eligibleHistoricalYears.length > 0) {
        setSelectedSourceYearId(String(eligibleHistoricalYears[0].academic_year_id));
      }
    } else if (newMode === "PERIOD") {
      if (!selectedSourceYearId && eligibleHistoricalYears.length > 0) {
        setSelectedSourceYearId(String(eligibleHistoricalYears[0].academic_year_id));
      }
    }
  };

  // Ensure a valid historical year is selected in ALL_TERMS or PERIOD mode
  useEffect(() => {
    if ((scopeMode === "ALL_TERMS" || scopeMode === "PERIOD") && eligibleHistoricalYears.length > 0) {
      const currentYearValid = eligibleHistoricalYears.some(
        (y) => String(y.academic_year_id) === selectedSourceYearId,
      );
      if (!currentYearValid) {
        setSelectedSourceYearId(String(eligibleHistoricalYears[0].academic_year_id));
      }
    }
  }, [scopeMode, eligibleHistoricalYears, selectedSourceYearId]);

  // If year changes in PERIOD mode, pick the first valid period in that year
  useEffect(() => {
    if (scopeMode === "PERIOD" && selectedSourceYearId) {
      if (periodsForSelectedYear.length > 0) {
        const currentPeriodValid = periodsForSelectedYear.some(
          (p) => String(p.id) === selectedSourcePeriodId,
        );
        if (!currentPeriodValid) {
          setSelectedSourcePeriodId(String(periodsForSelectedYear[0].id));
        }
      } else {
        setSelectedSourcePeriodId("");
      }
    }
  }, [scopeMode, selectedSourceYearId, periodsForSelectedYear, selectedSourcePeriodId]);

  // Determine whether current source scope parameters are valid according to backend contract
  const isSourceScopeValid = useMemo(() => {
    if (scopeMode === "ANY") return true;
    if (scopeMode === "ALL_TERMS") return Boolean(selectedSourceYearId);
    if (scopeMode === "PERIOD") return Boolean(selectedSourceYearId && selectedSourcePeriodId);
    return false;
  }, [scopeMode, selectedSourceYearId, selectedSourcePeriodId]);

  // Source teacher discovery
  const [teachersLoading, setTeachersLoading] = useState(false);
  const [teachersError, setTeachersError] = useState("");
  const [sourceTeachers, setSourceTeachers] = useState<SourceTeacher[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>("");
  const [requestMessage, setRequestMessage] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestSentSuccess, setRequestSentSuccess] = useState<ContentShareRequest | null>(null);

  const loadSourceTeachers = useCallback(async () => {
    if (!activeDestination) return;
    if (!isSourceScopeValid) {
      setSourceTeachers([]);
      setSelectedTeacherId("");
      return;
    }
    setTeachersLoading(true);
    setTeachersError("");
    setRequestSentSuccess(null);
    try {
      const teachers = await getSourceTeachers({
        destination_class_id: activeDestination.classId,
        destination_subject_id: activeDestination.subjectId,
        destination_academic_period_id: activeDestination.periodId,
        source_scope_mode: scopeMode,
        source_academic_year_id: selectedSourceYearId ? Number(selectedSourceYearId) : undefined,
        source_academic_period_id: selectedSourcePeriodId ? Number(selectedSourcePeriodId) : undefined,
      });
      setSourceTeachers(teachers || []);
      if (teachers && teachers.length > 0) {
        setSelectedTeacherId(teachers[0].staff_id);
      } else {
        setSelectedTeacherId("");
      }
    } catch (err: any) {
      setTeachersError(err.message || "Unable to check eligible teachers.");
    } finally {
      setTeachersLoading(false);
    }
  }, [activeDestination, isSourceScopeValid, scopeMode, selectedSourceYearId, selectedSourcePeriodId]);

  useEffect(() => {
    if (activeTab === "request" && activeDestination) {
      void loadSourceTeachers();
    }
  }, [activeTab, activeDestination, loadSourceTeachers]);

  const handleSendRequest = async () => {
    if (!activeDestination || !selectedTeacherId || !isSourceScopeValid) return;
    setSendingRequest(true);
    setTeachersError("");
    try {
      const req = await createContentRequest({
        source_owner_staff_id: selectedTeacherId,
        subject_id: activeDestination.subjectId,
        source_scope_mode: scopeMode,
        source_academic_year_id: selectedSourceYearId ? Number(selectedSourceYearId) : undefined,
        source_academic_period_id: selectedSourcePeriodId ? Number(selectedSourcePeriodId) : undefined,
        destination_class_id: activeDestination.classId,
        destination_subject_id: activeDestination.subjectId,
        destination_academic_period_id: activeDestination.periodId,
        message: requestMessage.trim() || undefined,
      });
      setRequestSentSuccess(req);
    } catch (err: any) {
      setTeachersError(err.message || "Failed to send request.");
    } finally {
      setSendingRequest(false);
    }
  };

  // -------------------------------------------------------------------------
  // TABS 3 & 4: Received Requests and Sent Requests (Global across subjects)
  // -------------------------------------------------------------------------
  const [incomingData, setIncomingData] = useState<ContentShareRequestListResponse | null>(null);
  const [outgoingData, setOutgoingData] = useState<ContentShareRequestListResponse | null>(null);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState("");

  const loadRequests = useCallback(async (boxToLoad: "incoming" | "outgoing") => {
    setLoadingRequests(true);
    setRequestsError("");
    try {
      const data = await getContentRequests(boxToLoad, 1, 50);
      if (boxToLoad === "incoming") setIncomingData(data);
      else setOutgoingData(data);
    } catch (err: any) {
      setRequestsError(err.message || "Failed to load requests.");
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "received") void loadRequests("incoming");
    if (activeTab === "sent") void loadRequests("outgoing");
  }, [activeTab, loadRequests]);

  // Modal states for packaging / preview / decline
  const [packagingRequest, setPackagingRequest] = useState<ContentShareRequest | null>(null);
  const [eligibleMaterials, setEligibleMaterials] = useState<OwnerEligibleMaterialItem[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [packagingTokens, setPackagingTokens] = useState<Set<string>>(new Set());
  const [submittingPackage, setSubmittingPackage] = useState(false);
  const [packageError, setPackageError] = useState("");

  const [previewRequest, setPreviewRequest] = useState<ContentShareRequest | null>(null);
  const [packagePreview, setPackagePreview] = useState<RequesterVisiblePackageSummary | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [decisionInProgress, setDecisionInProgress] = useState(false);
  const [cloneOperationResult, setCloneOperationResult] = useState<ContentCloneOperation | null>(null);

  const [declineTarget, setDeclineTarget] = useState<ContentShareRequest | null>(null);
  const [decliningInProgress, setDecliningInProgress] = useState(false);

  // Auto-open requested item from URL query parameter (deep-link support)
  useEffect(() => {
    if (!urlRequestId) return;
    const currentList = activeTab === "received" ? incomingData?.items : outgoingData?.items;
    if (!currentList || currentList.length === 0) return;

    const matched = currentList.find((r) => r.request_id === urlRequestId);
    if (!matched) return;

    if (activeTab === "received" && matched.status === "PENDING_OWNER") {
      void openPackageModal(matched);
    } else if (activeTab === "sent" && matched.status === "PACKAGE_SENT") {
      void openPreviewModal(matched);
    }
  }, [urlRequestId, activeTab, incomingData, outgoingData]);

  // Packaging Modal Handlers (Starts with 0 items selected)
  const openPackageModal = async (req: ContentShareRequest) => {
    setPackagingRequest(req);
    setPackagingTokens(new Set()); // Starts with 0 selected
    setPackageError("");
    setLoadingMaterials(true);
    try {
      const res = await getEligibleMaterials(req.request_id);
      setEligibleMaterials(res.items || []);
    } catch (err: any) {
      setPackageError(err.message || "Unable to load eligible materials.");
    } finally {
      setLoadingMaterials(false);
    }
  };

  const handleSelectAllPackaging = () => {
    setPackagingTokens(new Set(eligibleMaterials.map((m) => m.source_revision_token)));
  };

  const handleDeselectAllPackaging = () => {
    setPackagingTokens(new Set());
  };

  const handleSendPackage = async () => {
    if (!packagingRequest || packagingTokens.size === 0) return;
    setSubmittingPackage(true);
    setPackageError("");
    try {
      const itemsToPackage = eligibleMaterials
        .filter((item) => packagingTokens.has(item.source_revision_token))
        .map((item) => ({
          item_type: item.item_type,
          source_entity_id: item.source_entity_id,
          source_revision_token: item.source_revision_token,
        }));

      await createPackage(packagingRequest.request_id, {
        expected_version: packagingRequest.version,
        items: itemsToPackage,
      });

      setPackagingRequest(null);
      void loadRequests("incoming");
    } catch (err: any) {
      setPackageError(err.message || "Failed to freeze and send package.");
    } finally {
      setSubmittingPackage(false);
    }
  };

  // Preview & Decision Handlers
  const openPreviewModal = async (req: ContentShareRequest) => {
    setPreviewRequest(req);
    setPackagePreview(null);
    setPreviewError("");
    setCloneOperationResult(null);
    setLoadingPreview(true);
    try {
      const prev = await getPackagePreview(req.request_id);
      setPackagePreview(prev);
    } catch (err: any) {
      setPreviewError(err.message || "Unable to load package preview.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleAcceptPackage = async () => {
    if (!previewRequest) return;
    setDecisionInProgress(true);
    setPreviewError("");
    try {
      const res = await decidePackage(previewRequest.request_id, {
        decision: "ACCEPT",
        expected_version: previewRequest.version,
      });
      if ("operation_id" in res) {
        setCloneOperationResult(res as ContentCloneOperation);
      }
      void loadRequests("outgoing");
      onClonedSuccess?.();
    } catch (err: any) {
      setPreviewError(err.message || "Failed to accept and clone package.");
    } finally {
      setDecisionInProgress(false);
    }
  };

  const handleDeclinePackage = async () => {
    if (!previewRequest) return;
    setDecisionInProgress(true);
    setPreviewError("");
    try {
      await decidePackage(previewRequest.request_id, {
        decision: "DECLINE",
        expected_version: previewRequest.version,
      });
      setPreviewRequest(null);
      void loadRequests("outgoing");
    } catch (err: any) {
      setPreviewError(err.message || "Failed to decline package.");
    } finally {
      setDecisionInProgress(false);
    }
  };

  const handleDeclineConfirm = async () => {
    if (!declineTarget) return;
    setDecliningInProgress(true);
    try {
      await declineContentRequest(declineTarget.request_id, declineTarget.version);
      setDeclineTarget(null);
      void loadRequests("incoming");
    } catch (err: any) {
      setRequestsError(err.message || "Failed to decline request.");
    } finally {
      setDecliningInProgress(false);
    }
  };

  // Helper icons
  const getItemTypeIcon = (type: string) => {
    switch (type) {
      case "COMPETENCY":
        return <Award className="size-4 shrink-0 text-amber-700" />;
      case "LESSON":
        return <BookOpen className="size-4 shrink-0 text-blue-700" />;
      case "CLASSWORK":
        return <ClipboardList className="size-4 shrink-0 text-purple-700" />;
      default:
        return <FileText className="size-4 shrink-0 text-gray-700" />;
    }
  };

  // Navigation tab switcher (updates URL query params if route-backed)
  const handleTabSwitch = (tab: RepostWorkspaceTab) => {
    setActiveTab(tab);
    if (!isDialogContext) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        if (tab === "received") next.set("box", "incoming");
        else if (tab === "sent") next.set("box", "outgoing");
        else next.delete("box");
        next.delete("request_id");
        next.delete("requestId");
        return next;
      });
    }
  };

  // Status badge styling
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING_OWNER":
        return (
          <Badge variant="outline" className="border-amber-500 bg-amber-50 text-amber-800 font-bold">
            <Clock className="size-3 mr-1 inline" /> Pending Colleague
          </Badge>
        );
      case "PACKAGE_SENT":
        return (
          <Badge variant="solid" className="border border-black bg-blue-500 text-white font-bold">
            <Package className="size-3 mr-1 inline" /> Package Ready
          </Badge>
        );
      case "ACCEPTED":
        return (
          <Badge variant="solid" className="border border-black bg-emerald-500 text-white font-bold">
            <Check className="size-3 mr-1 inline" /> Cloned & Accepted
          </Badge>
        );
      case "DECLINED_BY_OWNER":
      case "DECLINED_BY_REQUESTER":
        return (
          <Badge variant="outline" className="border-red-500 bg-red-50 text-red-700 font-bold">
            <X className="size-3 mr-1 inline" /> Declined
          </Badge>
        );
      case "EXPIRED":
        return (
          <Badge variant="outline" className="border-gray-400 bg-gray-100 text-gray-600 font-bold">
            Expired
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background text-foreground">
      {/* ── Destination Header / Selector ── */}
      <div className="bg-white border-b-2 border-black p-4 shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-0.5">
              Proposed Destination
            </span>
            {activeDestination ? (
              <div className="flex items-center gap-2">
                <h4 className="text-base sm:text-lg font-black font-head text-foreground truncate">
                  {activeDestination.subjectName} &middot; {activeDestination.sectionName}
                </h4>
                <Badge variant="outline" size="sm" className="border-black font-bold shrink-0">
                  {activeDestination.periodName}
                </Badge>
              </div>
            ) : loadingScopes ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Loading your teaching loads...
              </div>
            ) : availableScopes.length > 0 ? (
              <div className="flex items-center gap-2">
                <select
                  value={selectedScopeKey}
                  onChange={(e) => setSelectedScopeKey(e.target.value)}
                  className="border-2 border-black p-1.5 rounded text-xs font-bold bg-white"
                >
                  {availableScopes.map((s) => (
                    <option
                      key={`${s.class_id}:${s.subject_id}:${s.academic_period_id}`}
                      value={`${s.class_id}:${s.subject_id}:${s.academic_period_id}`}
                    >
                      {s.subject_name} &middot; {s.section_name} ({s.period_name})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="text-xs text-amber-700 font-semibold">
                No active destination teaching loads found for cloning.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Unified 4-Tab Bar ── */}
      <div className="flex border-b-2 border-black bg-gray-100 shrink-0 overflow-x-auto">
        <button
          type="button"
          onClick={() => handleTabSwitch("reuse")}
          className={`flex-1 min-w-[140px] py-3 px-4 font-bold text-xs sm:text-sm border-r-2 border-black transition-colors flex items-center justify-center gap-2 ${
            activeTab === "reuse" ? "bg-white text-black shadow-inner" : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          <FolderSync className="size-4 shrink-0" />
          <span className="truncate">Reuse My Previous Materials</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabSwitch("request")}
          className={`flex-1 min-w-[140px] py-3 px-4 font-bold text-xs sm:text-sm border-r-2 border-black transition-colors flex items-center justify-center gap-2 ${
            activeTab === "request" ? "bg-white text-black shadow-inner" : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          <Send className="size-4 shrink-0" />
          <span className="truncate">Request from Another Teacher</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabSwitch("received")}
          className={`flex-1 min-w-[120px] py-3 px-4 font-bold text-xs sm:text-sm border-r-2 border-black transition-colors flex items-center justify-center gap-2 ${
            activeTab === "received" ? "bg-white text-black shadow-inner" : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          <Inbox className="size-4 shrink-0" />
          <span className="truncate">Received Requests</span>
          {incomingData?.badges?.pending ? (
            <span className="ml-1 size-5 rounded-full bg-amber-400 text-black text-[10px] font-black flex items-center justify-center border border-black">
              {incomingData.badges.pending}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => handleTabSwitch("sent")}
          className={`flex-1 min-w-[120px] py-3 px-4 font-bold text-xs sm:text-sm transition-colors flex items-center justify-center gap-2 ${
            activeTab === "sent" ? "bg-white text-black shadow-inner" : "text-gray-600 hover:bg-gray-200"
          }`}
        >
          <PackageCheck className="size-4 shrink-0" />
          <span className="truncate">Sent Requests</span>
          {outgoingData?.badges?.package_sent ? (
            <span className="ml-1 size-5 rounded-full bg-blue-500 text-white text-[10px] font-black flex items-center justify-center border border-black">
              {outgoingData.badges.package_sent}
            </span>
          ) : null}
        </button>
      </div>

      {/* ── Tab Content Container ── */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {/* =================================================================== */}
        {/* TAB 1: REUSE MY PREVIOUS MATERIALS                                  */}
        {/* =================================================================== */}
        {activeTab === "reuse" && (
          <div className="space-y-4">
            <div className="bg-amber-50 border-2 border-black p-4 rounded text-xs text-gray-800">
              <p className="font-bold">Reuse Your Historical Curriculum Materials</p>
              <p className="mt-1 text-gray-700">
                Directly copy competencies, lessons, and classworks from your previous academic years into{" "}
                <strong>{activeDestination?.sectionName || "your destination section"}</strong>. Cloned items
                will initially be created as unpublished drafts for you to review and customize.
              </p>
            </div>

            {cloneSuccessResult && (
              <div className="border-2 border-black bg-emerald-50 p-6 rounded text-center space-y-3">
                <div className="flex size-12 mx-auto items-center justify-center rounded-full border-2 border-black bg-emerald-400">
                  <CheckCircle2 className="size-7 text-black" />
                </div>
                <h4 className="text-xl font-bold text-emerald-900 font-head">Materials Successfully Reused!</h4>
                <p className="text-sm text-emerald-800">
                  New copies have been added as drafts in{" "}
                  <strong>{activeDestination?.sectionName}</strong>.
                </p>
                <div className="flex justify-center gap-2 pt-2">
                  <Badge variant="solid" className="border border-black bg-white text-black font-bold">
                    {cloneSuccessResult.summary.competency_count ?? 0} Competencies
                  </Badge>
                  <Badge variant="solid" className="border border-black bg-white text-black font-bold">
                    {cloneSuccessResult.summary.lesson_count ?? 0} Lessons
                  </Badge>
                  <Badge variant="solid" className="border border-black bg-white text-black font-bold">
                    {cloneSuccessResult.summary.classwork_count ?? 0} Classworks
                  </Badge>
                </div>
                <div className="pt-3 flex justify-center gap-3">
                  <Button
                    variant="default"
                    onClick={() => {
                      if (activeDestination) {
                        onCloseDialog?.();
                        navigate(`/teacher/classes/${activeDestination.classId}/${activeDestination.subjectId}`);
                      }
                    }}
                  >
                    View Cloned Materials
                  </Button>
                  <Button variant="outline" onClick={() => setCloneSuccessResult(null)}>
                    Reuse More Materials
                  </Button>
                </div>
              </div>
            )}

            {!cloneSuccessResult && (
              <>
                {selfError && (
                  <div className="border border-red-300 bg-red-50 p-3 rounded text-xs text-red-700 font-semibold">
                    {selfError}
                  </div>
                )}

                {/* Filter and select toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Type:</span>
                    {(["ALL", "COMPETENCY", "LESSON", "CLASSWORK"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setSelfItemTypeFilter(t)}
                        className={`px-2.5 py-1 text-xs font-bold rounded border border-black transition-colors ${
                          selfItemTypeFilter === t
                            ? "bg-black text-white shadow-xs"
                            : "bg-white text-gray-800 hover:bg-gray-100"
                        }`}
                      >
                        {t === "ALL" ? "All" : t.charAt(0) + t.slice(1).toLowerCase() + "s"}
                      </button>
                    ))}
                  </div>

                  {selfMaterials.length > 0 && (
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <button
                        type="button"
                        onClick={selectAllFiltered}
                        className="text-blue-700 hover:underline cursor-pointer"
                      >
                        Select All
                      </button>
                      <span>&middot;</span>
                      <button
                        type="button"
                        onClick={deselectAll}
                        className="text-gray-600 hover:underline cursor-pointer"
                      >
                        Deselect All
                      </button>
                      <span>&middot;</span>
                      <span className="text-muted-foreground font-semibold">
                        {selectedTokens.size} of {filteredSelfMaterials.length} selected
                      </span>
                    </div>
                  )}
                </div>

                {/* Items list */}
                {selfLoading ? (
                  <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin text-foreground" />
                    <p className="text-xs font-bold">Loading your prior teaching records...</p>
                  </div>
                ) : filteredSelfMaterials.length === 0 ? (
                  <Empty className="py-12 border-2 border-dashed border-gray-300 rounded">
                    <EmptyHeader>
                      <EmptyTitle>No Prior Materials Found</EmptyTitle>
                      <EmptyDescription>
                        You do not have any published teaching records for this subject in previous academic years.
                      </EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                ) : (
                  <div className="border-2 border-black rounded divide-y divide-black max-h-96 overflow-y-auto bg-white shadow-[2px_2px_0px_#000]">
                    {filteredSelfMaterials.map((item) => {
                      const isSelected = selectedTokens.has(item.source_revision_token);
                      return (
                        <div
                          key={item.source_revision_token}
                          onClick={() => toggleItemSelection(item.source_revision_token)}
                          className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                            isSelected ? "bg-amber-100/60" : "hover:bg-gray-50"
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 pr-2">
                            <div
                              className={`size-5 rounded border-2 border-black flex items-center justify-center shrink-0 ${
                                isSelected ? "bg-primary text-black" : "bg-white"
                              }`}
                            >
                              {isSelected && <Check className="size-3.5 stroke-[3]" />}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs sm:text-sm font-bold text-foreground truncate">
                                {item.safe_title}
                              </p>
                              <p className="text-[11px] text-muted-foreground font-medium truncate">
                                {item.academic_period_name} &middot; Token: {item.source_revision_token.slice(0, 10)}...
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Badge variant="outline" size="sm" className="border-black text-[10px] font-bold">
                              {item.item_type}
                            </Badge>
                            {getItemTypeIcon(item.item_type)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Footer action */}
                <div className="pt-2 flex items-center justify-between border-t border-gray-200">
                  <span className="text-xs font-semibold text-muted-foreground">
                    {selectedTokens.size} material{selectedTokens.size === 1 ? "" : "s"} ready to clone
                  </span>
                  <Button
                    variant="default"
                    disabled={selfLoading || cloningInProgress || selectedTokens.size === 0}
                    onClick={handleSelfCloneExecute}
                    className="flex items-center gap-2"
                  >
                    {cloningInProgress ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Reusing Materials...
                      </>
                    ) : (
                      <>
                        <FolderSync className="size-4" />
                        Reuse Selected Materials ({selectedTokens.size})
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: REQUEST FROM ANOTHER TEACHER                                 */}
        {/* =================================================================== */}
        {activeTab === "request" && (
          <div className="space-y-5">
            <div className="bg-white border-2 border-black p-4 rounded text-xs text-gray-800 shadow-[2px_2px_0px_#000]">
              <p className="font-bold">Request Course Materials from a Colleague</p>
              <p className="mt-1 text-gray-600">
                Ask another teacher who handled {activeDestination?.subjectName || "this subject"} in a completed
                prior term to share their curriculum materials.
              </p>
            </div>

            {requestSentSuccess && (
              <div className="border-2 border-black bg-emerald-50 p-6 rounded text-center space-y-3">
                <div className="flex size-12 mx-auto items-center justify-center rounded-full border-2 border-black bg-emerald-400">
                  <CheckCircle2 className="size-7 text-black" />
                </div>
                <h4 className="text-xl font-bold text-emerald-900 font-head">Repost Request Sent!</h4>
                <p className="text-sm text-emerald-800">
                  Your request has been delivered to <strong>{requestSentSuccess.source_owner_name}</strong>.
                  You will receive an in-app notification as soon as materials are prepared.
                </p>
                <div className="pt-2 flex justify-center gap-3">
                  <Button variant="default" onClick={() => handleTabSwitch("sent")}>
                    View in Sent Requests
                  </Button>
                  <Button variant="outline" onClick={() => setRequestSentSuccess(null)}>
                    Send Another Request
                  </Button>
                </div>
              </div>
            )}

            {!requestSentSuccess && (
              <>
                {/* ── Search Mode Selector ── */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 text-foreground">
                    Source Search Mode
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[
                      { mode: "ANY", label: "Any Prior Term", desc: "Search all historical teaching records" },
                      { mode: "ALL_TERMS", label: "Any Term in Year", desc: "Filter by academic year" },
                      { mode: "PERIOD", label: "Specific Term", desc: "Exact academic period match" },
                    ].map((item) => (
                      <button
                        key={item.mode}
                        type="button"
                        onClick={() => handleScopeModeChange(item.mode as any)}
                        className={`p-2.5 text-left rounded border-2 border-black transition-all ${
                          scopeMode === item.mode
                            ? "bg-primary font-bold shadow-sm"
                            : "bg-white text-gray-700 hover:bg-gray-50"
                        }`}
                      >
                        <p className="text-xs font-bold">{item.label}</p>
                        <p className="text-[10px] text-gray-600 leading-tight mt-0.5">{item.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* ── Dynamic Year & Period Selectors ── */}
                {scopeMode === "ALL_TERMS" && (
                  <div className="p-3 border-2 border-black rounded bg-gray-50 space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-foreground">
                      Select Prior Academic Year
                    </label>
                    {loadingCalendar ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" /> Loading academic calendar...
                      </div>
                    ) : eligibleHistoricalYears.length === 0 ? (
                      <div className="text-xs text-amber-800 bg-amber-50 p-2.5 border border-amber-300 rounded font-medium">
                        No prior completed academic years exist relative to this destination term.
                      </div>
                    ) : (
                      <select
                        value={selectedSourceYearId}
                        onChange={(e) => setSelectedSourceYearId(e.target.value)}
                        className="w-full border-2 border-black p-2 rounded bg-white text-xs sm:text-sm font-bold shadow-[2px_2px_0px_#000]"
                      >
                        {eligibleHistoricalYears.map((y) => (
                          <option key={y.academic_year_id} value={String(y.academic_year_id)}>
                            {y.year_label} {y.is_active ? "(Active)" : "(Archived)"}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                {scopeMode === "PERIOD" && (
                  <div className="p-3 border-2 border-black rounded bg-gray-50 space-y-3">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-foreground">
                        1. Select Prior Academic Year
                      </label>
                      {eligibleHistoricalYears.length === 0 ? (
                        <div className="text-xs text-amber-800 bg-amber-50 p-2 border border-amber-300 rounded font-medium">
                          No prior completed academic years exist.
                        </div>
                      ) : (
                        <select
                          value={selectedSourceYearId}
                          onChange={(e) => setSelectedSourceYearId(e.target.value)}
                          className="w-full border-2 border-black p-2 rounded bg-white text-xs sm:text-sm font-bold shadow-[2px_2px_0px_#000]"
                        >
                          {eligibleHistoricalYears.map((y) => (
                            <option key={y.academic_year_id} value={String(y.academic_year_id)}>
                              {y.year_label} {y.is_active ? "(Active)" : "(Archived)"}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-foreground">
                        2. Select Specific Historical Term
                      </label>
                      {periodsForSelectedYear.length === 0 ? (
                        <div className="text-xs text-amber-800 bg-amber-50 p-2 border border-amber-300 rounded font-medium">
                          No prior completed terms exist in the selected year.
                        </div>
                      ) : (
                        <select
                          value={selectedSourcePeriodId}
                          onChange={(e) => setSelectedSourcePeriodId(e.target.value)}
                          className="w-full border-2 border-black p-2 rounded bg-white text-xs sm:text-sm font-bold shadow-[2px_2px_0px_#000]"
                        >
                          {periodsForSelectedYear.map((p) => (
                            <option key={p.id} value={String(p.id)}>
                              {p.period} (Sequence {p.period_sequence})
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}

                {/* ── Select Source Teacher ── */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 text-foreground">
                    Select Source Teacher
                  </label>
                  {!isSourceScopeValid ? (
                    <div className="border border-gray-300 bg-gray-50 p-3 rounded text-xs text-gray-600 font-medium">
                      Please select an academic year and term above to see eligible teachers.
                    </div>
                  ) : teachersLoading ? (
                    <div className="py-3 flex items-center gap-2 text-gray-600 text-xs font-bold">
                      <Loader2 className="size-4 animate-spin" /> Looking for verified subject teachers...
                    </div>
                  ) : sourceTeachers.length === 0 ? (
                    <div className="border border-amber-300 bg-amber-50 p-3 rounded text-xs text-amber-900 font-medium">
                      No other verified teachers found with published teaching records for{" "}
                      <strong>{activeDestination?.subjectName}</strong> in the selected scope.
                    </div>
                  ) : (
                    <select
                      value={selectedTeacherId}
                      onChange={(e) => setSelectedTeacherId(e.target.value)}
                      className="w-full border-2 border-black p-2.5 rounded bg-white text-sm font-bold shadow-[2px_2px_0px_#000]"
                    >
                      {sourceTeachers.map((t) => (
                        <option key={t.staff_id} value={t.staff_id}>
                          {t.display_name} ({t.staff_id})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {/* ── Personal Note / Message ── */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1.5 text-foreground">
                    Personal Note / Request Message
                  </label>
                  <textarea
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                    placeholder={`Hi, could you please share your lessons and classworks for ${activeDestination?.subjectName || "this subject"}?`}
                    rows={3}
                    className="w-full border-2 border-black p-2.5 rounded text-xs sm:text-sm bg-white focus:outline-none focus:ring-1 focus:ring-black shadow-[2px_2px_0px_#000]"
                  />
                </div>

                {teachersError && (
                  <div className="border border-red-300 bg-red-50 p-3 rounded text-xs text-red-700 font-semibold">
                    {teachersError}
                  </div>
                )}

                {/* ── Submit Action ── */}
                <div className="pt-2 flex items-center justify-between border-t border-gray-200">
                  <span className="text-xs text-muted-foreground font-semibold">
                    Colleague will receive an in-app alert to curate materials
                  </span>
                  <Button
                    variant="default"
                    disabled={
                      !activeDestination ||
                      !selectedTeacherId ||
                      !isSourceScopeValid ||
                      teachersLoading ||
                      sendingRequest
                    }
                    onClick={handleSendRequest}
                    className="flex items-center gap-2"
                  >
                    {sendingRequest ? (
                      <>
                        <Loader2 className="size-4 animate-spin" /> Sending Request...
                      </>
                    ) : (
                      <>
                        <Send className="size-4" /> Send Repost Request
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: RECEIVED REQUESTS (Incoming, global across subjects)          */}
        {/* =================================================================== */}
        {activeTab === "received" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-black font-head uppercase tracking-wider">
                  Requests Received from Colleagues
                </h4>
                <p className="text-xs text-muted-foreground font-medium">
                  Colleagues asking for your published competencies, lessons, and classworks.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadRequests("incoming")}
                disabled={loadingRequests}
                className="flex items-center gap-1.5"
              >
                <RefreshCw className={`size-3.5 ${loadingRequests ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {requestsError && (
              <div className="border border-red-300 bg-red-50 p-3 rounded text-xs text-red-700 font-semibold">
                {requestsError}
              </div>
            )}

            {loadingRequests ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-foreground" />
                <p className="text-xs font-bold">Loading received requests...</p>
              </div>
            ) : !incomingData || incomingData.items.length === 0 ? (
              <Empty className="py-12 border-2 border-dashed border-gray-300 rounded">
                <EmptyHeader>
                  <EmptyTitle>No Received Requests</EmptyTitle>
                  <EmptyDescription>
                    You have not received any material requests from other teachers.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {incomingData.items.map((req) => (
                  <Card
                    key={req.request_id}
                    className="border-2 border-black p-4 bg-white shadow-[2px_2px_0px_#000] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-foreground">{req.requester_name}</span>
                        <span className="text-xs text-muted-foreground">requested</span>
                        <span className="text-xs font-bold underline text-foreground">{req.subject_name}</span>
                        {renderStatusBadge(req.status)}
                      </div>
                      <p className="text-xs text-gray-600 font-medium">
                        Target Section: <strong>{req.destination_section_name}</strong> &middot; Term:{" "}
                        {req.destination_period_name}
                      </p>
                      {req.message && (
                        <p className="text-xs italic bg-gray-50 border border-gray-200 p-2 rounded text-gray-700 mt-1">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Received on {new Date(req.created_at).toLocaleDateString()} &middot; ID: {req.request_id.slice(0, 8)}...
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                      {req.status === "PENDING_OWNER" && (
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => void openPackageModal(req)}
                            className="flex items-center gap-1.5"
                          >
                            <Package className="size-3.5" /> Prepare Package
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDeclineTarget(req)}
                            className="text-red-700 border-red-300 hover:bg-red-50"
                          >
                            Decline
                          </Button>
                        </>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: SENT REQUESTS (Outgoing, global across subjects)              */}
        {/* =================================================================== */}
        {activeTab === "sent" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-black font-head uppercase tracking-wider">
                  Requests Sent to Colleagues
                </h4>
                <p className="text-xs text-muted-foreground font-medium">
                  Track material requests you sent and preview ready packages.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadRequests("outgoing")}
                disabled={loadingRequests}
                className="flex items-center gap-1.5"
              >
                <RefreshCw className={`size-3.5 ${loadingRequests ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>

            {requestsError && (
              <div className="border border-red-300 bg-red-50 p-3 rounded text-xs text-red-700 font-semibold">
                {requestsError}
              </div>
            )}

            {loadingRequests ? (
              <div className="py-16 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-6 animate-spin text-foreground" />
                <p className="text-xs font-bold">Loading sent requests...</p>
              </div>
            ) : !outgoingData || outgoingData.items.length === 0 ? (
              <Empty className="py-12 border-2 border-dashed border-gray-300 rounded">
                <EmptyHeader>
                  <EmptyTitle>No Sent Requests</EmptyTitle>
                  <EmptyDescription>
                    You have not sent any requests to other teachers yet.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {outgoingData.items.map((req) => (
                  <Card
                    key={req.request_id}
                    className="border-2 border-black p-4 bg-white shadow-[2px_2px_0px_#000] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-foreground">{req.source_owner_name}</span>
                        <span className="text-xs text-muted-foreground">&middot;</span>
                        <span className="text-xs font-bold underline text-foreground">{req.subject_name}</span>
                        {renderStatusBadge(req.status)}
                      </div>
                      <p className="text-xs text-gray-600 font-medium">
                        Target Section: <strong>{req.destination_section_name}</strong> &middot; Term:{" "}
                        {req.destination_period_name}
                      </p>
                      {req.message && (
                        <p className="text-xs italic bg-gray-50 border border-gray-200 p-2 rounded text-gray-700 mt-1">
                          &ldquo;{req.message}&rdquo;
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        Sent on {new Date(req.created_at).toLocaleDateString()} &middot; ID: {req.request_id.slice(0, 8)}...
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0">
                      {req.status === "PACKAGE_SENT" && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => void openPreviewModal(req)}
                          className="flex items-center gap-1.5 bg-yellow-400 text-black border-2 border-black font-bold"
                        >
                          <PackageCheck className="size-3.5" /> Review &amp; Clone
                        </Button>
                      )}
                      {req.status === "ACCEPTED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            onCloseDialog?.();
                            navigate(`/teacher/classes/${req.destination_class_id}/${req.destination_subject_id}`);
                          }}
                          className="flex items-center gap-1.5 text-xs font-bold"
                        >
                          <ExternalLink className="size-3.5" /> View Cloned Materials
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* CHILD MODAL: PACKAGE BUILDER (Owner view, 0 selected by default)      */}
      {/* ===================================================================== */}
      <Dialog
        open={Boolean(packagingRequest)}
        onOpenChange={(open) => {
          if (!open) setPackagingRequest(null);
        }}
      >
        <Dialog.Content size="xl" className="max-h-[90vh] flex flex-col p-0">
          <Dialog.Header position="fixed" className="bg-primary border-b-2 border-black px-6 py-4">
            <div className="pr-6">
              <h3 className="text-xl font-bold font-head">Prepare Material Package</h3>
              <p className="text-xs text-black/80 font-semibold">
                Select competencies, lessons, and classworks to package for{" "}
                <strong>{packagingRequest?.requester_name}</strong>
              </p>
            </div>
          </Dialog.Header>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="bg-amber-50 border-2 border-black p-3 rounded text-xs text-gray-800">
              <strong>Immutable Package Notice:</strong> Once sent, this package is frozen into an immutable
              snapshot. The requester will review safe titles and counts before choosing to clone.
            </div>

            {packageError && (
              <div className="border border-red-300 bg-red-50 p-3 rounded text-xs text-red-700 font-semibold">
                {packageError}
              </div>
            )}

            {/* Selection Toolbar */}
            {eligibleMaterials.length > 0 && (
              <div className="flex items-center justify-between text-xs font-bold px-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllPackaging}
                    className="text-blue-700 hover:underline cursor-pointer"
                  >
                    Select All
                  </button>
                  <span>&middot;</span>
                  <button
                    type="button"
                    onClick={handleDeselectAllPackaging}
                    className="text-gray-600 hover:underline cursor-pointer"
                  >
                    Deselect All
                  </button>
                </div>
                <span className="text-muted-foreground">
                  {packagingTokens.size} of {eligibleMaterials.length} selected
                </span>
              </div>
            )}

            {loadingMaterials ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-500">
                <Loader2 className="size-6 animate-spin text-black" />
                <p className="text-xs font-bold">Loading your eligible materials...</p>
              </div>
            ) : eligibleMaterials.length === 0 ? (
              <Empty className="py-8">
                <EmptyHeader>
                  <EmptyTitle>No Eligible Materials</EmptyTitle>
                  <EmptyDescription>
                    You do not have any published, owned materials matching this request scope.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="border-2 border-black rounded divide-y divide-black max-h-80 overflow-y-auto bg-white">
                {eligibleMaterials.map((item) => {
                  const isSelected = packagingTokens.has(item.source_revision_token);
                  return (
                    <div
                      key={item.source_revision_token}
                      onClick={() => {
                        setPackagingTokens((prev) => {
                          const next = new Set(prev);
                          if (next.has(item.source_revision_token)) next.delete(item.source_revision_token);
                          else next.add(item.source_revision_token);
                          return next;
                        });
                      }}
                      className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                        isSelected ? "bg-amber-100/60" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <div
                          className={`size-5 rounded border-2 border-black flex items-center justify-center shrink-0 ${
                            isSelected ? "bg-primary text-black" : "bg-white"
                          }`}
                        >
                          {isSelected && <Check className="size-3.5 stroke-[3]" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-bold text-foreground truncate">{item.safe_title}</p>
                          <p className="text-[11px] text-muted-foreground font-medium truncate">
                            {item.academic_period_name}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" size="sm" className="border-black text-[10px] font-bold shrink-0">
                        {item.item_type}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Dialog.Footer position="fixed" className="border-t-2 border-black bg-gray-50 px-6 py-3 flex items-center justify-between">
            <span className="text-xs font-bold text-muted-foreground">
              {packagingTokens.size} item{packagingTokens.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPackagingRequest(null)}>
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                disabled={submittingPackage || packagingTokens.size === 0}
                onClick={handleSendPackage}
                className="flex items-center gap-1.5"
              >
                {submittingPackage ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Freezing Snapshot...
                  </>
                ) : (
                  <>
                    <Send className="size-4" /> Send Package ({packagingTokens.size})
                  </>
                )}
              </Button>
            </div>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      {/* ===================================================================== */}
      {/* CHILD MODAL: PACKAGE PREVIEW & DECISION (Requester view)             */}
      {/* ===================================================================== */}
      <Dialog
        open={Boolean(previewRequest)}
        onOpenChange={(open) => {
          if (!open) setPreviewRequest(null);
        }}
      >
        <Dialog.Content size="xl" className="max-h-[90vh] flex flex-col p-0">
          <Dialog.Header position="fixed" className="bg-primary border-b-2 border-black px-6 py-4">
            <div className="pr-6">
              <h3 className="text-xl font-bold font-head">Review Packaged Materials</h3>
              <p className="text-xs text-black/80 font-semibold">
                Prepared by <strong>{previewRequest?.source_owner_name}</strong> for {previewRequest?.destination_section_name}
              </p>
            </div>
          </Dialog.Header>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {cloneOperationResult ? (
              <div className="border-2 border-black bg-emerald-50 p-6 rounded text-center space-y-4">
                <div className="flex size-12 mx-auto items-center justify-center rounded-full border-2 border-black bg-emerald-400">
                  <CheckCircle2 className="size-7 text-black" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-emerald-900 font-head">Materials Successfully Cloned!</h4>
                  <p className="text-sm text-emerald-800 mt-1">
                    Independent copies have been created in your destination section ({previewRequest?.destination_section_name}).
                  </p>
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <Badge variant="solid" className="border border-black bg-white text-black font-bold">
                    {cloneOperationResult.summary.competency_count ?? 0} Competencies
                  </Badge>
                  <Badge variant="solid" className="border border-black bg-white text-black font-bold">
                    {cloneOperationResult.summary.lesson_count ?? 0} Lessons
                  </Badge>
                  <Badge variant="solid" className="border border-black bg-white text-black font-bold">
                    {cloneOperationResult.summary.classwork_count ?? 0} Classworks
                  </Badge>
                </div>
                <div className="pt-4 flex justify-center gap-3">
                  <Button
                    variant="default"
                    onClick={() => {
                      const classId = previewRequest?.destination_class_id;
                      const subjectId = previewRequest?.destination_subject_id;
                      setPreviewRequest(null);
                      onCloseDialog?.();
                      if (classId && subjectId) {
                        navigate(`/teacher/classes/${classId}/${subjectId}`);
                      }
                    }}
                  >
                    View Cloned Materials
                  </Button>
                  <Button variant="outline" onClick={() => setPreviewRequest(null)}>
                    Close
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {previewError && (
                  <div className="border border-red-300 bg-red-50 p-3 rounded text-xs text-red-700 font-semibold">
                    {previewError}
                  </div>
                )}

                {loadingPreview ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-2 text-gray-500">
                    <Loader2 className="size-6 animate-spin text-black" />
                    <p className="text-xs font-bold">Verifying package snapshot...</p>
                  </div>
                ) : packagePreview ? (
                  <>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="border-2 border-black p-2.5 rounded bg-white text-center">
                        <p className="text-xs text-gray-500 font-bold">Competencies</p>
                        <p className="text-xl font-black font-head">{packagePreview.summary.competency_count}</p>
                      </div>
                      <div className="border-2 border-black p-2.5 rounded bg-white text-center">
                        <p className="text-xs text-gray-500 font-bold">Lessons</p>
                        <p className="text-xl font-black font-head">{packagePreview.summary.lesson_count}</p>
                      </div>
                      <div className="border-2 border-black p-2.5 rounded bg-white text-center">
                        <p className="text-xs text-gray-500 font-bold">Classworks</p>
                        <p className="text-xl font-black font-head">{packagePreview.summary.classwork_count}</p>
                      </div>
                      <div className="border-2 border-black p-2.5 rounded bg-white text-center">
                        <p className="text-xs text-gray-500 font-bold">Attachments</p>
                        <p className="text-xl font-black font-head">{packagePreview.summary.attachment_count}</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
                        Packaged Items ({packagePreview.items.length})
                      </h4>
                      <div className="border-2 border-black rounded divide-y divide-black bg-white max-h-64 overflow-y-auto">
                        {packagePreview.items.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between p-2.5 text-xs">
                            <span className="font-bold text-foreground truncate mr-2">{item.safe_title}</span>
                            <Badge variant="outline" size="sm" className="shrink-0 text-[10px]">
                              {item.item_type}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bg-amber-50 border border-black p-3 rounded text-xs text-gray-800">
                      <strong>Cloning Behavior:</strong> Accepting will copy all packaged items into{" "}
                      <strong>{previewRequest?.destination_section_name}</strong>. Created lessons and classworks
                      will initially be locked and unpublished drafts for you to review and customize.
                    </div>
                  </>
                ) : null}
              </>
            )}
          </div>

          {!cloneOperationResult && (
            <Dialog.Footer position="fixed" className="border-t-2 border-black bg-gray-50 px-6 py-3 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={decisionInProgress}
                onClick={handleDeclinePackage}
                className="text-red-700 border-red-300 hover:bg-red-50"
              >
                Decline Package
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewRequest(null)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={decisionInProgress || loadingPreview || !packagePreview}
                  onClick={handleAcceptPackage}
                  className="bg-yellow-400 text-black border-2 border-black font-bold flex items-center gap-1.5"
                >
                  {decisionInProgress ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Cloning...
                    </>
                  ) : (
                    <>
                      <Check className="size-4" /> Accept &amp; Clone
                    </>
                  )}
                </Button>
              </div>
            </Dialog.Footer>
          )}
        </Dialog.Content>
      </Dialog>

      {/* ===================================================================== */}
      {/* CHILD MODAL: DECLINE CONFIRMATION (Owner declining incoming request)  */}
      {/* ===================================================================== */}
      <Dialog
        open={Boolean(declineTarget)}
        onOpenChange={(open) => {
          if (!open) setDeclineTarget(null);
        }}
      >
        <Dialog.Content size="md" className="p-0">
          <Dialog.Header position="fixed" className="bg-red-600 text-white border-b-2 border-black px-6 py-4">
            <div className="pr-6">
              <h3 className="text-lg font-bold font-head">Decline Material Request</h3>
            </div>
          </Dialog.Header>
          <div className="p-5 text-sm space-y-3">
            <p>
              Are you sure you want to decline this request from{" "}
              <strong>{declineTarget?.requester_name}</strong> for {declineTarget?.subject_name}?
            </p>
            <p className="text-xs text-muted-foreground">
              The requester will be notified that you are unable to share materials for this request.
            </p>
          </div>
          <Dialog.Footer position="fixed" className="border-t-2 border-black bg-gray-50 px-6 py-3 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setDeclineTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={decliningInProgress}
              onClick={handleDeclineConfirm}
              className="bg-red-600 hover:bg-red-700 text-white border-2 border-black font-bold"
            >
              {decliningInProgress ? "Declining..." : "Confirm Decline"}
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </div>
  );
}

export default RepostWorkspace;
