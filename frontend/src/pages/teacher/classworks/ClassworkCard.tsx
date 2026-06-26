import { BookOpen, CheckSquare, ClipboardList, FileText, Link as LinkIcon, type LucideIcon } from "lucide-react";
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
  // Summary card for the global teacher Classworks page.
  const Icon = typeIcon[item.classwork_type.toUpperCase()] || ClipboardList;
  const assignmentCount = item.assignments?.length ?? 0;
  const attachmentCount = item.attachments?.length ?? 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-black bg-white px-4 py-3 text-left shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition hover:-translate-y-0.5 hover:bg-[#F6E9B2]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Icon size={19} className="shrink-0" />
          <h2 className="truncate text-lg font-bold">{item.title}</h2>
        </div>
        <p className="mt-1 text-xs font-medium text-gray-600">
          {[item.subject_name, `Created ${formatDate(item.created_at)}`]
            .filter(Boolean)
            .join(" | ")}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2">
        {assignmentCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
            <LinkIcon size={12} />
            Class {assignmentCount}
          </span>
        )}
        {attachmentCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#7ABA78] px-3 py-1 text-xs font-semibold">
            <FileText size={12} />
            File {attachmentCount}
          </span>
        )}
      </div>
    </button>
  );
}
