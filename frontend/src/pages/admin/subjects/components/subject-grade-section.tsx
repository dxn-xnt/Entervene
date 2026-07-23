import { Badge } from "@/components/retroui/Badge";
import { Button } from "@/components/retroui/Button";
import { Card } from "@/components/retroui/Card";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { SubjectListItem } from "@/lib/api";
import type { GradeGroup } from "./subject-utils";
import { SubjectCatalogCard } from "./subject-catalog-card";

export function SubjectGradeSection({
  group,
  onArchive,
}: {
  group: GradeGroup;
  onArchive: (subject: SubjectListItem) => void;
}) {
  const navigate = useNavigate();

  return (
    <Card
      className="flex flex-col bg-primary gap-2"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">{group.grade}</h2>
        <div className="flex flex-row gap-3">
          <Badge variant={"outline"} className="border-border">
            {group.subjects.length} subject
            {group.subjects.length !== 1 ? "s" : ""}
          </Badge>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => navigate(`/admin/subjects/${encodeURIComponent(group.grade)}`)}
            title={`View ${group.grade}`}
          >
            <ArrowUpRight className="size-4" />
          </Button>
        </div>

      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {group.subjects.map((subject) => (
          <SubjectCatalogCard key={subject.subject_id} subject={subject} onArchive={onArchive} />
        ))}
      </div>
    </Card>
  );
}
