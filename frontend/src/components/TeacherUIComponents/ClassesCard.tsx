type Badge = {
  label: string;
  count: number;
  icon?: string;
};

type CardProps = {
  title: string;
  subtitle?: string;
  badges: Badge[];
  onClick?: () => void;
};

const Card = ({ title, subtitle, badges, onClick }: CardProps) => {
  return (
    <div
      onClick={onClick}
      className={`bg-[#F6E9B2] border rounded-lg p-4 ${onClick ? "cursor-pointer" : ""}`}
    >
      <h2 className="text-3xl font-semibold">{title}</h2>
      <p className="font-semibold">{subtitle}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        {badges.map((badge) => (
          <span
            key={badge.label}
            className="bg-white border rounded-full px-3 py-1 text-xs"
          >
            {badge.label} {badge.count}
          </span>
        ))}
      </div>
    </div>
  );
};

export default Card;
