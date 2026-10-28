import { Link } from "react-router-dom";
import type { ClassListItem } from "@/types/adminClasses";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Avatar } from "@/components/retroui/Avatar";
import { Progress } from "@/components/retroui/Progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArchiveIcon, EllipsisIcon, PenIcon } from "lucide-react";
import { Button } from "@/components/admin/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/Tooltip";
import { classPathwayLabel } from "@/lib/class-pathway";

export default function ClassCard({ item, onEdit, onArchive }: {
  item: ClassListItem;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const isArchived = item.class_status.toLocaleLowerCase() === "archived";
  const adviserName = item.adviser
    ? [item.adviser.first_name, item.adviser.middle_name, item.adviser.last_name, item.adviser.suffix]
      .filter(Boolean)
      .join(" ")
    : "No adviser assigned";
  const pathwayLabel = classPathwayLabel({
    gradeLevel: item.academic_level.grade_level,
    requiresPathway: item.academic_level.requires_pathway,
    pathwayId: item.pathway_id,
    pathwayName: item.pathway?.name,
    pathwayEnabled: item.pathway?.is_enabled,
  });

  return (
    <Card className={`group relative flex min-w-[340px] shrink-0 flex-col justify-between shadow-none p-3 hover:-translate-y-1 ${isArchived ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/admin/classes/${item.class_id}`}
          className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
          aria-label={`View ${item.section_name}`}
        >
          <h3 className="text-2xl font-bold leading-tight">{item.section_name}</h3>
          {pathwayLabel && <p className="mt-1 text-xs font-semibold text-muted-foreground">Academic Pathway: {pathwayLabel}</p>}
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <Badge size="sm" variant={isArchived ? "default" : "secondary"}>
            {isArchived ? "Archived" : "Active"}
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
                    onClick={(e) => e.preventDefault()}
                  >
                    <EllipsisIcon className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </span>} />
              <TooltipContent>Class actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="rounded border-2">
              <DropdownMenuItem onClick={onEdit} className="gap-2 rounded">
                <PenIcon className="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive} disabled={isArchived} className="gap-2 rounded">
                <ArchiveIcon className="size-4" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Card body as link */}
      <Link
        to={`/admin/classes/${item.class_id}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
        tabIndex={-1}
        aria-hidden
      >
        {/* Stats */}
        <div className="mt-1 flex w-full flex-row gap-2">
          <Card className="p-2 px-4 shadow-none gap-3 w-full flex flex-row items-center">
            <Progress
              variant="circular"
              value={item.student_count > 0 ? (item.female_count / item.student_count) * 100 : 0}
              className="size-20"
            />
            <div className="flex flex-row items-baseline gap-1.5">
              <span className="font-head text-3xl font-black text-foreground">{item.female_count}</span>
              <span className="text-md font-medium text-foreground">{item.female_count === 1 ? "Girl" : "Girls"}</span>
            </div>
          </Card>
          <Card className="p-2 px-4 w-full shadow-none gap-3 flex flex-row items-center">
            <Progress
              variant="circular"
              value={item.student_count > 0 ? (item.male_count / item.student_count) * 100 : 0}
              className="size-20"
            />
            <div className="flex flex-row items-baseline gap-1.5">
              <span className="font-head text-3xl font-black text-foreground">{item.male_count}</span>
              <span className="text-md font-medium text-foreground">{item.male_count === 1 ? "Boy" : "Boys"}</span>
            </div>
          </Card>
          <Card className="p-2 px-4 bg-primary shadow-none flex flex-col items-center justify-center">
            <span className="font-head text-3xl font-black text-foreground">{item.student_count}</span>
            <span className="text-md font-medium text-foreground">{item.student_count === 1 ? "Student" : "Students"}</span>
          </Card>
        </div>

        {/* Adviser */}
        <div className="flex items-center gap-2 pt-3">
          <Avatar variant="teacher" className="size-10">
            <Avatar.Image src={item.adviser?.avatar || "/avatars/teacher-avatars/12.svg"} alt={adviserName} />
            <Avatar.Fallback className="bg-amber-200 text-amber-900 font-semibold rounded-full">
              {item.adviser ? adviserName.charAt(0) : "-"}
            </Avatar.Fallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="truncate text-md font-semibold text-foreground">{adviserName}</span>
            <span className="truncate text-xs font-medium text-muted-foreground">Adviser</span>
          </div>
        </div>
      </Link>
    </Card>
  );
}
