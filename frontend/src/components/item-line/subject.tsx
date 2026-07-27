import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card as RetroCard } from "@/components/retroui/Card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ArchiveIcon, EllipsisIcon, PenIcon } from "lucide-react";

type CardProps = {
    isArchived?: boolean;
    className?: string;
    subject?: string;
    subjectName?: string;
    subjectCode?: string;
    subjectGroup?: string;
    hours?: number | string;
    gradingTemplate?: string;
    status?: string;
    date?: string;
    badge?: string;
    onClick?: () => void;
    onView?: () => void;
    onEdit?: () => void;
    onArchive?: () => void;
};

const SubjectItemLine = ({
    isArchived,
    className,
    subject,
    subjectName,
    subjectCode,
    subjectGroup,
    hours,
    gradingTemplate,
    status,
    date,
    badge,
    onClick,
    onView,
    onEdit,
    onArchive,
}: CardProps) => {
    const title = subjectName || subject;
    const statusLabel = status || badge;
    const handleMainClick = onClick || onView;
    const archived = isArchived ?? (statusLabel === "archived");
    const hasSubDetails = Boolean(subjectCode || date || subjectGroup || hours !== undefined || gradingTemplate);

    return (
        <RetroCard
            className={cn(
                "p-3 transition-colors",
                archived && "bg-black/5 border-dashed opacity-75 grayscale-[25%]",
                className
            )}
        >
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <button
                    type="button"
                    className="min-w-0 flex-1 text-left cursor-pointer"
                    onClick={handleMainClick}
                >
                    <div className="flex flex-wrap items-center gap-2 justify-between">
                        <p className={cn("text-2xl font-bold", archived && "text-black/70 line-through decoration-black/40")}>
                            {title}
                        </p>
                        <div className="flex flex-row items-center gap-2">
                            {statusLabel ? (
                                <Badge
                                    variant={archived ? "outline" : statusLabel === "active" ? "surface" : "outline"}
                                    className="capitalize"
                                >
                                    {statusLabel.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())}
                                </Badge>
                            ) : null}
                            {(onEdit || onArchive) ? (
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
                                            <DropdownMenuItem onClick={onEdit} className="gap-2">
                                                <PenIcon className="size-4" /> Edit
                                            </DropdownMenuItem>
                                        ) : null}
                                        {onArchive ? (
                                            <DropdownMenuItem onClick={onArchive} disabled={archived} className="gap-2">
                                                <ArchiveIcon className="size-4" /> Archive
                                            </DropdownMenuItem>
                                        ) : null}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : null}

                        </div>

                    </div>
                    {hasSubDetails ? (
                        <div className={cn("mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm", archived ? "text-black/50" : "text-black/70")}>
                            {subjectCode ? <span>{subjectCode}</span> : null}
                            {date ? <span>{date}</span> : null}
                            {subjectGroup ? <span>{subjectGroup}</span> : null}
                            {hours !== undefined ? <span>{hours} hours</span> : null}
                            {gradingTemplate ? <span>{gradingTemplate}</span> : null}
                        </div>
                    ) : null}
                </button>

            </div>
        </RetroCard>
    );
};

export default SubjectItemLine;

