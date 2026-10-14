import { apiFetch } from "@/lib/api";
import type { ActivityRubricLevel } from "@/types/classwork";

export type RubricTemplate = {
  rubric_template_id: number;
  owner_staff_id: string | null;
  is_system: boolean;
  name: string;
  description: string;
  levels: ActivityRubricLevel[];
  created_at: string;
  updated_at: string;
};

export type RubricTemplateInput = Pick<RubricTemplate, "name" | "description" | "levels">;

export function copyRubricLevels(levels: ActivityRubricLevel[]): ActivityRubricLevel[] {
  return levels.map(({ level_name, description, points, display_order }) => ({
    level_name,
    description,
    points,
    display_order,
  }));
}

async function templateResponse(response: Response): Promise<RubricTemplate> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Unable to save rubric template.");
  }
  return response.json() as Promise<RubricTemplate>;
}

export async function listRubricTemplates(): Promise<RubricTemplate[]> {
  const response = await apiFetch("/api/v1/rubric-templates");
  if (!response.ok) throw new Error("Unable to load rubric templates.");
  return response.json() as Promise<RubricTemplate[]>;
}

export function saveRubricTemplate(input: RubricTemplateInput, id?: number) {
  return apiFetch(id ? `/api/v1/rubric-templates/${id}` : "/api/v1/rubric-templates", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, levels: copyRubricLevels(input.levels) }),
  }).then(templateResponse);
}

export function duplicateRubricTemplate(id: number) {
  return apiFetch(`/api/v1/rubric-templates/${id}/duplicate`, { method: "POST" }).then(templateResponse);
}

export async function deleteRubricTemplate(id: number) {
  const response = await apiFetch(`/api/v1/rubric-templates/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : "Unable to delete rubric template.");
  }
}
