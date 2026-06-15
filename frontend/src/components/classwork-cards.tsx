import { Badge } from "@/components/retroui/Badge";

type CardProps = {
  title: string;
  subject?: string;
  date?: string;
  badge?: string;
};

const Cards = ({ title, subject, date, badge }: CardProps) => {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:justify-between md:items-center px-4 py-3 border border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2">
        <p className="font-semibold text-xl md:text-3xl">{title}</p>
        <div className="text-sm text-gray-600">
          <p>
            {subject && date ? `${subject} | ${date}` : subject || date || ""}
          </p>
        </div>
      </div>
      {badge && (
        <div className="w-fit">
          <Badge variant="surface">{badge}</Badge>
        </div>
      )}
    </div>
  );
};

export default Cards;
