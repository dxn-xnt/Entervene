import AppLayout from "@/layouts/app-layout";
import Card from "../../../components/StudentUIComponents/Card";
import { useNavigate } from "react-router-dom";
import { routes } from "@/../routes";

const Subjects = () => {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <header className="px-5 py-5 border-b border-gray-500">
        <h1 className="text-4xl font-semibold">Subjects</h1>
      </header>
      <main className="px-5 py-5 flex flex-row gap-4 min-h-screen">
        <div className="grid grid-cols-3 gap-4 self-start w-full">
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
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="Science & Technology"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="Mathematics"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
          <Card
            title="Filipino"
            onClick={() => navigate(routes.student.subjects)}
            teacher="Juan Dela Cruz"
            badges={[
              { label: "Quizzes", count: 1 },
              { label: "Assignments", count: 2 },
              { label: "Activities", count: 1 },
            ]}
          />
        </div>
      </main>
    </AppLayout>
  );
};

export default Subjects;