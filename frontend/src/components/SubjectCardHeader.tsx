type SubjectHeaderProps = {
  title: string;
  teacher: string;
};

const SubjectCardHeader = ({ title, teacher }: SubjectHeaderProps) => {
  return (
    <div className="flex items-center px-4 py-3 border border-black rounded-lg bg-[#F6E9B2] shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
      <div className="flex flex-col gap-2">
        <div className="flex flex-row gap-3 items-center">
          <p className="font-semibold text-3xl">{title}</p>
        </div>

        <p className="text-sm">{teacher}</p>
      </div>
    </div>
  );
};

export default SubjectCardHeader;
