import GradeItemLine from "@/components/item-line/grade";
import { SidebarTrigger } from "@/components/ui/sidebar";
import AppLayout from "@/layouts/app-layout";
import { useNavigate } from "react-router-dom";

type Grade = {
  section: string;
  subject: string;
};

const grades: Grade[] = [
  { section: "7 - Sapphire", subject: "Science" },
  { section: "7 - Ruby", subject: "Math" },
  { section: "7 - Gold", subject: "English" },
];

const Grades = () => {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col">
          <div className="flex flex-col gap-4 py-4 md:py-5 px-4 md:px-6 pb-6">
            <header className="flex items-center gap-3">
              <SidebarTrigger className="md:hidden" />
              <div>
                <h1 className="text-2xl md:text-4xl font-semibold">Grades</h1>
              </div>
            </header>
            <div className="-mx-4 md:-mx-6 border-b border-gray-500" />
            <div className="flex flex-col gap-3">
              {grades.map((grade) => (
                <GradeItemLine
                  key={grade.section}
                  section={grade.section}
                  subject={grade.subject}
                  onClick={() => navigate(`/teacher/grades/${encodeURIComponent(grade.section)}/${encodeURIComponent(grade.subject)}`)}
                />
              ))}
            </div>


          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default Grades;
