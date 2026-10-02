import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import { formatDate } from "@/lib/classwork-utils";
import type { ClassworkTracking, TeacherClasswork } from "@/types/classwork";

type ClassworkListItemProps = {
  item: TeacherClasswork;
  tracking?: ClassworkTracking;
  onOpen: (item: TeacherClasswork) => void;
};

export default function ClassworkListItem({
  item,
  onOpen,
}: ClassworkListItemProps) {
  const openItem = () => onOpen(item);

  return (
    <Tooltip>
      <TooltipTrigger render={<Card
        className="w-full cursor-pointer transition-all p-3.5 sm:p-4 hover:shadow-none"
        role="button"
        tabIndex={0}
        onClick={openItem}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openItem();
          }
        }}
        aria-label={`Open ${item.title}`}
      >
        <div className="flex items-start justify-between gap-3 sm:gap-6 min-w-0">
          {/* Left Side: Title & Subtitle Metadata */}
          <div className="min-w-0 flex-1 flex flex-col justify-center gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-lg text-foreground line-clamp-1 break-words [overflow-wrap:anywhere]">
                {item.title}
              </h3>
            </div>

            <div className="text-sm  text-muted-foreground font-medium line-clamp-2">
              {"Created "}
              {formatDate(item.created_at)}
            </div>
          </div>

          {/* Right Side: Badges (top right) */}
          <div className="flex flex-col items-right align-right gap-2">
            <div className="flex flex-row gap-1.5">
              {/* <Badge variant="secondary" size="sm" className="whitespace-nowrap">
                {displayType(item.classwork_type)}
              </Badge> */}
              <Badge
                variant={item.is_published ? "solid" : "default"}
                size="sm"
                className="whitespace-nowrap"
              >
                {item.is_published ? "Published" : "Draft"}
              </Badge>
            </div>
          </div>
        </div>
      </Card>} />
      <TooltipContent>View classwork</TooltipContent>
    </Tooltip>
  );
}
