import { ChevronRight } from "lucide-react";
import Card from "../../../components/TeacherUIComponents/SubjectCard";
type SubjectProps = {
  setActiveNav: (nav: string) => void;
};

const Subject = ({ setActiveNav }: SubjectProps) => {
  return (
    <div>
      <header className="px-5 py-5 flex items-center gap-3 border-b border-gray-500">
        <button
          onClick={() => setActiveNav("Classes")}
          className="text-4xl font-semibold cursor-pointer"
        >
          Classes
        </button>
        <ChevronRight size={40} />
        <h1 className="text-3xl">Subjects</h1>
      </header>
      <main className="px-5 py-5 flex flex-col gap-5">
        <Card 
          subject="Computer Programming"
          date="November 10, 2026"
        />
        <Card 
          subject="English"
          date="November 10, 2026"
        />
      </main>
    </div>
  );
};

export default Subject;