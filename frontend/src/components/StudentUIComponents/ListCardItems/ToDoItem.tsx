import { FileText } from "lucide-react";

type ListItemProps = {
  title: string;
  subject: string;
  deadline: string;
};

const ListItem = ({ title, subject, deadline }: ListItemProps) => {
  return (
    <div className="flex items-center px-4 py-3 border-2 border-black rounded-lg shadow-md hover:shadow-none transition-all cursor-pointer bg-card">
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <FileText size={24} className="shrink-0" />
          <p className="font-semibold text-3xl">{title}</p> 
        </div>

        <p className="text-sm">
          {subject} | Deadline {deadline}
        </p>
      </div>
    </div>
  );
};

export default ListItem;
