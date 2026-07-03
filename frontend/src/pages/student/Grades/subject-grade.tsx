import AppLayout from "@/layouts/app-layout";
import { ChevronRight, ChevronLeft } from "lucide-react";

type SubjectGradeProps = {
  subject: string;
  onBack: () => void;
};

const SubjectGrade = ({ subject, onBack }: SubjectGradeProps) => {
  return (
    <AppLayout>
      <header className="px-5 py-5 flex items-center gap-3 border-b border-gray-500">
        <h1 className="flex flex-wrap items-center gap-1.5 text-3xl font-bold tracking-tight">
          <button
            onClick={onBack}
            className="text-black/50 hover:text-black hover:underline transition-colors cursor-pointer"
          >
            Grades
          </button>
          <ChevronRight className="size-5 text-black/30" />
          <span className="text-2xl text-black">{subject}</span>
        </h1>
      </header>
      <main className="px-5 py-5"></main>
    </AppLayout>
  );
};

export default SubjectGrade;
