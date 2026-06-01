import AppLayout from "@/layouts/app-layout";
import Card from "../../components/StudentUIComponents/Card";
import { ArrowUpRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";

const StoryBoard = () => {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Story Board</h1>
      </header>
      <main className="px-5 py-5 flex flex-row gap-4 min-h-screen">
        <div className="grid grid-cols-2 gap-4 w-[65%] self-start">
          <Card
            title="Computer Programming"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="English"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Marie Tess"
            badges={[
              { label: "Assignments", count: 1 },
              { label: "Readings", count: 1 },
            ]}
          />
          <Card
            title="Science & Technology"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Jose Rizal"
            badges={[{ label: "Tasks All Completed", count: 0 }]}
          />
          <Card
            title="Mathematics"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Maria Clara"
            badges={[
              { label: "Activities", count: 1 },
              { label: "Readings", count: 1 },
            ]}
          />
          <Card
            title="Filipino"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Maripusa"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Readings", count: 1 },
            ]}
          />
          <Card
            title="System Designs"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Alden Richards"
            badges={[{ label: "Tasks All Completed", count: 0 }]}
          />
        </div>

        <div className="w-[35%] border rounded px-5 py-5 self-stretch shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
          <div className="flex flex-row justify-between items-center">
            <h2 className="text-3xl font-semibold">To do</h2>
            <button
              onClick={() => navigate(routes.student.todo)}
              className="border border-black rounded-full p-1 cursor-pointer"
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
        </div>
      </main>
    </AppLayout>
  );
};

export default StoryBoard;
