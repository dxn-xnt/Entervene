import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Archive, Pencil, RotateCcw } from "lucide-react";
import type { SubjectOfferingListItem } from "@/lib/api";
import { pathwayLabel, statusBadge, subjectCode } from "./subject-utils";

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
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{offering.subject.subject_name}</p>
            {statusBadge(offering.status)}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
            <span><strong>Code:</strong> {subjectCode(offering.subject)}</span>
            <span><strong>Year:</strong> {offering.academic_year.year_label}</span>
            <span><strong>Grade:</strong> {offering.academic_level.level_name}</span>
            <span><strong>Term:</strong> {offering.academic_period.period_name}</span>
            <span className="col-span-2"><strong>Pathway:</strong> {pathwayLabel(offering.pathway)}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(offering)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Edit offering"}
            >
              <Pencil className="size-4 mr-2" /> Edit
            </Button>
          ) : null}
          {offering.status === "active" && onArchive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onArchive(offering)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Archive offering"}
            >
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {offering.status === "archived" && onRestore ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(offering)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Restore offering"}
            >
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}
