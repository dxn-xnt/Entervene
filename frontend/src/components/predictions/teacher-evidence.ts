import type { PredictionEvidenceCategory, TeacherPredictionEvidence } from "@/lib/prediction-api";

export interface EvidenceGroup {
  title: string;
  categories: PredictionEvidenceCategory[];
}

export const EVIDENCE_GROUPS: EvidenceGroup[] = [
  { title: "Grade progress", categories: ["GRADE"] },
  { title: "Activities & submissions", categories: ["ACTIVITY_PROGRESS"] },
  { title: "Attendance & participation", categories: ["ATTENDANCE", "PARTICIPATION"] },
];

export function evidenceRowsForGroup(
  evidence: TeacherPredictionEvidence[],
  group: EvidenceGroup,
): TeacherPredictionEvidence[] {
  return evidence.filter((item) => group.categories.includes(item.category));
}
