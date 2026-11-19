import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { ArchiveIcon, EllipsisIcon, PenIcon, RotateCcw } from "lucide-react";
import type { SubjectOfferingListItem } from "@/lib/api";
import { pathwayLabel, subjectCode } from "./subject-utils";
import { Badge } from "@/components/retroui/Badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";

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
    <RetroCard className="group relative flex min-w-64 w-80 shrink-0 flex-col justify-between shadow-none p-3 hover:-translate-y-1">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xl font-bold leading-tight break-words">{offering.subject.subject_name}</p>
            <p className="text-sm font-semibold">{subjectCode(offering.subject)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge size="sm" variant={offering.status === "active" ? "secondary" : "default"}>
              {offering.status === "active" ? "Active" : "Archived"}
            </Badge>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex">
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="p-1 shadow-none"
                      aria-label="More options"
                      disabled={readOnly}
                    >
                      <EllipsisIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </span>} />
                <TooltipContent>{readOnly ? readOnlyReason || "Read-only" : "Offering actions"}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="rounded border-2">
                {onEdit ? (
                  <DropdownMenuItem
                    onClick={() => onEdit(offering)}
                    disabled={readOnly}
                    className="gap-2 rounded"
                  >
                    <PenIcon className="size-4" /> Edit
                  </DropdownMenuItem>
                ) : null}
                {offering.status === "active" && onArchive ? (
                  <DropdownMenuItem
                    onClick={() => onArchive(offering)}
                    disabled={readOnly}
                    className="gap-2 rounded"
                  >
                    <ArchiveIcon className="size-4" /> Archive
                  </DropdownMenuItem>
                ) : null}
                {offering.status === "archived" && onRestore ? (
                  <DropdownMenuItem
                    onClick={() => onRestore(offering)}
                    disabled={readOnly}
                    className="gap-2 rounded"
                  >
                    <RotateCcw className="size-4" /> Restore
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs">
          <span className="font-semibold">{offering.academic_level.level_name} • {offering.academic_period.period_name}</span>
          <span className="text-right font-semibold text-black/70">{offering.academic_year.year_label}</span>
          <span className="w-full break-words">{pathwayLabel(offering.pathway)}</span>
        </div>
      </div>
    </RetroCard>
  );
}
