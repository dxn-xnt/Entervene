type Badge = {
  label: string;
  count: number;
  icon?: string;
};

type CardProps = {
  title: string;
  teacher: string;
  badges: Badge[];
};

const Card = ({ title, teacher, badges }: CardProps) => {
  return (
    <div className="border rounded-lg p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <h2 className="text-3xl font-semibold truncate">{title}</h2>
      <p className="text-sm">{teacher}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        {badges.map((badge) => (
          <span
            key={badge.label}
            className="border border-yellow-400 rounded-full px-3 py-1 text-xs text-yellow-600"
          >
            {badge.label} {badge.count}
          </span>
        ))}
      </div>
    </div>
  );
};

export default Card;