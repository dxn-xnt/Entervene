import { BookOpen, CheckSquare, ClipboardList, FileText } from "lucide-react";
import { Card } from "@/components/retroui/Card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/retroui/tooltip";

type ListItemProps = {
  title: string;
  subject: string;
  deadline: string;
  type?: string | null;
  category?: string | null;
  onClick?: () => void;
};

const getClassworkIcon = (type?: string | null, category?: string | null) => {
  const normalized = (type || category || "").toUpperCase();
  switch (normalized) {
    case "READING":
    case "READINGS":
      return <BookOpen size={19} className="mt-0.5 shrink-0" />;
    case "ACTIVITY":
    case "ACTIVITIES":
      return <CheckSquare size={19} className="mt-0.5 shrink-0" />;
    case "QUIZ":
    case "QUIZZES":
      return <ClipboardList size={19} className="mt-0.5 shrink-0" />;
    case "ASSIGNMENT":
    case "ASSIGNMENTS":
    default:
      return <FileText size={19} className="mt-0.5 shrink-0" />;
  }
};

const ToDoItem = ({ title, subject, deadline, type, category, onClick }: ListItemProps) => {
  const icon = getClassworkIcon(type, category);

  const card = (
    <Card
      onClick={onClick}
      className="block w-full cursor-pointer"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onClick) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <Card.Content className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {icon}
            <Card.Title className="mb-0 text-sm font-bold line-clamp-2 break-words [overflow-wrap:anywhere] md:text-base">
              {title}
            </Card.Title>
          </div>

          <p className="mt-1 text-xs font-medium text-gray-600">
            {subject} | Deadline {deadline}
          </p>
        </div>
      </Card.Content>
    </Card>
  );

  return onClick ? (
    <Tooltip>
      <TooltipTrigger render={card} />
      <TooltipContent>View classwork</TooltipContent>
    </Tooltip>
  ) : card;
};

export default ToDoItem;

