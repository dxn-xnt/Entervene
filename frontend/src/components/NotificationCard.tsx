import { Badge } from "@/components/retroui/Badge";
import { Card } from "@/components/retroui/Card";
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
    <Card className="flex items-center justify-between">
      <div className="flex flex-col gap-1">
        <p className="font-semibold text-xl md:text-3xl">{title}</p>
        <p className="text-sm">{description}</p>
        <p className="text-xs text-gray-500">{cardInfo}</p>
      </div>
      <div className="w-fit">
        <Badge variant={"surface"}>{badge}</Badge>
      </div>
    </Card>
  );
};

export default NotificationCard;
