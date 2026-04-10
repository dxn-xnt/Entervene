import { Badge } from "../ui/badge";

type NotificationProps = {
  title: string;
  description: string;
  cardInfo: string;
  badge: string;
};

const NotificationCard = ({
  title,
  description,
  cardInfo,
  badge,
}: NotificationProps) => {
  return (
    <div className="flex flex-row justify-between items-center px-4 py-3 border border-black rounded-lg shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <p className="font-semibold text-3xl">{title}</p>
        </div>
        <div className="gap-2">
          <p className="text-sm">{description}</p>
          <p className="text-xs text-gray-500">{cardInfo}</p>
        </div>
      </div>
      <Badge variant={"destructive"} >{badge}</Badge>
    </div>
  );
};

export default NotificationCard;
