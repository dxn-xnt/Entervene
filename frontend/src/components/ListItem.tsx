import { FileText } from "lucide-react";

type ListItemProps = {
  title: string;
  subject: string;
  deadline: string;
};

const ListItem = ({ title, subject, deadline }: ListItemProps) => {
  return (
    <div className="flex items-center px-4 py-3 border border-black rounded-lg bg-[#FFFDF5] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-4">
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
