import { Badge } from "./ui/badge";

type ListItemProps = {
  title: string;
  subject?: string;
  date?: string;
  badge?: string;
};

const ListItem = ({ title, subject, date, badge }: ListItemProps) => {
  return (
    <div className="flex flex-row justify-between items-center px-4 py-3 border border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <p className="font-semibold text-3xl">{title}</p>
        </div>
        <div className="flex flex-row gap-2 items-center text-sm">
          {/* Conditional separator */}
          <p>
            {subject && date ? `${subject} | ${date}` : subject || date || ""}
          </p>
        </div>
      </div>
      {badge && <Badge variant="destructive">{badge}</Badge>}
    </div>
  );
};

export default ListItem;
