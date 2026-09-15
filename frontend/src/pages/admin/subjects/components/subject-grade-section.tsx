import * as React from "react";
import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Accordion } from "@/components/retroui/Accordion";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SubjectListItem } from "@/lib/api";
import type { GradeGroup } from "./subject-utils";
import { SubjectCatalogCard } from "./subject-catalog-card";

const INITIAL_LIMIT = 4;

export function SubjectGradeSection({
  group,
  onEdit,
  onArchive,
}: {
  group: GradeGroup;
  onEdit?: (subject: SubjectListItem) => void;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();
  const accordionValue = String(group.academicLevelId ?? group.grade);
  const [isExpanded, setIsExpanded] = React.useState(false);

  const displayedSubjects = isExpanded
    ? group.subjects
    : group.subjects.slice(0, INITIAL_LIMIT);
  const remainingCount = group.subjects.length - INITIAL_LIMIT;

  return (
    <Accordion
      multiple
      defaultValue={[accordionValue]}
      className="w-full"
    >
      <Accordion.Item
        value={accordionValue}
        className="border-2 border-border bg-background shadow-md overflow-hidden rounded-none"
      >
        <Accordion.Header className="items-center px-4 py-3 bg-primary text-foreground">
          <div className="flex items-center justify-between w-full mr-2">
            <h2 className="text-xl font-bold">{group.grade}</h2>
            <div className="flex items-center gap-2">
              <Badge size="sm" variant="outline" className="border-border bg-background">
                {group.subjects.length} subject
                {group.subjects.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </div>
        </Accordion.Header>

        <Accordion.Content className="p-4 pt-3 border-t-2 border-border bg-background">
          {group.subjects.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground font-medium">
              No subjects available for this grade.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 py-1">
              {displayedSubjects.map((subject) => (
                <SubjectCatalogCard
                  key={subject.subject_id}
                  subject={subject}
                  onEdit={onEdit}
                  onArchive={onArchive}
                />
              ))}
            </div>
          )}
          <div className="flex items-center justify-between pt-2 -mb-1">
            <div>
              {group.subjects.length > INITIAL_LIMIT && (
                <Button
                  variant="default"
                  size="sm"
                  autoIcon={false}
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="border-2 border-border shadow-none text-xs font-bold px-3 py-1.5 h-auto rounded"
                >
                  {isExpanded ? "Show less" : `Show ${remainingCount} more`}
                </Button>
              )}
            </div>
            <Button
              variant="link"
              className="p-0 text-sm text-foreground inline-flex items-center gap-1"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                navigate(`/admin/subjects/${encodeURIComponent(group.grade)}`);
              }}
              title={`View ${group.grade}`}
            >
              View all subjects
              <ArrowUpRight className="size-4" />
            </Button>
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion>
  );
}



