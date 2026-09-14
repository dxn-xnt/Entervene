import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import { Archive, Ellipsis, Lock, Pencil, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GradingTemplateListItem } from "@/lib/api";
import { scopeLabel, statusBadge } from "./subject-utils";
import { Badge } from "@/components/retroui/Badge";

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
  const assignedCount = template.assigned_subjects?.length ?? (template.subject ? 1 : 0);
  const assignedSubjects = template.assigned_subjects ?? (template.subject ? [template.subject] : []);

  return (
    <RetroCard className="p-3 bg-primary">
      <div className="min-w-0 flex-1 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-bold text-2xl">{template.template_name}</p>
          <div className="flex flex-row gap-2 items-center">
            {statusBadge(template.status)}
            {template.is_locked ? (
              <Badge size="sm" variant="solid" className="flex flex-row items-center gap-1 border-2 border-black">
                <Lock className="size-3" /> Term Locked
              </Badge>
            ) : null}
            <div className="flex shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6.5 w-6.5 p-0 shadow-none"
                    disabled={readOnly}
                    title={readOnly ? readOnlyReason : "Actions"}
                    aria-label="Actions"
                  >
                    <Ellipsis className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="border-2 min-w-[140px]">
                  {onEdit ? (
                    <DropdownMenuItem
                      onClick={() => onEdit(template)}
                      disabled={readOnly}
                      className="gap-2 cursor-pointer"
                    >
                      <Pencil className="size-4" /> Edit
                    </DropdownMenuItem>
                  ) : null}
                  {template.status === "active" && onArchive ? (
                    <DropdownMenuItem
                      onClick={() => onArchive(template)}
                      disabled={readOnly}
                      className="gap-2 cursor-pointer"
                    >
                      <Archive className="size-4" /> Archive
                    </DropdownMenuItem>
                  ) : null}
                  {template.status === "archived" && onRestore ? (
                    <DropdownMenuItem
                      onClick={() => onRestore(template)}
                      disabled={readOnly}
                      className="gap-2 cursor-pointer"
                    >
                      <RotateCcw className="size-4" /> Restore
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

        </div>

        <div className="flex flex-col gap-2 p-2 bg-background border-border border-2">
          <span><strong>Academic scope:</strong> {template.academic_level?.level_name ?? "Any level"}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <strong>Assigned subjects </strong> <span className="text-sm">({assignedCount}):</span>{" "}
            {assignedSubjects.length > 0 ? (
              assignedSubjects.map((s) => (
                <Badge key={s.subject_id} size="sm" variant="surface">
                  {s.subject_name}
                </Badge>
              ))
            ) : (
              <span>General / Default template</span>
            )}
          </div>
          <span><strong>Components:</strong> {template.component_count}</span>
        </div>
        <p className="sr-only">{scopeLabel(template)}</p>
        <div className="flex gap-2">
          {template.components.map((component) => (
            <Badge
              key={component.component_id}
              variant="outline"
              className="flex flex-col w-full"

            >
              <span className="font-medium whitespace-nowrap">
                {component.component_name}:
              </span>
              <span className="font-bold text-lg">
                {component.weight}%
              </span>
            </Badge>
          ))}
        </div>
        {template.description ? <p className="text-xs text-foreground">{template.description}</p> : null}
      </div>

    </RetroCard>
  );
}
