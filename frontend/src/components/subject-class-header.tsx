import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";
import type { TeacherAdvisoryClassDetailResponse } from "@/types/adminClasses";

export interface SubjectClassHeaderProps {
  detail: {
    class_id: number | string;
    section_name?: string;
    academic_level?: string;
    is_archived?: boolean;
  };
  currentSubject?: {
    subject_id: number;
    subject_name: string;
  } | null;
  statusLabel?: string;
  className?: string;
  showViewSubjectButton?: boolean;
}

export function SubjectClassHeader({
  detail,
  currentSubject,
  statusLabel,
  className,
  showViewSubjectButton = true,
}: SubjectClassHeaderProps) {
  const navigate = useNavigate();
  const computedStatus = statusLabel ?? (detail.is_archived ? "Archived" : "Active");
  const title = currentSubject?.subject_name || detail.section_name || "Subject";
  const subtitle = [detail.section_name, detail.academic_level].filter(Boolean).join(" | ");

  return (
    <Card className={`block w-full border-black bg-primary transition-none hover:shadow-md pt-3 pb-4 ${className || ""}`}>
      <Card.Content>
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Card.Title
                    className="mb-0 truncate text-2xl font-extrabold sm:text-3xl"
                    tabIndex={0}
                  >
                    {title}
                  </Card.Title>
                }
              />
              <TooltipContent>{title}</TooltipContent>
            </Tooltip>
          </div>
          <div className="flex shrink-0 flex-row items-center gap-2">
            <Badge
              variant="outline"
              size="sm"
              className="w-fit font-black"
            >
              {computedStatus}
            </Badge>
            {showViewSubjectButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="inline-flex">
                      <Button
                        variant="secondary"
                        className="shadow-none p-1"
                        size="sm"
                        aria-label={`View ${title}`}
                        onClick={() => {
                          if (currentSubject) {
                            navigate(
                              `/teacher/classes/${detail.class_id}/subjects/${currentSubject.subject_id}`,
                            );
                          }
                        }}
                      >
                        <ArrowUpRight className="size-4" />
                      </Button>
                    </span>
                  }
                />
                <TooltipContent>View subject</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {subtitle && (
          <p className="text-sm mt-1">
            {subtitle}
          </p>
        )}
      </Card.Content>
    </Card>
  );
}

export default SubjectClassHeader;
