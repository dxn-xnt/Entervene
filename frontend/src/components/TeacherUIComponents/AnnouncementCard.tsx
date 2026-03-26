type AnnouncementCardProps = {
  title: string;
  category: string;
  dateTime: string;
};

const Announcement = ({ title, category, dateTime }: AnnouncementCardProps) => {
  return (
    <div className="flex flex-col gap-2 border rounded p-4">
      <div className="flex flex-row gap-2">
        <h2 className="text-2xl font-semibold truncate">{title}</h2>
        <p className="text-sm font-light self-end">
          (<span className="italic">{category}</span>)
        </p>
      </div>
      <p className="text-sm">{dateTime}</p>
    </div>
  );
};

export default Announcement;
