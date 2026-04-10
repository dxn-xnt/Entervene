type SubjectProps = {
  subject: string;
  date: string;
};

const SubjectCard = ({ subject, date }: SubjectProps) => {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 border border-black rounded-lg bg-[#FFFDF5] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
        <p className="font-semibold text-3xl">{subject}</p>
        <p className="text-sm">Assign since {date}</p>
    </div>
  );
};

export default SubjectCard;