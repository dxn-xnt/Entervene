import { useEffect, useState } from "react";
import type { DevelopmentCurrentTermListItem } from "@/lib/prediction-api";
import { listTeacherCandidates, matchingCandidate, type TeacherInterventionSummary } from "@/lib/teacher-interventions-api";

export function useTeacherCandidateShortcut(prediction: DevelopmentCurrentTermListItem | null): number | undefined {
  const [candidates, setCandidates] = useState<TeacherInterventionSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listTeacherCandidates().then((result) => { if (!cancelled) setCandidates(result.items); })
      .catch(() => { if (!cancelled) setCandidates([]); });
    return () => { cancelled = true; };
  }, []);
  return prediction ? matchingCandidate(prediction, candidates)?.intervention_id : undefined;
}
