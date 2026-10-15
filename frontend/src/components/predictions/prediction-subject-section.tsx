import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { SubjectSectionCard } from "./subject-section-card";
import type { DashboardSubjectGroupSummary } from "./current-term-dashboard-adapter";

interface PredictionSubjectSectionProps {
  group: DashboardSubjectGroupSummary;
}

export function PredictionSubjectSection({ group }: PredictionSubjectSectionProps) {
  return (
    <Card className="flex flex-col bg-primary">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">{group.display_name}</h2>
          {group.grade_level !== null && (
            <span className="text-xs font-semibold text-muted-foreground">
              (Grade {group.grade_level})
            </span>
          )}
        </div>
        <div className="flex flex-row flex-wrap gap-2 items-center">
          {group.high_risk_count > 0 && (
            <Badge size="sm" variant="surface" className="bg-destructive text-black font-bold">
              {group.high_risk_count} {group.high_risk_count === 1 ? "High Risk" : "High Risks"}
            </Badge>
          )}
          {group.moderate_risk_count > 0 && (
            <Badge size="sm" variant="surface" className="bg-amber-300 text-black font-bold">
              {group.moderate_risk_count} Moderate Risk
            </Badge>
          )}
          {group.needs_monitoring_count > 0 && (
            <Badge size="sm" variant="outline" className="border-border font-bold">
              {group.needs_monitoring_count} Monitoring
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 pt-2">
        {group.sections.length > 0 ? (
          group.sections.map((sec) => (
            <SubjectSectionCard
              key={sec.class_id}
              subjectId={group.subject_id}
              classId={sec.class_id}
              name={sec.section_name}
              gradeLevel={sec.grade_level}
              totalPredictions={sec.total_predictions}
              highRisk={sec.high_risk_count}
              moderateRisk={sec.moderate_risk_count}
              needsMonitoring={sec.needs_monitoring_count}
              lowRisk={sec.low_risk_count}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground italic py-2">
            No sections assigned in this subject.
          </p>
        )}
      </div>
    </Card>
  );
}
