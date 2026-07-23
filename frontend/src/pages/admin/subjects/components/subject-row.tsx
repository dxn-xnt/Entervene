import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Archive, ArrowUpRight, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SubjectListItem } from "@/lib/api";
import { statusBadge, subjectCode, subjectRouteGrade } from "./subject-utils";

export function SubjectRow({
  subject,
  onArchive,
  onRestore,
}: {
  subject: SubjectListItem;
  onArchive?: (subject: SubjectListItem) => void;
  onRestore?: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();
  const routeGrade = encodeURIComponent(subjectRouteGrade(subject.academic_level));

  return (
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <button
          type="button"
          className="min-w-0 text-left"
          onClick={() => navigate(`/admin/subjects/${routeGrade}/${subject.subject_id}`)}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{subject.subject_name}</p>
            {statusBadge(subject.status)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            <span><strong>Code:</strong> {subjectCode(subject)}</span>
            <span><strong>Grade:</strong> {subject.academic_level.level_name}</span>
            <span><strong>Group:</strong> {subject.subject_group || "Ungrouped"}</span>
            <span><strong>Hours:</strong> {subject.hours ?? 0}</span>
            <span className="col-span-2 md:col-span-2">
              <strong>Default template:</strong> {subject.default_grading_template || "No grading template"}
            </span>
          </div>
          {subject.description ? <p className="text-xs text-muted-foreground">{subject.description}</p> : null}
        </button>
        <div className="flex shrink-0 gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate(`/admin/subjects/${routeGrade}/${subject.subject_id}`)}
          >
            <ArrowUpRight className="size-4 mr-2" /> View
          </Button>
          {subject.status === "active" && onArchive ? (
            <Button size="sm" variant="outline" onClick={() => onArchive(subject)}>
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {subject.status === "archived" && onRestore ? (
            <Button size="sm" variant="outline" onClick={() => onRestore(subject)}>
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}
