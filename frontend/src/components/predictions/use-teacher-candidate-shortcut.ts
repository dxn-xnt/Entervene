import { useEffect, useState } from "react";
import type { DevelopmentCurrentTermListItem } from "@/lib/prediction-api";
import {
  listTeacherActive,
  listTeacherCandidates,
  matchingActiveIntervention,
  matchingCandidate,
  type TeacherInterventionSummary,
} from "@/lib/teacher-interventions-api";

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

export function useTeacherActiveInterventionShortcut(prediction: DevelopmentCurrentTermListItem | null): number | undefined {
  const [activeInterventions, setActiveInterventions] = useState<TeacherInterventionSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listTeacherActive().then((result) => { if (!cancelled) setActiveInterventions(result.items); })
      .catch(() => { if (!cancelled) setActiveInterventions([]); });
    return () => { cancelled = true; };
  }, []);
  return prediction ? matchingActiveIntervention(prediction, activeInterventions)?.intervention_id : undefined;
}
