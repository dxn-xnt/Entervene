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
      className="block w-full px-4 py-3 cursor-pointer"
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
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <FileText size={24} className="shrink-0" />
          <p className="font-semibold text-3xl">{title}</p>
        </div>

        <p className="text-sm">
          {subject} | Deadline {deadline}
        </p>
      </div>
    </Card>
  );
};

export default ToDoItem;
