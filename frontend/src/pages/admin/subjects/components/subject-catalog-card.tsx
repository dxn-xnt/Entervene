import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Link } from "react-router-dom";
import { ArchiveIcon, EllipsisIcon, PenIcon } from "lucide-react";
import type { SubjectListItem } from "@/lib/api";
import { subjectCode, subjectRouteGrade } from "./subject-utils";
import { Badge } from "@/components/retroui/Badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function SubjectCatalogCard({
  subject,
  onEdit,
  onArchive,
}: {
  subject: SubjectListItem;
  onEdit?: (subject: SubjectListItem) => void;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const routeGrade = encodeURIComponent(subjectRouteGrade(subject.academic_level));

  return (
    <RetroCard className="group relative flex min-w-80 flex-col justify-between shadow-none p-3 hover:-translate-y-1">
      <Link
        to={`/admin/subjects/${routeGrade}/${subject.subject_id}`}
        className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        aria-label={`View ${subject.subject_name}`}
      >
        <div className="flex items-start justify-between gap-2">

          <div>
            <p className="text-2xl font-bold leading-tight mr-5">{subject.subject_name}</p>
            <p className="text-sm font-semibold">{subjectCode(subject)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={subject.status === "active" ? "secondary" : "default"}>
              {subject.status === "active" ? "Active" : "Archived"}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="p-2 shadow-none hover:shadow-none hover:translate-none"
                  aria-label="More options"
                  onClick={(e) => e.preventDefault()}
                >
                  <EllipsisIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-2">
                {onEdit ? (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onEdit(subject);
                    }}
                    className="gap-2"
                  >
                    <PenIcon className="size-4" /> Edit
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => onArchive(subject)} className="gap-2">
                  <ArchiveIcon className="size-4" /> Archive
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <span className="font-semibold">{subject.subject_group || "Ungrouped"}</span>
          <span className="text-right font-semibold">{subject.hours ?? 0} hrs</span>
          <span className="col-span-2 line-clamp-1">{subject.default_grading_template || "No template"}</span>
        </div>
      </Link>

      {/* <div className="mt-3 flex gap-2">
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
      </div>  */}
    </RetroCard>
  );
}
