import { Badge } from "@/components/retroui/Badge";

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
    <div className="flex flex-col gap-2 md:flex-row md:justify-between md:items-center px-4 py-3 border-2 border-black rounded-lg shadow-md">
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-xl md:text-3xl">{title}</p>
        <p className="text-sm">{description}</p>
        <p className="text-xs text-gray-500">{cardInfo}</p>
      </div>
      <div className="w-fit">
        <Badge variant={"surface"}>{badge}</Badge>
      </div>
    </div>
  );
};

export default NotificationCard;
