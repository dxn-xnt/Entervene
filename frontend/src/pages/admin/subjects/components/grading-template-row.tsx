import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Archive, Pencil, RotateCcw } from "lucide-react";
import type { GradingTemplateListItem } from "@/lib/api";
import { scopeLabel, statusBadge } from "./subject-utils";

export function GradingTemplateRow({
  template,
  onEdit,
  onArchive,
  onRestore,
  readOnly = false,
  readOnlyReason,
}: {
  template: GradingTemplateListItem;
  onEdit?: (template: GradingTemplateListItem) => void;
  onArchive?: (template: GradingTemplateListItem) => void;
  onRestore?: (template: GradingTemplateListItem) => void;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  return (
    <RetroCard className="p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-bold">{template.template_name}</p>
            {statusBadge(template.status)}
          </div>
          <div className="mt-2 grid grid-cols-1 gap-1 text-sm md:grid-cols-2">
            <span><strong>Academic scope:</strong> {template.academic_level?.level_name ?? "Any level"}</span>
            <span><strong>Subject scope:</strong> {template.subject?.subject_name ?? "Any subject"}</span>
            <span><strong>Total weight:</strong> {template.total_weight}%</span>
            <span><strong>Components:</strong> {template.component_count}</span>
          </div>
          <p className="sr-only">{scopeLabel(template)}</p>
          {template.description ? <p className="text-xs text-muted-foreground">{template.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {template.components.map((component) => (
              <span
                key={component.component_id}
                className="rounded-full border border-black px-2 py-1 text-xs font-semibold"
              >
                {component.component_name}: {component.weight}%
              </span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          {onEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(template)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Edit grading template"}
            >
              <Pencil className="size-4 mr-2" /> Edit
            </Button>
          ) : null}
          {template.status === "active" && onArchive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onArchive(template)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Archive grading template"}
            >
              <Archive className="size-4 mr-2" /> Archive
            </Button>
          ) : null}
          {template.status === "archived" && onRestore ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(template)}
              disabled={readOnly}
              title={readOnly ? readOnlyReason : "Restore grading template"}
            >
              <RotateCcw className="size-4 mr-2" /> Restore
            </Button>
          ) : null}
        </div>
      </div>
    </RetroCard>
  );
}
