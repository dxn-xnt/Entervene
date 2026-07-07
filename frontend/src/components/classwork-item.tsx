import { Monitor } from "lucide-react";

type ClassworkListItemProps = {
  title: string;
  submittedDate: string;
  status?: string;
};

const ClassworkListItem = ({
  title,
  submittedDate,
  status,
}: ClassworkListItemProps) => {
  return (
    <div className="flex items-center justify-between px-4 py-3 border border-black rounded-lg bg-[#FFFDF5] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <Monitor size={24} className="shrink-0" />
          <p className="font-semibold text-3xl">{title}</p>
        </div>
        <p className="text-sm">
          Submitted {submittedDate} | {status}
        </p>
      </div>
    </div>
  );
};

export default ClassworkListItem;
