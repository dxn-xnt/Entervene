import { FileText } from "lucide-react";
import { Card } from "@/components/retroui/Card";

type ListItemProps = {
  title: string;
  subject: string;
  deadline: string;
  onClick?: () => void;
};

const ToDoItem = ({ title, subject, deadline, onClick }: ListItemProps) => {
  return (
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
            <FileText size={19} className="mt-0.5 shrink-0" />
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
};

export default ToDoItem;
