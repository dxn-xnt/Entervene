import { apiFetch } from "./api";

export type DestinationScope = {
  class_id: number;
  section_name: string;
  subject_id: number;
  subject_name: string;
  academic_period_id: number;
  period_name: string;
  academic_year_id: number;
  academic_year_label: string;
  year_state: "ACTIVE" | "PREPARED_FUTURE";
};

export type SourceTeacher = {
  staff_id: string;
  display_name: string;
};

export type ContentShareRequestStatus =
  | "PENDING_OWNER"
  | "PACKAGE_SENT"
  | "ACCEPTED"
  | "DECLINED_BY_OWNER"
  | "DECLINED_BY_REQUESTER"
  | "EXPIRED";

export type ContentShareRequest = {
  request_id: string;
  requester_name: string;
  source_owner_name: string;
  subject_id: number;
  subject_name: string;
  source_scope_mode: "ANY" | "ALL_TERMS" | "PERIOD";
  source_academic_year_id?: number | null;
  source_academic_period_id?: number | null;
  destination_class_id: number;
  destination_section_name: string;
  destination_subject_id: number;
  destination_academic_period_id: number;
  destination_period_name: string;
  status: ContentShareRequestStatus;
  message?: string | null;
  expires_at: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ContentShareRequestListResponse = {
  items: ContentShareRequest[];
  total: number;
  page: number;
  page_size: number;
  badges: {
    pending: number;
    package_sent: number;
    expired: number;
  };
};

export type OwnerEligibleMaterialItem = {
  item_type: "COMPETENCY" | "LESSON" | "CLASSWORK";
  source_entity_id: number;
  safe_title: string;
  academic_period_id: number;
  academic_period_name: string;
  source_revision_token: string;
};

export type OwnerEligibleMaterialsResponse = {
  request_id: string;
  items: OwnerEligibleMaterialItem[];
  total: number;
};

export type PackagePreviewItem = {
  item_type: "COMPETENCY" | "LESSON" | "CLASSWORK";
  safe_title: string;
  display_order: number;
};

export type RequesterVisiblePackageSummary = {
  package_id: string;
  request_id: string;
  status: string;
  sent_at: string;
  expires_at: string;
  summary: {
    competency_count: number;
    lesson_count: number;
    classwork_count: number;
    attachment_count: number;
  };
  items: PackagePreviewItem[];
};

export type ContentCloneOperation = {
  operation_id: string;
  mode: "SELF" | "SHARED_PACKAGE";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  destination_class_id: number;
  destination_subject_id: number;
  destination_academic_period_id: number;
  summary: {
    competency_count?: number;
    lesson_count?: number;
    classwork_count?: number;
    attachment_count?: number;
  };
  error_code?: string | null;
  created_at: string;
  completed_at?: string | null;
};

export type SelfEligibleMaterialsResponse = {
  items: OwnerEligibleMaterialItem[];
  total: number;
};

export type PeriodMapping = {
  source_academic_period_id: number;
  destination_academic_period_id: number;
};

function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "idemp-" + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// API methods
// ---------------------------------------------------------------------------

export async function getDestinationScopes(): Promise<DestinationScope[]> {
  const res = await apiFetch("/api/v1/content-cloning/scopes");
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to load destination scopes");
  }
  return res.json();
}

