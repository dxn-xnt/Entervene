import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Archive, ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SubjectListItem } from "@/lib/api";
import { statusBadge, subjectCode, subjectRouteGrade } from "./subject-utils";

export function SubjectCatalogCard({
  subject,
  onArchive,
}: {
  subject: SubjectListItem;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();
  const routeGrade = encodeURIComponent(subjectRouteGrade(subject.academic_level));

  return (
    <RetroCard className="flex min-h-36 w-56 shrink-0 flex-col justify-between shadow-none p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="line-clamp-1 text-lg font-bold">{subject.subject_name}</p>
          <p className="text-xs font-semibold">{subjectCode(subject)}</p>
        </div>
        {statusBadge(subject.status)}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="font-semibold">{subject.subject_group || "Ungrouped"}</span>
        <span className="text-right font-semibold">{subject.hours ?? 0} hrs</span>
        <span className="col-span-2 line-clamp-1">{subject.default_grading_template || "No template"}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 flex-1"
          onClick={() => navigate(`/admin/subjects/${routeGrade}/${subject.subject_id}`)}
        >
          <ArrowUpRight className="mr-2 size-4" /> View
        </Button>
        <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onArchive(subject)}>
          <Archive className="mr-2 size-4" /> Archive
        </Button>
      </div>
    </RetroCard>
  );
}
