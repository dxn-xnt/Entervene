import { ChevronRight } from "lucide-react";
import Card from "../../../components/TeacherUIComponents/SubjectCard";
import AppLayout from "@/layouts/app-layout";
import { Link } from "react-router-dom";
import { routes } from "@/../routes";

const Subject = () => {
  return (
    <AppLayout>
      <header className="px-5 py-5 flex items-center gap-3 border-b border-gray-500">
        <Link
          to={routes.teacher.classes}
          className="text-4xl font-semibold cursor-pointer"
        >
          Classes
        </Link>
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
    </AppLayout>
  );
};

export default Subject;
