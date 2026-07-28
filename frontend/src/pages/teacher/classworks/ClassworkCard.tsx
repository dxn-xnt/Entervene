import {
  BookOpen,
  CheckSquare,
  ClipboardList,
  FileText,
  Link as LinkIcon,
  type LucideIcon,
} from "lucide-react";

import { Card } from "@/components/retroui/Card";
import { Badge } from "@/components/retroui/Badge";
import { formatDate } from "@/lib/classwork-utils";
import type { TeacherClasswork } from "@/types/classwork";

const typeIcon: Record<string, LucideIcon> = {
  READING: BookOpen,
  ACTIVITY: CheckSquare,
  ASSIGNMENT: FileText,
  QUIZ: ClipboardList,
};

type ClassworkCardProps = {
  item: TeacherClasswork;
  onOpen: (item: TeacherClasswork) => void;
};

export default function ClassworkCard({ item, onOpen }: ClassworkCardProps) {
  const Icon = typeIcon[item.classwork_type.toUpperCase()] || ClipboardList;

  const assignmentCount = item.assignments?.length ?? 0;
  const attachmentCount = item.attachments?.length ?? 0;

  return (
    <Card
      className="block w-full cursor-pointer"
      onClick={() => onOpen(item)}
    >
      <Card.Content className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Icon size={19} className="shrink-0" />

            <Card.Title className="mb-0 truncate text-lg">
              {item.title}
            </Card.Title>
          </div>

          <p className="mt-1 text-xs font-medium text-gray-600">
            {[item.subject_name, `Created ${formatDate(item.created_at)}`]
              .filter(Boolean)
              .join(" | ")}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {assignmentCount > 0 && (
            <Badge
              variant="secondary"
              size="sm"
              className="flex items-center gap-1"
            >
              <LinkIcon size={12} />
              <span>Class {assignmentCount}</span>
            </Badge>
          )}

          {attachmentCount > 0 && (
            <Badge
              variant="secondary"
              size="sm"
              className="flex items-center gap-1"
            >
              <FileText size={12} />
              <span>File {attachmentCount}</span>
            </Badge>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}
