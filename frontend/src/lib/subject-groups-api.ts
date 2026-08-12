import { apiFetch } from "./api";

export type SubjectGroupRead = {
  subject_group_id: number;
  name: string;
  passing_threshold: number;
  is_active: boolean;
  display_order: number;
  subject_count: number;
};

export type SubjectGroupListResponse = {
  groups: SubjectGroupRead[];
};

export type SubjectGroupCreate = {
  name: string;
  passing_threshold: number;
  display_order?: number;
};

export type SubjectGroupUpdate = {
  name?: string;
  passing_threshold?: number;
  is_active?: boolean;
  display_order?: number;
};

export type AffectedSubject = {
  subject_id: number;
  subject_name: string;
  subject_codename: string | null;
};

export type DeactivateErrorDetail = {
  message: string;
  affected_subjects: AffectedSubject[];
};

export async function getSubjectGroups(): Promise<SubjectGroupListResponse> {
  const res = await apiFetch("/api/v1/subject-groups");
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to load subject groups");
  }
  return res.json();
}

export async function createSubjectGroup(payload: SubjectGroupCreate): Promise<SubjectGroupRead> {
  const res = await apiFetch("/api/v1/subject-groups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to create subject group");
  }
  return res.json();
}

export async function updateSubjectGroup(
  groupId: number,
  payload: SubjectGroupUpdate
): Promise<SubjectGroupRead> {
  const res = await apiFetch(`/api/v1/subject-groups/${groupId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || "Failed to update subject group");
  }
  return res.json();
}

export async function deactivateSubjectGroup(groupId: number): Promise<{ message: string }> {
  const res = await apiFetch(`/api/v1/subject-groups/${groupId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    if (res.status === 409 && err?.detail?.affected_subjects) {
      const errorObj = new Error(err.detail.message || "Cannot deactivate group") as Error & {
        affectedSubjects?: AffectedSubject[];
      };
      errorObj.affectedSubjects = err.detail.affected_subjects;
      throw errorObj;
    }
    throw new Error(typeof err?.detail === "string" ? err.detail : "Failed to deactivate subject group");
  }
  return res.json();
}
