import { ChevronRight } from "lucide-react";
import { ChevronLeft } from "lucide-react";

type SubjectGradeProps = {
  subject: string;
  onBack: () => void;
};

const SubjectGrade = ({ subject, onBack }: SubjectGradeProps) => {
  return (
    <div>
      <header className="px-5 py-5 flex items-center gap-3 border-b border-gray-500">
        <button
          onClick={onBack}
          className="text-4xl font-semibold cursor-pointer"
        >
          Grades
        </button>
        <ChevronRight size={40} />
        <h1 className="text-3xl">{subject}</h1>
      </header>
      <main className="px-5 py-5">
        <div>
          <button
            onClick={onBack}
            className="text-3xl font-semibold cursor-pointer flex flex-row"
          >
            <ChevronLeft size={40} />
            Grades
          </button>
        </div>
      </main>
    </div>
  );
};

export default SubjectGrade;