export async function getSourceTeachers(params: {
  destination_class_id: number;
  destination_subject_id: number;
  destination_academic_period_id: number;
  source_scope_mode?: "ANY" | "ALL_TERMS" | "PERIOD";
  source_academic_year_id?: number | null;
  source_academic_period_id?: number | null;
}): Promise<SourceTeacher[]> {
  const q = new URLSearchParams({
    destination_class_id: String(params.destination_class_id),
    destination_subject_id: String(params.destination_subject_id),
    destination_academic_period_id: String(params.destination_academic_period_id),
    source_scope_mode: params.source_scope_mode || "ANY",
  });
  if (params.source_academic_year_id) {
    q.set("source_academic_year_id", String(params.source_academic_year_id));
  }
  if (params.source_academic_period_id) {
    q.set("source_academic_period_id", String(params.source_academic_period_id));
  }
  const res = await apiFetch(`/api/v1/content-cloning/source-teachers?${q.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to load eligible source teachers");
  }
  return res.json();
}

export async function createContentRequest(payload: {
  source_owner_staff_id: string;
  subject_id: number;
  source_scope_mode: "ANY" | "ALL_TERMS" | "PERIOD";
  source_academic_year_id?: number | null;
  source_academic_period_id?: number | null;
  destination_class_id: number;
  destination_subject_id: number;
  destination_academic_period_id: number;
  message?: string | null;
}): Promise<ContentShareRequest> {
  const key = generateIdempotencyKey();
  const res = await apiFetch("/api/v1/content-cloning/requests", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to create share request");
  }
  return res.json();
}

export async function getContentRequests(
  box: "incoming" | "outgoing",
  page = 1,
  pageSize = 50,
): Promise<ContentShareRequestListResponse> {
  const q = new URLSearchParams({
    box,
    page: String(page),
    page_size: String(pageSize),
  });
  const res = await apiFetch(`/api/v1/content-cloning/requests?${q.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to fetch content requests");
  }
  return res.json();
}

export async function declineContentRequest(
  requestId: string,
  expectedVersion: number,
): Promise<ContentShareRequest> {
  const res = await apiFetch(`/api/v1/content-cloning/requests/${requestId}/decline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expected_version: expectedVersion }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to decline content request");
  }
  return res.json();
}

export async function getEligibleMaterials(
  requestId: string,
  itemType?: string,
  page = 1,
  pageSize = 100,
): Promise<OwnerEligibleMaterialsResponse> {
  const q = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
  });
  if (itemType) q.set("item_type", itemType);
  const res = await apiFetch(`/api/v1/content-cloning/requests/${requestId}/eligible-materials?${q.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to load eligible materials");
  }
  return res.json();
}

export async function createPackage(
  requestId: string,
  payload: {
    expected_version: number;
    items: Array<{
      item_type: "COMPETENCY" | "LESSON" | "CLASSWORK";
      source_entity_id: number;
      source_revision_token: string;
    }>;
  },
): Promise<RequesterVisiblePackageSummary> {
  const key = generateIdempotencyKey();
  const res = await apiFetch(`/api/v1/content-cloning/requests/${requestId}/package`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to create package");
  }
  return res.json();
}

export async function getPackagePreview(requestId: string): Promise<RequesterVisiblePackageSummary> {
  const res = await apiFetch(`/api/v1/content-cloning/requests/${requestId}/package`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to load package preview");
  }
  return res.json();
}

export async function decidePackage(
  requestId: string,
  payload: {
    decision: "ACCEPT" | "DECLINE";
    expected_version: number;
    period_mappings?: PeriodMapping[];
  },
): Promise<ContentCloneOperation | ContentShareRequest> {
  const key = generateIdempotencyKey();
  const res = await apiFetch(`/api/v1/content-cloning/requests/${requestId}/package-decision`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      decision: payload.decision,
      expected_version: payload.expected_version,
      period_mappings: payload.period_mappings || [],
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to process package decision");
  }
  return res.json();
}

export async function getSelfCloneMaterials(params: {
  destination_class_id: number;
  destination_subject_id: number;
  destination_academic_period_id: number;
  item_type?: string;
  page?: number;
  pageSize?: number;
}): Promise<SelfEligibleMaterialsResponse> {
  const q = new URLSearchParams({
    destination_class_id: String(params.destination_class_id),
    destination_subject_id: String(params.destination_subject_id),
    destination_academic_period_id: String(params.destination_academic_period_id),
    page: String(params.page || 1),
    page_size: String(params.pageSize || 100),
  });
  if (params.item_type) q.set("item_type", params.item_type);
  const res = await apiFetch(`/api/v1/content-cloning/clone-operations/self/eligible-materials?${q.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to load self-clonable materials");
  }
  return res.json();
}

export async function cloneSelfMaterials(payload: {
  destination_class_id: number;
  destination_subject_id: number;
  destination_academic_period_id: number;
  items: Array<{
    item_type: "COMPETENCY" | "LESSON" | "CLASSWORK";
    source_entity_id: number;
    source_revision_token: string;
  }>;
  period_mappings?: PeriodMapping[];
}): Promise<ContentCloneOperation> {
  const key = generateIdempotencyKey();
  const res = await apiFetch("/api/v1/content-cloning/clone-operations/self", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify({
      destination_class_id: payload.destination_class_id,
      destination_subject_id: payload.destination_subject_id,
      destination_academic_period_id: payload.destination_academic_period_id,
      items: payload.items,
      period_mappings: payload.period_mappings || [],
    }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to clone materials");
  }
  return res.json();
}

export async function getCloneOperation(operationId: string): Promise<ContentCloneOperation> {
  const res = await apiFetch(`/api/v1/content-cloning/clone-operations/${operationId}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || "Failed to fetch clone operation");
  }
  return res.json();
}
