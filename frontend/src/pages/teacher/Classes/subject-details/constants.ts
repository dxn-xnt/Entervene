import type { ClassworkDraft } from "./types";

export const LOCKED_CLASSWORK_MESSAGE =
  "This classwork is not available yet. Please check back later or contact your teacher for more information.";

export const emptyClassworkDraft: ClassworkDraft = {
  title: "",
  description: "",
  instructions: "",
  classwork_type: "ACTIVITY",
  classwork_category: "WRITTEN_WORK",
  total_points: "100",
  due_date: "",
  is_published: true,
};

export const allowedMaterialExtensions = [".pdf", ".docx", ".pptx", ".jpg", ".jpeg", ".png"];
export const maxMaterialSize = 4 * 1024 * 1024;
