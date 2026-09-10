import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { ArchiveIcon, EllipsisIcon, PenIcon, RotateCcw } from "lucide-react";
import type { SubjectOfferingListItem } from "@/lib/api";
import { pathwayLabel, subjectCode } from "./subject-utils";
import { Badge } from "@/components/retroui/Badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function OfferingRow({
  offering,
  onEdit,
  onArchive,
  onRestore,
  readOnly = false,
  readOnlyReason,
}: {
  offering: SubjectOfferingListItem;
  onEdit?: (offering: SubjectOfferingListItem) => void;
  onArchive?: (offering: SubjectOfferingListItem) => void;
  onRestore?: (offering: SubjectOfferingListItem) => void;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  return (
    <RetroCard className="group relative flex min-w-90 flex-col justify-between shadow-none p-3 hover:-translate-y-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-2xl font-bold leading-tight mr-5">{offering.subject.subject_name}</p>
            <p className="text-sm font-semibold">{subjectCode(offering.subject)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={offering.status === "active" ? "secondary" : "default"}>
              {offering.status === "active" ? "Active" : "Archived"}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  className="p-2 shadow-none"
                  aria-label="More options"
                  disabled={readOnly}
                  title={readOnly ? readOnlyReason : undefined}
                >
                  <EllipsisIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-2">
                {onEdit ? (
                  <DropdownMenuItem
                    onClick={() => onEdit(offering)}
                    disabled={readOnly}
                    className="gap-2"
                  >
                    <PenIcon className="size-4" /> Edit
                  </DropdownMenuItem>
                ) : null}
                {offering.status === "active" && onArchive ? (
                  <DropdownMenuItem
                    onClick={() => onArchive(offering)}
                    disabled={readOnly}
                    className="gap-2"
                  >
                    <ArchiveIcon className="size-4" /> Archive
                  </DropdownMenuItem>
                ) : null}
                {offering.status === "archived" && onRestore ? (
                  <DropdownMenuItem
                    onClick={() => onRestore(offering)}
                    disabled={readOnly}
                    className="gap-2"
                  >
                    <RotateCcw className="size-4" /> Restore
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <span className="font-semibold">{offering.academic_level.level_name} • {offering.academic_period.period_name}</span>
          <span className="text-right font-semibold text-black/70">{offering.academic_year.year_label}</span>
          <span className="col-span-2 line-clamp-1">{pathwayLabel(offering.pathway)}</span>
        </div>
      </div>
    </RetroCard>
  );
}
