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
import { Button } from "@/components/retroui/Button";

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

  return (
    <Card className={`group relative bg-background shadow-none hover:-translate-y-1 ${isArchived ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <Link
          to={`/admin/classes/${item.class_id}`}
          className="min-w-0 flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded"
          aria-label={`View ${item.section_name}`}
        >
          <h3 className="text-2xl font-bold leading-tight">{item.section_name}</h3>
        </Link>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={isArchived ? "default" : "surface"}>
            {isArchived ? "Archived" : "Active"}
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
              <DropdownMenuItem onClick={onEdit} className="gap-2">
                <PenIcon className="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive} disabled={isArchived} className="gap-2">
                <ArchiveIcon className="size-4" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Card body as link */}
      <Link
        to={`/admin/classes/${item.class_id}`}
        className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1 rounded-lg"
        tabIndex={-1}
        aria-hidden
      >
        {/* Stats */}
        <div className="flex flex-row w-full mt-3 gap-2">
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
            <Avatar.Image src="/avatars/teacher-avatars/12.svg" alt={adviserName} />
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